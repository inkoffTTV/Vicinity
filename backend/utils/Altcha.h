#pragma once
#include <json/json.h>
#include <string>

// Капча ALTCHA (протокол altcha.org, без сторонних сервисов): сервер выдаёт задачу
// «найди number, при котором SHA-256(salt + number) == challenge», подписанную HMAC-ключом процесса.
// Браузер перебирает числа (доли секунды–пара секунд), сервер проверяет ответ за один хэш.
// Скрипту, создающему аккаунты пачками, каждая регистрация стоит столько же процессорного времени.
namespace Altcha {
    // Задача: {algorithm, challenge, maxnumber, salt, signature}; живёт ALTCHA_TTL_SEC
    Json::Value createChallenge();

    // payload — base64(JSON {algorithm, challenge, number, salt, signature}) из виджета.
    // true — решение верное, не истекло и не использовалось раньше (повтор того же решения отклоняется).
    bool verify(const std::string& payload);
}
