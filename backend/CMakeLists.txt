cmake_minimum_required(VERSION 3.16)
project(VicinityServer VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(Drogon CONFIG REQUIRED)
find_package(OpenSSL REQUIRED)

add_executable(VicinityServer
    main.cc
    controllers/AdminController.cc
    controllers/AuthController.cc
    controllers/ChannelController.cc
    controllers/ChatController.cc
    controllers/FriendsController.cc
    controllers/GamesController.cc
    controllers/ProfileController.cc
    controllers/ReadController.cc
    controllers/RoleController.cc
    controllers/RtcController.cc
    controllers/SearchController.cc
    controllers/ServerController.cc
    controllers/SettingsController.cc
    controllers/UserController.cc
    controllers/WSController.cc
    filters/AuthFilter.cc
    filters/RateLimitFilter.cc
    managers/SessionManager.cc
    managers/UserRateLimiter.cc
    managers/WSManager.cc
    managers/VoiceManager.cc
    models/Cascade.cc
    models/Database.cc
    models/User.cc
    utils/Access.cc
    utils/Altcha.cc
    utils/Broadcast.cc
    utils/CryptoUtils.cc
    utils/EmailUtils.cc
    utils/FileSystem.cc
    utils/Mailer.cc
    utils/Messages.cc
    utils/NetUtils.cc
    utils/ProfileExt.cc
    utils/TextUtils.cc
    utils/Tiers.cc
    utils/Uploads.cc
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
