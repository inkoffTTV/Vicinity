#include "Uploads.h"
#include "CryptoUtils.h"
#include "../../shared/crypto/common_consts.h"
#include <drogon/drogon.h>
#include <trantor/utils/Logger.h>
#include <filesystem>
#include <string_view>

namespace fs = std::filesystem;

namespace Uploads {

static const std::string kPrefix = "/uploads/";

// Расширение по сигнатуре (magic bytes), а не по имени файла; "" — не картинка
static std::string imageExtension(std::string_view c) {
    const auto* b = reinterpret_cast<const unsigned char*>(c.data());
    if (c.size() >= 8 && b[0] == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G') return "png";
    if (c.size() >= 6 && c.substr(0, 4) == "GIF8")                              return "gif";
    if (c.size() >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF)           return "jpg";
    if (c.size() >= 12 && c.substr(0, 4) == "RIFF" && c.substr(8, 4) == "WEBP")  return "webp";
    return "";
}

Saved saveImage(const drogon::HttpFile& file, const std::string& subDir) {
    Saved out;
    if (file.fileLength() > static_cast<size_t>(Vicinity::MAX_UPLOAD_SIZE)) {
        out.code  = drogon::k413RequestEntityTooLarge;
        out.error = "Файл слишком большой (макс 15 МБ)";
        return out;
    }
    const std::string ext = imageExtension(file.fileContent());
    if (ext.empty()) {
        out.code  = drogon::k415UnsupportedMediaType;
        out.error = "Only PNG, JPG, GIF, WEBP allowed";
        return out;
    }
    const std::string name = CryptoUtils::randomHex(16) + "." + ext;
    // Относительный путь saveAs() дописывает к upload_path и сам создаёт подкаталог
    if (file.saveAs(subDir + "/" + name) != 0) {
        LOG_ERROR << "Upload: cannot save " << subDir << "/" << name;
        out.code  = drogon::k500InternalServerError;
        out.error = "Не удалось сохранить файл";
        return out;
    }
    out.url = kPrefix + subDir + "/" + name;
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

void removeByUrl(const std::string& url) {
    const auto slash = url.find('/', kPrefix.size());
    if (slash == std::string::npos) return;
    const std::string subDir = url.substr(kPrefix.size(), slash - kPrefix.size());
    if (!isUploadUrl(url, subDir)) return;
    std::error_code ec;
    fs::remove(fs::path(drogon::app().getUploadPath()) / url.substr(kPrefix.size()), ec);
    if (ec) LOG_WARN << "Upload: cannot remove " << url << ": " << ec.message();
}

} // namespace Uploads
