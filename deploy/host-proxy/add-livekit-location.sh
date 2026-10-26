#!/bin/sh
# Сценарий Б (nginx хоста перед контейнерами): добавить location /livekit/ с WebSocket-заголовками
# в уже установленный конфиг Vicinity — для голоса через SFU (docs/VOICE-SFU.md).
#   ssh root@IP_VPS 'sh -s' < deploy/host-proxy/add-livekit-location.sh
#   (другой файл конфига: ssh root@IP_VPS 'sh -s /etc/nginx/sites-available/имя' < …)
# Делает резервную копию, вставляет блок перед «location = /ws {», проверяет nginx -t и перезагружает nginx.
set -eu
F=${1:-/etc/nginx/sites-available/vicinity}
[ -f "$F" ] || { echo "нет файла $F" >&2; exit 1; }
if grep -q 'location /livekit/' "$F"; then
    echo "в $F уже есть location /livekit/ — ничего не меняю"
    exit 0
fi
grep -q 'location = /ws {' "$F" || { echo "в $F нет «location = /ws {» — добавь блок вручную (deploy/host-proxy/nginx-vicinity.conf)" >&2; exit 1; }
cp -a "$F" "$F.bak_$(date +%Y%m%d_%H%M%S)"
tmp=$(mktemp)
awk '
/location = \/ws \{/ && !done {
    print "    # Голос в каналах через SFU (docs/VOICE-SFU.md): сигналинг LiveKit — WebSocket, нужен Upgrade, как у /ws"
    print "    location /livekit/ {"
    print "        proxy_pass http://127.0.0.1:8081;"
    print "        proxy_http_version 1.1;"
    print "        proxy_set_header Upgrade $http_upgrade;"
    print "        proxy_set_header Connection \"upgrade\";"
    print "        proxy_set_header Host $host;"
    print "        proxy_set_header X-Real-IP $remote_addr;"
    print "        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;"
    print "        proxy_set_header X-Forwarded-Proto $scheme;"
    print "        proxy_read_timeout 1h;"
    print "        proxy_send_timeout 1h;"
    print "        # В URL лежит токен комнаты — не пишем его в логи"
    print "        access_log off;"
    print "    }"
    print ""
    done = 1
}
{ print }
' "$F" > "$tmp"
cat "$tmp" > "$F"
rm -f "$tmp"
nginx -t
systemctl reload nginx
echo "готово: location /livekit/ добавлен в $F, nginx перезагружен"
