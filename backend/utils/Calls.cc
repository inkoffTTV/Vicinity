#include "Calls.h"
#include "Broadcast.h"
#include "JsonUtils.h"
#include "Messages.h"
#include "WebPush.h"
#include <drogon/drogon.h>
#include <chrono>
#include <map>
#include <mutex>

using namespace drogon;

namespace {

struct Pending {
    int64_t startedMs  = 0;
    int64_t acceptedMs = 0;   // 0 — ещё звонит
};

std::mutex gMutex;
// Ключ — (звонящий, адресат); у пары не бывает двух звонков сразу
std::map<std::pair<int64_t, int64_t>, Pending> gCalls;

int64_t nowMs() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

// Звонок, в котором участвуют эти двое, в любую сторону
bool find(int64_t a, int64_t b, std::pair<int64_t, int64_t>& key, Pending& out) {
    auto it = gCalls.find({a, b});
    if (it == gCalls.end()) it = gCalls.find({b, a});
    if (it == gCalls.end()) return false;
    key = it->first;
    out = it->second;
    return true;
}

int64_t dmChannel(const orm::DbClientPtr& db, int64_t a, int64_t b) {
    auto rows = db->execSqlSync(
        "SELECT c.id FROM channels c "
        "JOIN channel_members m1 ON c.id = m1.channel_id AND m1.user_id = ? "
        "JOIN channel_members m2 ON c.id = m2.channel_id AND m2.user_id = ? "
        "WHERE c.type = 'dm' AND (SELECT COUNT(*) FROM channel_members WHERE channel_id = c.id) = 2 "
        "ORDER BY c.id LIMIT 1", a, b);
    if (!rows.empty()) return rows[0]["id"].as<int64_t>();
    auto name = db->execSqlSync("SELECT display_name FROM users WHERE id = ?", b);
    auto ins = db->execSqlSync("INSERT INTO channels(type, name, owner_id) VALUES('dm', ?, ?) RETURNING id",
                               name.empty() ? std::string() : name[0]["display_name"].as<std::string>(), a);
    const int64_t id = ins[0]["id"].as<int64_t>();
    db->execSqlSync("INSERT OR IGNORE INTO channel_members(channel_id, user_id) VALUES(?, ?)", id, a);
    db->execSqlSync("INSERT OR IGNORE INTO channel_members(channel_id, user_id) VALUES(?, ?)", id, b);
    return id;
}

} // namespace

namespace Calls {

void onSignal(const std::string& type, int64_t from, int64_t to, const std::string& reason, bool delivered) {
    std::pair<int64_t, int64_t> key;
    Pending p;
    std::string result;
    int64_t duration = 0;
    {
        std::lock_guard<std::mutex> lock(gMutex);
        const bool known = find(from, to, key, p);
        if (type == "call_invite") {
            if (!delivered) {
                // Адресата нет в сети: звонок пропущен сразу, звонящему уже ушло call_unavailable
                if (known) gCalls.erase(key);
                result = "missed";
                key = {from, to};
            } else if (!known || p.acceptedMs) {
                gCalls[{from, to}] = Pending{nowMs(), 0};
            }
        } else if (!known) {
            return;
        } else if (type == "call_accept") {
            if (to == key.first) gCalls[key].acceptedMs = nowMs();   // принял адресат
        } else if (type == "call_reject" || type == "call_busy") {
            if (p.acceptedMs) return;
            gCalls.erase(key);
            result = (type == "call_busy" || reason == "timeout") ? "missed" : "declined";
        } else if (type == "call_end") {
            gCalls.erase(key);
            if (p.acceptedMs) {
                result   = "ok";
                duration = (nowMs() - p.acceptedMs) / 1000;
            } else {
                // Отбой до ответа: звонящий не дождался (или адресат отклонил через call_end)
                result = from == key.first ? "missed" : "declined";
            }
        } else {
            return;
        }
    }
    if (result.empty()) return;
    record(key.first, key.second, result, duration);
    if (type == "call_invite" && !delivered) {
        auto name = app().getDbClient()->execSqlSync("SELECT display_name FROM users WHERE id = ?", from);
        WebPush::notifyCall(to, from, name.empty() ? std::string() : name[0]["display_name"].as<std::string>());
    }
}

void record(int64_t caller, int64_t callee, const std::string& result, int64_t durationSec) {
    try {
        auto db = app().getDbClient();
        const int64_t channelId = dmChannel(db, caller, callee);
        Json::Value meta;
        meta["result"]   = result;
        meta["duration"] = static_cast<Json::Int64>(durationSec);
        auto ins = db->execSqlSync(
            "INSERT INTO messages(channel_id, author_id, text, kind, meta) VALUES(?, ?, '', 'call', ?) RETURNING id",
            channelId, caller, JsonUtils::write(meta));
        Json::Value msg = Messages::load(db, ins[0]["id"].as<int64_t>());
        Json::Value ws = msg;
        ws["type"] = "new_message";
        Broadcast::toChannel(channelId, ws);
        // Пропущенный — ещё и на телефон; про отклонённый или состоявшийся напоминать не о чем
        if (result == "missed") WebPush::notifyMessage(msg, channelId);
    } catch (const std::exception& e) {
        LOG_WARN << "calls: не удалось записать звонок: " << e.what();
    }
}

} // namespace Calls
