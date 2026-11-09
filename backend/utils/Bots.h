#pragma once
#include <drogon/HttpResponse.h>
#include <drogon/orm/DbClient.h>
#include <json/json.h>
#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <utility>
#include <vector>

// Боты (docs/API.md §21): пользователи с is_bot = 1, Bot API в стиле Telegram и доставка им обновлений.
// Обновления копятся в bot_updates (getUpdates, длинный опрос без блокировки потоков) или уходят
// POST-запросом на вебхук бота. Токены хранятся только хэшем и никогда не пишутся в лог.
namespace Bots {

// Таймер чистки очереди и нажатий; читает custom_config.bots. Вызывать после Database::initialize()
void init();

// Разрешены ли вебхуки бота на http и частные/локальные адреса (custom_config.bots.allow_private_webhooks)
bool allowPrivateWebhooks();

// ---------- Токены и пользователи-боты ----------

struct Token {
    std::string token;   // «<id>:<секрет>» — показывается владельцу один раз
    std::string hash;    // sha256 токена — в bots.token_hash
    std::string hint;    // последние 4 символа — чтобы узнать токен в списке
    std::string webappKey;   // ключ подписи initData мини-приложений (webAppKey) — в bots.webapp_key
};
Token newToken(int64_t botId);

// id бота по токену из URL; 0 — токен неверный. Заодно заполняет bots.webapp_key, если его ещё нет
int64_t authenticate(const drogon::orm::DbClientPtr& db, const std::string& token);

bool isBot(const drogon::orm::DbClientPtr& db, int64_t userId);

// Ник бота: 5–32 символа [a-z0-9_], оканчивается на bot. Пусто — подходит, иначе причина
std::string usernameProblem(const std::string& username);

// Объект бота для владельца (GET /bots): {id, username, display_name, avatar_path, description, token_hint,
// read_all, webhook_url, commands, servers:[{id,name}], created_at}; null — нет такого бота
Json::Value botObject(const drogon::orm::DbClientPtr& db, int64_t botId);

// ---------- Объекты Bot API ----------

// User {id, is_bot, first_name, username}
Json::Value tgUser(const drogon::orm::DbClientPtr& db, int64_t userId);
// Chat {id, type: private|group|supergroup, title?|first_name?, username?} с точки зрения бота
Json::Value tgChat(const drogon::orm::DbClientPtr& db, int64_t channelId, int64_t botId);
// Message из объекта сообщения Vicinity (Messages::load); edited — добавить edit_date
Json::Value tgMessage(const drogon::orm::DbClientPtr& db, const Json::Value& msg, int64_t botId, bool edited = false);

// Ответы Bot API: {"ok":true,"result":…} и {"ok":false,"error_code":N,"description":"…"}
drogon::HttpResponsePtr ok(const Json::Value& result);
drogon::HttpResponsePtr fail(int code, const std::string& description, int retryAfter = 0);

// ---------- Текст и кнопки ----------

// Текст с parse_mode (HTML, MarkdownV2, Markdown) → разметка Vicinity; без режима — как есть
std::string convertText(const std::string& text, const std::string& parseMode);

// reply_markup (объект или JSON-строка) → чистый {"inline_keyboard": [[…]]} или null (кнопок нет,
// reply/remove/force клавиатуры молча игнорируются). false — ошибка, причина в err.
// webhookOnly — только кнопки url и copy_text (входящие вебхуки каналов)
bool parseMarkup(const Json::Value& in, Json::Value& out, std::string& err, bool webhookOnly = false);

// Есть ли в кнопках сообщения callback_data == data
bool markupHasCallback(const Json::Value& markup, const std::string& data);

// Адрес вебхука бота: https (http и частные адреса — только с allow_private_webhooks). Пусто — подходит
std::string webhookUrlProblem(const std::string& url);

// ---------- Файлы (docs/API.md §21.7) ----------

// Потолки; ниже них — лимит вложений по подписке владельца бота (Tiers::uploadLimitBytes)
constexpr int64_t kFileMaxBytes = 50LL * 1024 * 1024;   // файл, загруженный ботом (multipart)
constexpr int64_t kUrlMaxBytes  = 20LL * 1024 * 1024;   // все файлы одного запроса, которые сервер скачивает по ссылкам
constexpr long kFetchTimeoutMs  = 20000;                // одно скачивание
constexpr long kPlanTimeoutMs   = 40000;                // все скачивания одного запроса (aiogram ждёт 60 с, nginx — 75 с)
constexpr int  kMaxFetches      = 8;                    // запросов со скачиванием одновременно на сервер
constexpr int  kMaxFetchesPerBot = 2;                   // … и на одного бота

// file_id вложения: «vc» + a|f (картинка или файл) + «_» + случайное имя файла на сервере. Без прав бота
// (сообщение с этим файлом в его чате или его собственное) ничего не даёт. "" — URL не вложение
std::string fileId(const std::string& url);
// file_unique_id: один и тот же для всех ботов
std::string fileUniqueId(const std::string& url);
// URL вложения (/uploads/...) по file_id; "" — это не наш file_id
std::string urlFromFileId(const std::string& id);
// file_path для getFile и /file/bot<токен>/<file_path>: «attachments/<имя>» или «files/<имя>»
std::string filePath(const std::string& url);

// Сервер умеет скачивать файлы по ссылке (собран с libcurl)
bool canFetchUrls();
// Ссылка для sendPhoto/…: http(s), без логина в адресе; частные и локальные адреса — только с
// allow_private_webhooks (как у вебхуков). Пусто — подходит
std::string fetchUrlProblem(const std::string& url);
// Скачать по ссылке не больше maxBytes (не дольше timeoutMs, до 3 перенаправлений; адрес каждого соединения
// проверяется по правилам выше). false — причина в why (текст ошибки Bot API без «Bad Request: »)
bool fetchUrl(const std::string& url, int64_t maxBytes, std::string& data, std::string& contentType, std::string& why,
              long timeoutMs = kFetchTimeoutMs);

// ---------- Доставка обновлений ----------

// Новое (или изменённое) сообщение в канале → обновления ботам-участникам по правилам §21.
// Best-effort: ошибки только в лог
void onMessage(const drogon::orm::DbClientPtr& db, const Json::Value& msg, int64_t channelId, bool edited);

// Положить обновление {message|edited_message|callback_query: …} боту: на вебхук или в очередь
void enqueue(const drogon::orm::DbClientPtr& db, int64_t botId, const Json::Value& update);

// getUpdates: сразу, если есть обновления или timeout = 0, иначе ждать до timeout секунд.
// allowed — новый список типов обновлений (если передан). Новый вызов того же бота завершает
// предыдущий пустым ответом
void getUpdates(int64_t botId, int64_t offset, int limit, int timeout, const std::optional<Json::Value>& allowed,
                std::function<void(const drogon::HttpResponsePtr&)>&& cb);

// Завершить ожидающий getUpdates бота ответом resp (например, при setWebhook)
void cancelWaiter(int64_t botId, const drogon::HttpResponsePtr& resp);

// Отправить накопленные обновления на только что установленный вебхук (по порядку, по одному в полёте;
// не дошедшие повторяются с паузой 5–60 с, пока вебхук установлен)
void flushToWebhook(int64_t botId);

// allowed_updates из getUpdates или setWebhook: список типов (пустой — все). Хранится в bots.allowed_updates
// и действует на обновления, созданные после вызова
void setAllowedUpdates(const drogon::orm::DbClientPtr& db, int64_t botId, const Json::Value& list);

// Бот удалён: завершить его getUpdates ответом resp, забыть состояние доставки и эфемерные
void forget(int64_t botId, const drogon::HttpResponsePtr& resp);

// ---------- Эфемерные сообщения ----------

struct Ephemeral {
    int64_t botId = 0, userId = 0, channelId = 0;
    Json::Value message;   // объект сообщения, как его получил клиент
};
// Запомнить эфемерное сообщение на 15 минут (для нажатия его кнопок). Хранится только нужное для
// callback_query; память ограничена (на бота и всего), вытесняются самые старые
void rememberEphemeral(const std::string& id, const Ephemeral& e);
std::optional<Ephemeral> findEphemeral(const std::string& id);

// ---------- Мини-приложения (docs/API.md §21.8) ----------

// Ключ подписи initData, как secret_key у Telegram: hex(HMAC_SHA256(key = "WebAppData", msg = токен))
std::string webAppKey(const std::string& token);

// Адрес мини-приложения: https до 512 символов (http и частные адреса — только с allow_private_webhooks)
bool webAppUrlOk(const std::string& url);
// Хост адреса мини-приложения так, как его разберёт браузер: нижний регистр, без порта и точки в конце;
// "" — запись, которую браузер понял бы иначе («\», %-коды, не-ASCII, IPv4 вида 127.1 или 0x7f000001)
std::string webAppHost(const std::string& url);
// Имя хоста из заголовка Host: нижний регистр, без порта и точки в конце (IPv6 — без скобок)
std::string requestHost(const std::string& hostHeader);

// Кнопка меню (setChatMenuButton): {type: commands|default} или {type: web_app, text 1–64, web_app: {url}}.
// false — ошибка, причина в err (описание Bot API без «Bad Request: »)
bool parseMenuButton(const Json::Value& in, Json::Value& out, std::string& err);

// Кнопка меню бота в чате channelId (своя для чата, иначе общая; channelId = 0 — общая); {type: "default"}, если не задана
Json::Value menuButton(const drogon::orm::DbClientPtr& db, int64_t botId, int64_t channelId);

// Процентное кодирование для query-строки: всё, кроме A-Z a-z 0-9 - _ . ~
std::string urlEncode(const std::string& s);

// initData из пар ключ–значение (значения без кодирования): «k=v&…&hash=…», hash = hex(HMAC_SHA256(key = ключ
// из webAppKey, data_check_string)), data_check_string — «k=v» по алфавиту через \n. keyHex пустой — без hash
std::string signInitData(const std::vector<std::pair<std::string, std::string>>& fields, const std::string& keyHex);

} // namespace Bots
