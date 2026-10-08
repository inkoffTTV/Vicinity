# Vicinity на VPS: пошаговая установка

После этой инструкции на твоём VPS работают:

- **сервер Vicinity** — к нему подключаются десктоп-клиенты (`http://IP_VPS:8080`) и сайт;
- **веб-версия** — `https://chat.твой-домен.ru`, с голосовыми каналами и звонками прямо в браузере;
- **TURN-сервер coturn** — чтобы звонки 1:1 проходили через домашние роутеры и мобильный интернет;
- **HTTPS** — без него браузер не даст микрофон, камеру, показ экрана и уведомления.

Всё запускается в Docker одной командой. Инструкция рассчитана на два случая:

- **Сценарий А — порты 80/443 свободны.** HTTPS и сертификат Let's Encrypt делает Caddy из нашего
  `docker-compose.yml`, ничего настраивать на хосте не нужно.
- **Сценарий Б — на сервере уже есть nginx или Caddy** (например, у Telegram-бота с веб-интерфейсом).
  Vicinity слушает только `127.0.0.1:8081`, а существующий прокси получает отдельный поддомен.
  Бот и его настройки не трогаются.

Команды ниже выполняются на VPS от root. Если входишь обычным пользователем — добавляй `sudo`.

**Содержание:** [как это устроено](#как-это-устроено) · [что понадобится](#что-понадобится) ·
[1. подключиться](#1-подключиться-к-серверу) · [2. выбрать сценарий](#2-выбрать-сценарий-какие-порты-заняты) ·
[3. Docker](#3-установка-docker) · [4. код](#4-скачать-vicinity) · [5. настройки](#5-настройки-env) ·
[6. запуск](#6-запуск) · [7. порты](#7-открыть-порты) · [8. проверка](#8-проверка) ·
[обновление](#обновление) · [резервные копии](#резервные-копии) · [логи](#логи-и-управление) ·
[если что-то не работает](#если-что-то-не-работает) · [безопасность](#безопасность-чек-лист)

---

## Как это устроено

```text
 Браузер ──HTTPS 443──► Caddy (сценарий А) ─┐
                        или nginx/Caddy     ├──► web: nginx, сайт + прокси ──► vicinity: сервер :8080 ──► том vicinity-data
                        хоста (сценарий Б) ─┘    127.0.0.1:8081                 (Drogon)                (база + загрузки)
 Десктоп ──HTTP 8080 (или https://домен)─────────────────────────────────────────►┘
 Звонки 1:1 ──UDP/TCP 3478, UDP 49160–49200──► coturn (TURN), сеть хоста
```

| Контейнер | Что делает |
|---|---|
| `vicinity-server` | сервер: API, WebSocket, голосовые каналы, файлы. База и загрузки — в томе `deploy_vicinity-data` |
| `vicinity-web` | nginx: отдаёт сайт и проксирует `/api`, `/ws`, `/uploads` на сервер |
| `vicinity-coturn` | TURN для звонков; учётки выдаёт сервер, общий секрет — в `deploy/.env` |
| `vicinity-caddy` | только в сценарии А: HTTPS и автоматический сертификат для домена |

### Веб-версия

Сайт собирается из `web/` и работает с той же базой, что и десктоп: те же аккаунты, сообщения, серверы.
Голосовые каналы идут через сервер (WebSocket), звонки 1:1 — напрямую между участниками, а если напрямую
не получается — через coturn. Голос, звонки, показ экрана и уведомления в браузере работают **только по
HTTPS**, поэтому для веб-версии нужен домен (подойдёт поддомен домена бота или бесплатный от DuckDNS).

## Что понадобится

| | Минимум | Комментарий |
|---|---|---|
| VPS | 1 vCPU, 1 ГБ RAM, Ubuntu 22.04/24.04 или Debian 12 | в простое все контейнеры Vicinity занимают десятки МБ RAM |
| Swap | 2 ГБ, если RAM меньше 2 ГБ | только для сборки: компиляция Drogon без swap падает по памяти |
| Диск | 5 ГБ свободно (лучше 10) | образы + кэш сборки ~3 ГБ, плюс база и загрузки |
| Домен | A-запись поддомена на IP VPS | например `chat.example.com`; без домена — только `http://IP` для пробы |
| Доступ | SSH (root или пользователь с sudo) | |

Хостер — любой, чей IP доступен твоим друзьям. Для России: aeza, ruvds, timeweb, vdsina или
Финляндия/Германия/Нидерланды (Hetzner, aeza-eu).

---

## 1. Подключиться к серверу

С Windows (PowerShell) или Linux/macOS:

```bash
ssh root@IP_VPS
```

## 2. Выбрать сценарий: какие порты заняты

Сначала посмотри, что уже работает на сервере — ничего чужого Vicinity не должен занять:

```bash
ss -tlnp | grep -E ':(80|443|8080|8081|3478)\b'     # TCP
ss -ulnp | grep -E ':(443|3478)\b'                  # UDP
docker ps --format '{{.Names}}\t{{.Ports}}' 2>/dev/null   # контейнеры, если Docker уже стоит
```

| Что видно | Что делать |
|---|---|
| на 80 и 443 ничего нет | **сценарий А** |
| на 80/443 `nginx`, `caddy`, `apache2` или `docker-proxy` | **сценарий Б** — там уже кто-то обслуживает сайты (например, бот) |
| занят 8081 | в сценарии Б возьми другой порт (`WEB_PORT=8082`) и укажи его же в конфиге прокси |
| занят 8080 | `BACKEND_PORT=8090` — тогда десктопу адрес `http://IP_VPS:8090` (или `https://домен`) |
| занят 3478 | на сервере уже есть TURN — обратись к тому, кто его ставил; два coturn на одном порту не уживутся |

Запомни и порт SSH: `ss -tlnp | grep sshd` — понадобится при настройке файервола.

## 3. Установка Docker

Проверь, нет ли Docker уже (его мог поставить бот):

```bash
docker --version && docker compose version
```

- Обе команды ответили — **ничего не ставь и не перезапускай**: перезапуск Docker перезапустит и контейнеры бота.
- `docker: command not found` — ставим:

  ```bash
  curl -fsSL https://get.docker.com | sh
  ```

- Docker есть, а `docker compose` нет (старый пакет из Ubuntu): `apt-get install -y docker-compose-v2`.

Swap (если RAM меньше 2 ГБ и `swapon --show` ничего не выводит):

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## 4. Скачать Vicinity

```bash
apt-get install -y git
git clone https://github.com/inkoffTTV/Vicinity.git ~/vicinity
cd ~/vicinity/deploy
```

## 5. Настройки (.env)

Все настройки — в одном файле `deploy/.env` (в git он не попадает). Создаём его из образца и сразу
вписываем публичный IP и случайный секрет TURN:

```bash
cd ~/vicinity/deploy
cp -n env.example .env && chmod 600 .env
sed -i "s/^PUBLIC_IP=.*/PUBLIC_IP=$(curl -4 -fsS https://ifconfig.me)/" .env
sed -i "s/^VICINITY_TURN_SECRET=.*/VICINITY_TURN_SECRET=$(openssl rand -hex 32)/" .env
grep -E '^(PUBLIC_IP|VICINITY_TURN_SECRET)=' .env      # оба должны быть заполнены
```

Если `PUBLIC_IP` остался пустым — впиши IP из панели хостера вручную (`nano .env`).
Секрет TURN один на сервер и coturn: compose передаёт его обоим, `turnserver.conf` править не нужно.

Дальше — настройки своего сценария. Открой файл: `nano .env` (сохранить — Ctrl+O, Enter, выйти — Ctrl+X).
В нём уже есть строки `WEB_BIND=`, `WEB_PORT=`, `COMPOSE_PROFILES=` и `DOMAIN=` — **поменяй значения в них**,
а не дописывай такие же строки ниже или выше: если ключ встречается в `.env` дважды, действует последняя
строка. Проверка: `grep -E '^(WEB_BIND|WEB_PORT|COMPOSE_PROFILES|DOMAIN)=' .env` — каждый ключ ровно один раз.

### Сценарий А: порты 80/443 свободны

1. У регистратора домена создай **A-запись** `chat.example.com` → IP VPS. Проверка (может занять до часа):
   `getent hosts chat.example.com` — должен показать IP VPS.
2. В `.env` поменяй значения в существующих строках на такие:

   ```ini
   COMPOSE_PROFILES=https
   DOMAIN=chat.example.com
   WEB_BIND=127.0.0.1
   WEB_PORT=8081
   ```

Caddy сам получит сертификат Let's Encrypt, будет его продлевать и перенаправлять `http://` на `https://`.
Для выпуска сертификата порты 80 и 443 должны быть открыты снаружи (шаг 7). Caddy работает в сети хоста:
слушает 80/443 на всех адресах VPS (и по IPv6, если у домена есть AAAA-запись), видит настоящий адрес
каждого посетителя и ходит на сайт по `127.0.0.1:8081`.

### Сценарий Б: на сервере уже есть nginx или Caddy (например, Telegram-бот)

Vicinity получает **отдельный поддомен** (`chat.example.com`) и отдельный блок в конфиге прокси.
Файлы бота, его домен и сертификаты не меняются.

1. A-запись `chat.example.com` → IP VPS (как в сценарии А).
2. В `.env` поменяй значения в существующих строках (`COMPOSE_PROFILES` и `DOMAIN` оставь пустыми —
   Caddy из compose не нужен, 80/443 заняты):

   ```ini
   WEB_BIND=127.0.0.1
   WEB_PORT=8081
   ```

3. Запусти Vicinity (шаг 6) и проверь, что сайт отвечает локально:
   `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8081/` → `200`.
4. Подключи поддомен к прокси — **nginx** или **Caddy** ниже.

#### Если на хосте nginx

Готовый блок лежит в `deploy/host-proxy/nginx-vicinity.conf`. Его содержимое:

```nginx
server {
    listen 80;
    server_name chat.example.com;

    # Аватары и вложения до 15 МБ (+ запас на multipart)
    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:8081;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 5m;
        proxy_send_timeout 5m;
    }

    # WebSocket: сообщения, присутствие и голос. Соединение живёт часами — длинные таймауты.
    location = /ws {
        proxy_pass http://127.0.0.1:8081;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
        access_log off;   # в URL лежит токен сессии
    }
}
```

Установка (замени `chat.example.com` на свой поддомен; если взял другой `WEB_PORT` — поменяй и `8081`):

```bash
ls /etc/nginx/sites-enabled /etc/nginx/conf.d       # куда nginx складывает сайты
cp -a /etc/nginx /root/nginx-backup-$(date +%F)      # копия конфигов на всякий случай

# Ubuntu/Debian (есть sites-enabled):
sed 's/chat.example.com/chat.твой-домен.ru/' ~/vicinity/deploy/host-proxy/nginx-vicinity.conf \
    > /etc/nginx/sites-available/vicinity
ln -s /etc/nginx/sites-available/vicinity /etc/nginx/sites-enabled/vicinity
# (если sites-enabled нет — сохрани файл как /etc/nginx/conf.d/vicinity.conf)

nginx -t && systemctl reload nginx                   # reload, не restart: бот не прерывается
```

Сертификат Let's Encrypt (certbot сам допишет в **этот** блок HTTPS и редирект и будет продлевать сертификат):

```bash
apt-get install -y certbot python3-certbot-nginx     # если certbot ещё не стоит
certbot --nginx -d chat.твой-домен.ru
certbot renew --dry-run                              # проверка автопродления
```

`nginx -t` ругается — ничего не перезагружай, исправь ошибку (или удали `/etc/nginx/sites-enabled/vicinity`):
пока проверка не прошла, работающий nginx и бот продолжают жить со старым конфигом.

> Прокси бота сам работает в Docker-контейнере? До `127.0.0.1:8081` хоста он не достанет. Подключи
> его контейнер к сети Vicinity — `docker network connect deploy_default <контейнер-прокси>` — и вместо
> `http://127.0.0.1:8081` укажи `http://vicinity-web:80`.

#### Если на хосте Caddy

Допиши в конец `/etc/caddy/Caddyfile` (блоки бота не трогай) — то же есть в `deploy/host-proxy/Caddyfile`:

```caddyfile
chat.example.com {
	request_body {
		max_size 20MB
	}
	header Strict-Transport-Security "max-age=31536000"
	reverse_proxy 127.0.0.1:8081
}
```

```bash
cp /etc/caddy/Caddyfile /root/Caddyfile.backup-$(date +%F)
nano /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy
```

Caddy сам получит и будет продлевать сертификат; WebSocket, `X-Forwarded-For` и длинные соединения
он проксирует без дополнительных настроек.

### Без домена (только попробовать)

Оставь в `.env` `WEB_BIND=0.0.0.0` и `WEB_PORT=80` (80 занят — `8081`), сайт будет на `http://IP_VPS`.
Переписка работает, а голос, звонки и уведомления в браузере — нет (нужен HTTPS). Десктоп-клиентам
домен не нужен. Когда появится домен — перейди на сценарий А или Б и выполни `docker compose up -d`.

## 6. Запуск

```bash
cd ~/vicinity/deploy
docker compose up -d --build
```

Первая сборка компилирует Drogon — **10–20 минут** на маленьком VPS. Следующие обновления — пара минут.

```bash
docker compose ps
```

`vicinity-server` и `vicinity-web` должны быть `Up (healthy)`, `vicinity-coturn` (и `vicinity-caddy`
в сценарии А) — `Up`. Быстрая проверка:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/api/v1/auth/me   # 401 — сервер жив
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8081/                  # 200 — сайт (без домена: :80)
```

В сценарии А сертификат появится через минуту: `docker compose logs caddy | grep -i "certificate obtained"`.

## 7. Открыть порты

| Порт | Протокол | Зачем | Когда |
|---|---|---|---|
| порт SSH (обычно 22) | TCP | доступ к серверу | всегда |
| 80, 443 | TCP | сайт по HTTPS и выпуск сертификата | сценарий А (в Б уже открыты для бота) |
| 443 | UDP | HTTP/3 у Caddy (необязательно) | сценарий А |
| 8080 | TCP | десктоп-клиенты по `http://IP_VPS:8080` | пока ими пользуются |
| 3478 | TCP и UDP | TURN/STUN для звонков | всегда |
| 49160–49200 | UDP | TURN relay (сам звук и видео) | всегда |

**Файервол в панели хостера** (Security Group / «Firewall»), если он есть, — открой там эти порты.

**ufw на самом VPS.** Сначала посмотри состояние: `ufw status`.

- `Status: active` — просто добавь правила:

  ```bash
  ufw allow 3478 && ufw allow 49160:49200/udp
  ufw allow 80/tcp && ufw allow 443                   # сценарий А
  ufw allow 8080/tcp                                  # десктоп по http://IP:8080
  ```

- `Status: inactive` — **не включай ufw вслепую**: он закроет всё, что не разрешено, включая SSH и бота.
  Сначала разреши порт SSH и все порты из `ss -tlnp`, которые нужны снаружи (бот, его сайт), потом добавь
  правила выше и только тогда `ufw enable`. Если сомневаешься — оставь ufw выключенным и закрывай порты
  в панели хостера.

> Порты, которые публикует Docker (8080, 8081 или 80 у веб-контейнера), ufw **не закрывает** — Docker обходит
> его правила. Чтобы порт был недоступен снаружи, его привязывают к `127.0.0.1` в `.env` (`WEB_BIND`,
> `BACKEND_BIND`). coturn и Caddy работают в сети хоста, поэтому для 3478, 49160–49200 и 80/443 сценария А
> правила ufw действуют — при включённом ufw их нужно разрешить.

## 8. Проверка

1. Открой `https://chat.твой-домен.ru`, зарегистрируйся, напиши сообщение.
2. Зайди в голосовой канал сервера — браузер спросит доступ к микрофону.
3. Позвони другу из лички (второй аккаунт, лучше с телефона через мобильный интернет — так проверяется TURN).
4. Десктоп: в поле «Адрес сервера» — `http://IP_VPS:8080` или `https://chat.твой-домен.ru`.

Регистрация открыта всем, кто знает адрес, — давай его только своим.

---

## Обновление

```bash
cd ~/vicinity && sh deploy/update.sh
```

Скрипт по шагам: проверяет, что в репозитории нет локальных правок → делает резервную копию (`backup.sh`)
→ `git pull` → `docker compose up -d --build` (пересоздаются только изменившиеся контейнеры) → ждёт,
пока сервер и сайт станут `healthy` → удаляет прежние образы. Запускать повторно безопасно. Без копии:
`BACKUP=0 sh deploy/update.sh` (не рекомендуется).

То же вручную:

```bash
cd ~/vicinity && git pull && cd deploy && docker compose up -d --build
```

После смены настроек в `.env` достаточно `docker compose up -d` — compose пересоздаст затронутые контейнеры.
Выключаешь Caddy (убрал `COMPOSE_PROFILES=https`) — останови его: `docker compose --profile https stop caddy`.

### Обновление со старой версии

Раньше инструкция просила вписать IP и секрет прямо в `deploy/turnserver.conf` (и иногда TURN —
в `deploy/config.docker.json`). Теперь всё это в `.env`, а `update.sh` остановится с сообщением
«есть локальные правки». Перенос:

```bash
cd ~/vicinity
git status --short                                 # какие файлы правились
grep -E '^(external-ip|static-auth-secret)=' deploy/turnserver.conf   # старые IP и секрет
git stash                                          # убрать правки (остаются в git stash list)
cd deploy && cp -n env.example .env && chmod 600 .env && nano .env
```

В `.env`: `PUBLIC_IP` — старый `external-ip`, `VICINITY_TURN_SECRET` — старый `static-auth-secret`
(или новый `openssl rand -hex 32`), выбери сценарий из шага 5. Если раньше запускал с `WEB_PORT=8081`
в командной строке — впиши `WEB_PORT=8081` в `.env`. Затем `sh update.sh`. База и загрузки остаются:
том `deploy_vicinity-data` тот же.

#### Копия через scp (папка без git)

Старая инструкция копировала на VPS только `backend`, `shared` и `deploy`. Новой сборке нужна ещё папка
`web/` (веб-версия): без неё `docker compose up -d --build` падает на `COPY web/package.json`, а `update.sh`
останавливается с подсказкой. Код в такой папке сам не обновляется — один раз перейди на git:

```bash
git clone https://github.com/inkoffTTV/Vicinity.git ~/vicinity-git
cp ~/vicinity/deploy/.env ~/vicinity-git/deploy/.env        # если .env был; иначе создай по шагу 5
sh ~/vicinity-git/deploy/backup.sh                          # резервная копия базы, загрузок и .env
cd ~/vicinity/deploy && docker compose down                  # без -v: том с данными остаётся
cd ~ && mv ~/vicinity ~/vicinity-scp && mv ~/vicinity-git ~/vicinity
cd ~/vicinity/deploy && docker compose up -d --build
```

Имя проекта compose то же — `deploy` (по имени папки), поэтому том `deploy_vicinity-data` с базой и
загрузками подхватится. Если `.env` в старой папке не было (IP и секрет были в `turnserver.conf`) —
создай его по шагу 5 и перенеси значения, как описано выше. Старую папку `~/vicinity-scp` удали, когда
убедишься, что всё работает. Остаться на scp тоже можно: тогда копируй с компьютера все четыре папки
`scp -r backend shared web deploy root@IP_VPS:/root/vicinity/` и запускай `sh deploy/update.sh`.

## Резервные копии

```bash
sh ~/vicinity/deploy/backup.sh                 # копия в ~/vicinity-backups/ГГГГММДД-ЧЧММСС (время UTC)
```

В копии: `vicinity.db` (снимок базы через `sqlite3 .backup` — сервер не останавливается, копия проверяется
`PRAGMA quick_check`), `uploads.tar.gz` (аватары и вложения) и `env` (твой `.env` с секретом). Хранятся
последние 14 копий (`KEEP=30 sh backup.sh` — другое число), другая папка — `sh backup.sh /mnt/backups`.

Каждый день в 4:00 — `crontab -e` и строка:

```cron
0 4 * * * sh /root/vicinity/deploy/backup.sh >> /var/log/vicinity-backup.log 2>&1
```

Копия на том же диске не спасёт от смерти VPS — периодически забирай её к себе (с ПК):

```bash
scp -r root@IP_VPS:vicinity-backups/20261008-040000 .
```

### Восстановление

```bash
cd ~/vicinity/deploy
B=~/vicinity-backups/20261008-040000                      # папка нужной копии
docker compose stop vicinity
docker cp "$B/vicinity.db" vicinity-server:/data/vicinity.db
gunzip -c "$B/uploads.tar.gz" | docker cp - vicinity-server:/data/
docker compose start vicinity
```

На новом сервере: установи всё по шагам 1–6, положи `env` из копии как `deploy/.env` (поправь `PUBLIC_IP`),
запусти и восстанови базу и загрузки командами выше.

### Перенос базы с локального сервера

База, которой пользовались на своём ПК (`build/backend/Release/vicinity.db` и папка `uploads/` рядом),
переносится так же. На ПК, в папке с этими файлами:

```bash
ssh root@IP_VPS mkdir -p import
scp -r vicinity.db uploads root@IP_VPS:import/
```

Затем на VPS:

```bash
cd ~/vicinity/deploy
docker compose stop vicinity
docker cp ~/import/vicinity.db vicinity-server:/data/vicinity.db
docker cp ~/import/uploads vicinity-server:/data/
docker compose start vicinity
```

## Логи и управление

Все команды — из папки `~/vicinity/deploy`:

```bash
docker compose ps                          # что запущено и healthy ли
docker compose logs -f --tail 100          # логи всех сервисов (Ctrl+C — выйти)
docker compose logs -f vicinity            # сервер; web, coturn, caddy — так же
docker compose restart vicinity            # перезапустить сервер
docker compose stop                        # остановить всё (данные целы)
docker compose down                        # удалить контейнеры (том с данными остаётся)
```

Логи каждого контейнера ограничены 3 файлами по 10 МБ — диск не забьётся.

> **Никогда не запускай `docker compose down -v`** — `-v` удаляет том с базой и загрузками.
> И не используй `docker system prune -a`, если на сервере есть другие контейнеры (бот): он удалит
> их остановленные образы. Освободить место от кэша сборки Vicinity — `docker builder prune`
> (следующая сборка будет дольше).

## Если что-то не работает

**Сначала:** `docker compose ps` и `docker compose logs --tail 50 <сервис>`.

**`502 Bad Gateway`.**
От nginx/Caddy хоста — не отвечает `vicinity-web`: `docker compose ps`, `curl -I http://127.0.0.1:8081/`
(порт в конфиге прокси совпадает с `WEB_PORT`?). От самого сайта — не запущен сервер:
`docker compose logs vicinity`.

**`port is already allocated` / `address already in use` при запуске.**
Порт занят другим сервисом (шаг 2): в сценарии А это значит, что на 80/443 кто-то есть — переходи на
сценарий Б; иначе поменяй `WEB_PORT` / `BACKEND_PORT` в `.env`.

**Сайт открывается, но «Нет соединения» / WebSocket постоянно переподключается.**
Прокси хоста не пропускает WebSocket: в nginx нужен `location = /ws` с `Upgrade`/`Connection "upgrade"`
и `proxy_read_timeout 1h` (готовый блок выше). Проверка с сервера:

```bash
curl -si --http1.1 -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
     -H 'Sec-WebSocket-Key: dGVzdHRlc3R0ZXN0dGVzdA==' https://chat.твой-домен.ru/ws | head -1
```

`401` — запрос на WebSocket дошёл до сервера (без токена так и должно быть), `404` — прокси срезал `Upgrade`.
За Cloudflare включи WebSockets в настройках Network.

**Микрофон не работает, «Голос и звонки работают только по защищённому соединению».**
Сайт открыт по `http://`. Браузер даёт микрофон, камеру и экран только на `https://` (или `localhost`) —
настрой домен по сценарию А или Б. Убедись, что открыт адрес с `https://` и без ошибок сертификата.

**Звонок «соединяется» и обрывается / нет звука в звонке (TURN).**
- Открыты ли UDP/TCP 3478 и UDP 49160–49200 — и в ufw, и в панели хостера?
- `PUBLIC_IP` в `.env` — публичный IP (не `10.x`/`192.168.x`); после правки — `docker compose up -d`.
- `docker compose logs coturn`: `401` и `Cannot find credentials` — учётка не подходит: секреты должны
  совпадать (обычно они из одного `.env`, проверь `VICINITY_TURN_URLS`, если задавал его вручную) и время
  на VPS должно быть верным (`timedatectl`).
- Проверка из браузера: на сайте открой консоль разработчика (F12) и выполни
  `fetch('/api/v1/rtc/ice',{headers:{Authorization:'Bearer '+localStorage.getItem('vicinity.token')}}).then(r=>r.json()).then(console.log)`.
  Должен быть `turn:IP_VPS:3478...` с `username` и `credential`. Подставь их на странице
  [Trickle ICE](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/) →
  «Gather candidates»: строка с типом `relay` — TURN работает.

**`429 Too many requests` при входе — сразу у всех.**
Лимит — 60 попыток входа/регистрации в минуту с одного IP. Если он срабатывает у всех одновременно, сервер
видит всех с одного адреса: прокси хоста не передаёт `X-Forwarded-For` (возьми готовый блок выше).
Сообщения ограничены 10 за 5 секунд на пользователя — это нормальная защита от флуда.

**`413 Request Entity Too Large` при загрузке файла.**
В nginx хоста нет `client_max_body_size 20m;` в блоке Vicinity (в Caddy — `request_body`).

**Сертификат не выпускается.**
A-запись ещё не обновилась (`getent hosts chat.твой-домен.ru`), порт 80 закрыт в панели хостера или
домен проксируется Cloudflare (на время выпуска — серое облако «DNS only»). Логи: `docker compose logs caddy`
или вывод `certbot`.

**Сборка падает с `Killed` / `cc1plus: fatal error`.** Не хватает памяти — добавь swap (шаг 3).

**Не скачиваются образы (`403`, `toomanyrequests`, таймаут на `docker.io`).** Docker Hub недоступен с
этого VPS. Пропиши зеркало в `/etc/docker/daemon.json` — `{"registry-mirrors": ["https://mirror.gcr.io"]}`
(или зеркало своего хостера) и `systemctl restart docker`. Это перезапустит **все** контейнеры, включая бота.

**Закончилось место.** `df -h /` и `docker system df`. Чаще всего это кэш сборки — `docker builder prune`.

## Безопасность: чек-лист

- [ ] **Файервол:** снаружи открыты только SSH, 80/443 (сайт), 3478 TCP/UDP, 49160–49200/UDP и — пока нужен —
      8080. Порт 8081 привязан к `127.0.0.1` (`WEB_BIND=127.0.0.1`).
- [ ] **Секрет TURN** — случайный (`openssl rand -hex 32`), только в `deploy/.env` с правами `600`.
      В командную строку процессов (`ps`) он не попадает: coturn читает его из копии `turnserver.conf`
      внутри контейнера, сервер Vicinity — из своего окружения.
      Сменить: впиши новый в `.env` и `docker compose up -d` (сервер и coturn пересоздадутся; клиенты
      получат новые учётки при следующем звонке).
- [ ] **Порт 8080.** Оставь, пока друзья заходят с десктопа по `http://IP_VPS:8080`. Когда все перейдут на
      `https://chat.твой-домен.ru`, закрой его: `BACKEND_BIND=127.0.0.1` в `.env` и `docker compose up -d`
      (ufw этот порт не закроет, см. шаг 7).
- [ ] **Только HTTPS для сайта:** Caddy (сценарий А) и certbot (сценарий Б) перенаправляют `http://` на `https://`.
- [ ] **SSH:** вход по ключу, пароль root длинный или вход по паролю отключён (`PasswordAuthentication no`).
- [ ] **Обновления системы:** `apt-get install -y unattended-upgrades`.
- [ ] **Резервные копии** по cron, и копия хранится не только на VPS.
- [ ] **Бот не затронут:** его сайт открывается, `nginx -t` проходит, `docker ps` показывает его контейнеры.
