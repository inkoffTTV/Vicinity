# Установка и обновление на VPS с помощью Claude Code

Готовый промпт для **локальной** сессии Claude Code (на твоём компьютере): Claude подключится к VPS по SSH,
осмотрится, предложит план, после твоего «да» установит или обновит Vicinity по [DEPLOY-VPS.md](../DEPLOY-VPS.md)
и проверит, что всё работает — не трогая Telegram-бота и прочее, что уже есть на сервере.

## Подготовка: вход на VPS по SSH-ключу (один раз)

Claude подключается только по ключу — пароль от сервера ему не нужен и в чат его вводить нельзя.
Пароль вводишь только ты, в своём окне терминала, один раз при копировании ключа.

**Windows (PowerShell):**

```powershell
ssh-keygen -t ed25519                     # Enter на все вопросы (ключ уже есть — пропусти)
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh root@IP_VPS "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
ssh -o BatchMode=yes root@IP_VPS "echo ok"   # должно напечатать ok без пароля
```

**Linux / macOS:**

```bash
ssh-keygen -t ed25519
ssh-copy-id root@IP_VPS
ssh -o BatchMode=yes root@IP_VPS "echo ok"
```

Если на VPS входишь не под root, а пользователем с `sudo`, который спрашивает пароль, — Claude не сможет
выполнять такие команды и попросит выполнить их тебя.

## Как запустить

1. Установи Claude Code (claude.com/claude-code) и открой терминал в любой папке.
2. Запусти `claude`.
3. Вставь промпт ниже целиком. Claude спросит адрес сервера и домен — отвечай в чате.

Обновлять потом можно тем же промптом: Claude увидит, что Vicinity уже установлен, и пойдёт по пути обновления.

## Промпт

```text
Помоги мне установить или обновить мессенджер Vicinity на моём VPS. Репозиторий:
https://github.com/inkoffTTV/Vicinity. Всё делается по инструкции DEPLOY-VPS.md из этого репозитория
(на VPS она будет в ~/vicinity/DEPLOY-VPS.md; до клонирования прочитай её на GitHub). На этом же VPS
работает мой Telegram-бот (возможно, с веб-интерфейсом за nginx или Caddy, возможно, в Docker) — он
должен работать так же, как до тебя. Объясняй простыми словами, что делаешь и зачем.

1. Доступ.
   - Спроси у меня IP или имя хоста VPS, пользователя и порт SSH.
   - Подключайся только по SSH-ключу, неинтерактивно:
     ssh -o BatchMode=yes -o ConnectTimeout=15 -p ПОРТ ПОЛЬЗОВАТЕЛЬ@ХОСТ '<команды>'
     (несколько команд — через ssh ... 'bash -s' <<'EOF' ... EOF).
   - Никогда не спрашивай пароли в чате, не подставляй их в команды и не записывай в файлы. Не работает
     вход по ключу — дай мне инструкцию из раздела «Подготовка» docs/LOCAL-CLAUDE-DEPLOY.md и жди, пока я
     сделаю это сам в своём терминале. «Host key verification failed» — попроси меня один раз зайти
     по ssh в моём терминале и подтвердить ключ сервера. Команда просит пароль sudo — не вводи его,
     попроси меня выполнить её.
   - Ничего не сохраняй о доступе на моём компьютере, кроме того, что уже есть в ~/.ssh.

2. Разведка — только чтение, ничего не меняя:
   - система: uname -a; cat /etc/os-release; free -h; swapon --show; df -h /; timedatectl
   - Docker: docker --version; docker compose version; docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
   - порты: ss -tlnp; ss -ulnp
   - веб-сервер хоста: systemctl is-active nginx caddy apache2; ls -la /etc/nginx/sites-enabled /etc/nginx/conf.d;
     cat /etc/caddy/Caddyfile (если есть); certbot certificates (если есть)
   - файервол: ufw status verbose
   - Vicinity: ls ~/vicinity; git -C ~/vicinity status --short; git -C ~/vicinity log -1 --oneline;
     ls -la ~/vicinity/deploy/.env (содержимое .env не выводи); docker ps --filter name=vicinity
   - Telegram-бот: найди, как он запущен (сервис systemd, процесс, контейнер), какие порты и домены использует.
   Сохрани «снимок до»: список контейнеров и их статусы, вывод ss -tlnp, HTTP-коды сайтов бота
   (curl -s -o /dev/null -w '%{http_code}' https://домен-бота/).

3. План — и жди моего «да».
   Покажи итог разведки и план: новая установка или обновление; сценарий из DEPLOY-VPS.md (А — порты 80/443
   свободны, Caddy из compose; Б — на хосте уже есть nginx или Caddy; или «без домена»); какие порты займёт
   Vicinity (8080 — десктоп, 8081 или другой свободный — сайт на 127.0.0.1, 3478 TCP/UDP и 49160–49200/UDP —
   TURN, в сценарии А — 80/443) и нет ли конфликтов; какой поддомен нужен (спроси у меня и проверь A-запись:
   getent hosts поддомен); что изменится на хосте (новые файлы конфигурации прокси, сертификат, правила
   файервола, swap). Ничего не меняй, пока я не отвечу «да». Если план по ходу меняется — снова спроси.

4. Не трогай бота и чужое:
   - не меняй и не удаляй файлы, конфиги, контейнеры, тома, сервисы и сертификаты бота;
   - не перезапускай Docker-демон и веб-сервер хоста; конфиги прокси применяй только
     nginx -t && systemctl reload nginx или caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy;
   - новый сайт — отдельным файлом (/etc/nginx/sites-available/vicinity + ссылка в sites-enabled, либо
     /etc/nginx/conf.d/vicinity.conf) или отдельным блоком в конце Caddyfile; перед любой правкой — копия файла;
   - certbot запускай только для поддомена Vicinity: certbot --nginx -d <поддомен>;
   - никогда: docker system prune, docker compose down -v, docker volume rm, rm -rf вне ~/vicinity,
     правка настроек SSH, установка Docker поверх существующего;
   - ufw: если включён — только добавляй правила; если выключен — не включай без моего явного согласия
     и без правил для порта SSH и всех портов бота.

5. Резервная копия — до любых изменений.
   Если Vicinity уже установлен: sh ~/vicinity/deploy/backup.sh и убедись, что в ~/vicinity-backups
   появилась новая папка с vicinity.db. Перед правкой конфигов хоста — копии этих файлов (с датой в имени).

6. Установка или обновление — строго по DEPLOY-VPS.md.
   - Новая установка: шаги 3–7. Swap, git, Docker ставь, только если их нет, и только после моего «да».
     Секрет TURN генерируй прямо на сервере (openssl rand -hex 32 в deploy/.env), .env — с правами 600.
     Не показывай секрет в чате и не копируй .env к себе.
   - Обновление: cd ~/vicinity && sh deploy/update.sh. Если скрипт сообщает о локальных правках — раздел
     «Обновление со старой версии»: покажи мне, что изменено, перенеси настройки в .env, только потом
     убирай правки (git stash, не git reset --hard).
   - Первая сборка идёт 10–20 минут: запускай сборку и обновление так, чтобы обрыв SSH их не прервал,
     следи за логом и рассказывай о прогрессе:
       cd ~/vicinity/deploy && nohup docker compose up -d --build > ~/vicinity-build.log 2>&1 &
       nohup sh ~/vicinity/deploy/update.sh > ~/vicinity-update.log 2>&1 &

7. Проверка после.
   - cd ~/vicinity/deploy && docker compose ps: vicinity-server и vicinity-web — healthy, vicinity-coturn
     (и vicinity-caddy в сценарии А) — Up.
   - curl на сервере: http://127.0.0.1:8080/api/v1/auth/me → 401, http://127.0.0.1:<WEB_PORT>/ → 200.
   - снаружи: https://<поддомен>/ → 200, https://<поддомен>/api/v1/auth/me → 401, WebSocket:
     curl -si --http1.1 -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13'
     -H 'Sec-WebSocket-Key: dGVzdHRlc3R0ZXN0dGVzdA==' https://<поддомен>/ws | head -1 → 401.
   - TURN: ss -ulnp | grep 3478 и docker compose logs --tail 20 coturn без ошибок.
   - «Снимок после» для бота: те же контейнеры в тех же статусах, те же порты в ss -tlnp, сайты бота
     отвечают теми же кодами. Если у бота хоть что-то изменилось — сразу скажи мне и верни конфиги хоста
     из копий.

8. Итог.
   Что сделано; адрес сайта; адрес для десктоп-клиентов (http://IP:8080 и https://<поддомен>); какие порты
   мне открыть в панели хостера (её ты не видишь): 80/443 TCP (сценарий А), 8080 TCP, 3478 TCP+UDP,
   49160–49200 UDP; где резервные копии и как обновлять дальше (sh ~/vicinity/deploy/update.sh); что ещё
   осталось сделать мне (например, проверить звонок в браузере с двух аккаунтов). Секреты не выводи.
```
