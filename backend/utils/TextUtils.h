#pragma once
#include <cstddef>
#include <optional>
#include <string>
#include <string_view>

// Работа с UTF-8: все лимиты считаются в символах (кодовых точках), а не в байтах,
// и строки никогда не режутся посреди символа.
namespace TextUtils {
    // Корректная UTF-8 (без overlong-последовательностей, суррогатов и кодов > U+10FFFF)
    bool isValidUtf8(std::string_view s);
    // Длина в символах (для корректной UTF-8)
    size_t utf8Length(std::string_view s);
    // Первые maxChars символов — обрезка только по границе символа
    std::string utf8Truncate(std::string_view s, size_t maxChars);
    // Убрать пробельные символы ASCII по краям
    std::string trim(std::string_view s);
    // Есть ли управляющие символы (C0 и DEL); перевод строки и таб можно разрешить
    bool hasControlChars(std::string_view s, bool allowNewlines = false);

    // Однострочное имя (отображаемое имя, название сервера/канала/беседы):
    // корректная UTF-8 без управляющих символов, края обрезаны, не пустое, не длиннее maxChars.
    // truncate=true — длинное имя обрезается по границе символа, а не отвергается.
    // nullopt — имя недопустимо.
    std::optional<std::string> cleanName(std::string_view raw, size_t maxChars, bool truncate = false);

    // Цвет вида #RRGGBB
    bool isHexColor(std::string_view s);

    // Экранирование для LIKE ... ESCAPE '\': символы % и _ (и сам \) ищутся буквально
    std::string escapeLike(std::string_view s);
}
