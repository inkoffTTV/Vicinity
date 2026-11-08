#include "Uploads.h"
#include "CryptoUtils.h"
#include "TextUtils.h"
#include "../../shared/crypto/common_consts.h"
#include <drogon/drogon.h>
#include <trantor/utils/Logger.h>
#include <cctype>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <functional>
#include <map>
#include <set>
#include <sys/stat.h>

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

// Расширение звука, видео и PDF по сигнатуре: для файлов без расширения в имени (aiogram URLInputFile шлёт
// случайное имя без точки, §21.7); "" — не узнали
static std::string mediaExtension(std::string_view c) {
    const auto* b = reinterpret_cast<const unsigned char*>(c.data());
    if (c.size() >= 4 && c.substr(0, 4) == "OggS") return "ogg";
    if (c.size() >= 4 && c.substr(0, 4) == "fLaC") return "flac";
    if (c.size() >= 5 && c.substr(0, 5) == "%PDF-") return "pdf";
    if (c.size() >= 12 && c.substr(0, 4) == "RIFF" && c.substr(8, 4) == "WAVE") return "wav";
    if (c.size() >= 12 && c.substr(4, 4) == "ftyp") {
        const std::string_view brand = c.substr(8, 4);
        return brand == "M4A " || brand == "M4B " ? "m4a" : brand == "qt  " ? "mov" : "mp4";
    }
    if (c.size() >= 4 && b[0] == 0x1A && b[1] == 0x45 && b[2] == 0xDF && b[3] == 0xA3)
        return c.substr(0, 64).find("webm") != std::string_view::npos ? "webm" : "mkv";
    if (c.size() >= 3 && c.substr(0, 3) == "ID3") return "mp3";
    // Кадр MPEG без тега ID3: синхрослово 11 бит, Layer III, допустимые битрейт и частота; ADTS — AAC
    if (c.size() >= 4 && b[0] == 0xFF && (b[1] & 0xE0) == 0xE0 && (b[2] >> 4) != 0x0F && ((b[2] >> 2) & 0x03) != 0x03) {
        if ((b[1] & 0xF6) == 0xF0) return "aac";
        if ((b[1] & 0x06) == 0x02 && (b[1] & 0x18) != 0x08) return "mp3";
    }
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

static bool tooLarge(size_t length, int64_t maxBytes, Saved& out) {
    if (maxBytes <= 0) maxBytes = Vicinity::MAX_UPLOAD_SIZE;
    if (length <= static_cast<size_t>(maxBytes)) return false;
    out.code  = drogon::k413RequestEntityTooLarge;
    out.error = "Файл слишком большой (макс " + std::to_string(maxBytes / (1024 * 1024)) + " МБ)";
    return true;
}

static bool tooLarge(const drogon::HttpFile& file, int64_t maxBytes, Saved& out) {
    return tooLarge(file.fileLength(), maxBytes, out);
}

// Записывает файл в <upload_path>/<relative>: 0 — успех (как HttpFile::saveAs)
using Writer = std::function<int(const std::string& relative)>;

// Сохраняет файл под случайным именем в <upload_path>/<subDir>/; ext может быть пустым
static void store(const Writer& write, const std::string& subDir, const std::string& ext, Saved& out) {
    const std::string name = CryptoUtils::randomHex(16) + (ext.empty() ? "" : "." + ext);
    // Относительный путь saveAs() дописывает к upload_path и сам создаёт подкаталог
    if (write(subDir + "/" + name) != 0) {
        LOG_ERROR << "Upload: cannot save " << subDir << "/" << name;
        out.code  = drogon::k500InternalServerError;
        out.error = "Не удалось сохранить файл";
        return;
    }
    out.url = kPrefix + subDir + "/" + name;
}

static void store(const drogon::HttpFile& file, const std::string& subDir, const std::string& ext, Saved& out) {
    store([&file](const std::string& rel) { return file.saveAs(rel); }, subDir, ext, out);
}

Saved saveImage(const drogon::HttpFile& file, const std::string& subDir) {
    Saved out;
    if (tooLarge(file, Vicinity::MAX_UPLOAD_SIZE, out)) return out;
    const std::string ext = imageExtension(file.fileContent());
    if (ext.empty()) {
        out.code  = drogon::k415UnsupportedMediaType;
        out.error = "Only PNG, JPG, GIF, WEBP allowed";
        return out;
    }
    store(file, subDir, ext, out);
    return out;
}

// Общая часть saveAttachment/saveAttachmentData: content — содержимое, name — уже очищенное имя
static Attachment saveAttachmentWith(std::string_view content, const std::string& name, const Writer& write) {
    Attachment out;
    out.name = name;
    out.size = static_cast<int64_t>(content.size());
    // Картинка определяется по содержимому; всё остальное — файл, расширение берём из имени
    std::string ext = imageExtension(content);
    if (!ext.empty()) {
        out.type = "image";
        store(write, "attachments", ext, out);
        return out;
    }
    ext = nameExtension(out.name);
    if (ext.empty()) ext = mediaExtension(content);   // имя без расширения: по содержимому
    if (kDeniedExtensions.count(ext)) {
        out.code  = drogon::k415UnsupportedMediaType;
        out.error = "Файлы этого типа отправлять нельзя";
        return out;
    }
    out.type = "file";
    store(write, "files", ext, out);
    if (out.error.empty()) rememberName(out.url, out.name);   // для Content-Disposition при скачивании
    return out;
}

Attachment saveAttachment(const drogon::HttpFile& file, int64_t maxBytes) {
    Attachment out;
    if (tooLarge(file, maxBytes, out)) return out;
    return saveAttachmentWith(file.fileContent(), cleanFileName(file.getFileName()),
                              [&file](const std::string& rel) { return file.saveAs(rel); });
}

Attachment saveAttachmentData(std::string_view content, const std::string& rawName, int64_t maxBytes) {
    Attachment out;
    if (tooLarge(content.size(), maxBytes, out)) return out;
    std::string name = cleanFileName(rawName);
    // Имя картинки — с её настоящим расширением, как у файла на сервере
    if (const std::string ext = imageExtension(content); !ext.empty()) {
        if (const auto d = name.rfind('.'); d != std::string::npos && d > 0) name.erase(d);
        if (name.empty()) name = "image";
        name += "." + ext;
    }
    return saveAttachmentWith(content, name, [content](const std::string& rel) {
        std::error_code ec;
        const fs::path path = fs::path(drogon::app().getUploadPath()) / rel;
        fs::create_directories(path.parent_path(), ec);
        std::ofstream f(path, std::ios::binary | std::ios::trunc);
        if (!f) return -1;
        f.write(content.data(), static_cast<std::streamsize>(content.size()));
        f.close();
        return f ? 0 : -1;
    });
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

bool isAudioName(const std::string& name) {
    static const std::set<std::string> kAudio = {"webm", "ogg", "opus", "m4a", "mp4", "mp3", "wav", "aac", "weba"};
    return kAudio.count(nameExtension(name)) > 0;
}

std::string localPath(const std::string& url) {
    if (attachmentType(url).empty()) return "";
    return (fs::path(drogon::app().getUploadPath()) / url.substr(kPrefix.size())).string();
}

static int be16(const unsigned char* p) { return (p[0] << 8) | p[1]; }
static int64_t be32(const unsigned char* p) {
    return (int64_t(p[0]) << 24) | (int64_t(p[1]) << 16) | (int64_t(p[2]) << 8) | int64_t(p[3]);
}
static int le16(const unsigned char* p) { return p[0] | (p[1] << 8); }
static int le24(const unsigned char* p) { return p[0] | (p[1] << 8) | (p[2] << 16); }

// Ориентация из EXIF (сегмент APP1 JPEG, тег 0x0112): 1–8; 0 — нет или не разобрали
static int exifOrientation(const unsigned char* d, size_t n) {
    if (n < 14 || std::memcmp(d, "Exif\0\0", 6) != 0) return 0;
    const unsigned char* t = d + 6;
    const size_t tn = n - 6;
    const bool le = t[0] == 'I' && t[1] == 'I';
    if (!le && !(t[0] == 'M' && t[1] == 'M')) return 0;
    auto u16 = [le](const unsigned char* p) { return le ? (p[0] | (p[1] << 8)) : ((p[0] << 8) | p[1]); };
    auto u32 = [le](const unsigned char* p) -> uint32_t {
        return le ? (uint32_t(p[0]) | (uint32_t(p[1]) << 8) | (uint32_t(p[2]) << 16) | (uint32_t(p[3]) << 24))
                  : ((uint32_t(p[0]) << 24) | (uint32_t(p[1]) << 16) | (uint32_t(p[2]) << 8) | uint32_t(p[3]));
    };
    if (u16(t + 2) != 42) return 0;
    const uint32_t ifd = u32(t + 4);
    if (ifd < 8 || ifd + 2 > tn) return 0;
    const int count = u16(t + ifd);
    for (int i = 0; i < count; ++i) {
        const size_t e = ifd + 2 + 12 * static_cast<size_t>(i);
        if (e + 12 > tn) return 0;
        if (u16(t + e) != 0x0112) continue;
        const int v = u16(t + e + 2) == 3 ? u16(t + e + 8) : 0;   // тип SHORT, значение в самой записи
        return v >= 1 && v <= 8 ? v : 0;
    }
    return 0;
}

std::pair<int, int> imageSize(const std::string& url) {
    if (attachmentType(url) != "image") return {0, 0};
    std::ifstream f(localPath(url), std::ios::binary);
    if (!f) return {0, 0};
    unsigned char h[32] = {};
    f.read(reinterpret_cast<char*>(h), sizeof h);
    const auto got = static_cast<size_t>(f.gcount());
    const std::string_view head(reinterpret_cast<const char*>(h), got);
    const std::string ext = imageExtension(head);
    auto sane = [](int64_t w, int64_t hgt) -> std::pair<int, int> {
        if (w <= 0 || hgt <= 0 || w > 100000 || hgt > 100000) return {0, 0};
        return {static_cast<int>(w), static_cast<int>(hgt)};
    };
    if (ext == "png" && got >= 24) return sane(be32(h + 16), be32(h + 20));
    if (ext == "gif" && got >= 10) return sane(le16(h + 6), le16(h + 8));
    if (ext == "webp" && got >= 30) {
        const std::string_view chunk = head.substr(12, 4);
        if (chunk == "VP8 ") return sane(le16(h + 26) & 0x3FFF, le16(h + 28) & 0x3FFF);
        if (chunk == "VP8L")
            return sane(1 + (((h[22] & 0x3F) << 8) | h[21]),
                        1 + (((h[24] & 0x0F) << 10) | (h[23] << 2) | ((h[22] & 0xC0) >> 6)));
        if (chunk == "VP8X") return sane(1 + le24(h + 24), 1 + le24(h + 27));
        return {0, 0};
    }
    if (ext == "jpg") {
        // Идём по сегментам до SOFn (ширина и высота кадра); не дальше 64 сегментов. Снимок телефона
        // хранится повёрнутым, а EXIF Orientation 5–8 говорит показать его на 90° — ширина и высота меняются местами
        std::streamoff pos = 2;
        int orientation = 0;
        for (int n = 0; n < 64; ++n) {
            unsigned char m[9] = {};
            f.clear();
            f.seekg(pos);
            f.read(reinterpret_cast<char*>(m), 4);
            if (f.gcount() < 4 || m[0] != 0xFF) return {0, 0};
            const unsigned char marker = m[1];
            if (marker == 0xFF) { pos += 1; continue; }   // заполнитель
            if (marker == 0xD8 || marker == 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { pos += 2; continue; }
            if (marker == 0xD9 || marker == 0xDA) return {0, 0};   // конец или данные — SOF не встретился
            const int len = be16(m + 2);
            if (len < 2) return {0, 0};
            const bool sof = marker >= 0xC0 && marker <= 0xCF && marker != 0xC4 && marker != 0xC8 && marker != 0xCC;
            if (marker == 0xE1 && orientation == 0 && len > 2) {
                std::string app(static_cast<size_t>(len - 2), '\0');
                f.read(app.data(), static_cast<std::streamsize>(app.size()));
                orientation = exifOrientation(reinterpret_cast<const unsigned char*>(app.data()),
                                              static_cast<size_t>(f.gcount()));
            }
            if (sof) {
                f.read(reinterpret_cast<char*>(m + 4), 5);
                if (f.gcount() < 5) return {0, 0};
                if (orientation >= 5) return sane(be16(m + 5), be16(m + 7));
                return sane(be16(m + 7), be16(m + 5));
            }
            pos += 2 + len;
        }
    }
    return {0, 0};
}

std::string mimeType(const std::string& name) {
    static const std::map<std::string, std::string> kMime = {
        {"png", "image/png"}, {"jpg", "image/jpeg"}, {"jpeg", "image/jpeg"}, {"gif", "image/gif"},
        {"webp", "image/webp"}, {"mp4", "video/mp4"}, {"m4v", "video/mp4"}, {"mov", "video/quicktime"},
        {"webm", "video/webm"}, {"mkv", "video/x-matroska"}, {"mp3", "audio/mpeg"}, {"m4a", "audio/mp4"},
        {"ogg", "audio/ogg"}, {"oga", "audio/ogg"}, {"opus", "audio/ogg"}, {"wav", "audio/wav"},
        {"aac", "audio/aac"}, {"flac", "audio/flac"}, {"weba", "audio/webm"}, {"pdf", "application/pdf"},
        {"txt", "text/plain"}, {"csv", "text/csv"}, {"json", "application/json"}, {"zip", "application/zip"},
        {"7z", "application/x-7z-compressed"}, {"rar", "application/vnd.rar"}, {"gz", "application/gzip"},
        {"doc", "application/msword"}, {"docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
        {"xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
        {"pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"},
    };
    auto it = kMime.find(nameExtension(name));
    return it == kMime.end() ? "application/octet-stream" : it->second;
}

std::string extensionForMime(const std::string& mime) {
    std::string m = mime.substr(0, mime.find(';'));
    m = TextUtils::trim(m);
    for (char& c : m) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    static const std::map<std::string, std::string> kExt = {
        {"video/mp4", "mp4"}, {"video/quicktime", "mov"}, {"video/webm", "webm"}, {"video/x-matroska", "mkv"},
        {"audio/mpeg", "mp3"}, {"audio/mp3", "mp3"}, {"audio/mp4", "m4a"}, {"audio/x-m4a", "m4a"},
        {"audio/ogg", "ogg"}, {"audio/opus", "opus"}, {"audio/wav", "wav"}, {"audio/x-wav", "wav"},
        {"audio/aac", "aac"}, {"audio/flac", "flac"}, {"application/pdf", "pdf"}, {"text/plain", "txt"},
        {"text/csv", "csv"}, {"application/json", "json"}, {"application/zip", "zip"},
    };
    auto it = kExt.find(m);
    return it == kExt.end() ? "" : it->second;
}

int64_t fileSize(const std::string& url) {
    if (attachmentType(url).empty()) return 0;
    std::error_code ec;
    const auto size = fs::file_size(fs::path(drogon::app().getUploadPath()) / url.substr(kPrefix.size()), ec);
    return ec ? 0 : static_cast<int64_t>(size);
}

std::string contentExtension(const std::string& url) {
    const std::string path = localPath(url);
    if (path.empty()) return "";
    std::ifstream f(path, std::ios::binary);
    char head[64] = {};
    f.read(head, sizeof head);
    const std::string_view c(head, static_cast<size_t>(f.gcount()));
    const std::string image = imageExtension(c);
    return image.empty() ? mediaExtension(c) : image;
}

std::string duplicate(const std::string& url) {
    const std::string type = attachmentType(url);
    if (type.empty()) return "";
    const std::string subDir = type == "image" ? "attachments" : "files";
    const std::string ext = nameExtension(url.substr(url.rfind('/') + 1));
    const std::string name = CryptoUtils::randomHex(16) + (ext.empty() ? "" : "." + ext);
    const fs::path root(drogon::app().getUploadPath());
    const fs::path from = root / url.substr(kPrefix.size());
    const fs::path to = root / subDir / name;
    std::error_code ec;
    if (!fs::is_regular_file(from, ec)) return "";
    // Жёсткая ссылка: место на диске не тратится, а у сообщения свой адрес — удалите одно, другое останется
    fs::create_hard_link(from, to, ec);
    if (ec) {
        std::error_code copyEc;
        if (!fs::copy_file(from, to, fs::copy_options::none, copyEc) || copyEc) {
            LOG_WARN << "Upload: cannot duplicate " << url << ": " << ec.message() << " / " << copyEc.message();
            return "";
        }
    }
    const std::string out = kPrefix + subDir + "/" + name;
    if (subDir == "files")
        if (const std::string n = downloadName(url); !n.empty()) rememberName(out, n);
    return out;
}

std::string fileIdentity(const std::string& url) {
    const std::string path = localPath(url);
    struct stat st {};
    if (path.empty() || ::stat(path.c_str(), &st) != 0) return "";
    // Копии одного файла (жёсткие ссылки) — один inode; mtime в наносекундах отличает inode, занятый заново
    return std::to_string(st.st_dev) + ":" + std::to_string(st.st_ino) + ":" + std::to_string(st.st_size) + ":" +
           std::to_string(st.st_mtim.tv_sec) + "." + std::to_string(st.st_mtim.tv_nsec);
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
