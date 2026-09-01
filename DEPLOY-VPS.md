# Деплой сервера Vicinity на VPS (стабильный доступ из РФ)

Цель: сервер крутится на VPS, друзья заходят по `http://IP_VPS:8080` напрямую —
без туннелей, без блокировок домена, без обрывов. Это решение «главной боли».

---

## 1. Взять VPS
Подойдёт **самый дешёвый** (1 vCPU / 1 ГБ RAM хватает; для сборки Drogon лучше 2 ГБ
или добавить swap — см. шаг 3). ОС: **Ubuntu 22.04**.

Для РФ-доступа бери хостер, чей IP точно пингуется из России:
- **Российские:** aeza, ruvds, timeweb, vdsina (≈200–350 ₽/мес) — гарантированно открыты в РФ.
- **Рядом (тоже обычно ок):** Финляндия/Германия/Нидерланды (Hetzner, aeza-eu).

После оплаты получишь: **IP-адрес**, логин **root** и пароль (или SSH-ключ).

## 2. Зайти на VPS
С Windows (PowerShell):
```
ssh root@IP_VPS
```
(введи пароль). Дальше всё выполняется на VPS.

## 3. Поставить Docker (+ swap, если RAM = 1 ГБ)
```bash
# swap 2G — чтобы сборка Drogon не упала по памяти на маленьком VPS
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# Docker
curl -fsSL https://get.docker.com | sh
```

## 4. Залить проект на VPS
Вариант А — через git (если репозиторий доступен):
```bash
apt-get install -y git
git clone <URL-репозитория> vicinity && cd vicinity
```
Вариант Б — скопировать с твоего ПК (нужны только папки `backend/`, `shared/`, `deploy/`).
В PowerShell на твоём ПК:
```
scp -r backend shared deploy root@IP_VPS:/root/vicinity/
```
Затем на VPS: `cd /root/vicinity`.

## 5. Запустить
```bash
cd deploy
docker compose up -d --build
```
Первая сборка собирает Drogon из исходников — **10–20 минут** (терпим, один раз).
Проверка:
```bash
docker compose logs --tail 30        # должно крутиться без ошибок
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/api/v1/auth/me   # 401 = сервер жив
```

## 6. Открыть порт 8080
```bash
ufw allow 22/tcp && ufw allow 8080/tcp
# Для звонков (coturn/TURN): сигнальный порт + диапазон relay-портов
ufw allow 3478/tcp && ufw allow 3478/udp
ufw allow 49160:49200/udp
ufw --force enable
```
⚠️ Если у хостера есть **облачный фаервол/Security Group в панели** — там тоже открой TCP 8080
(иначе ufw не поможет).

Проверь снаружи (со своего ПК):
```
curl -s -o NUL -w "%{http_code}\n" http://IP_VPS:8080/api/v1/auth/me
```
Должно вернуть `401` — значит сервер виден из интернета.

## 7. Дать друзьям
Адрес сервера: **`http://IP_VPS:8080`**
Друг: распаковать `Vicinity.zip` → `Vicinity.exe` → раскрыть «▸ Адрес сервера» →
вписать `http://IP_VPS:8080` → зарегистрироваться/войти.
> Всем нужно **перерегистрироваться** на новом сервере — это чистая база (старые аккаунты
> были на локальном сервере). Перенос старой базы — опционально (см. ниже).

---

## Обновление сервера (после правок бэкенда)
```bash
cd /root/vicinity && git pull        # или заново scp backend/
cd deploy && docker compose up -d --build
```
База и загрузки сохранятся (том `vicinity-data`).

## Полезное
- Логи: `docker compose logs -f`
- Рестарт: `docker compose restart`
- Стоп: `docker compose down` (том с данными остаётся)
- Бэкап БД: `docker run --rm -v vicinity_vicinity-data:/d -v $PWD:/b alpine cp /d/vicinity.db /b/`
- Перенос старой локальной базы: скопировать свой `build/backend/Release/vicinity.db` и `uploads/`
  в том `vicinity-data` (через `docker cp` в контейнер `vicinity-server:/data/`).

## Дальше (по желанию, не обязательно)
- **Домен + HTTPS:** повесить домен на IP и поставить Caddy/Nginx как reverse-proxy с авто-TLS,
  тогда адрес будет `https://chat.твойдомен` и трафик шифруется. Но для друзей и `http://IP:8080`
  уже полностью рабочий вариант.
