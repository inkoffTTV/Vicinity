#include "FileSystem.h"
#include <filesystem>
#include <algorithm>

namespace fs = std::filesystem;

namespace FileSystem {

bool ensureDir(const std::string& path) {
    std::error_code ec;
    fs::create_directories(path, ec);
    return !ec;
}

bool fileExists(const std::string& path) {
    return fs::exists(path);
}

bool removeFile(const std::string& path) {
    std::error_code ec;
    return fs::remove(path, ec);
}

std::string extension(const std::string& filename) {
    auto pos = filename.rfind('.');
    if (pos == std::string::npos) return "";
    std::string ext = filename.substr(pos);
    std::transform(ext.begin(), ext.end(), ext.begin(), ::tolower);
    return ext;
}

bool isAllowedImage(const std::string& ext) {
    return ext == ".gif" || ext == ".png" || ext == ".jpg" || ext == ".jpeg";
}

} // namespace FileSystem
