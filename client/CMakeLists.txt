cmake_minimum_required(VERSION 3.16)
project(VicinityClient VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)

# 6.6: Shape.preferredRendererType (иконки, градиенты), QScreenCapture — с 6.5
find_package(Qt6 6.6 REQUIRED COMPONENTS Core Gui Qml Quick QuickControls2 WebSockets Network Sql Multimedia)

# WebRTC (звонки) + Opus — из vcpkg (C:/vcpkg/installed/x64-windows в CMAKE_PREFIX_PATH)
find_package(LibDataChannel CONFIG REQUIRED)
find_package(Opus CONFIG QUIET)
if (NOT Opus_FOUND)
    # Пакеты Linux-дистрибутивов ставят opus без CMake-конфига — только pkg-config
    find_package(PkgConfig REQUIRED)
    pkg_check_modules(OPUS REQUIRED IMPORTED_TARGET GLOBAL opus)
    add_library(Opus::opus ALIAS PkgConfig::OPUS)
endif()

# openh264 (видео-кодек звонков, Фаза C) — vcpkg кладёт без CMake-конфига
find_path(OPENH264_INCLUDE_DIR wels/codec_api.h)
find_library(OPENH264_LIBRARY openh264)
if (NOT OPENH264_INCLUDE_DIR OR NOT OPENH264_LIBRARY)
    message(FATAL_ERROR "openh264 не найден. Windows: vcpkg install openh264:x64-windows; "
                        "Linux: пакет openh264 (Arch) / libopenh264-dev (Debian, Ubuntu)")
endif()

qt_add_executable(Vicinity
    main.cpp
    src/core/AppState.h
    src/core/AppState.cc
    src/core/ThemeManager.h
    src/core/ThemeManager.cc
    src/core/VoiceEngine.h
    src/core/VoiceEngine.cc
    src/core/VideoEngine.h
    src/core/VideoEngine.cc
    src/core/CallEngine.h
    src/core/CallEngine.cc
    src/models/ChatMessageModel.h
    src/models/ChatMessageModel.cc
    src/network/ApiClient.h
    src/network/ApiClient.cc
    src/network/NetworkManager.h
    src/network/NetworkManager.cc
    src/security/CryptoEngine.h
    src/security/CryptoEngine.cc
    src/security/LocalDatabase.h
    src/security/LocalDatabase.cc
    qml.qrc
)

target_include_directories(Vicinity PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${OPENH264_INCLUDE_DIR}
)

target_link_libraries(Vicinity PRIVATE
    Qt6::Core
    Qt6::Gui
    Qt6::Qml
    Qt6::Quick
    Qt6::QuickControls2
    Qt6::WebSockets
    Qt6::Network
    Qt6::Sql
    Qt6::Multimedia
    LibDataChannel::LibDataChannel
    Opus::opus
    ${OPENH264_LIBRARY}
)

# Платформозависимое аудио: winmm (Windows) / ALSA (Linux)
if (WIN32)
    target_link_libraries(Vicinity PRIVATE winmm)
else()
    find_library(ASOUND_LIBRARY asound)
    if (NOT ASOUND_LIBRARY)
        message(FATAL_ERROR "libasound не найден. Установи alsa-lib (CachyOS: sudo pacman -S alsa-lib)")
    endif()
    target_link_libraries(Vicinity PRIVATE ${ASOUND_LIBRARY})
endif()

set_target_properties(Vicinity PROPERTIES
    WIN32_EXECUTABLE TRUE
    MACOSX_BUNDLE TRUE
)

# Безголовый участник звонка для e2e-тестов совместимости с браузером
# (web/e2e/d-interop.spec.ts): тот же CallEngine без QML и аудиоустройств.
option(VICINITY_BUILD_INTEROP "Build tools/call_interop (desktop<->browser call test harness)" OFF)
if (VICINITY_BUILD_INTEROP)
    qt_add_executable(call_interop
        tools/call_interop.cpp
        src/core/CallEngine.h
        src/core/CallEngine.cc
        src/core/VideoEngine.h
        src/core/VideoEngine.cc
        src/network/ApiClient.h
        src/network/ApiClient.cc
    )
    target_include_directories(call_interop PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}
        ${OPENH264_INCLUDE_DIR}
    )
    target_link_libraries(call_interop PRIVATE
        Qt6::Core
        Qt6::Gui
        Qt6::Network
        Qt6::WebSockets
        Qt6::Multimedia
        LibDataChannel::LibDataChannel
        Opus::opus
        ${OPENH264_LIBRARY}
    )
endif()
