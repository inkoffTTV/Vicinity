#pragma once
#include <string>

// Отправка писем через SMTP (custom_config.smtp; в Docker — переменные VICINITY_SMTP_* из deploy/.env).
// Подходит любой почтовый ящик с SMTP: Яндекс, Mail.ru, Gmail (пароль приложения) и т. п.
// Сервер, собранный без libcurl, письма не отправляет: configured() == false.
namespace Mailer {
    // Задан ли SMTP (host, from) и умеет ли сборка отправлять письма
    bool configured();

    // Отправить текстовое письмо в фоновом потоке (сетевой обмен не блокирует обработку запросов).
    // Ошибка отправки пишется в лог сервера.
    void sendAsync(const std::string& to, const std::string& subject, const std::string& body);
}
