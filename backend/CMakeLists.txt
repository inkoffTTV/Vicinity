cmake_minimum_required(VERSION 3.16)
project(VicinityServer VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(Drogon CONFIG REQUIRED)
find_package(OpenSSL REQUIRED)

add_executable(VicinityServer
    main.cc
    controllers/AuthController.cc
    controllers/ChatController.cc
    controllers/FriendsController.cc
    controllers/ProfileController.cc
    controllers/RoleController.cc
    controllers/ServerController.cc
    controllers/UserController.cc
    controllers/WSController.cc
    filters/AuthFilter.cc
    filters/RateLimitFilter.cc
    managers/SessionManager.cc
    managers/WSManager.cc
    managers/VoiceManager.cc
    models/Database.cc
    models/User.cc
    utils/CryptoUtils.cc
    utils/FileSystem.cc
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
