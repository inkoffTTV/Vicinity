#pragma once
#include <json/json.h>
#include <cstdint>
#include <string>

// Активность (docs/API.md §16): опыт и уровень за сообщения, звонки, голос и игры; ежедневная серия;
// титулы и эмблемы (награды) за события. Таблицы activity и awards. Все функции без исключений наружу.
namespace Activity {
    enum class Kind { Message, CallSeconds, VoiceSeconds, GamePlayed, GameWon };

    // Засчитать событие: обновить счётчики, опыт, серию; выдать новые награды и сообщить пользователю по WS
    void bump(int64_t userId, Kind kind, int64_t amount = 1);

    // {xp, level, level_xp, next_xp, streak, best_streak, msgs, call_min, voice_min, games, wins,
    //  title, emblem, awards:[{id, kind, name, rarity, desc, earned_at}]}
    Json::Value summary(int64_t userId);
    // Короткая сводка для чужого профиля и списков: {level, streak, title, emblem}
    Json::Value brief(int64_t userId);

    // Надеть титул/эмблему из заработанных ("" — снять); false — не заработано (error заполнен)
    bool equip(int64_t userId, const std::string& title, const std::string& emblem, std::string& error);

    // Полный каталог наград: [{id, kind, name, rarity, desc}]
    Json::Value catalog();
    // Друзья пользователя и он сам, по убыванию опыта: [{id, username, display_name, avatar_path, level, xp, streak}]
    Json::Value leaderboard(int64_t userId);

    int levelFor(int64_t xp);
}
