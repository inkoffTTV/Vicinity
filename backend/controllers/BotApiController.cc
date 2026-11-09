#include "BotApiController.h"
#include "../managers/UserRateLimiter.h"
#include "../utils/Access.h"
#include "../utils/Bots.h"
#include "../utils/Broadcast.h"
#include "../utils/CryptoUtils.h"
#include "../utils/HttpUtils.h"
#include "../utils/JsonUtils.h"
#include "../utils/Messages.h"
#include "../utils/TextUtils.h"
#include "../utils/Tiers.h"
#include "../utils/Uploads.h"
#include "../../shared/crypto/common_consts.h"
#include <drogon/MultiPart.h>
#include <drogon/drogon.h>
#include <algorithm>
#include <cctype>
#include <cstring>
#include <ctime>
#include <chrono>
#include <mutex>
#include <filesystem>
#include <map>
#include <thread>
#include <vector>

using namespace drogon;
using Bots::fail;
using Bots::ok;

namespace {

// Параметры метода из любого источника. Вложенные объекты (reply_markup, commands, …) могут прийти
// JSON-строкой (так шлют aiogram и python-telegram-bot в form-urlencoded) — json() их разбирает.
struct Params {
    Json::Value v{Json::objectValue};
    std::shared_ptr<MultiPartParser> mp;   // файлы multipart (sendPhoto и др.)

    // Файл-часть multipart с таким именем поля; nullptr — нет
    const HttpFile* file(const std::string& name) const {
        if (!mp || name.empty()) return nullptr;
        for (const auto& f : mp->getFiles())
            if (f.getItemName() == name) return &f;
        return nullptr;
    }

    bool has(const char* k) const { return v.isMember(k) && !v[k].isNull(); }

    std::string str(const char* k) const {
        const Json::Value& x = v[k];
        if (x.isString()) return x.asString();
        if (x.isIntegral()) return std::to_string(x.asInt64());
        if (x.isBool()) return x.asBool() ? "true" : "false";
        return "";
    }

    std::optional<int64_t> integer(const char* k) const {
        const Json::Value& x = v[k];
        if (x.isIntegral()) return x.asInt64();
        if (x.isDouble() && x.asDouble() == static_cast<double>(static_cast<int64_t>(x.asDouble())))
            return static_cast<int64_t>(x.asDouble());
        if (x.isString()) {
            const std::string s = TextUtils::trim(x.asString());
            if (s.empty() || s.size() > 20) return std::nullopt;
            size_t i = s[0] == '-' ? 1 : 0;
            if (i == s.size()) return std::nullopt;
            for (size_t k2 = i; k2 < s.size(); ++k2)
                if (!std::isdigit(static_cast<unsigned char>(s[k2]))) return std::nullopt;
            try { return std::stoll(s); } catch (...) { return std::nullopt; }
        }
        return std::nullopt;
    }

    bool boolean(const char* k, bool def = false) const {
        const Json::Value& x = v[k];
        if (x.isBool()) return x.asBool();
        if (x.isIntegral()) return x.asInt64() != 0;
        if (x.isString()) {
            std::string s = x.asString();
            std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return std::tolower(c); });
            if (s == "true" || s == "1") return true;
            if (s == "false" || s == "0") return false;
        }
        return def;
    }

    // Объект/массив; строка — разбирается как JSON, а если не разбирается — возвращается как есть
    Json::Value json(const char* k) const {
        const Json::Value& x = v[k];
        if (x.isString()) {
            Json::Value out;
            if (JsonUtils::parse(x.asString(), out)) return out;
        }
        return x;
    }
};

Params collect(const HttpRequestPtr& req) {
    Params p;
    // query и form-urlencoded (Drogon разбирает тело POST сам)
    for (const auto& [k, val] : req->getParameters()) p.v[k] = val;
    if (req->contentType() == CT_APPLICATION_JSON) {
        auto j = req->getJsonObject();
        if (j && j->isObject())
            for (const auto& name : j->getMemberNames()) p.v[name] = (*j)[name];
    } else if (req->contentType() == CT_MULTIPART_FORM_DATA) {
        auto mp = std::make_shared<MultiPartParser>();
        if (mp->parse(req) == 0) {
            for (const auto& [k, val] : mp->getParameters()) p.v[k] = val;
            p.mp = mp;
        }
    }
    return p;
}

struct Ctx {
    int64_t bot = 0;
    Params p;
    orm::DbClientPtr db;
    HttpRequestPtr req;   // держит тело запроса (файлы multipart), пока идёт отправка
};

using Handler = HttpResponsePtr (*)(Ctx&);
using Reply = std::function<void(const HttpResponsePtr&)>;
using AsyncHandler = void (*)(Ctx&, Reply&&);

HttpResponsePtr tooFast() { return fail(429, "Too Many Requests: retry after 1", 1); }

// chat_id → канал, где бот участник; иначе ответ с ошибкой
HttpResponsePtr chatOf(Ctx& c, int64_t& chatId, Access::ChannelInfo* info = nullptr) {
    if (!c.p.has("chat_id")) return fail(400, "Bad Request: chat_id is empty");
    const auto id = c.p.integer("chat_id");
    if (!id || *id <= 0) return fail(400, "Bad Request: chat not found");
    chatId = *id;
    const auto acc = Access::channel(c.db, chatId, c.bot, info);
    if (acc == Access::Result::NotFound) return fail(400, "Bad Request: chat not found");
    if (acc == Access::Result::Forbidden) return fail(403, "Forbidden: bot is not a member of the chat");
    return nullptr;
}

HttpResponsePtr textOf(const Params& p, std::string& out) {
    const std::string raw = p.str("text");
    if (!TextUtils::isValidUtf8(raw)) return fail(400, "Bad Request: text must be encoded in UTF-8");
    out = Bots::convertText(raw, p.str("parse_mode"));
    if (TextUtils::trim(out).empty()) return fail(400, "Bad Request: message text is empty");
    if (static_cast<int>(TextUtils::utf8Length(out)) > Vicinity::MAX_MESSAGE_LEN)
        return fail(400, "Bad Request: message is too long");
    return nullptr;
}

HttpResponsePtr markupOf(const Params& p, Json::Value& out) {
    std::string err;
    if (!Bots::parseMarkup(p.has("reply_markup") ? p.json("reply_markup") : Json::Value(), out, err))
        return fail(400, "Bad Request: " + err);
    return nullptr;
}

std::optional<std::string> markupColumn(const Json::Value& markup) {
    if (markup.isNull()) return std::nullopt;
    std::string s = JsonUtils::write(markup);
    while (!s.empty() && s.back() == '\n') s.pop_back();
    return s;
}

std::string nowUtc() {
    const std::time_t t = std::time(nullptr);
    std::tm tm{};
    gmtime_r(&t, &tm);
    char buf[32];
    std::strftime(buf, sizeof buf, "%Y-%m-%d %H:%M:%S", &tm);
    return buf;
}

// reply_to_message_id или reply_parameters → id сообщения этого чата (0 — без ответа)
HttpResponsePtr replyOf(Ctx& c, int64_t chatId, int64_t& replyTo) {
    replyTo = c.p.integer("reply_to_message_id").value_or(0);
    bool withoutReply = c.p.boolean("allow_sending_without_reply");
    if (c.p.has("reply_parameters")) {
        const Json::Value rp = c.p.json("reply_parameters");
        replyTo = JsonUtils::getInt(rp, "message_id", replyTo);
        withoutReply = JsonUtils::getBool(rp, "allow_sending_without_reply", withoutReply);
    }
    if (replyTo > 0 && c.db->execSqlSync("SELECT 1 FROM messages WHERE id = ? AND channel_id = ?", replyTo, chatId).empty()) {
        if (!withoutReply) return fail(400, "Bad Request: message to be replied not found");
        replyTo = 0;
    }
    if (replyTo < 0) replyTo = 0;
    return nullptr;
}

// Подпись к файлу: как текст, но может быть пустой
HttpResponsePtr captionOf(const std::string& raw, const std::string& parseMode, std::string& out) {
    if (!TextUtils::isValidUtf8(raw)) return fail(400, "Bad Request: text must be encoded in UTF-8");
    out = Bots::convertText(raw, parseMode);
    if (TextUtils::trim(out).empty()) out.clear();
    if (static_cast<int>(TextUtils::utf8Length(out)) > Vicinity::MAX_MESSAGE_LEN)
        return fail(400, "Bad Request: message caption is too long");
    return nullptr;
}

// ---------- Файлы (docs/API.md §21.7) ----------

// Бот видит файл: он сам его отправил или файл — вложение сообщения в чате, где бот участник
bool canSeeFile(const orm::DbClientPtr& db, int64_t bot, const std::string& url) {
    auto rows = db->execSqlSync(
        "SELECT channel_id, MAX(author_id = ?) AS mine FROM messages WHERE attachment = ? GROUP BY channel_id LIMIT 50",
        bot, url);
    for (const auto& r : rows) {
        if (r["mine"].as<int>() != 0) return true;
        if (Access::channel(db, r["channel_id"].as<int64_t>(), bot) == Access::Result::Ok) return true;
    }
    return false;
}

// Имя, под которым файл уже показан в сообщениях (или запомнено при загрузке)
std::string storedName(const orm::DbClientPtr& db, const std::string& url) {
    auto r = db->execSqlSync("SELECT attachment_name FROM messages WHERE attachment = ? AND attachment_name IS NOT NULL "
                             "AND attachment_name != '' LIMIT 1", url);
    if (!r.empty()) return r[0]["attachment_name"].as<std::string>();
    std::string name = Uploads::downloadName(url);
    return name.empty() ? url.substr(url.rfind('/') + 1) : name;
}

// Файл для отправки: часть multipart, file_id уже сохранённого или ссылка, которую скачает сервер
struct Media {
    std::string kind;                       // photo | document | video | audio | voice | animation
    const HttpFile* part = nullptr;         // multipart (живёт, пока жив Ctx.p.mp)
    std::string reuse;                      // URL вложения по file_id — сообщение получит его копию
    std::string remote;                     // http(s)-ссылка
    int sameAs = -1;                        // та же часть или ссылка, что у элемента sameAs: сохраняется один раз
    std::string caption;
    Json::Value meta{Json::objectValue};    // duration, width, height, performer, title — от бота
    // После сохранения
    std::string url, name, type;
    int64_t size = 0;
    bool fresh = false;                     // сохранён сейчас — при ошибке удалить
};

bool startsWithNoCase(const std::string& s, const char* prefix) {
    const size_t n = std::strlen(prefix);
    if (s.size() < n) return false;
    for (size_t i = 0; i < n; ++i)
        if (std::tolower(static_cast<unsigned char>(s[i])) != prefix[i]) return false;
    return true;
}

// Источник файла: value — строка параметра (attach://…, file_id, http(s)-ссылка) или пусто,
// тогда файл ищется частью multipart с именем field (curl -F photo=@x.png)
HttpResponsePtr inputOf(Ctx& c, const std::string& field, const std::string& rawValue, Media& m) {
    const std::string value = TextUtils::trim(rawValue);
    if (value.empty()) {
        m.part = c.p.file(field);
        if (!m.part) return fail(400, "Bad Request: there is no " + (field.empty() ? std::string("media") : field) +
                                          " in the request");
        return nullptr;
    }
    if (startsWithNoCase(value, "attach://")) {
        m.part = c.p.file(value.substr(9));
        if (!m.part) return fail(400, "Bad Request: wrong file identifier/HTTP URL specified");
        return nullptr;
    }
    if (startsWithNoCase(value, "http://") || startsWithNoCase(value, "https://")) {
        if (!Bots::canFetchUrls()) return fail(400, "Bad Request: sending files by URL is not supported on this server");
        if (const std::string why = Bots::fetchUrlProblem(value); !why.empty()) return fail(400, "Bad Request: " + why);
        m.remote = value;
        return nullptr;
    }
    const std::string url = Bots::urlFromFileId(value);
    if (url.empty() || !canSeeFile(c.db, c.bot, url) || Uploads::fileSize(url) <= 0)
        return fail(400, "Bad Request: wrong file identifier/HTTP URL specified");
    m.reuse = url;
    return nullptr;
}

// duration, width, height, performer, title из параметров метода или элемента InputMedia
void metaOf(const Json::Value& src, Media& m) {
    Params p;
    p.v = src.isObject() ? src : Json::Value(Json::objectValue);
    for (const char* k : {"duration", "width", "height"})
        if (const auto v = p.integer(k); v && *v > 0 && *v <= 1000000) m.meta[k] = static_cast<Json::Int64>(*v);
    for (const char* k : {"performer", "title"}) {
        const std::string v = TextUtils::trim(p.str(k));
        if (!v.empty() && TextUtils::isValidUtf8(v) && !TextUtils::hasControlChars(v))
            m.meta[k] = TextUtils::utf8Truncate(v, 128);
    }
}

// Имя файла по ссылке: последний компонент пути; без расширения — по Content-Type ответа
std::string nameFromUrl(const std::string& url, const std::string& contentType) {
    std::string path = url.substr(url.find("://") + 3);
    path = path.substr(0, path.find_first_of("?#"));
    const auto slash = path.find('/');
    std::string name = slash == std::string::npos ? std::string() : path.substr(path.rfind('/') + 1);
    name = Uploads::cleanFileName(name);
    if (name.empty()) name = "file";
    if (name.find('.') == std::string::npos)
        if (const std::string ext = Uploads::extensionForMime(contentType); !ext.empty()) name += "." + ext;
    return name;
}

// Расширение последнего компонента пути ("" — нет)
std::string extensionOf(const std::string& name) {
    const auto slash = name.rfind('/');
    const auto dot = name.rfind('.');
    if (dot == std::string::npos || (slash != std::string::npos && dot < slash) || dot + 1 == name.size()) return "";
    return name.substr(dot + 1);
}

// Отправка файлов после всех проверок: одно сообщение (sendPhoto…) или альбом (sendMediaGroup)
struct Plan {
    int64_t chatId = 0;
    int64_t replyTo = 0;
    std::optional<std::string> markup;
    std::vector<Media> items;
    bool group = false;
    int64_t owner = 0;                                  // владелец бота: его подписка и квота байт
    int64_t fileLimit = Bots::kFileMaxBytes;            // одна часть multipart
    int64_t urlBudget = Bots::kUrlMaxBytes;             // все скачивания по ссылкам вместе
    std::chrono::steady_clock::time_point deadline{};   // конец скачиваний (Bots::kPlanTimeoutMs с начала)
};

// Лимиты владельца бота: размер вложения по его подписке, как у людей (ChatController::uploadAttachment)
void limitsOf(Ctx& c, Plan& plan) {
    auto r = c.db->execSqlSync("SELECT b.owner_id, u.subscription_tier FROM bots b LEFT JOIN users u ON u.id = b.owner_id "
                               "WHERE b.user_id = ?", c.bot);
    int tier = 0;
    if (!r.empty()) {
        plan.owner = r[0]["owner_id"].isNull() ? 0 : r[0]["owner_id"].as<int64_t>();
        tier = r[0]["subscription_tier"].isNull() ? 0 : r[0]["subscription_tier"].as<int>();
    }
    const int64_t tierBytes = Tiers::uploadLimitBytes(tier);
    plan.fileLimit = std::min(Bots::kFileMaxBytes, tierBytes);
    plan.urlBudget = std::min(Bots::kUrlMaxBytes, tierBytes);
}

HttpResponsePtr quotaExceeded() { return fail(429, "Too Many Requests: file quota exceeded, retry after 60", 60); }

// Байты новых файлов ботов одного владельца (UserRateLimiter::Action::BotBytes)
bool chargeBytes(const Plan& plan, int64_t bytes) {
    return UserRateLimiter::instance().allow(UserRateLimiter::Action::BotBytes, plan.owner, static_cast<double>(bytes));
}

HttpResponsePtr savedError(const Uploads::Attachment& a) {
    if (a.code == k413RequestEntityTooLarge) return fail(400, "Bad Request: file is too big");
    if (a.code == k415UnsupportedMediaType) return fail(400, "Bad Request: file type is not allowed");
    return fail(500, "Internal Server Error");
}

// Сохранить файл (скачать по ссылке, записать часть multipart или скопировать готовый по file_id) и проверить вид
HttpResponsePtr storeMedia(Ctx& c, Plan& plan, Media& m) {
    const std::string source = m.sameAs >= 0 ? plan.items[static_cast<size_t>(m.sameAs)].url : m.reuse;
    if (!source.empty()) {
        // file_id мог стать недействительным, пока шли скачивания: сообщение удалили — файла уже нет
        if (m.sameAs < 0 && !canSeeFile(c.db, c.bot, source))
            return fail(400, "Bad Request: wrong file identifier/HTTP URL specified");
        // У каждого сообщения свой URL (жёсткая ссылка на тот же файл): удаление исходного сообщения
        // отзывает его ссылку, а копия бота живёт до удаления сообщения бота
        const std::string name = m.sameAs >= 0 ? plan.items[static_cast<size_t>(m.sameAs)].name : storedName(c.db, source);
        m.url = Uploads::duplicate(source);
        if (m.url.empty()) return fail(400, "Bad Request: wrong file identifier/HTTP URL specified");
        m.fresh = true;
        m.type = Uploads::attachmentType(m.url);
        m.size = Uploads::fileSize(m.url);
        m.name = name;
    } else {
        Uploads::Attachment a;
        if (m.part) {
            if (static_cast<int64_t>(m.part->fileLength()) > plan.fileLimit) return fail(400, "Bad Request: file is too big");
            if (!chargeBytes(plan, static_cast<int64_t>(m.part->fileLength()))) return quotaExceeded();
            a = Uploads::saveAttachment(*m.part, plan.fileLimit);
        } else {
            const auto left = std::chrono::duration_cast<std::chrono::milliseconds>(
                plan.deadline - std::chrono::steady_clock::now()).count();
            if (left <= 0) return fail(400, "Bad Request: failed to get HTTP URL content");
            std::string data, contentType, why;
            if (!Bots::fetchUrl(m.remote, plan.urlBudget, data, contentType, why, static_cast<long>(left)))
                return fail(400, "Bad Request: " + why);
            plan.urlBudget -= static_cast<int64_t>(data.size());
            if (!chargeBytes(plan, static_cast<int64_t>(data.size()))) return quotaExceeded();
            a = Uploads::saveAttachmentData(data, nameFromUrl(m.remote, contentType), Bots::kUrlMaxBytes);
        }
        if (!a.error.empty()) return savedError(a);
        m.url = a.url;
        m.type = a.type;
        m.size = a.size;
        m.name = a.name;
        m.fresh = true;
        // Имя картинки — с настоящим расширением (как в ChatController::sendMessage)
        if (m.type == "image") {
            std::string base = m.name;
            if (const auto d = base.rfind('.'); d != std::string::npos && d > 0) base.erase(d);
            if (base.empty()) base = m.kind == "photo" ? "photo" : "image";
            m.name = base + m.url.substr(m.url.rfind('.'));
        } else if (m.name.empty()) {
            m.name = m.url.substr(m.url.rfind('/') + 1);
        } else if (extensionOf(m.name).empty()) {
            // Имя без расширения (aiogram URLInputFile): расширение, которое сервер узнал по содержимому
            if (const std::string ext = extensionOf(m.url); !ext.empty()) m.name += "." + ext;
        }
    }
    if (m.kind == "photo" && m.type != "image")
        return fail(400, "Bad Request: IMAGE_PROCESS_FAILED: photo must be a PNG, JPEG, GIF or WEBP image");
    if ((m.kind == "video" || m.kind == "audio") && m.type != "file")
        return fail(400, "Bad Request: wrong file type: " + m.kind + " can't be an image, use sendPhoto");
    // Голосовое: звук по имени или по содержимому (имя может быть любым)
    if (m.kind == "voice" &&
        (m.type != "file" || (!Uploads::isAudioName(m.url) && !Uploads::isAudioName("voice." + Uploads::contentExtension(m.url)))))
        return fail(400, "Bad Request: VOICE_INVALID: voice must be an OGG, OPUS, MP3 or M4A file");
    return nullptr;
}

// Удалить файлы, сохранённые для ещё не отправленных элементов (from и дальше)
void dropFresh(Plan& plan, size_t from = 0) {
    for (size_t i = from; i < plan.items.size(); ++i)
        if (plan.items[i].fresh) {
            Uploads::removeByUrl(plan.items[i].url);
            plan.items[i].fresh = false;
        }
}

// Общий media_group_id альбома — строка из цифр, как в Telegram
std::string newMediaGroupId() {
    return std::to_string(std::stoull(CryptoUtils::randomHex(7), nullptr, 16));
}

HttpResponsePtr runPlan(Ctx& c, Plan& plan) {
    size_t posted = 0;
    try {
        plan.deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(Bots::kPlanTimeoutMs);
        for (auto& m : plan.items)
            if (auto e = storeMedia(c, plan, m)) {
                dropFresh(plan);
                return e;
            }
        // Пока скачивали, бота могли убрать из чата
        if (Access::channel(c.db, plan.chatId, c.bot) != Access::Result::Ok) {
            dropFresh(plan);
            return fail(403, "Forbidden: bot is not a member of the chat");
        }
        const std::string groupId = plan.group ? newMediaGroupId() : std::string();
        Json::Value out(Json::arrayValue);
        for (size_t i = 0; i < plan.items.size(); ++i) {
            const Media& m = plan.items[i];
            Messages::Post post;
            post.text = m.caption;
            post.attachment = m.url;
            post.attachmentName = m.name;
            post.attachmentSize = m.size;
            post.attachmentType = m.type;
            if (i == 0 && plan.replyTo > 0) post.replyTo = plan.replyTo;
            if (i == 0) post.replyMarkup = plan.markup;
            Json::Value meta = m.meta;
            if (m.kind == "voice") {
                // Голосовое — как у людей (§2): плеер с волной, длительность от бота или из файла в браузере
                Json::Value voice;
                voice["duration"] = meta.isMember("duration") ? meta["duration"].asDouble() : 0.0;
                voice["peaks"] = Json::Value(Json::arrayValue);
                post.kind = "voice";
                meta = voice;
            } else {
                meta["media"] = m.kind;   // каким методом отправлено — тем же видом вернётся в Message
                if (!groupId.empty()) meta["media_group_id"] = groupId;
            }
            std::string metaStr = JsonUtils::write(meta);
            while (!metaStr.empty() && metaStr.back() == '\n') metaStr.pop_back();
            post.meta = metaStr;
            post.push = false;
            post.activity = false;
            const Json::Value msg = Messages::post(c.db, plan.chatId, c.bot, post);
            posted = i + 1;
            out.append(Bots::tgMessage(c.db, msg, c.bot));
        }
        return ok(plan.group ? out : out[0]);
    } catch (...) {
        // Отправленные сообщения держат свои файлы, остальные — удалить
        dropFresh(plan, posted);
        throw;
    }
}

// Скачивания по ссылкам идут в отдельных потоках: не больше kMaxFetches запросов сразу на сервер
// и kMaxFetchesPerBot на бота — один бот не займёт все места
std::mutex gFetchMutex;
int gFetches = 0;
std::map<int64_t, int> gFetchesByBot;

bool takeFetchSlot(int64_t bot) {
    std::lock_guard<std::mutex> lock(gFetchMutex);
    auto it = gFetchesByBot.find(bot);
    const int mine = it == gFetchesByBot.end() ? 0 : it->second;
    if (gFetches >= Bots::kMaxFetches || mine >= Bots::kMaxFetchesPerBot) return false;
    ++gFetches;
    gFetchesByBot[bot] = mine + 1;
    return true;
}

void releaseFetchSlot(int64_t bot) {
    std::lock_guard<std::mutex> lock(gFetchMutex);
    --gFetches;
    auto it = gFetchesByBot.find(bot);
    if (it != gFetchesByBot.end() && --it->second <= 0) gFetchesByBot.erase(it);
}

void startPlan(Ctx& c, Plan&& plan, Reply&& cb) {
    const bool remote = std::any_of(plan.items.begin(), plan.items.end(), [](const Media& m) { return !m.remote.empty(); });
    if (!remote) {
        cb(runPlan(c, plan));
        return;
    }
    if (!takeFetchSlot(c.bot)) {
        cb(tooFast());
        return;
    }
    // Поток держит тело запроса, только если в нём есть файлы multipart
    Ctx job = c;
    if (std::none_of(plan.items.begin(), plan.items.end(), [](const Media& m) { return m.part != nullptr; })) {
        job.req.reset();
        job.p.mp.reset();
    }
    std::thread([job = std::move(job), plan = std::move(plan), cb = std::move(cb)]() mutable {
        HttpResponsePtr r;
        try {
            r = runPlan(job, plan);
        } catch (const std::exception& e) {
            LOG_ERROR << "bot api: media: " << e.what();
            r = fail(500, "Internal Server Error");
        }
        releaseFetchSlot(job.bot);
        cb(r);
    }).detach();
}

// Новые файлы запроса (не file_id и не повтор той же части или ссылки) — лимит загрузок, как у людей
HttpResponsePtr chargeUploads(Ctx& c, const Plan& plan) {
    const auto fresh = std::count_if(plan.items.begin(), plan.items.end(),
                                     [](const Media& m) { return m.sameAs < 0 && m.reuse.empty(); });
    if (fresh > 0 && !UserRateLimiter::instance().allow(UserRateLimiter::Action::Upload, c.bot, static_cast<double>(fresh)))
        return tooFast();
    return nullptr;
}

HttpResponsePtr blockedInDm(Ctx& c, int64_t chatId) {
    if (const int64_t peer = Access::dmPeer(c.db, chatId, c.bot); peer && Access::blockedBetween(c.db, c.bot, peer))
        return fail(403, "Forbidden: bot was blocked by the user");
    return nullptr;
}

// sendPhoto, sendDocument, sendVideo, sendAudio, sendVoice, sendAnimation
void sendMedia(Ctx& c, Reply&& cb, const char* kind) {
    Plan plan;
    if (auto e = chatOf(c, plan.chatId)) return cb(e);
    if (auto e = blockedInDm(c, plan.chatId)) return cb(e);
    Media m;
    m.kind = kind;
    if (auto e = inputOf(c, kind, c.p.str(kind), m)) return cb(e);
    if (auto e = captionOf(c.p.str("caption"), c.p.str("parse_mode"), m.caption)) return cb(e);
    metaOf(c.p.v, m);
    Json::Value markup;
    if (auto e = markupOf(c.p, markup)) return cb(e);
    plan.markup = markupColumn(markup);
    if (auto e = replyOf(c, plan.chatId, plan.replyTo)) return cb(e);
    limitsOf(c, plan);
    if (m.part && static_cast<int64_t>(m.part->fileLength()) > plan.fileLimit) return cb(fail(400, "Bad Request: file is too big"));
    if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::BotSend, c.bot)) return cb(tooFast());
    plan.items.push_back(std::move(m));
    if (auto e = chargeUploads(c, plan)) return cb(e);
    startPlan(c, std::move(plan), std::move(cb));
}

void sendPhoto(Ctx& c, Reply&& cb) { sendMedia(c, std::move(cb), "photo"); }
void sendDocument(Ctx& c, Reply&& cb) { sendMedia(c, std::move(cb), "document"); }
void sendVideo(Ctx& c, Reply&& cb) { sendMedia(c, std::move(cb), "video"); }
void sendAudio(Ctx& c, Reply&& cb) { sendMedia(c, std::move(cb), "audio"); }
void sendVoice(Ctx& c, Reply&& cb) { sendMedia(c, std::move(cb), "voice"); }
void sendAnimation(Ctx& c, Reply&& cb) { sendMedia(c, std::move(cb), "animation"); }

// Альбом: 2–10 photo/video, или только document, или только audio. Кнопок у альбома нет (как в Telegram)
void sendMediaGroup(Ctx& c, Reply&& cb) {
    Plan plan;
    plan.group = true;
    if (auto e = chatOf(c, plan.chatId)) return cb(e);
    if (auto e = blockedInDm(c, plan.chatId)) return cb(e);
    if (c.p.has("reply_markup")) return cb(fail(400, "Bad Request: reply markup is not allowed in media groups"));
    const Json::Value media = c.p.json("media");
    if (!media.isArray()) return cb(fail(400, "Bad Request: can't parse media JSON object"));
    if (media.size() < 2 || media.size() > 10) return cb(fail(400, "Bad Request: media group must contain 2-10 items"));
    limitsOf(c, plan);
    bool docs = false, audio = false, visual = false;
    for (const auto& item : media) {
        if (!item.isObject()) return cb(fail(400, "Bad Request: can't parse InputMedia JSON object"));
        const std::string type = JsonUtils::getStr(item, "type");
        if (type != "photo" && type != "video" && type != "document" && type != "audio")
            return cb(fail(400, "Bad Request: unsupported media type \"" + type.substr(0, 32) + "\" in a media group"));
        docs = docs || type == "document";
        audio = audio || type == "audio";
        visual = visual || type == "photo" || type == "video";
        Media m;
        m.kind = type;
        const std::string src = item["media"].isString() ? item["media"].asString() : std::string();
        if (TextUtils::trim(src).empty()) return cb(fail(400, "Bad Request: wrong file identifier/HTTP URL specified"));
        if (auto e = inputOf(c, "", src, m)) return cb(e);
        if (auto e = captionOf(JsonUtils::getStr(item, "caption"), JsonUtils::getStr(item, "parse_mode"), m.caption))
            return cb(e);
        metaOf(item, m);
        if (m.part && static_cast<int64_t>(m.part->fileLength()) > plan.fileLimit)
            return cb(fail(400, "Bad Request: file is too big"));
        // Та же часть attach:// или та же ссылка ещё раз — сохраняется (скачивается) один раз
        for (size_t j = 0; j < plan.items.size() && m.reuse.empty(); ++j) {
            const Media& prev = plan.items[j];
            if (prev.sameAs < 0 && ((m.part && prev.part == m.part) || (!m.remote.empty() && prev.remote == m.remote))) {
                m.sameAs = static_cast<int>(j);
                break;
            }
        }
        plan.items.push_back(std::move(m));
    }
    if ((docs && (audio || visual)) || (audio && visual))
        return cb(fail(400, "Bad Request: documents and audio files can be grouped only with messages of the same type"));
    if (auto e = replyOf(c, plan.chatId, plan.replyTo)) return cb(e);
    for (size_t i = 0; i < plan.items.size(); ++i)
        if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::BotSend, c.bot)) return cb(tooFast());
    if (auto e = chargeUploads(c, plan)) return cb(e);
    startPlan(c, std::move(plan), std::move(cb));
}

HttpResponsePtr getFile(Ctx& c) {
    const std::string url = Bots::urlFromFileId(TextUtils::trim(c.p.str("file_id")));
    if (url.empty() || !canSeeFile(c.db, c.bot, url)) return fail(400, "Bad Request: invalid file_id");
    const int64_t size = Uploads::fileSize(url);
    if (size <= 0) return fail(400, "Bad Request: invalid file_id");
    Json::Value f;
    f["file_id"]        = Bots::fileId(url);
    f["file_unique_id"] = Bots::fileUniqueId(url);
    f["file_size"]      = static_cast<Json::Int64>(size);
    f["file_path"]      = Bots::filePath(url);
    return ok(f);
}

// ---------- Методы ----------

HttpResponsePtr getMe(Ctx& c) {
    Json::Value u = Bots::tgUser(c.db, c.bot);
    u.removeMember("language_code");
    auto r = c.db->execSqlSync("SELECT read_all FROM bots WHERE user_id = ?", c.bot);
    u["can_join_groups"] = true;
    u["can_read_all_group_messages"] = !r.empty() && r[0]["read_all"].as<int>() != 0;
    u["supports_inline_queries"] = false;
    u["can_connect_to_business"] = false;
    u["has_main_web_app"] = false;
    return ok(u);
}

HttpResponsePtr sendMessage(Ctx& c) {
    int64_t chatId = 0;
    if (auto e = chatOf(c, chatId)) return e;
    if (const int64_t peer = Access::dmPeer(c.db, chatId, c.bot); peer && Access::blockedBetween(c.db, c.bot, peer))
        return fail(403, "Forbidden: bot was blocked by the user");
    std::string text;
    if (auto e = textOf(c.p, text)) return e;
    Json::Value markup;
    if (auto e = markupOf(c.p, markup)) return e;
    int64_t replyTo = 0;
    if (auto e = replyOf(c, chatId, replyTo)) return e;
    if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::BotSend, c.bot)) return tooFast();

    Messages::Post post;
    post.text = text;
    if (replyTo > 0) post.replyTo = replyTo;
    post.replyMarkup = markupColumn(markup);
    post.push = false;
    post.activity = false;
    const Json::Value msg = Messages::post(c.db, chatId, c.bot, post);
    return ok(Bots::tgMessage(c.db, msg, c.bot));
}

enum class Edit { Text, Caption, Markup };

HttpResponsePtr editMessage(Ctx& c, Edit what) {
    if (c.p.has("inline_message_id")) return fail(400, "Bad Request: inline messages are not supported");
    int64_t chatId = 0;
    if (auto e = chatOf(c, chatId)) return e;
    const auto mid = c.p.integer("message_id");
    if (!mid || *mid <= 0) return fail(400, "Bad Request: message identifier is not specified");
    auto row = c.db->execSqlSync("SELECT author_id, text, reply_markup, edited, attachment FROM messages "
                                 "WHERE id = ? AND channel_id = ?", *mid, chatId);
    if (row.empty()) return fail(400, "Bad Request: message to edit not found");
    if (row[0]["author_id"].as<int64_t>() != c.bot) return fail(400, "Bad Request: message can't be edited");
    // Как в Telegram: у сообщения с файлом меняется подпись (editMessageCaption), у текстового — текст
    const bool media = !row[0]["attachment"].isNull() && !row[0]["attachment"].as<std::string>().empty();
    if (what == Edit::Text && media) return fail(400, "Bad Request: there is no text in the message to edit");
    if (what == Edit::Caption && !media) return fail(400, "Bad Request: there is no caption in the message to edit");
    const std::string oldText = row[0]["text"].as<std::string>();
    Json::Value oldMarkup;
    if (row[0]["reply_markup"].isNull() || !JsonUtils::parse(row[0]["reply_markup"].as<std::string>(), oldMarkup))
        oldMarkup = Json::Value(Json::nullValue);
    std::string text = oldText;
    if (what == Edit::Text)
        if (auto e = textOf(c.p, text)) return e;
    if (what == Edit::Caption)
        if (auto e = captionOf(c.p.str("caption"), c.p.str("parse_mode"), text)) return e;
    Json::Value markup;
    if (auto e = markupOf(c.p, markup)) return e;
    if (text == oldText && markup == oldMarkup)
        return fail(400, "Bad Request: message is not modified: specified new message content and reply markup are "
                         "exactly the same as a current content and reply markup of the message");
    if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::BotSend, c.bot)) return tooFast();

    const bool textChanged = text != oldText;
    c.db->execSqlSync("UPDATE messages SET text = ?, reply_markup = ?, edited = CASE WHEN ? THEN 1 ELSE edited END "
                      "WHERE id = ?",
                      text, markupColumn(markup), textChanged ? 1 : 0, *mid);
    const Json::Value msg = Messages::load(c.db, *mid);
    Json::Value ws;
    ws["type"]         = "message_edited";
    ws["channel_id"]   = static_cast<Json::Int64>(chatId);
    ws["id"]           = static_cast<Json::Int64>(*mid);
    ws["text"]         = msg["text"];
    ws["reply_markup"] = msg["reply_markup"];
    ws["edited"]       = msg["edited"];
    Broadcast::toChannel(chatId, ws);
    return ok(Bots::tgMessage(c.db, msg, c.bot, textChanged));
}

HttpResponsePtr editMessageText(Ctx& c) { return editMessage(c, Edit::Text); }
HttpResponsePtr editMessageCaption(Ctx& c) { return editMessage(c, Edit::Caption); }
HttpResponsePtr editMessageReplyMarkup(Ctx& c) { return editMessage(c, Edit::Markup); }
HttpResponsePtr editMessageMedia(Ctx&) {
    return fail(400, "Bad Request: editMessageMedia is not supported, delete the message and send a new one");
}

HttpResponsePtr deleteMessage(Ctx& c) {
    int64_t chatId = 0;
    if (auto e = chatOf(c, chatId)) return e;
    const auto mid = c.p.integer("message_id");
    if (!mid || *mid <= 0) return fail(400, "Bad Request: message identifier is not specified");
    auto row = c.db->execSqlSync("SELECT author_id, attachment FROM messages WHERE id = ? AND channel_id = ?", *mid, chatId);
    if (row.empty()) return fail(400, "Bad Request: message to delete not found");
    if (row[0]["author_id"].as<int64_t>() != c.bot) return fail(400, "Bad Request: message can't be deleted");
    const bool pinned = !c.db->execSqlSync("SELECT 1 FROM pins WHERE message_id = ?", *mid).empty();
    c.db->execSqlSync("DELETE FROM messages WHERE id = ?", *mid);
    if (!row[0]["attachment"].isNull() && !row[0]["attachment"].as<std::string>().empty())
        Uploads::removeByUrl(row[0]["attachment"].as<std::string>());
    c.db->execSqlSync("DELETE FROM reactions WHERE message_id = ?", *mid);
    c.db->execSqlSync("DELETE FROM pins WHERE message_id = ?", *mid);
    c.db->execSqlSync("DELETE FROM bot_callbacks WHERE message_id = ?", *mid);
    Json::Value ws;
    ws["type"]       = "message_deleted";
    ws["channel_id"] = static_cast<Json::Int64>(chatId);
    ws["id"]         = static_cast<Json::Int64>(*mid);
    Broadcast::toChannel(chatId, ws);
    if (pinned) {
        Json::Value pins;
        pins["type"]       = "pins_updated";
        pins["channel_id"] = static_cast<Json::Int64>(chatId);
        Broadcast::toChannel(chatId, pins);
    }
    return ok(true);
}

HttpResponsePtr answerCallbackQuery(Ctx& c) {
    std::string id = c.p.str("callback_query_id");
    const std::string text = c.p.str("text");
    if (!TextUtils::isValidUtf8(text) || TextUtils::utf8Length(text) > 200)
        return fail(400, "Bad Request: answer text must be at most 200 characters");
    const std::string url = c.p.str("url");
    if (!url.empty()) {
        if (url.size() > 512 || !TextUtils::isValidUtf8(url) || TextUtils::hasControlChars(url) ||
            url.find(' ') != std::string::npos ||
            !(url.rfind("https://", 0) == 0 || url.rfind("http://", 0) == 0))
            return fail(400, "Bad Request: URL_INVALID");
    }
    auto pending = c.db->execSqlSync(
        "SELECT channel_id FROM bot_callbacks WHERE id = ? AND bot_id = ? AND answered = 0 "
        "AND created_at > datetime('now', '-15 minutes')", id, c.bot);
    if (pending.empty()) return fail(400, "Bad Request: query is too old or already answered");
    // Бота убрали из чата после нажатия — ответить нажавшему он уже не может
    if (Access::channel(c.db, pending[0]["channel_id"].as<int64_t>(), c.bot) != Access::Result::Ok)
        return fail(403, "Forbidden: bot is not a member of the chat");
    auto row = c.db->execSqlSync(
        "UPDATE bot_callbacks SET answered = 1 WHERE id = ? AND bot_id = ? AND answered = 0 "
        "RETURNING user_id, channel_id, message_id", id, c.bot);
    if (row.empty()) return fail(400, "Bad Request: query is too old or already answered");
    Json::Value ev;
    ev["type"]       = "callback_answer";
    ev["query_id"]   = id;
    ev["channel_id"] = static_cast<Json::Int64>(row[0]["channel_id"].as<int64_t>());
    ev["message_id"] = static_cast<Json::Int64>(row[0]["message_id"].as<int64_t>());
    ev["show_alert"] = c.p.boolean("show_alert");
    if (!text.empty()) ev["text"] = text;
    if (!url.empty()) ev["url"] = url;
    Broadcast::toUser(row[0]["user_id"].as<int64_t>(), ev);
    return ok(true);
}

HttpResponsePtr setMyCommands(Ctx& c) {
    const Json::Value cmds = c.p.json("commands");
    if (!cmds.isArray()) return fail(400, "Bad Request: commands must be an Array");
    if (cmds.size() > 100) return fail(400, "Bad Request: too many commands (at most 100)");
    Json::Value clean(Json::arrayValue);
    for (const auto& cmd : cmds) {
        std::string name = JsonUtils::getStr(cmd, "command");
        if (!name.empty() && name[0] == '/') name.erase(0, 1);
        const std::string desc = TextUtils::trim(JsonUtils::getStr(cmd, "description"));
        const bool okName = !name.empty() && name.size() <= 32 &&
                            std::all_of(name.begin(), name.end(), [](unsigned char ch) {
                                return std::islower(ch) || std::isdigit(ch) || ch == '_';
                            });
        if (!okName) return fail(400, "Bad Request: BOT_COMMAND_INVALID: command must be 1-32 characters a-z, 0-9, _");
        if (desc.empty() || !TextUtils::isValidUtf8(desc) || TextUtils::utf8Length(desc) > 256 ||
            TextUtils::hasControlChars(desc))
            return fail(400, "Bad Request: BOT_COMMAND_DESCRIPTION_INVALID: description must be 1-256 characters");
        Json::Value item;
        item["command"] = name;
        item["description"] = desc;
        clean.append(item);
    }
    std::string stored = JsonUtils::write(clean);
    c.db->execSqlSync("UPDATE bots SET commands = ? WHERE user_id = ?", stored, c.bot);
    return ok(true);
}

HttpResponsePtr getMyCommands(Ctx& c) {
    auto r = c.db->execSqlSync("SELECT commands FROM bots WHERE user_id = ?", c.bot);
    Json::Value cmds(Json::arrayValue);
    if (r.empty() || !JsonUtils::parse(r[0]["commands"].as<std::string>(), cmds) || !cmds.isArray())
        cmds = Json::Value(Json::arrayValue);
    return ok(cmds);
}

HttpResponsePtr deleteMyCommands(Ctx& c) {
    c.db->execSqlSync("UPDATE bots SET commands = '[]' WHERE user_id = ?", c.bot);
    return ok(true);
}

HttpResponsePtr getChat(Ctx& c) {
    int64_t chatId = 0;
    if (auto e = chatOf(c, chatId)) return e;
    Json::Value chat = Bots::tgChat(c.db, chatId, c.bot);
    chat["accent_color_id"] = 0;
    chat["max_reaction_count"] = 11;
    // Обязательные поля ChatFullInfo в актуальных библиотеках (aiogram 3)
    for (const char* k : {"unlimited_gifts", "limited_gifts", "unique_gifts", "premium_subscription", "gifts_from_channels"})
        chat["accepted_gift_types"][k] = false;
    return ok(chat);
}

HttpResponsePtr sendChatAction(Ctx& c) {
    int64_t chatId = 0;
    if (auto e = chatOf(c, chatId)) return e;
    // «печатает…» не чаще раза в 2 с; лишние вызовы молча принимаются
    if (UserRateLimiter::instance().allow(UserRateLimiter::Action::Typing, c.bot)) {
        auto r = c.db->execSqlSync("SELECT display_name FROM users WHERE id = ?", c.bot);
        Json::Value ev;
        ev["type"]       = "typing";
        ev["channel_id"] = static_cast<Json::Int64>(chatId);
        ev["user_id"]    = static_cast<Json::Int64>(c.bot);
        ev["name"]       = r.empty() ? std::string() : r[0]["display_name"].as<std::string>();
        Broadcast::toChannel(chatId, ev, c.bot);
    }
    return ok(true);
}

HttpResponsePtr setWebhook(Ctx& c) {
    const std::string url = TextUtils::trim(c.p.str("url"));
    const bool drop = c.p.boolean("drop_pending_updates");
    if (url.empty()) {
        c.db->execSqlSync("UPDATE bots SET webhook_url = NULL, webhook_secret = NULL WHERE user_id = ?", c.bot);
        if (drop) c.db->execSqlSync("DELETE FROM bot_updates WHERE bot_id = ?", c.bot);
        return ok(true);
    }
    if (const std::string why = Bots::webhookUrlProblem(url); !why.empty()) return fail(400, "Bad Request: " + why);
    const std::string secret = c.p.str("secret_token");
    if (secret.size() > 256 || !std::all_of(secret.begin(), secret.end(), [](unsigned char ch) {
            return std::isalnum(ch) || ch == '_' || ch == '-';
        }))
        return fail(400, "Bad Request: secret token contains unallowed characters");
    std::optional<std::string> secretCol;
    if (!secret.empty()) secretCol = secret;
    std::string urlCopy = url;
    c.db->execSqlSync("UPDATE bots SET webhook_url = ?, webhook_secret = ?, webhook_error = NULL, webhook_error_at = NULL "
                      "WHERE user_id = ?", urlCopy, secretCol, c.bot);
    if (c.p.has("allowed_updates")) Bots::setAllowedUpdates(c.db, c.bot, c.p.json("allowed_updates"));
    if (drop) c.db->execSqlSync("DELETE FROM bot_updates WHERE bot_id = ?", c.bot);
    Bots::cancelWaiter(c.bot, fail(409, "Conflict: terminated by setWebhook request"));
    Bots::flushToWebhook(c.bot);
    return ok(true);
}

HttpResponsePtr deleteWebhook(Ctx& c) {
    c.db->execSqlSync("UPDATE bots SET webhook_url = NULL, webhook_secret = NULL WHERE user_id = ?", c.bot);
    if (c.p.boolean("drop_pending_updates")) c.db->execSqlSync("DELETE FROM bot_updates WHERE bot_id = ?", c.bot);
    return ok(true);
}

HttpResponsePtr getWebhookInfo(Ctx& c) {
    auto r = c.db->execSqlSync(
        "SELECT webhook_url, webhook_error, CAST(strftime('%s', webhook_error_at) AS INTEGER) AS error_at, "
        "(SELECT COUNT(*) FROM bot_updates WHERE bot_id = ?) AS pending FROM bots WHERE user_id = ?",
        c.bot, c.bot);
    Json::Value info;
    info["url"] = r.empty() || r[0]["webhook_url"].isNull() ? std::string() : r[0]["webhook_url"].as<std::string>();
    info["has_custom_certificate"] = false;
    info["pending_update_count"] = r.empty() ? 0 : r[0]["pending"].as<int>();
    if (!r.empty() && !r[0]["webhook_error"].isNull()) {
        info["last_error_message"] = r[0]["webhook_error"].as<std::string>();
        if (!r[0]["error_at"].isNull()) info["last_error_date"] = static_cast<Json::Int64>(r[0]["error_at"].as<int64_t>());
    }
    info["max_connections"] = 40;
    return ok(info);
}

// Расширение Vicinity: сообщение видит только user_id, в истории его нет
HttpResponsePtr sendEphemeralMessage(Ctx& c) {
    int64_t chatId = 0;
    if (auto e = chatOf(c, chatId)) return e;
    const auto userId = c.p.integer("user_id");
    if (!userId || *userId <= 0) return fail(400, "Bad Request: user_id is empty");
    if (Access::channel(c.db, chatId, *userId) != Access::Result::Ok)
        return fail(400, "Bad Request: user not found in the chat");
    std::string text;
    if (auto e = textOf(c.p, text)) return e;
    Json::Value markup;
    if (auto e = markupOf(c.p, markup)) return e;
    if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::BotSend, c.bot)) return tooFast();

    auto u = c.db->execSqlSync("SELECT display_name, avatar_path, accent_color FROM users WHERE id = ?", c.bot);
    const std::string id = CryptoUtils::randomHex(12);
    const std::string created = nowUtc();
    Json::Value msg;
    msg["id"]              = 0;
    msg["channel_id"]      = static_cast<Json::Int64>(chatId);
    msg["author_id"]       = static_cast<Json::Int64>(c.bot);
    msg["author_name"]     = u.empty() ? std::string() : u[0]["display_name"].as<std::string>();
    msg["author_avatar"]   = u.empty() || u[0]["avatar_path"].isNull() ? std::string() : u[0]["avatar_path"].as<std::string>();
    msg["author_tier"]     = 0;
    msg["author_accent"]   = u.empty() || u[0]["accent_color"].isNull() ? std::string() : u[0]["accent_color"].as<std::string>();
    msg["author_style"]    = Json::Value(Json::nullValue);
    msg["author_badge"]    = Json::Value(Json::nullValue);
    msg["author_title"]    = "";
    msg["author_emblem"]   = "";
    msg["author_bot"]      = true;
    msg["text"]            = text;
    msg["created_at"]      = created;
    msg["edited"]          = false;
    msg["attachment"]      = "";
    msg["attachment_url"]  = "";
    msg["attachment_name"] = "";
    msg["attachment_size"] = 0;
    msg["attachment_type"] = "";
    msg["kind"]            = "";
    msg["meta"]            = Json::Value(Json::nullValue);
    msg["reactions"]       = Json::Value(Json::arrayValue);
    msg["reply_to"]        = 0;
    msg["reply"]           = Json::Value(Json::nullValue);
    msg["reply_markup"]    = markup;
    msg["webhook"]         = Json::Value(Json::nullValue);
    msg["ephemeral"]       = true;
    msg["ephemeral_id"]    = id;
    Json::Value ev;
    ev["type"]       = "ephemeral_message";
    ev["channel_id"] = static_cast<Json::Int64>(chatId);
    ev["message"]    = msg;
    Broadcast::toUser(*userId, ev);
    Bots::rememberEphemeral(id, {c.bot, *userId, chatId, msg});

    Json::Value result = Bots::tgMessage(c.db, msg, c.bot);
    result["ephemeral_id"] = id;
    return ok(result);
}

// ---------- Мини-приложения (§21.8) ----------

// {type:"bot_menu_button_changed", bot_id, channel_id}: шапка лички с ботом перечитывает кнопку меню.
// channel_id 0 — кнопка для всех чатов бота: событие получают все, у кого с ним личка
void menuButtonChanged(Ctx& c, int64_t chatId) {
    Json::Value ev;
    ev["type"]       = "bot_menu_button_changed";
    ev["bot_id"]     = static_cast<Json::Int64>(c.bot);
    ev["channel_id"] = static_cast<Json::Int64>(chatId);
    try {
        if (chatId > 0) {
            Broadcast::toChannel(chatId, ev, c.bot);
            return;
        }
        auto r = c.db->execSqlSync("SELECT m2.user_id FROM channel_members m1 "
                                   "JOIN channels ch ON ch.id = m1.channel_id AND ch.type = 'dm' "
                                   "JOIN channel_members m2 ON m2.channel_id = m1.channel_id AND m2.user_id != m1.user_id "
                                   "WHERE m1.user_id = ? LIMIT 10000", c.bot);
        for (const auto& row : r) Broadcast::toUser(row["user_id"].as<int64_t>(), ev);
    } catch (...) {}   // кнопка сохранена; без события клиент увидит её при следующем открытии лички
}

// setChatMenuButton(chat_id?, menu_button?) — без chat_id кнопка для всех чатов бота, без menu_button — default
HttpResponsePtr setChatMenuButton(Ctx& c) {
    int64_t chatId = 0;
    if (c.p.has("chat_id"))
        if (auto e = chatOf(c, chatId)) return e;
    Json::Value button;
    if (c.p.has("menu_button")) {
        std::string err;
        if (!Bots::parseMenuButton(c.p.json("menu_button"), button, err)) return fail(400, "Bad Request: " + err);
    } else {
        button["type"] = "default";
    }
    // Адрес самого Vicinity мини-приложению не годится (docs/API.md §21.8): открыть его всё равно не дадим
    if (button["type"].asString() == "web_app") {
        const std::string self = Bots::requestHost(c.req ? c.req->getHeader("host") : std::string());
        if (!self.empty() && Bots::webAppHost(button["web_app"]["url"].asString()) == self)
            return fail(400, "Bad Request: BUTTON_URL_INVALID: web_app.url must not point to Vicinity itself");
    }
    if (button["type"].asString() == "default") {
        c.db->execSqlSync("DELETE FROM bot_menu_buttons WHERE bot_id = ? AND channel_id = ?", c.bot, chatId);
        menuButtonChanged(c, chatId);
        return ok(true);
    }
    std::string stored = JsonUtils::write(button);
    while (!stored.empty() && stored.back() == '\n') stored.pop_back();
    c.db->execSqlSync("INSERT INTO bot_menu_buttons(bot_id, channel_id, button) VALUES(?, ?, ?) "
                      "ON CONFLICT(bot_id, channel_id) DO UPDATE SET button = excluded.button", c.bot, chatId, stored);
    menuButtonChanged(c, chatId);
    return ok(true);
}

HttpResponsePtr getChatMenuButton(Ctx& c) {
    int64_t chatId = 0;
    if (c.p.has("chat_id"))
        if (auto e = chatOf(c, chatId)) return e;
    return ok(Bots::menuButton(c.db, c.bot, chatId));
}

// answerWebAppQuery(web_app_query_id, result: InlineQueryResultArticle) — отличие от Telegram: сообщение приходит от
// самого бота в чат, откуда открыли мини-приложение (от имени человека Vicinity не пишет). Один ответ на query_id, час
HttpResponsePtr answerWebAppQuery(Ctx& c) {
    const std::string id = c.p.str("web_app_query_id");
    const Json::Value result = c.p.json("result");
    if (!result.isObject()) return fail(400, "Bad Request: result must be an object");
    if (JsonUtils::getStr(result, "type") != "article")
        return fail(400, "Bad Request: only InlineQueryResultArticle is supported");
    const Json::Value& content = result["input_message_content"];
    if (!content.isObject() || !content["message_text"].isString())
        return fail(400, "Bad Request: input_message_content.message_text is required");
    const std::string raw = content["message_text"].asString();
    if (!TextUtils::isValidUtf8(raw)) return fail(400, "Bad Request: text must be encoded in UTF-8");
    const std::string text = Bots::convertText(raw, JsonUtils::getStr(content, "parse_mode"));
    if (TextUtils::trim(text).empty()) return fail(400, "Bad Request: message text is empty");
    if (static_cast<int>(TextUtils::utf8Length(text)) > Vicinity::MAX_MESSAGE_LEN)
        return fail(400, "Bad Request: message is too long");
    Json::Value markup;
    std::string err;
    if (!Bots::parseMarkup(result["reply_markup"], markup, err)) return fail(400, "Bad Request: " + err);
    auto q = c.db->execSqlSync("SELECT channel_id FROM bot_webapp_queries WHERE id = ? AND bot_id = ? AND answered = 0 "
                               "AND created_at > datetime('now', '-1 hour')", id, c.bot);
    if (q.empty()) return fail(400, "Bad Request: QUERY_ID_INVALID");
    const int64_t chatId = q[0]["channel_id"].as<int64_t>();
    if (chatId <= 0 || Access::channel(c.db, chatId, c.bot) != Access::Result::Ok)
        return fail(400, "Bad Request: chat not found");
    if (const int64_t peer = Access::dmPeer(c.db, chatId, c.bot); peer && Access::blockedBetween(c.db, c.bot, peer))
        return fail(403, "Forbidden: bot was blocked by the user");
    if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::BotSend, c.bot)) return tooFast();
    if (c.db->execSqlSync("UPDATE bot_webapp_queries SET answered = 1 WHERE id = ? AND answered = 0 RETURNING id", id).empty())
        return fail(400, "Bad Request: QUERY_ID_INVALID");
    Messages::Post post;
    post.text = text;
    post.replyMarkup = markupColumn(markup);
    post.push = false;
    post.activity = false;
    Messages::post(c.db, chatId, c.bot, post);
    return ok(Json::Value(Json::objectValue));   // SentWebAppMessage без inline_message_id
}

HttpResponsePtr trueResult(Ctx&) { return ok(true); }

const std::map<std::string, Handler>& methods() {
    static const std::map<std::string, Handler> m = {
        {"getme", getMe},
        {"sendmessage", sendMessage},
        {"editmessagetext", editMessageText},
        {"editmessagereplymarkup", editMessageReplyMarkup},
        {"editmessagecaption", editMessageCaption},
        {"editmessagemedia", editMessageMedia},
        {"getfile", getFile},
        {"deletemessage", deleteMessage},
        {"answercallbackquery", answerCallbackQuery},
        {"setmycommands", setMyCommands},
        {"getmycommands", getMyCommands},
        {"deletemycommands", deleteMyCommands},
        {"getchat", getChat},
        {"sendchataction", sendChatAction},
        {"setwebhook", setWebhook},
        {"deletewebhook", deleteWebhook},
        {"getwebhookinfo", getWebhookInfo},
        {"sendephemeralmessage", sendEphemeralMessage},
        {"setchatmenubutton", setChatMenuButton},
        {"getchatmenubutton", getChatMenuButton},
        {"answerwebappquery", answerWebAppQuery},
        {"logout", trueResult},
        {"close", trueResult},
    };
    return m;
}

// Методы, которые могут ждать скачивания файла по ссылке: отвечают через cb
const std::map<std::string, AsyncHandler>& asyncMethods() {
    static const std::map<std::string, AsyncHandler> m = {
        {"sendphoto", sendPhoto},
        {"senddocument", sendDocument},
        {"sendvideo", sendVideo},
        {"sendaudio", sendAudio},
        {"sendvoice", sendVoice},
        {"sendanimation", sendAnimation},
        {"sendmediagroup", sendMediaGroup},
    };
    return m;
}

} // namespace

void BotApiController::handle(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb,
                              const std::string& token, const std::string& method) {
    // Токен — часть пути: в лог не пишем ни путь, ни токен
    try {
        auto db = app().getDbClient();
        const int64_t bot = Bots::authenticate(db, token);
        if (!bot) { cb(fail(401, "Unauthorized")); return; }
        if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::BotApi, bot)) { cb(tooFast()); return; }
        std::string name = method;
        std::transform(name.begin(), name.end(), name.begin(), [](unsigned char ch) { return std::tolower(ch); });
        Ctx c{bot, collect(req), db, req};

        if (name == "getupdates") {
            auto hook = db->execSqlSync("SELECT webhook_url FROM bots WHERE user_id = ?", bot);
            if (!hook.empty() && !hook[0]["webhook_url"].isNull()) {
                cb(fail(409, "Conflict: can't use getUpdates method while webhook is active; use deleteWebhook to "
                             "delete the webhook first"));
                return;
            }
            const int64_t offset = c.p.integer("offset").value_or(0);
            const int limit = static_cast<int>(std::clamp<int64_t>(c.p.integer("limit").value_or(100), 1, 100));
            const int timeout = static_cast<int>(std::clamp<int64_t>(c.p.integer("timeout").value_or(0), 0, 50));
            std::optional<Json::Value> allowed;
            if (c.p.has("allowed_updates")) allowed = c.p.json("allowed_updates");
            Bots::getUpdates(bot, offset, limit, timeout, allowed, std::move(cb));
            return;
        }
        const auto& am = asyncMethods();
        if (auto a = am.find(name); a != am.end()) {
            a->second(c, std::move(cb));
            return;
        }
        const auto& m = methods();
        auto it = m.find(name);
        if (it == m.end()) { cb(fail(404, "Not Found")); return; }
        cb(it->second(c));
    } catch (const std::exception& e) {
        LOG_ERROR << "bot api: " << method << ": " << e.what();
        cb(fail(500, "Internal Server Error"));
    }
}

// GET /api/v1/file/bot<токен>/<file_path> — файл из getFile. Бот получает только файлы, которые видит
// (canSeeFile); путь проверен регуляркой маршрута и isUploadUrl, выйти за каталог вложений нельзя
void BotApiController::file(const HttpRequestPtr&, std::function<void(const HttpResponsePtr&)>&& cb,
                            const std::string& token, const std::string& dir, const std::string& name) {
    try {
        auto db = app().getDbClient();
        const int64_t bot = Bots::authenticate(db, token);
        if (!bot) { cb(fail(401, "Unauthorized")); return; }
        if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::BotApi, bot)) { cb(tooFast()); return; }
        const std::string url = "/uploads/" + dir + "/" + name;
        std::error_code ec;
        const std::string path = Uploads::localPath(url);
        if (!Uploads::isUploadUrl(url, dir) || path.empty() || !canSeeFile(db, bot, url) ||
            !std::filesystem::is_regular_file(path, ec)) {
            cb(fail(404, "Not Found"));
            return;
        }
        const bool image = dir == "attachments";
        auto resp = HttpResponse::newFileResponse(path, "", CT_CUSTOM,
                                                  image ? Uploads::mimeType(url) : "application/octet-stream");
        resp->addHeader("Content-Disposition", Uploads::contentDisposition(storedName(db, url)));
        resp->addHeader("X-Content-Type-Options", "nosniff");
        resp->addHeader("Content-Security-Policy", "default-src 'none'; sandbox");
        resp->addHeader("Cache-Control", "private, no-store");
        cb(resp);
    } catch (const std::exception& e) {
        LOG_ERROR << "bot api: file: " << e.what();
        cb(fail(500, "Internal Server Error"));
    }
}
