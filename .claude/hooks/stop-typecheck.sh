#!/bin/sh
# Stop: если в web/src есть несохранённые в git правки — прогнать typecheck и напомнить, если он красный.
root=${CLAUDE_PROJECT_DIR:-.}
cd "$root" || exit 0
[ -n "$(git status --porcelain -- web/src 2>/dev/null)" ] || exit 0
out=$(cd web && npx tsc --noEmit 2>&1)
if [ -n "$out" ]; then
  printf '%s\n' "typecheck web/ красный — почини до «готово»:" "$(printf '%s' "$out" | head -20)" >&2
  exit 2
fi
exit 0
