#include "Tiers.h"

namespace Tiers {

int clamp(int tier) { return tier < 0 ? 0 : tier > 3 ? 3 : tier; }

int64_t uploadLimitBytes(int tier) {
    static constexpr int64_t mb[] = {15, 25, 50, 100};
    return mb[clamp(tier)] * 1024 * 1024;
}

int maxOwnedServers(int tier) {
    static constexpr int n[] = {10, 25, 50, -1};
    return n[clamp(tier)];
}

int bioLimit(int tier) { return clamp(tier) >= 2 ? 400 : 190; }

bool animatedBanner(int tier) { return clamp(tier) >= 2; }
bool colorThemes(int tier)    { return clamp(tier) >= 2; }
bool customTheme(int tier)    { return clamp(tier) >= 3; }
bool nameColor(int tier)      { return clamp(tier) >= 1; }
bool gradientName(int tier)   { return clamp(tier) >= 3; }

Json::Value describe(int tier) {
    tier = clamp(tier);
    // Демонстрация экрана: минимум 1080p 30 к/с для всех; выше — по подписке.
    // Камера: 720p, у Ultra 1080p. Качество выставляет клиент (WebRTC идёт напрямую между участниками).
    static constexpr int screenHeight[] = {1080, 1080, 1440, 2160};
    static constexpr int screenFps[]    = {30, 60, 60, 60};
    static const char*   names[]        = {"Бесплатно", "Basic", "Standard", "Ultra"};

    Json::Value v;
    v["tier"]            = tier;
    v["name"]            = names[tier];
    v["files_mb"]        = static_cast<Json::Int64>(uploadLimitBytes(tier) / (1024 * 1024));
    v["screen"]["height"] = screenHeight[tier];
    v["screen"]["fps"]    = screenFps[tier];
    v["camera_height"]   = tier >= 3 ? 1080 : 720;
    v["servers"]         = maxOwnedServers(tier);
    v["bio"]             = bioLimit(tier);
    v["animated_banner"] = animatedBanner(tier);
    v["color_themes"]    = colorThemes(tier);
    v["custom_theme"]    = customTheme(tier);
    v["name_color"]      = nameColor(tier);
    v["gradient_name"]   = gradientName(tier);
    return v;
}

} // namespace Tiers
