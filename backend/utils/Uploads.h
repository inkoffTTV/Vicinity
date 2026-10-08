#pragma once
#include <drogon/HttpTypes.h>
#include <drogon/MultiPart.h>
#include <string>

// Загрузка картинок (вложения, аватары, баннеры).
// Файлы лежат в upload_path (каталог, который раздаётся как /uploads/), имя — случайное
// 128-битное hex, чтобы ссылку на вложение из лички нельзя было подобрать.
namespace Uploads {

struct Saved {
    std::string            url;                      // /uploads/<subDir>/<имя>.<ext>
    drogon::HttpStatusCode code = drogon::k201Created;
    std::string            error;                    // не пусто — загрузка отклонена
};

// Сохраняет файл как картинку (png/jpg/gif/webp по сигнатуре) в <upload_path>/<subDir>/
Saved saveImage(const drogon::HttpFile& file, const std::string& subDir);

// Удаляет ранее загруженный файл по его URL (/uploads/...). Чужие пути игнорируются.
void removeByUrl(const std::string& url);

// URL указывает на файл в /uploads/<subDir>/ (без подкаталогов и «..»)
bool isUploadUrl(const std::string& url, const std::string& subDir);

}
