#include "Uploads.h"
#include "CryptoUtils.h"
#include "TextUtils.h"
#include "../../shared/crypto/common_consts.h"
#include <drogon/drogon.h>
#include <trantor/utils/Logger.h>
#include <cctype>
#include <cstring>
#include <filesystem>
#include <set>

namespace fs = std::filesystem;

namespace Uploads {

static const std::string kPrefix = "/uploads/";
static constexpr size_t kMaxFileNameLen = 255;

// Файлы, которые браузер может исполнить как страницу/скрипт, и исполняемые файлы ОС —
// такие вложения не принимаем, даже если они будут только скачиваться
static const std::set<std::string> kDeniedExtensions = {
    "html", "htm", "shtml", "xhtml", "xht", "mht", "mhtml", "svg", "svgz", "xml", "xsl", "xslt",
    "js", "mjs", "cjs", "php", "phtml",
    "exe", "bat", "cmd", "com", "scr", "pif", "cpl", "msi", "msp", "dll", "jar", "app", "lnk", "reg",
    "sh", "bash", "ps1", "psm1", "vbs", "vbe", "wsf", "wsh", "hta",
};

// Расширение по сигнатуре (magic bytes), а не по имени файла; "" — не картинка
static std::string imageExtension(std::string_view c) {
    const auto* b = reinterpret_cast<const unsigned char*>(c.data());
    if (c.size() >= 8 && b[0] == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G') return "png";
    if (c.size() >= 6 && c.substr(0, 4) == "GIF8")                              return "gif";
    if (c.size() >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF)           return "jpg";
    if (c.size() >= 12 && c.substr(0, 4) == "RIFF" && c.substr(8, 4) == "WEBP")  return "webp";
    return "";
}

// Расширение из имени файла: только латиница и цифры, до 10 символов, в нижнем регистре; иначе ""
static std::string nameExtension(std::string_view name) {
    const auto dot = name.rfind('.');
    if (dot == std::string_view::npos) return "";
    std::string ext(name.substr(dot + 1));
    if (ext.empty() || ext.size() > 10) return "";
    for (char& c : ext) {
        if (!std::isalnum(static_cast<unsigned char>(c))) return "";
        c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    }
    return ext;
}

static bool tooLarge(const drogon::HttpFile& file, Saved& out) {
    if (file.fileLength() <= static_cast<size_t>(Vicinity::MAX_UPLOAD_SIZE)) return false;
    out.code  = drogon::k413RequestEntityTooLarge;
    out.error = "Файл слишком большой (макс 15 МБ)";
    return true;
}

// Сохраняет файл под случайным именем в <upload_path>/<subDir>/; ext может быть пустым
static void store(const drogon::HttpFile& file, const std::string& subDir, const std::string& ext, Saved& out) {
    const std::string name = CryptoUtils::randomHex(16) + (ext.empty() ? "" : "." + ext);
    // Относительный путь saveAs() дописывает к upload_path и сам создаёт подкаталог
    if (file.saveAs(subDir + "/" + name) != 0) {
        LOG_ERROR << "Upload: cannot save " << subDir << "/" << name;
        out.code  = drogon::k500InternalServerError;
        out.error = "Не удалось сохранить файл";
        return;
    }
    out.url = kPrefix + subDir + "/" + name;
}

Saved saveImage(const drogon::HttpFile& file, const std::string& subDir) {
    Saved out;
    if (tooLarge(file, out)) return out;
    const std::string ext = imageExtension(file.fileContent());
    if (ext.empty()) {
        out.code  = drogon::k415UnsupportedMediaType;
        out.error = "Only PNG, JPG, GIF, WEBP allowed";
        return out;
    }
    store(file, subDir, ext, out);
    return out;
}

Attachment saveAttachment(const drogon::HttpFile& file) {
    Attachment out;
    if (tooLarge(file, out)) return out;
    out.name = cleanFileName(file.getFileName());
    out.size = static_cast<int64_t>(file.fileLength());
    // Картинка определяется по содержимому; всё остальное — файл, расширение берём из имени
    std::string ext = imageExtension(file.fileContent());
    if (!ext.empty()) {
        out.type = "image";
        store(file, "attachments", ext, out);
        return out;
    }
    ext = nameExtension(out.name);
    if (kDeniedExtensions.count(ext)) {
        out.code  = drogon::k415UnsupportedMediaType;
        out.error = "Файлы этого типа отправлять нельзя";
        return out;
    }
    out.type = "file";
    store(file, "files", ext, out);
    if (out.error.empty()) rememberName(out.url, out.name);   // для Content-Disposition при скачивании
    return out;
}

bool isUploadUrl(const std::string& url, const std::string& subDir) {
    const std::string prefix = kPrefix + subDir + "/";
    if (url.size() <= prefix.size() || url.compare(0, prefix.size(), prefix) != 0) return false;
    if (url.find("..") != std::string::npos) return false;
    for (size_t i = prefix.size(); i < url.size(); ++i) {
        const char c = url[i];
        const bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
                        (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '-';
        if (!ok) return false;
    }
    return true;
}

std::string attachmentType(const std::string& url) {
    if (isUploadUrl(url, "attachments")) return "image";
    if (isUploadUrl(url, "files"))       return "file";
    return "";
}

int64_t fileSize(const std::string& url) {
    if (attachmentType(url).empty()) return 0;
    std::error_code ec;
    const auto size = fs::file_size(fs::path(drogon::app().getUploadPath()) / url.substr(kPrefix.size()), ec);
    return ec ? 0 : static_cast<int64_t>(size);
}

void rememberName(const std::string& url, const std::string& name) {
    if (name.empty() || !isUploadUrl(url, "files")) return;
    try {
        drogon::app().getDbClient()->execSqlSync(
            "INSERT OR REPLACE INTO upload_names(url, name) VALUES(?, ?)", url, name);
    } catch (const std::exception& e) {
        LOG_WARN << "Upload: cannot remember name of " << url << ": " << e.what();
    }
}

std::string downloadName(const std::string& url) {
    if (!isUploadUrl(url, "files")) return "";
    try {
        auto r = drogon::app().getDbClient()->execSqlSync("SELECT name FROM upload_names WHERE url = ?", url);
        if (!r.empty() && !r[0]["name"].isNull()) return r[0]["name"].as<std::string>();
    } catch (const std::exception& e) {
        LOG_WARN << "Upload: cannot read name of " << url << ": " << e.what();
    }
    return "";
}

std::string contentDisposition(const std::string& name) {
    if (name.empty()) return "attachment";
    // Запасное имя для старых браузеров: печатный ASCII без кавычек и обратной косой черты,
    // каждый прочий символ (а не каждый его байт UTF-8) — «_»
    std::string ascii;
    for (unsigned char c : name) {
        if ((c & 0xC0) == 0x80) continue;   // продолжение многобайтового символа
        ascii += (c >= 0x20 && c < 0x7F && c != '"' && c != '\\') ? static_cast<char>(c) : '_';
    }
    // attr-char из RFC 5987 оставляем как есть, остальные байты UTF-8 — %XX
    static const char* kHex = "0123456789ABCDEF";
    std::string encoded;
    for (unsigned char c : name) {
        if ((c < 0x80 && std::isalnum(c)) || std::strchr("!#$&+-.^_`|~", c) != nullptr) {
            encoded += static_cast<char>(c);
        } else {
            encoded += '%';
            encoded += kHex[c >> 4];
            encoded += kHex[c & 0x0F];
        }
    }
    return "attachment; filename=\"" + ascii + "\"; filename*=UTF-8''" + encoded;
}

std::string cleanFileName(std::string_view raw) {
    const auto slash = raw.find_last_of("/\\");
    if (slash != std::string_view::npos) raw = raw.substr(slash + 1);
    if (!TextUtils::isValidUtf8(raw) || TextUtils::hasControlChars(raw)) return "";
    return TextUtils::trim(TextUtils::utf8Truncate(raw, kMaxFileNameLen));
}

void removeByUrl(const std::string& url) {
    const auto slash = url.find('/', kPrefix.size());
    if (slash == std::string::npos) return;
    const std::string subDir = url.substr(kPrefix.size(), slash - kPrefix.size());
    if (!isUploadUrl(url, subDir)) return;
    std::error_code ec;
    fs::remove(fs::path(drogon::app().getUploadPath()) / url.substr(kPrefix.size()), ec);
    if (ec) LOG_WARN << "Upload: cannot remove " << url << ": " << ec.message();
    if (subDir == "files") {
        try {
            drogon::app().getDbClient()->execSqlSync("DELETE FROM upload_names WHERE url = ?", url);
        } catch (...) {}
    }
}

} // namespace Uploads
