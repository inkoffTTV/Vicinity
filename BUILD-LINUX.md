# Сборка Vicinity на Linux (CachyOS / Arch)

Backend (Drogon) и клиент (Qt6) кросс-платформенные. Аудио на Linux работает
через **ALSA** (поверх PipeWire в CachyOS), на Windows — через winmm. Выбирается
автоматически в CMake.

## 1. Зависимости (CachyOS использует pacman + paru)

```bash
# Базовые инструменты + Qt6 + ALSA + зависимости Drogon
sudo pacman -S --needed base-devel cmake git \
    qt6-base qt6-declarative qt6-websockets qt6-shadertools qt6-wayland \
    alsa-lib jsoncpp openssl sqlite c-ares brotli zlib

# Drogon из AUR (paru предустановлен в CachyOS)
paru -S drogon
```

Если `QtQuick.Effects` (для скругления аватарок) не найдётся — он входит в
`qt6-declarative`; убедись что пакет установлен полностью.

## 2. Сборка

```bash
cd CPMessenger

# Backend
cmake -S backend -B build-linux/backend -DCMAKE_BUILD_TYPE=Release
cmake --build build-linux/backend -j$(nproc)

# Client
cmake -S client -B build-linux/client -DCMAKE_BUILD_TYPE=Release
cmake --build build-linux/client -j$(nproc)
```

(Или просто `./build-linux.sh`.)

## 3. Запуск

```bash
# Сервер (config.json копируется рядом с бинарником при сборке)
cd build-linux/backend
./VicinityServer        # слушает 0.0.0.0:8080

# Клиент (в другом терминале)
./build-linux/client/Vicinity
```

В клиенте на экране входа адрес сервера: `127.0.0.1:8080` (локально),
либо туннель/IP домашнего сервера.

## 4. Подключение к домашнему серверу (Windows)
Просто запусти клиент на Linux и впиши адрес:
`https://vicinitymsg.serveousercontent.com` — всё кросс-платформенно,
Linux-клиент и Windows-сервер общаются по одному протоколу.

## Заметки
- Голос: микрофон/динамики берутся из устройства ALSA `default` (= системное
  по умолчанию, маршрутизируется PipeWire). Выбор конкретного устройства в UI
  пока только на Windows; на Linux используется системное по умолчанию.
- Если нет звука: проверь `pavucontrol` / `wpctl status`, что приложение
  привязано к нужным микрофону и выводу.
- Бинарники: `VicinityServer` и `Vicinity` (без .exe).
- Данные клиента (сессия, тема, голос): `~/.config/Vicinity/Vicinity.conf`.
