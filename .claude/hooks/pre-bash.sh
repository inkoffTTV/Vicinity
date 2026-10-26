#!/bin/sh
# PreToolUse Bash: блокирует переписывание истории и пуш не в рабочую ветку (CLAUDE.md, «Железные правила»).
# Выход 2 — команда не выполняется, текст на stderr видит Claude.
cmd=$(jq -r '.tool_input.command // ""' 2>/dev/null)
[ -n "$cmd" ] || exit 0
case "$cmd" in *git*) ;; *) exit 0 ;; esac
deny() { printf '%s\n' "Заблокировано хуком: $1" >&2; exit 2; }
printf '%s' "$cmd" | grep -Eq 'git[^|;&]*push[^|;&]*(--force|-f\b|--force-with-lease)' && deny "git push --force запрещён (историю не переписываем)"
printf '%s' "$cmd" | grep -Eq 'git[^|;&]*\brebase\b' && deny "git rebase запрещён, делай fetch + merge"
printf '%s' "$cmd" | grep -Eq 'git[^|;&]*commit[^|;&]*--amend' && deny "git commit --amend запрещён"
printf '%s' "$cmd" | grep -Eq 'git[^|;&]*push[^|;&]*\b(origin[[:space:]]+)?(main|master|develop)\b' && deny "пуш в main/master/develop запрещён, только в рабочую ветку"
printf '%s' "$cmd" | grep -Eq 'git[^|;&]*(reset[^|;&]*--hard|clean[^|;&]*-[a-z]*f|branch[^|;&]*-D\b)' && deny "git reset --hard / clean -f / branch -D — сначала спроси"
exit 0
