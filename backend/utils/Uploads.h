#pragma once
#include <drogon/HttpTypes.h>
#include <drogon/MultiPart.h>
#include <cstdint>
#include <string>
#include <string_view>

// Загрузка файлов (вложения, аватары, баннеры, иконки серверов).
// Файлы лежат в upload_path (каталог, который раздаётся как /uploads/), имя — случайное
// 128-битное hex, чтобы ссылку на вложение из лички нельзя было подобрать.
namespace Uploads {

struct Saved {
    std::string            url;                      // /uploads/<subDir>/<имя>.<ext>
    drogon::HttpStatusCode code = drogon::k201Created;
    std::string            error;                    // не пусто — загрузка отклонена
};

// Вложение сообщения (docs/API.md §2)
struct Attachment : Saved {
    std::string name;      // имя файла у клиента (без пути)
    int64_t     size = 0;  // байт
    std::string type;      // "image" | "file"
};

// Сохраняет файл как картинку (png/jpg/gif/webp по сигнатуре) в <upload_path>/<subDir>/
Saved saveImage(const drogon::HttpFile& file, const std::string& subDir);

// Вложение: картинка (по сигнатуре) — в attachments/, любой другой файл — в files/
// (кроме типов, которые браузер может исполнить, и исполняемых файлов)
Attachment saveAttachment(const drogon::HttpFile& file);

// Удаляет ранее загруженный файл по его URL (/uploads/...). Чужие пути игнорируются.
void removeByUrl(const std::string& url);

// URL указывает на файл в /uploads/<subDir>/ (без подкаталогов и «..»)
bool isUploadUrl(const std::string& url, const std::string& subDir);

// Тип вложения по URL: "image" — /uploads/attachments/, "file" — /uploads/files/, "" — не вложение
std::string attachmentType(const std::string& url);

// Размер вложения по его URL; 0 — это не вложение или файла нет
int64_t fileSize(const std::string& url);

// Исходное имя загруженного файла-вложения (/uploads/files/...) — для Content-Disposition при скачивании.
// rememberName запоминает его при загрузке, downloadName возвращает ("" — неизвестно).
void rememberName(const std::string& url, const std::string& name);
std::string downloadName(const std::string& url);

// Content-Disposition для скачивания: attachment; filename="<ASCII-замена>"; filename*=UTF-8''<имя в %-кодировке>
// (RFC 6266/5987); без имени — просто attachment
std::string contentDisposition(const std::string& name);

// Имя файла от клиента для показа: последний компонент пути, корректная UTF-8 без управляющих
// символов, до 255 символов; "" — имени нет или оно негодное
std::string cleanFileName(std::string_view raw);

}
