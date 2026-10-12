#pragma once
#include <optional>
#include <string>

namespace EmailUtils {
    // Проверка и нормализация адреса для правила «один ящик — один аккаунт»:
    // нижний регистр, без «+метки», у Gmail без точек в имени (ivan.petrov+x@gmail.com → ivanpetrov@gmail.com).
    // nullopt — адрес некорректен.
    std::optional<std::string> normalize(const std::string& email);

    // Адрес сам по себе корректен и пригоден для отправки (без пробелов, переводов строк, ровно одна @)
    bool looksValid(const std::string& email);

    // Домен одноразовой почты (mailinator, temp-mail, 10minutemail и т. п.)
    bool isDisposable(const std::string& normalizedEmail);
}
