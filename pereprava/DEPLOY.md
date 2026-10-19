# Как выложить «Переправу» на свой сервер

Инструкция для чистого сервера с Ubuntu 22.04 или 24.04. Всё работает в Docker: два контейнера —
игровой сервер (`game`) и nginx (`web`), который отдаёт клиент и пропускает WebSocket `/ws`
к игровому серверу. Базы данных нет: матчи живут в памяти сервера.

Что понадобится:

- VPS с Ubuntu, 1 ядро и 1 ГБ памяти хватит на десятки одновременных матчей;
- доступ к серверу по SSH (по ключу);
- для HTTPS — домен (или поддомен), A-запись которого указывает на IP сервера.

Если на сервере уже работает другой сайт на портах 80/443 — сначала прочитайте раздел
«Если на сервере уже есть сайт» в конце.

## 1. Установить Docker

Под пользователем с `sudo`:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
```

Выйдите из SSH и зайдите снова, чтобы группа `docker` применилась. Проверка:

```bash
docker run --rm hello-world
docker compose version
```

Если включён файрвол `ufw`, откройте веб-порты (SSH не закрывайте):

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

## 2. Скачать игру

```bash
cd ~
git clone -b claude/zen-feynman-rcs2s3 https://github.com/inkoffTTV/Vicinity.git
cd Vicinity/pereprava
```

Игра лежит в папке `pereprava/` репозитория. Если позже её перенесут в основную ветку или
отдельный репозиторий — поменяйте ветку или адрес в `git clone`, остальное то же.

## 3. Настроить `.env`

```bash
cp .env.example .env
nano .env
```

| Параметр     | Что это                                                               | Пример                    |
| ------------ | --------------------------------------------------------------------- | ------------------------- |
| `DOMAIN`     | домен игры; `_` — домена пока нет, игра работает по IP через HTTP     | `game.example.ru`         |
| `PUBLIC_URL` | публичный адрес игры (виден в `/health`, нужен для приглашений)       | `https://game.example.ru` |
| `MAX_ROOMS`  | сколько комнат одновременно; сверх лимита игрок увидит «Сервер занят» | `50`                      |
| `HTTP_PORT`  | порт HTTP на сервере                                                  | `80`                      |
| `HTTPS_PORT` | порт HTTPS на сервере                                                 | `443`                     |

Паролей и секретных ключей игре не нужно — в `.env` их нет.

## 4. Запустить

```bash
docker compose up -d --build
```

Первая сборка идёт 2–4 минуты. Проверка:

```bash
docker compose ps                     # оба контейнера Up, game — (healthy)
curl http://localhost/health          # {"ok":true,...}
```

Откройте в браузере `http://IP-сервера` — должно появиться меню игры. Кнопка «С другом» создаёт
комнату и даёт ссылку для друга.

## 5. Включить HTTPS (certbot)

Нужен домен с A-записью на IP сервера. Проверьте, что он уже указывает куда надо:
`ping game.example.ru`.

1. В `.env` поставьте `DOMAIN=game.example.ru` и `PUBLIC_URL=https://game.example.ru`, затем
   перезапустите nginx, чтобы он отвечал на этот домен:

   ```bash
   docker compose up -d
   ```

2. Получите сертификат (подставьте свой домен и почту — на неё Let's Encrypt пишет, если сертификат
   скоро истечёт):

   ```bash
   docker compose run --rm certbot certonly --webroot -w /var/www/certbot \
     -d game.example.ru --email you@example.ru --agree-tos --no-eff-email
   ```

3. Перезапустите nginx — он увидит сертификат и включит HTTPS с переадресацией с HTTP:

   ```bash
   docker compose restart web
   docker compose logs web | grep pereprava   # «сертификат ... найден — включаю HTTPS»
   ```

Откройте `https://game.example.ru`.

### Продление сертификата

Сертификат живёт 90 дней. Добавьте продление в cron (`crontab -e`), путь поправьте под себя:

```cron
17 4 * * 1 cd /home/USER/Vicinity/pereprava && docker compose run --rm certbot renew --quiet && docker compose exec web nginx -s reload
```

Раз в неделю certbot проверит срок и продлит сертификат, когда до конца останется меньше 30 дней.

## 6. Обновить игру

```bash
cd ~/Vicinity/pereprava
git pull
docker compose up -d --build
```

Идущие матчи при перезапуске сервера прервутся — обновляйте, когда никто не играет
(число игроков видно в `/health`). Старые образы можно убрать: `docker image prune -f`.

## 7. Логи и состояние

```bash
docker compose logs -f game        # игровой сервер
docker compose logs -f web         # nginx: запросы и ошибки
docker compose logs --since 1h game
curl -s http://localhost/health    # комнаты, игроки, время работы
docker compose ps                  # состояние контейнеров
docker stats --no-stream           # память и процессор
```

Логи ограничены (3 файла по 10 МБ на контейнер), диск они не забьют.

Остановить игру: `docker compose down`. Запустить снова: `docker compose up -d`.
Контейнеры сами поднимаются после перезагрузки сервера (`restart: unless-stopped`).

## Если на сервере уже есть сайт

Порты 80 и 443 может занимать только одна программа. Если на сервере уже работает другой сайт
(свой nginx, Caddy или другой проект в Docker), **не останавливайте и не меняйте его** — поставьте
игру на свободный порт и пропишите в существующем веб-сервере поддомен.

1. В `.env`: `DOMAIN=_`, `HTTP_PORT=8088`, `HTTPS_PORT=8448` (любые свободные порты), затем
   `docker compose up -d --build`. Проверка: `curl http://localhost:8088/health`.
2. В уже работающем веб-сервере добавьте поддомен, который проксирует на `127.0.0.1:8088`
   **с поддержкой WebSocket**. HTTPS при этом выдаёт существующий веб-сервер.

   Для nginx на хосте:

   ```nginx
   server {
     server_name game.example.ru;
     location / {
       proxy_pass http://127.0.0.1:8088;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
       proxy_set_header Host $host;
       proxy_read_timeout 120s;
     }
   }
   ```

   Затем `sudo certbot --nginx -d game.example.ru` (если certbot стоит на хосте).

   Для Caddy (HTTPS он получает сам):

   ```caddy
   game.example.ru {
     reverse_proxy 127.0.0.1:8088
   }
   ```

3. Порты 8088/8448 в файрволе открывать не нужно — к ним ходит только локальный веб-сервер.

## Если что-то не работает

- **Меню открылось, но «С другом» пишет «Нет связи с сервером».** Не проходит WebSocket. Проверьте
  `docker compose logs web` и, если перед игрой стоит ещё один прокси, что он передаёт заголовки
  `Upgrade` и `Connection` (пример выше).
- **`game` не становится healthy.** Посмотрите `docker compose logs game`. Чаще всего порт занят
  или не хватает памяти (`free -h`).
- **certbot пишет `Connection refused` или `unauthorized`.** Домен ещё не указывает на сервер,
  порт 80 закрыт файрволом или занят другим сайтом.
- **После обновления в браузере старая версия.** Обновите страницу: `index.html` не кэшируется,
  остальные файлы имеют хэш в имени.
