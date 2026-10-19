#!/bin/sh
# Собирает конфиг nginx при старте контейнера:
#   есть сертификат Let's Encrypt для $DOMAIN — HTTPS и переадресация с HTTP,
#   нет — только HTTP (в том числе для первой выдачи сертификата через certbot).
set -eu
DOMAIN="${DOMAIN:-_}"
CERT="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
OUT=/etc/nginx/conf.d/pereprava.conf

if [ "$DOMAIN" != "_" ] && [ -f "$CERT" ]; then
  echo "pereprava: сертификат для ${DOMAIN} найден — включаю HTTPS"
  sed "s|__DOMAIN__|${DOMAIN}|g" /etc/nginx/pereprava/https.conf.in > "$OUT"
else
  echo "pereprava: сертификата нет — работаю по HTTP"
  sed "s|__DOMAIN__|${DOMAIN}|g" /etc/nginx/pereprava/http.conf.in > "$OUT"
fi
