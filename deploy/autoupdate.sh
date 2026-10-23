#!/bin/sh
# Автообновление Vicinity на VPS с ветки GitHub (DEPLOY-VPS.md, «Автообновление с ветки»).
#   sh deploy/autoupdate.sh            — проверить ветку и, если есть новые коммиты, обновиться (для cron)
#   sh deploy/autoupdate.sh install    — поставить в cron каждые 5 минут (старую запись заменяет)
#   sh deploy/autoupdate.sh uninstall  — убрать из cron
#   sh deploy/autoupdate.sh status     — что стоит, что на сервере, что в ветке, когда был последний запуск
#   sh deploy/autoupdate.sh now        — обновиться прямо сейчас, даже без новых коммитов
# Ветка — текущая в репозитории (BRANCH=имя — другая). Журнал: deploy/autoupdate.log (обрезается до 2000 строк).
# Повторные запуски не накладываются (замок deploy/.autoupdate.lock); упавшее обновление одного и того же
# коммита не повторяется каждые 5 минут — только после нового коммита или `now`.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
repo=$(dirname "$here")
log="$here/autoupdate.log"
lock="$here/.autoupdate.lock"
failed="$here/.autoupdate-failed"   # sha коммита, обновление на который упало
branch=${BRANCH:-$(git -C "$repo" rev-parse --abbrev-ref HEAD 2>/dev/null || echo claude/zen-feynman-rcs2s3)}
every=${EVERY:-5}

say() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$log"; }

cron_line() {
    printf '*/%s * * * * sh %s/autoupdate.sh >/dev/null 2>&1\n' "$every" "$here"
}

# Текущий crontab без наших записей (новой и старой однострочной с vicinity-up.lock)
other_cron() {
    crontab -l 2>/dev/null | grep -v -e 'deploy/autoupdate.sh' -e 'vicinity-up.lock' || true
}

trim_log() {
    [ -f "$log" ] || return 0
    if [ "$(wc -l < "$log")" -gt 2000 ]; then
        tail -n 1500 "$log" > "$log.tmp" && mv "$log.tmp" "$log"
    fi
}

run_update() {
    # 1. Что в ветке
    if ! git -C "$repo" fetch -q origin "$branch"; then
        say "не удалось получить origin/$branch (нет сети или доступа к GitHub)"
        return 1
    fi
    local_sha=$(git -C "$repo" rev-parse HEAD)
    remote_sha=$(git -C "$repo" rev-parse "origin/$branch")
    if [ "$local_sha" = "$remote_sha" ] && [ "${1:-}" != force ]; then
        return 0   # ничего нового — тихо
    fi
    if [ "${1:-}" != force ] && [ -f "$failed" ] && [ "$(cat "$failed")" = "$remote_sha" ]; then
        return 0   # на этот коммит уже падали — ждём следующего или `now`
    fi
    say "обновление: $(printf '%.7s' "$local_sha") → $(printf '%.7s' "$remote_sha") ($branch)"
    git -C "$repo" log --oneline "$local_sha..$remote_sha" 2>/dev/null | sed 's/^/    /' | tee -a "$log" || true
    # Ветка на сервере должна быть той же, что обновляем
    if [ "$(git -C "$repo" rev-parse --abbrev-ref HEAD)" != "$branch" ]; then
        git -C "$repo" checkout -q "$branch" || { say "не удалось переключиться на $branch"; echo "$remote_sha" > "$failed"; return 1; }
    fi
    # 2. Само обновление: копия → pull → сборка → перезапуск → проверка (update.sh)
    # Из cron — только в журнал; при ручном `now` ход сборки виден и на экране
    if [ "${1:-}" = force ]; then
        say "идёт update.sh (копия → pull → сборка → перезапуск), обычно 3–10 минут…"
        sh "$here/update.sh" 2>&1 | tee -a "$log"
        upd_ok=$([ "$(sed -n '$p' "$log")" = "Обновление завершено" ] && echo 1 || echo 0)
    else
        sh "$here/update.sh" >> "$log" 2>&1 && upd_ok=1 || upd_ok=0
    fi
    if [ "$upd_ok" = 1 ]; then
        if [ "$(git -C "$repo" rev-parse HEAD)" != "$remote_sha" ]; then
            # update.sh отработал, но код не сменился (например, pull не прошёл) — не крутить сборку каждые 5 минут
            echo "$remote_sha" > "$failed"
            say "ОШИБКА: update.sh завершился, но сервер остался на $(printf '%.7s' "$(git -C "$repo" rev-parse HEAD)") — см. $log"
            return 1
        fi
        rm -f "$failed"
        say "готово: сервер на $(printf '%.7s' "$remote_sha")"
    else
        echo "$remote_sha" > "$failed"
        say "ОШИБКА: обновление на $(printf '%.7s' "$remote_sha") не удалось — подробности выше в $log; повтор после нового коммита или: sh deploy/autoupdate.sh now"
        return 1
    fi
}

case "${1:-run}" in
    run|now)
        trim_log
        # Замок: второй экземпляр (прошлая сборка ещё идёт) выходит сразу
        if command -v flock >/dev/null 2>&1; then
            exec 9> "$lock"
            flock -n 9 || exit 0
        else
            if ! mkdir "$lock.d" 2>/dev/null; then exit 0; fi
            trap 'rmdir "$lock.d" 2>/dev/null' EXIT INT TERM
        fi
        [ "${1:-run}" = now ] && force=force || force=
        run_update $force
        ;;
    install)
        if command -v crontab >/dev/null 2>&1; then
            { other_cron; cron_line; } | crontab -
            say "автообновление включено: каждые $every мин с ветки $branch (crontab -l)"
        elif command -v systemctl >/dev/null 2>&1 && [ -d /etc/systemd/system ]; then
            # Без cron (так бывает на минимальных образах) — таймер systemd
            cat > /etc/systemd/system/vicinity-autoupdate.service <<UNIT
[Unit]
Description=Vicinity: обновление с ветки GitHub
[Service]
Type=oneshot
WorkingDirectory=$repo
ExecStart=/bin/sh $here/autoupdate.sh
UNIT
            cat > /etc/systemd/system/vicinity-autoupdate.timer <<UNIT
[Unit]
Description=Vicinity: проверять ветку каждые $every минут
[Timer]
OnBootSec=2min
OnUnitActiveSec=${every}min
AccuracySec=30s
[Install]
WantedBy=timers.target
UNIT
            systemctl daemon-reload
            systemctl enable --now vicinity-autoupdate.timer >/dev/null
            say "автообновление включено через systemd: каждые $every мин с ветки $branch (systemctl list-timers vicinity-autoupdate.timer)"
        else
            echo "Нет ни crontab, ни systemd: apt install cron" >&2
            exit 1
        fi
        ;;
    uninstall)
        if command -v crontab >/dev/null 2>&1; then other_cron | crontab - 2>/dev/null || true; fi
        if [ -f /etc/systemd/system/vicinity-autoupdate.timer ]; then
            systemctl disable --now vicinity-autoupdate.timer >/dev/null 2>&1 || true
            rm -f /etc/systemd/system/vicinity-autoupdate.timer /etc/systemd/system/vicinity-autoupdate.service
            systemctl daemon-reload
        fi
        say "автообновление выключено"
        ;;
    status)
        if crontab -l 2>/dev/null | grep -q 'deploy/autoupdate.sh'; then
            echo "cron: включено — $(crontab -l 2>/dev/null | grep 'deploy/autoupdate.sh')"
        elif systemctl is-active -q vicinity-autoupdate.timer 2>/dev/null; then
            echo "systemd: включено — $(systemctl list-timers --no-pager vicinity-autoupdate.timer 2>/dev/null | sed -n 2p)"
        elif crontab -l 2>/dev/null | grep -q 'vicinity-up.lock'; then
            echo "cron: стоит старая однострочная запись — замени на скрипт: sh deploy/autoupdate.sh install"
        else
            echo "выключено (sh deploy/autoupdate.sh install)"
        fi
        echo "ветка: $branch"
        echo "на сервере: $(git -C "$repo" log -1 --format='%h %s (%cr)')"
        if git -C "$repo" fetch -q origin "$branch" 2>/dev/null; then
            behind=$(git -C "$repo" rev-list --count "HEAD..origin/$branch")
            if [ "$behind" = 0 ]; then echo "в ветке: то же самое, обновлять нечего"
            else echo "в ветке: на $behind коммит(а) новее — $(git -C "$repo" log -1 --format='%h %s' "origin/$branch")"; fi
        else
            echo "в ветке: не удалось спросить GitHub"
        fi
        [ -f "$failed" ] && echo "ПОСЛЕДНЕЕ ОБНОВЛЕНИЕ УПАЛО на $(printf '%.7s' "$(cat "$failed")") — см. $log, повтор: sh deploy/autoupdate.sh now"
        if [ -f "$log" ]; then echo "журнал ($log), последние записи:"; grep -E '^[0-9]{4}-' "$log" | tail -n 5 | sed 's/^/  /'; fi
        ;;
    *) echo "использование: sh $0 [run|now|install|uninstall|status]" >&2; exit 2 ;;
esac
