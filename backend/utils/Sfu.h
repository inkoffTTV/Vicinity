#pragma once
#include <cstdint>
#include <string>

// Голос в каналах через SFU LiveKit (docs/VOICE-SFU.md): сервер только выдаёт токены доступа к комнатам,
// медиа идёт в контейнер livekit. Конфиг — custom_config.sfu {url, key, secret}, в Docker — переменные
// LIVEKIT_API_KEY / LIVEKIT_API_SECRET (общие с контейнером) и VICINITY_SFU_URL. Без ключей — не настроен,
// клиенты идут по-старому (PCM через WebSocket, docs/API.md §11).
namespace Sfu {
    bool configured();

    // Адрес сигналинга для клиента: по умолчанию "/livekit" — тот же хост, что сайт (nginx проксирует)
    std::string url();

    // Имя комнаты голосового канала
    std::string roomFor(int64_t channelId);

    // JWT доступа (HS256, LiveKit video grant): identity "u<userId>", имя — display_name, срок ttlSec
    std::string token(int64_t userId, const std::string& displayName, const std::string& room, int64_t ttlSec);
}
