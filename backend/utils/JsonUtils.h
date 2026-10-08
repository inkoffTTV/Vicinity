#pragma once
#include <json/json.h>
#include <cstdint>
#include <memory>
#include <string>

// Безопасное чтение полей из клиентского JSON.
// jsoncpp бросает исключение на asInt64()/asString()/operator[] при неожиданном типе,
// поэтому всё, что пришло от клиента, читаем только через эти функции:
// неверный тип или отсутствие поля → значение по умолчанию.
namespace JsonUtils {

inline bool has(const Json::Value& o, const char* key) {
    return o.isObject() && o.isMember(key);
}

inline std::string getStr(const Json::Value& o, const char* key, const std::string& def = std::string()) {
    if (!o.isObject()) return def;
    const Json::Value& v = o[key];
    return v.isString() ? v.asString() : def;
}

inline int64_t getInt(const Json::Value& o, const char* key, int64_t def = 0) {
    if (!o.isObject()) return def;
    const Json::Value& v = o[key];
    return v.isInt64() ? v.asInt64() : def;
}

// Флаг: true/false или 0/1 (десктоп шлёт is_voice числом)
inline bool getBool(const Json::Value& o, const char* key, bool def = false) {
    if (!o.isObject()) return def;
    const Json::Value& v = o[key];
    if (v.isBool())  return v.asBool();
    if (v.isInt64()) return v.asInt64() != 0;
    return def;
}

// Разбор текста в JSON без исключений; false — синтаксическая ошибка
inline bool parse(const std::string& text, Json::Value& out) {
    Json::CharReaderBuilder builder;
    std::unique_ptr<Json::CharReader> reader(builder.newCharReader());
    std::string errs;
    return reader->parse(text.data(), text.data() + text.size(), &out, &errs);
}

inline std::string write(const Json::Value& v) {
    Json::FastWriter fw;
    return fw.write(v);
}

} // namespace JsonUtils
