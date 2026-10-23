#include "InviteController.h"
#include "../utils/Access.h"
#include "../utils/Broadcast.h"
#include "../utils/HttpUtils.h"
#include "../utils/Invites.h"
#include <drogon/drogon.h>
#include <optional>

using HttpUtils::error;

namespace {

struct Pending {
    int64_t     id = 0;
    std::string kind;
    int64_t     targetId  = 0;
    int64_t     inviterId = 0;
};

// Своё ожидающее приглашение; nullopt — нет такого (или оно чужое)
std::optional<Pending> pendingFor(const orm::DbClientPtr& db, int64_t id, int64_t self) {
    auto r = db->execSqlSync(
        "SELECT id, kind, target_id, inviter_id FROM invites WHERE id = ? AND invitee_id = ?", id, self);
    if (r.empty()) return std::nullopt;
    return Pending{r[0]["id"].as<int64_t>(), r[0]["kind"].as<std::string>(), r[0]["target_id"].as<int64_t>(),
                   r[0]["inviter_id"].as<int64_t>()};
}

// Приглашение закрыто: убрать строку, обновить список у всех устройств приглашённого
// и рассказать пригласившему, чем кончилось
void close(const orm::DbClientPtr& db, const Pending& p, int64_t self, bool accepted, const std::string& name) {
    db->execSqlSync("DELETE FROM invites WHERE id = ?", p.id);
    Json::Value removed;
    removed["type"]      = "invite_removed";
    removed["invite_id"] = static_cast<Json::Int64>(p.id);
    Broadcast::toUser(self, removed);

    auto u = db->execSqlSync("SELECT display_name FROM users WHERE id = ?", self);
    Json::Value ans;
    ans["type"]      = "invite_answered";
    ans["kind"]      = p.kind;
    ans["target_id"] = static_cast<Json::Int64>(p.targetId);
    ans["name"]      = name;
    ans["accepted"]  = accepted;
    ans["user_id"]   = static_cast<Json::Int64>(self);
    ans["user_name"] = u.empty() ? "" : u[0]["display_name"].as<std::string>();
    Broadcast::toUser(p.inviterId, ans);
}

} // namespace

// GET /api/v1/invites → {"invites":[{id, kind, target_id, name, icon, members, inviter{...}, created_at}]}
void InviteController::list(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb) {
    int64_t self = req->attributes()->get<int64_t>("user_id");
    auto db = app().getDbClient();
    try {
        auto rows = db->execSqlSync("SELECT id FROM invites WHERE invitee_id = ? ORDER BY id DESC LIMIT 100", self);
        Json::Value arr(Json::arrayValue);
        for (const auto& row : rows) {
            Json::Value v = Invites::describe(db, row["id"].as<int64_t>());
            if (!v.isNull()) arr.append(std::move(v));
        }
        Json::Value resp;
        resp["invites"] = arr;
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

// POST /api/v1/invites/{id}/accept → {"status":"joined","kind":"group","channel_id":N} | {"…","server_id":S}
void InviteController::accept(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id) {
    int64_t self = req->attributes()->get<int64_t>("user_id");
    auto db = app().getDbClient();
    try {
        auto p = pendingFor(db, id, self);
        if (!p) { cb(error("Приглашение не найдено", k404NotFound)); return; }
        Json::Value resp;
        resp["status"] = "joined";
        resp["kind"]   = p->kind;

        if (p->kind == "group") {
            auto ch = db->execSqlSync(
                "SELECT name FROM channels WHERE id = ? AND type = 'group' AND server_id IS NULL", p->targetId);
            if (ch.empty()) {
                close(db, *p, self, false, "");
                cb(error("Этой беседы больше нет", k404NotFound)); return;
            }
            const std::string name = ch[0]["name"].isNull() ? "" : ch[0]["name"].as<std::string>();
            auto ins = db->execSqlSync(
                "INSERT OR IGNORE INTO channel_members(channel_id, user_id) VALUES(?, ?) RETURNING user_id",
                p->targetId, self);
            if (!ins.empty()) {
                Json::Value joined;
                joined["type"]       = "channel_member_joined";
                joined["channel_id"] = static_cast<Json::Int64>(p->targetId);
                joined["user_id"]    = static_cast<Json::Int64>(self);
                Broadcast::toChannel(p->targetId, joined, self);
            }
            close(db, *p, self, true, name);
            // Другим устройствам — беседа в списке (accepted: тост «вас добавили» не нужен)
            Json::Value ev;
            ev["type"]       = "channel_added";
            ev["channel_id"] = static_cast<Json::Int64>(p->targetId);
            ev["name"]       = name;
            ev["accepted"]   = true;
            Broadcast::toUser(self, ev);
            resp["channel_id"] = static_cast<Json::Int64>(p->targetId);
        } else {
            auto s = db->execSqlSync("SELECT name FROM servers WHERE id = ?", p->targetId);
            if (s.empty()) {
                close(db, *p, self, false, "");
                cb(error("Этого сервера больше нет", k404NotFound)); return;
            }
            const std::string name = s[0]["name"].as<std::string>();
            if (Access::isBanned(db, p->targetId, self)) {
                close(db, *p, self, false, name);
                cb(error("Вы заблокированы на этом сервере", k403Forbidden)); return;
            }
            auto ins = db->execSqlSync(
                "INSERT OR IGNORE INTO server_members(server_id, user_id) VALUES(?, ?) RETURNING user_id",
                p->targetId, self);
            if (!ins.empty()) {
                Json::Value joined;
                joined["type"]      = "server_member_joined";
                joined["server_id"] = static_cast<Json::Int64>(p->targetId);
                joined["user_id"]   = static_cast<Json::Int64>(self);
                Broadcast::toServer(p->targetId, joined);
            }
            close(db, *p, self, true, name);
            Json::Value ev;
            ev["type"]      = "server_added";
            ev["server_id"] = static_cast<Json::Int64>(p->targetId);
            ev["name"]      = name;
            ev["accepted"]  = true;
            Broadcast::toUser(self, ev);
            resp["server_id"] = static_cast<Json::Int64>(p->targetId);
        }
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

// POST /api/v1/invites/{id}/decline → {"status":"declined"}
void InviteController::decline(const HttpRequestPtr& req, std::function<void(const HttpResponsePtr&)>&& cb, int64_t id) {
    int64_t self = req->attributes()->get<int64_t>("user_id");
    auto db = app().getDbClient();
    try {
        auto p = pendingFor(db, id, self);
        if (!p) { cb(error("Приглашение не найдено", k404NotFound)); return; }
        auto r = p->kind == "group"
            ? db->execSqlSync("SELECT name FROM channels WHERE id = ?", p->targetId)
            : db->execSqlSync("SELECT name FROM servers WHERE id = ?", p->targetId);
        close(db, *p, self, false, r.empty() || r[0]["name"].isNull() ? "" : r[0]["name"].as<std::string>());
        Json::Value resp;
        resp["status"] = "declined";
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}
