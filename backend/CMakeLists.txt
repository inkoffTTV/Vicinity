cmake_minimum_required(VERSION 3.16)
project(VicinityServer VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(Drogon CONFIG REQUIRED)
find_package(OpenSSL REQUIRED)

add_executable(VicinityServer
    main.cc
    controllers/AccountController.cc
    controllers/ActivityController.cc
    controllers/HealthController.cc
    controllers/HomeController.cc
    controllers/AdminController.cc
    controllers/AuthController.cc
    controllers/ChannelController.cc
    controllers/ChatController.cc
    controllers/FriendsController.cc
    controllers/InviteController.cc
    controllers/GamesController.cc
    controllers/PlayController.cc
    controllers/ProfileController.cc
    controllers/PushController.cc
    controllers/ReadController.cc
    controllers/RoleController.cc
    controllers/RtcController.cc
    controllers/MusicController.cc
    controllers/SearchController.cc
    controllers/ServerController.cc
    controllers/SettingsController.cc
    controllers/ThemesController.cc
    controllers/UserController.cc
    controllers/WSController.cc
    filters/AuthFilter.cc
    filters/RateLimitFilter.cc
    managers/SessionManager.cc
    managers/UserRateLimiter.cc
    managers/WSManager.cc
    managers/VoiceManager.cc
    managers/ActivityManager.cc
    models/Cascade.cc
    models/Database.cc
    models/User.cc
    utils/Access.cc
    utils/Activity.cc
    utils/Altcha.cc
    utils/Broadcast.cc
    utils/Calls.cc
    utils/CryptoUtils.cc
    utils/EmailUtils.cc
    utils/Gifts.cc
    utils/Listen.cc
    utils/FileSystem.cc
    utils/Invites.cc
    utils/Mailer.cc
    utils/Messages.cc
    utils/NetUtils.cc
    utils/Privacy.cc
    utils/ProfileExt.cc
    utils/Sfu.cc
    utils/TextUtils.cc
    utils/Tiers.cc
    utils/Totp.cc
    utils/TwoFactor.cc
    utils/Uploads.cc
    utils/WebPush.cc
)

target_include_directories(VicinityServer PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${CMAKE_CURRENT_SOURCE_DIR}/../shared
)

target_link_libraries(VicinityServer PRIVATE
    Drogon::Drogon
    OpenSSL::Crypto
)

# Копируем config.json рядом с бинарником после каждой сборки,
# чтобы рантайм-конфиг не устаревал относительно исходника.
add_custom_command(TARGET VicinityServer POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
            ${CMAKE_CURRENT_SOURCE_DIR}/config.json
            $<TARGET_FILE_DIR:VicinityServer>/config.json
)

# libcurl — отправка писем с кодом подтверждения (SMTP). Необязательна: без неё сервер собирается,
# но режим регистрации «email» недоступен (utils/Mailer.cc).
find_package(CURL QUIET)
if(CURL_FOUND)
    target_link_libraries(VicinityServer PRIVATE CURL::libcurl)
    target_compile_definitions(VicinityServer PRIVATE VICINITY_HAVE_CURL)
    message(STATUS "Vicinity: SMTP via libcurl enabled")
else()
    message(WARNING "Vicinity: libcurl not found - e-mail verification is disabled")
endif()
