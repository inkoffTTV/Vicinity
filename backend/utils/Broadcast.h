#pragma once
#include <json/json.h>
#include <cstdint>
#include <set>
#include <string>

// Рассылка WS-событий. Все функции best-effort: ошибки БД логируются и не пробрасываются,
// чтобы уже выполненное действие (сообщение, кик, смена профиля) не превращалось в 500.
namespace Broadcast {
    void toUser(int64_t userId, const Json::Value& ev);
    // Всем, кто видит канал: участникам сервера (серверный канал) или участникам беседы/лички
    void toChannel(int64_t channelId, const Json::Value& ev);
    // Всем участникам сервера
    void toServer(int64_t serverId, const Json::Value& ev);

    // Друзья (accepted) + участники общих серверов
    std::set<int64_t> contactsOf(int64_t userId);

    // {type:"presence"} — эффективное присутствие пользователя его контактам
    void presence(int64_t userId);
    // {type:"user_updated"} — профиль изменился: контактам и самому пользователю (другие его вкладки)
    void userUpdated(int64_t userId);

    // {type:"voice_state", channel_id, users:[{user_id,name}]}
    std::string voiceStatePayload(int64_t channelId);
    // Состояние голосового канала всем, кто видит канал
    void voiceState(int64_t channelId);
}
