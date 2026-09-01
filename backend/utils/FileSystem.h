#pragma once
#include <string>
#include <vector>

namespace FileSystem {
    bool ensureDir(const std::string& path);
    bool fileExists(const std::string& path);
    bool removeFile(const std::string& path);
    std::string extension(const std::string& filename); // lowercase, includes dot
    bool isAllowedImage(const std::string& ext);
}
