#!/usr/bin/env bash
# Сборка Vicinity на Linux (CachyOS/Arch). Зависимости — см. BUILD-LINUX.md.
set -e
cd "$(dirname "$0")"

echo "==> Backend"
cmake -S backend -B build-linux/backend -DCMAKE_BUILD_TYPE=Release
cmake --build build-linux/backend -j"$(nproc)"

echo "==> Client"
cmake -S client -B build-linux/client -DCMAKE_BUILD_TYPE=Release
cmake --build build-linux/client -j"$(nproc)"

echo
echo "Готово!"
echo "  Сервер: cd build-linux/backend && ./VicinityServer"
echo "  Клиент: ./build-linux/client/Vicinity   (адрес: 127.0.0.1:8080)"
