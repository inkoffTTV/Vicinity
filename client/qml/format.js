.pragma library

// Экранируем HTML, затем применяем ТОЛЬКО белый список форматирования.
// Так пользовательский ввод не может внедрить произвольную разметку (анти-XSS).
function escapeHtml(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// Базовое форматирование «обо мне»: **жирный**, *курсив*, __подчерк__, ссылки, переносы.
function bio(text) {
    if (!text) return "";
    var s = escapeHtml(text);
    s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
    s = s.replace(/__([^_]+)__/g, "<u>$1</u>");
    s = s.replace(/\*([^*]+)\*/g, "<i>$1</i>");
    // ссылки: только http/https, href из уже экранированного текста
    s = s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
    s = s.replace(/\n/g, "<br/>");
    return s;
}

// "2026-06-16 16:53:15" -> "16 июн 2026"
function memberSince(iso) {
    if (!iso) return "";
    var m = ["янв","фев","мар","апр","мая","июн","июл","авг","сен","окт","ноя","дек"];
    var d = String(iso).split(/[- :]/);
    if (d.length < 3) return iso;
    var day = parseInt(d[2], 10), mon = parseInt(d[1], 10) - 1, year = d[0];
    if (isNaN(day) || mon < 0 || mon > 11) return iso;
    return day + " " + m[mon] + " " + year;
}

// Безопасный разбор JSON, при ошибке — значение по умолчанию
function parse(jsonStr, fallback) {
    try { return jsonStr ? JSON.parse(jsonStr) : fallback; }
    catch (e) { return fallback; }
}
