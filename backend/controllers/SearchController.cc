#include "SearchController.h"
#include "../managers/UserRateLimiter.h"
#include "../utils/Access.h"
#include "../utils/HttpUtils.h"
#include "../utils/Messages.h"
#include "../utils/TextUtils.h"
#include <drogon/drogon.h>

using namespace drogon;
using HttpUtils::error;

static constexpr size_t  kMinQueryLen = 2;
static constexpr int64_t kMaxResults  = 50;

// GET /api/v1/search?q=...[&channel_id=N | &server_id=S] — сообщения доступных каналов, новые первыми
void SearchController::search(const HttpRequestPtr& req,
                              std::function<void(const HttpResponsePtr&)>&& cb) {
    int64_t userId = req->attributes()->get<int64_t>("user_id");
    const std::string q = TextUtils::trim(req->getParameter("q"));
    if (!TextUtils::isValidUtf8(q) || TextUtils::utf8Length(q) < kMinQueryLen) {
        cb(error("Запрос — не короче 2 символов", k400BadRequest)); return;
    }
    const int64_t channelId = HttpUtils::intParam(req, "channel_id");
    const int64_t serverId  = HttpUtils::intParam(req, "server_id");
    if (!UserRateLimiter::instance().allow(UserRateLimiter::Action::Search, userId)) {
        cb(HttpUtils::tooManyRequests()); return;
    }

    auto db = app().getDbClient();
    try {
        // Название канала для выдачи: у лички — имя собеседника
        const std::string select =
            "SELECT " + Messages::kColumns + ", c.name AS channel_name, c.type AS channel_type, "
            "c.server_id AS server_id, "
            "(SELECT ou.display_name FROM channel_members ocm JOIN users ou ON ou.id = ocm.user_id "
            " WHERE ocm.channel_id = c.id AND ocm.user_id != ? LIMIT 1) AS peer_name "
            "FROM " + Messages::kFrom + " JOIN channels c ON c.id = m.channel_id "
            "WHERE m.text LIKE ? ESCAPE '\\' AND ";
        const std::string tail = " ORDER BY m.id DESC LIMIT " + std::to_string(kMaxResults);
        const std::string pattern = "%" + TextUtils::escapeLike(q) + "%";

        if (channelId > 0) {
            auto acc = Access::channel(db, channelId, userId);
            if (acc != Access::Result::Ok) { cb(HttpUtils::accessError(acc)); return; }
        } else if (serverId > 0) {
            if (Access::serverOwner(db, serverId) == 0) { cb(error("Сервер не найден", k404NotFound)); return; }
            if (!Access::isServerMember(db, serverId, userId)) {
                cb(error("Вы не участник этого сервера", k403Forbidden)); return;
            }
        }
        auto rows = channelId > 0
            ? db->execSqlSync(select + "m.channel_id = ?" + tail, userId, pattern, channelId)
            : serverId > 0
            ? db->execSqlSync(select + "c.server_id = ?" + tail, userId, pattern, serverId)
            : db->execSqlSync(select + "m.channel_id IN (" + std::string(Access::kAccessibleChannels) + ")" + tail,
                              userId, pattern, userId, userId);

        Json::Value arr(Json::arrayValue);
        for (const auto& row : rows) {
            Json::Value msg = Messages::fromRow(row);
            const bool dm = row["channel_type"].as<std::string>() == "dm";
            const char* nameCol = dm && !row["peer_name"].isNull() ? "peer_name" : "channel_name";
            msg["channel_name"] = row[nameCol].isNull() ? "" : row[nameCol].as<std::string>();
            msg["server_id"]    = static_cast<Json::Int64>(row["server_id"].isNull() ? 0 : row["server_id"].as<int64_t>());
            arr.append(msg);
        }
        Messages::attachReactions(db, arr);
        Json::Value resp;
        resp["results"] = arr;
        cb(HttpUtils::json(std::move(resp)));
    } catch (const std::exception& e) {
        cb(error(e.what(), k500InternalServerError));
    }
}
