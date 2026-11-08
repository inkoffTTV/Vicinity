#pragma once
#include <drogon/HttpTypes.h>
#include <drogon/MultiPart.h>
#include <cstdint>
#include <string>
#include <string_view>
#include <utility>

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
// (кроме типов, которые браузер может исполнить, и исполняемых файлов). maxBytes — лимит по подписке
// отправителя (utils/Tiers.h); 0 — общий лимит MAX_UPLOAD_SIZE
Attachment saveAttachment(const drogon::HttpFile& file, int64_t maxBytes = 0);

// То же для байтов в памяти (бот прислал ссылку, сервер скачал файл сам — docs/API.md §21.7).
// rawName — имя от источника; для картинки расширение имени заменяется на настоящее
Attachment saveAttachmentData(std::string_view content, const std::string& rawName, int64_t maxBytes);

// Удаляет ранее загруженный файл по его URL (/uploads/...). Чужие пути игнорируются.
// У каждого сообщения свой URL вложения (повтор по file_id — duplicate), так что удаление
// сообщения отзывает его ссылку
void removeByUrl(const std::string& url);

// Копия вложения под новым случайным именем в том же каталоге (жёсткая ссылка, иначе копия файла),
// с тем же именем для скачивания; "" — исходного файла нет или не удалось
std::string duplicate(const std::string& url);

// Расширение по содержимому файла-вложения (картинка, звук, видео, PDF); "" — не узнали
std::string contentExtension(const std::string& url);

// Идентичность файла на диске (устройство, inode, размер, mtime): одинакова у копий из duplicate; "" — нет файла
std::string fileIdentity(const std::string& url);

// URL указывает на файл в /uploads/<subDir>/ (без подкаталогов и «..»)
bool isUploadUrl(const std::string& url, const std::string& subDir);

// Тип вложения по URL: "image" — /uploads/attachments/, "file" — /uploads/files/, "" — не вложение
std::string attachmentType(const std::string& url);
// Имя файла с расширением аудиозаписи (голосовое сообщение): webm, ogg, opus, m4a, mp4, mp3, wav, aac
bool isAudioName(const std::string& name);

// Размер вложения по его URL; 0 — это не вложение или файла нет
int64_t fileSize(const std::string& url);

// Путь к файлу вложения на диске; "" — URL не вложение
std::string localPath(const std::string& url);

// Ширина и высота картинки-вложения по заголовку файла (PNG, GIF, JPEG, WEBP); {0, 0} — не удалось
std::pair<int, int> imageSize(const std::string& url);

// MIME-тип по расширению имени файла; неизвестное — application/octet-stream
std::string mimeType(const std::string& name);

// Расширение по MIME-типу (Content-Type ответа при скачивании по ссылке); "" — неизвестный
std::string extensionForMime(const std::string& mime);

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
