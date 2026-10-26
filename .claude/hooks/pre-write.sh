#!/bin/sh
# PreToolUse Write|Edit|MultiEdit: не даёт писать в бота ti-it-top и в файлы с секретами.
path=$(jq -r '.tool_input.file_path // .tool_input.path // ""' 2>/dev/null)
[ -n "$path" ] || exit 0
deny() { printf '%s\n' "Заблокировано хуком: $1" >&2; exit 2; }
case "$path" in
  */deploy/ti-it-top/*|deploy/ti-it-top/*) deny "бот ti-it-top не трогаем ($path)" ;;
  *.env|*/.env.*|*.env.local|*.env.production|*/secrets/*|*.pem|*.key|*id_rsa*|*id_ed25519*) deny "секреты и ключи не пишем в файлы ($path)" ;;
esac
exit 0
