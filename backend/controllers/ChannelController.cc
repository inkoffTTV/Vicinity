#include "ChannelController.h"
#include "../managers/VoiceManager.h"
#include "../managers/WSManager.h"
#include "../models/Cascade.h"
#include "../utils/Access.h"
#include "../utils/Broadcast.h"
#include "../utils/HttpUtils.h"
#include "../utils/JsonUtils.h"
#include "../utils/Messages.h"
#include "../utils/TextUtils.h"
#include "../../shared/crypto/common_consts.h"
#include <drogon/drogon.h>

using namespace drogon;
using HttpUtils::error;
using HttpUtils::accessError;

static Json::Value channelEvent(const char* type, int64_t channelId) {
    Json::Value ev;
    ev["type"]       = type;
    ev["channel_id"] = static_cast<Json::Int64>(channelId);
    return ev;
}

static void serverChannelsChanged(int64_t serverId) {
    Json::Value ev;
    ev["type"]      = "server_channels_changed";
    ev["server_id"] = static_cast<Json::Int64>(serverId);
    Broadcast::toServer(serverId, ev);
}

// Управлять каналом сервера может только владелец сервера
static bool isServerOwner(const orm::DbClientPtr& db, const Access::ChannelInfo& info, int64_t userId) {
    return info.serverId != 0 && Access::serverOwner(db, info.serverId) == userId;
}

// GET /api/v1/channels/{id}/members — участники беседы/лички (у канала сервера — участники сервера)
void ChannelController::members(const HttpRequestPtr& req,
                                std::function<void(const HttpResponsePtr&)>&& cb,
                                int64_t channelId) {
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    auto db = app().getDbClient();
    try {
        Access::ChannelInfo info;
        auto acc = Access::channel(db, channelId, userId, &info);
        if (acc != Access::Result::Ok) { cb(accessError(acc)); return; }

        auto rows = info.serverId != 0
            ? db->execSqlSync(
                  "SELECT u.id, u.username, u.display_name, u.avatar_path, u.presence, s.owner_id "
                  "FROM server_members sm JOIN users u ON u.id = sm.user_id "
                  "JOIN servers s ON s.id = sm.server_id "
                  "WHERE sm.server_id = ? ORDER BY u.display_name COLLATE NOCASE", info.serverId)
            : db->execSqlSync(
                  "SELECT u.id, u.username, u.display_name, u.avatar_path, u.presence, c.owner_id "
                  "FROM channel_members cm JOIN users u ON u.id = cm.user_id "
                  "JOIN channels c ON c.id = cm.channel_id "
                  "WHERE cm.channel_id = ? ORDER BY cm.joined_at, cm.rowid", channelId);
        Json::Value arr(Json::arrayValue);
        for (const auto& r : rows) {
            const int64_t uid = r["id"].as<int64_t>();
            const std::string pres = r["presence"].isNull() ? "online" : r["presence"].as<std::string>();
            // Эффективное присутствие: онлайн только при активном WS и не «невидимке»
            const bool online = WSManager::instance().isOnline(uid) && pres != "invisible";
            Json::Value m;
            m["id"]           = static_cast<Json::Int64>(uid);
            m["username"]     = r["username"].as<std::string>();
            m["display_name"] = r["display_name"].as<std::string>();
            m["avatar_path"]  = r["avatar_path"].isNull() ? "" : r["avatar_path"].as<std::string>();
            m["presence"]     = online ? pres : "offline";
            m["is_owner"]     = !r["owner_id"].isNull() && r["owner_id"].as<int64_t>() == uid;
            arr.append(m);
        }
        Json::Value resp;
        resp["members"] = arr;
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

// POST /api/v1/channels/{id}/leave — выйти из беседы. Ушёл владелец — владельцем становится
// самый давний участник; ушёл последний — беседа удаляется.
void ChannelController::leave(const HttpRequestPtr& req,
                              std::function<void(const HttpResponsePtr&)>&& cb,
                              int64_t channelId) {
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    auto db = app().getDbClient();
    try {
        Access::ChannelInfo info;
        auto acc = Access::channel(db, channelId, userId, &info);
        if (acc != Access::Result::Ok) { cb(accessError(acc)); return; }
        if (info.serverId != 0) {
            cb(error("Из канала сервера нельзя выйти — можно выйти с сервера", k400BadRequest)); return;
        }
        if (info.type == "dm") { cb(error("Из личной переписки нельзя выйти", k400BadRequest)); return; }

        db->execSqlSync("DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?", channelId, userId);
        Broadcast::evictFromVoice(userId, {channelId});

        auto rest = db->execSqlSync(
            "SELECT user_id FROM channel_members WHERE channel_id = ? ORDER BY joined_at, rowid LIMIT 1",
            channelId);
        if (rest.empty()) {
            Cascade::deleteChannel(db, channelId);
        } else {
            auto owner = db->execSqlSync("SELECT owner_id FROM channels WHERE id = ?", channelId);
            int64_t ownerId = owner.empty() || owner[0]["owner_id"].isNull() ? 0 : owner[0]["owner_id"].as<int64_t>();
            if (ownerId == userId) {
                ownerId = rest[0]["user_id"].as<int64_t>();
                db->execSqlSync("UPDATE channels SET owner_id = ? WHERE id = ?", ownerId, channelId);
            }
            Json::Value left = channelEvent("channel_member_left", channelId);
            left["user_id"]  = static_cast<Json::Int64>(userId);
            left["owner_id"] = static_cast<Json::Int64>(ownerId);
            Broadcast::toChannel(channelId, left);
        }
        // Во все подключения ушедшего — беседа пропадает из списка
        Broadcast::toUser(userId, channelEvent("channel_removed", channelId));

        Json::Value resp;
        resp["status"] = "left";
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

// POST /api/v1/channels/{id}/update {name} — переименовать беседу (участник) или канал сервера (владелец)
void ChannelController::update(const HttpRequestPtr& req,
                               std::function<void(const HttpResponsePtr&)>&& cb,
                               int64_t channelId) {
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { cb(error("Invalid JSON", k400BadRequest)); return; }
    auto name = TextUtils::cleanName(JsonUtils::getStr(*json, "name"), Vicinity::MAX_NAME_LEN);
    if (!name) { cb(error("Название — от 1 до 64 символов", k400BadRequest)); return; }

    auto db = app().getDbClient();
    try {
        Access::ChannelInfo info;
        auto acc = Access::channel(db, channelId, userId, &info);
        if (acc != Access::Result::Ok) { cb(accessError(acc)); return; }
        if (info.type == "dm") { cb(error("Личную переписку нельзя переименовать", k400BadRequest)); return; }
        if (info.serverId != 0 && !isServerOwner(db, info, userId)) {
            cb(error("Переименовать канал может только владелец сервера", k403Forbidden)); return;
        }
        db->execSqlSync("UPDATE channels SET name = ? WHERE id = ?", *name, channelId);

        Json::Value ev = channelEvent("channel_updated", channelId);
        ev["name"] = *name;
        Broadcast::toChannel(channelId, ev);
        if (info.serverId != 0) serverChannelsChanged(info.serverId);

        Json::Value resp;
        resp["channel_id"] = static_cast<Json::Int64>(channelId);
        resp["name"]       = *name;
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

// DELETE /api/v1/channels/{id} — удалить канал сервера (владелец сервера) или беседу (её владелец)
void ChannelController::remove(const HttpRequestPtr& req,
                               std::function<void(const HttpResponsePtr&)>&& cb,
                               int64_t channelId) {
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    auto db = app().getDbClient();
    try {
        Access::ChannelInfo info;
        auto acc = Access::channel(db, channelId, userId, &info);
        if (acc != Access::Result::Ok) { cb(accessError(acc)); return; }
        if (info.type == "dm") { cb(error("Личную переписку удалить нельзя", k400BadRequest)); return; }
        if (info.serverId != 0) {
            if (!isServerOwner(db, info, userId)) {
                cb(error("Удалить канал может только владелец сервера", k403Forbidden)); return;
            }
        } else {
            auto owner = db->execSqlSync("SELECT owner_id FROM channels WHERE id = ?", channelId);
            if (owner.empty() || owner[0]["owner_id"].isNull() || owner[0]["owner_id"].as<int64_t>() != userId) {
                cb(error("Удалить беседу может только её владелец", k403Forbidden)); return;
            }
        }

        // Состав и голос — пока канал ещё существует
        const auto audience = Broadcast::channelAudience(channelId);
        for (int64_t uid : VoiceManager::instance().usersIn(channelId))
            Broadcast::evictFromVoice(uid, {channelId});
        Cascade::deleteChannel(db, channelId);

        if (info.serverId != 0) {
            serverChannelsChanged(info.serverId);
        } else {
            const Json::Value ev = channelEvent("channel_removed", channelId);
            for (int64_t uid : audience) Broadcast::toUser(uid, ev);
        }
        Json::Value resp;
        resp["status"] = "deleted";
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

// Закреплять в личках и беседах может любой участник, в каналах сервера — владелец сервера
static bool canManagePins(const orm::DbClientPtr& db, const Access::ChannelInfo& info, int64_t userId) {
    return info.serverId == 0 || isServerOwner(db, info, userId);
}

// GET /api/v1/channels/{id}/pins — закреплённые сообщения, последние закреплённые первыми
void ChannelController::listPins(const HttpRequestPtr& req,
                                 std::function<void(const HttpResponsePtr&)>&& cb,
                                 int64_t channelId) {
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    auto db = app().getDbClient();
    try {
        auto acc = Access::channel(db, channelId, userId);
        if (acc != Access::Result::Ok) { cb(accessError(acc)); return; }
        auto rows = db->execSqlSync(
            "SELECT " + Messages::kColumns + ", p.pinned_by, p.pinned_at FROM " + Messages::kFrom + " "
            "JOIN pins p ON p.message_id = m.id "
            "WHERE p.channel_id = ? ORDER BY p.pinned_at DESC, m.id DESC", channelId);
        Json::Value arr(Json::arrayValue);
        for (const auto& row : rows) {
            Json::Value msg = Messages::fromRow(row);
            msg["pinned_by"] = static_cast<Json::Int64>(row["pinned_by"].as<int64_t>());
            msg["pinned_at"] = row["pinned_at"].as<std::string>();
            arr.append(msg);
        }
        Messages::attachReactions(db, arr);
        Json::Value resp;
        resp["pins"] = arr;
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

// POST /api/v1/channels/{id}/pins {message_id}
void ChannelController::pin(const HttpRequestPtr& req,
                            std::function<void(const HttpResponsePtr&)>&& cb,
                            int64_t channelId) {
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    auto json = req->getJsonObject();
    if (!json || !json->isObject()) { cb(error("Invalid JSON", k400BadRequest)); return; }
    int64_t msgId = JsonUtils::getInt(*json, "message_id");
    if (msgId <= 0) { cb(error("Неверное сообщение", k400BadRequest)); return; }

    auto db = app().getDbClient();
    try {
        Access::ChannelInfo info;
        auto acc = Access::channel(db, channelId, userId, &info);
        if (acc != Access::Result::Ok) { cb(accessError(acc)); return; }
        if (!canManagePins(db, info, userId)) {
            cb(error("Закреплять сообщения может только владелец сервера", k403Forbidden)); return;
        }
        if (db->execSqlSync("SELECT 1 FROM messages WHERE id = ? AND channel_id = ?", msgId, channelId).empty()) {
            cb(error("Сообщение не найдено", k404NotFound)); return;
        }
        auto ins = db->execSqlSync(
            "INSERT OR IGNORE INTO pins(message_id, channel_id, pinned_by) VALUES(?, ?, ?) RETURNING message_id",
            msgId, channelId, userId);
        if (!ins.empty()) Broadcast::toChannel(channelId, channelEvent("pins_updated", channelId));

        Json::Value resp;
        resp["status"] = "pinned";
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}

// DELETE /api/v1/channels/{id}/pins/{mid}
void ChannelController::unpin(const HttpRequestPtr& req,
                              std::function<void(const HttpResponsePtr&)>&& cb,
                              int64_t channelId, int64_t msgId) {
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    auto db = app().getDbClient();
    try {
        Access::ChannelInfo info;
        auto acc = Access::channel(db, channelId, userId, &info);
        if (acc != Access::Result::Ok) { cb(accessError(acc)); return; }
        if (!canManagePins(db, info, userId)) {
            cb(error("Откреплять сообщения может только владелец сервера", k403Forbidden)); return;
        }
        auto del = db->execSqlSync(
            "DELETE FROM pins WHERE message_id = ? AND channel_id = ? RETURNING message_id", msgId, channelId);
        if (!del.empty()) Broadcast::toChannel(channelId, channelEvent("pins_updated", channelId));

        Json::Value resp;
        resp["status"] = "unpinned";
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}
