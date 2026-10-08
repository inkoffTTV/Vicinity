#!/bin/sh
# Резервная копия Vicinity: база (онлайн, sqlite3 .backup внутри контейнера), загрузки и deploy/.env.
#   sh deploy/backup.sh [каталог]     (по умолчанию ~/vicinity-backups)
# Каждый запуск — новая папка ГГГГММДД-ЧЧММСС; остаются последние KEEP копий (по умолчанию 14).
# Сервер не останавливается (кроме образа старой версии без sqlite3 — тогда на несколько секунд).
# Для cron: 0 4 * * * sh /root/vicinity/deploy/backup.sh >> /var/log/vicinity-backup.log 2>&1
set -eu

CONTAINER=${VICINITY_CONTAINER:-vicinity-server}
BACKUP_ROOT=${1:-${BACKUP_DIR:-$HOME/vicinity-backups}}
KEEP=${KEEP:-14}
here=$(cd "$(dirname "$0")" && pwd)

case $KEEP in
    '' | *[!0-9]*) echo "KEEP должно быть числом, а не '$KEEP'" >&2; exit 1 ;;
esac
if [ "$KEEP" -lt 1 ]; then echo "KEEP должно быть не меньше 1" >&2; exit 1; fi
if [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" != true ]; then
    echo "Контейнер $CONTAINER не запущен (cd deploy && docker compose up -d)" >&2
    exit 1
fi

# В копии хэши паролей и сессий — читать её может только владелец
umask 077
stamp=$(date -u +%Y%m%d-%H%M%S)
dest=$BACKUP_ROOT/$stamp
mkdir -p "$dest"

stopped=
on_exit() {
    status=$?
    if [ -n "$stopped" ]; then docker start "$CONTAINER" >/dev/null; fi
    if [ "$status" -ne 0 ]; then
        rm -rf "$dest"
        echo "Резервная копия не создана" >&2
    fi
}
trap on_exit EXIT
trap 'exit 1' INT TERM HUP

if docker exec "$CONTAINER" sh -c 'command -v sqlite3' >/dev/null 2>&1; then
    snapshot=/tmp/vicinity-backup-$stamp.db
    docker exec "$CONTAINER" sqlite3 /data/vicinity.db ".backup '$snapshot'"
    check=$(docker exec "$CONTAINER" sqlite3 "$snapshot" 'PRAGMA quick_check')
    if [ "$check" != ok ]; then
        docker exec "$CONTAINER" rm -f "$snapshot"
        echo "Проверка копии базы не прошла: $check" >&2
        exit 1
    fi
    docker cp "$CONTAINER:$snapshot" "$dest/vicinity.db"
    docker exec "$CONTAINER" rm -f "$snapshot"
else
    echo "В образе нет sqlite3 (старая версия) — сервер остановлен на время копирования базы"
    stopped=1
    docker stop "$CONTAINER" >/dev/null
    docker cp "$CONTAINER:/data/vicinity.db" "$dest/vicinity.db"
    docker start "$CONTAINER" >/dev/null
    stopped=
fi

# Загрузки (аватары, вложения) — tar как его отдаёт docker cp, внутри папка uploads/
if docker exec "$CONTAINER" test -d /data/uploads; then
    docker cp "$CONTAINER:/data/uploads" - > "$dest/uploads.tar"
    gzip "$dest/uploads.tar"
fi

if [ -f "$here/.env" ]; then cp "$here/.env" "$dest/env"; fi

# Старые копии: оставляем KEEP последних (glob отдаёт имена-даты по возрастанию, старые — первыми)
set -- "$BACKUP_ROOT"/[0-9]*-[0-9]*
excess=$(($# - KEEP))
for old in "$@"; do
    [ "$excess" -gt 0 ] || break
    rm -rf "$old"
    excess=$((excess - 1))
done

echo "Резервная копия: $dest ($(du -sh "$dest" | cut -f1))"
