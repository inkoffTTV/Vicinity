#!/usr/bin/env bash
# Доступ к VPS из облачной сессии Claude. Ключ и адрес — из секретов окружения, в репозитории их нет:
#   VPS_SSH_KEY_B64 — приватный ключ одной строкой (base64 -w0 ~/ключ), VPS_HOST, VPS_USER, VPS_PORT (22).
#   deploy/vps.sh check              — проверить соединение
#   deploy/vps.sh run '<команда>'    — выполнить команду на сервере
#   deploy/vps.sh update             — подтянуть ветку и пересобрать Vicinity (deploy/update.sh на сервере)
# Бота ti-it-top скрипт не касается: только каталог Vicinity.
set -euo pipefail

: "${VPS_SSH_KEY_B64:?нет VPS_SSH_KEY_B64 в секретах окружения}"
: "${VPS_HOST:?нет VPS_HOST}" "${VPS_USER:?нет VPS_USER}"

key=$(mktemp)
trap 'rm -f "$key"' EXIT
printf '%s' "$VPS_SSH_KEY_B64" | base64 -d > "$key"
chmod 600 "$key"

ssh_cmd=(ssh -i "$key" -p "${VPS_PORT:-22}" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -o BatchMode=yes "$VPS_USER@$VPS_HOST")
# Исходящий трафик облачной сессии идёт через HTTPS-прокси: если прямой SSH не проходит, VPS_VIA_PROXY=1 пускает его через CONNECT
if [ "${VPS_VIA_PROXY:-0}" = 1 ] && [ -n "${HTTPS_PROXY:-}" ]; then
    proxy=${HTTPS_PROXY#*://}
    ssh_cmd+=(-o "ProxyCommand=nc -X connect -x ${proxy%/} %h %p")
fi

case "${1:-check}" in
    check) "${ssh_cmd[@]}" 'echo "ok: $(hostname), $(uptime -p)"' ;;
    run) shift; "${ssh_cmd[@]}" "$@" ;;
    update) "${ssh_cmd[@]}" "cd \"${VPS_REPO:-~/vicinity}\" && git fetch origin claude/zen-feynman-rcs2s3 && git checkout claude/zen-feynman-rcs2s3 && sh deploy/update.sh" ;;
    *) echo "использование: $0 check | run '<команда>' | update" >&2; exit 2 ;;
esac
