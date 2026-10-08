#!/bin/sh
# Обновление Vicinity на VPS: резервная копия → git pull → пересборка → перезапуск → проверка.
#   sh deploy/update.sh
# Повторный запуск безопасен: без новых коммитов compose ничего не пересоздаёт.
# BACKUP=0 — без резервной копии (не рекомендуется); BACKUP_DIR и KEEP — как у backup.sh.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
repo=$(dirname "$here")
cd "$here"

if ! docker compose version >/dev/null 2>&1; then
    echo "Нужен Docker с плагином compose (DEPLOY-VPS.md, «Установка Docker»)" >&2
    exit 1
fi
if [ ! -f .env ]; then
    echo "Нет deploy/.env: cp env.example .env и заполни его (DEPLOY-VPS.md)" >&2
    exit 1
fi

# 1. Локальные правки отслеживаемых файлов git pull не перезапишет — проверяем до всего остального
in_git=
if git -C "$repo" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    in_git=1
    if [ -n "$(git -C "$repo" status --porcelain --untracked-files=no)" ]; then
        echo "В репозитории есть локальные правки, git pull их не перезапишет:" >&2
        git -C "$repo" status --short --untracked-files=no >&2
        echo "Перенеси свои настройки в deploy/.env и верни файлы: git -C $repo checkout -- <файл>" >&2
        echo "(DEPLOY-VPS.md, «Обновление со старой версии»)" >&2
        exit 1
    fi
fi

# Копия без git (раньше инструкция копировала через scp только backend, shared и deploy):
# без web/ сборка веб-контейнера упадёт посреди обновления — останавливаемся сразу
if [ -z "$in_git" ]; then
    for dir in backend shared web; do
        if [ ! -d "$repo/$dir" ]; then
            echo "В $repo нет папки $dir/ — веб-версия и сервер собираются из backend/, shared/ и web/." >&2
            echo "Перейди на git (DEPLOY-VPS.md, «Обновление со старой версии» → «Копия через scp»)" >&2
            echo "или скопируй недостающие папки: scp -r backend shared web deploy root@IP_VPS:$repo/" >&2
            exit 1
        fi
    done
fi

# 2. Резервная копия, если сервер уже работает
if [ "${BACKUP:-1}" != 0 ] && [ "$(docker inspect -f '{{.State.Running}}' vicinity-server 2>/dev/null)" = true ]; then
    sh "$here/backup.sh"
fi

# 3. Новый код
if [ -n "$in_git" ]; then
    git -C "$repo" pull --ff-only
else
    echo "Папка $repo — не git-репозиторий: код не обновляется, пересобираю то, что есть"
fi

# 4. Сборка и перезапуск: compose пересоздаёт только контейнеры с новым образом или настройками
docker compose config -q
old_images=$(docker inspect -f '{{.Image}}' vicinity-server vicinity-web 2>/dev/null || true)
docker compose up -d --build

# 5. Проверка: ждём, пока healthcheck сервера и веба станет healthy
wait_healthy() {
    tries=0
    until [ "$(docker inspect -f '{{.State.Health.Status}}' "$1" 2>/dev/null)" = healthy ]; do
        tries=$((tries + 1))
        if [ "$tries" -gt 90 ]; then
            echo "$1 не поднялся за 3 минуты. Последние строки лога:" >&2
            docker logs --tail 30 "$1" >&2
            return 1
        fi
        sleep 2
    done
    echo "$1: работает"
}
wait_healthy vicinity-server
wait_healthy vicinity-web
if [ "$(docker inspect -f '{{.State.Running}}' vicinity-coturn 2>/dev/null)" != true ]; then
    echo "coturn не запущен — звонки через NAT работать не будут: docker compose logs coturn" >&2
fi

# 6. Прежние образы сервера и веба больше не нужны (занятые и чужие образы не трогаются)
for image in $old_images; do
    docker image rm "$image" >/dev/null 2>&1 || true
done

docker compose ps
echo "Обновление завершено"
