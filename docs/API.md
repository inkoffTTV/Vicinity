# Vicinity API

Бэкенд — Drogon (C++), база SQLite. Все REST-пути начинаются с `/api/v1`, ответы — JSON,
ошибки — `{"error": "<текст>"}` с HTTP-кодом 4xx/5xx. Авторизация — `Authorization: Bearer <token>`;
WebSocket `/ws` принимает токен в заголовке или как `?token=` (для браузера).

**Совместимость.** У пользователей стоят старые сборки десктоп-клиента. Любое изменение API
только *добавляет* поля, эндпоинты и типы событий; существующие поля, коды ответов и события
сохраняют прежний смысл. Новые поля клиенты обязаны игнорировать, если не понимают их.

Пометка **[new]** — добавлено в ходе доработки веб-версии.

---

## 0. Регистрация и админ-панель **[new]**

GET `/health` (без авторизации) → `{ok: true}` 200, если сервер и база отвечают (`SELECT 1`), иначе `{ok: false}` 503.
Для healthcheck Docker (`deploy/docker-compose.yml`) и внешнего мониторинга.


Режим регистрации — `custom_config.registration.mode` (Docker: `VICINITY_REGISTRATION`):
`email` (капча + код из письма; по умолчанию, если настроен SMTP), `captcha` (только капча; по умолчанию без SMTP),
`open` (без проверок), `closed`. Лимит — `signups_per_ip_per_day` успешных регистраций с одного IP за сутки
(по умолчанию 3, `0` — без лимита). IP — адрес соединения или `X-Real-IP` от доверенного прокси (`trusted_proxies`).

- GET `/auth/registration` → `{mode, captcha, email, open}` — что требуется; форма регистрации подстраивается.
- GET `/auth/challenge` → задача капчи [ALTCHA](https://altcha.org/docs/server-integration/):
  `{algorithm:"SHA-256", challenge, maxnumber, salt, signature}`. Решение — число `n ≤ maxnumber`, при котором
  `hex(SHA-256(salt + n)) == challenge`; в запрос кладётся `base64(JSON{algorithm, challenge, number, salt, signature})`.
  Задача живёт 10 минут, каждое решение принимается один раз, ключ подписи меняется при перезапуске сервера.
- POST `/auth/register/start` `{username, password, display_name, email?, altcha?, website?}`:
  `website` — ловушка для ботов (должно быть пустым), `altcha` обязателен в режимах `email` и `captcha`,
  `email` — в режиме `email`.
  - режим `email` → **202** `{pending_id, email (замаскированный), expires_in, resend_in}`, код ушёл на почту;
  - режим `captcha`/`open` → **201** `{token, user_id, display_name}` — как старый `/auth/register`.
  Ошибки: 400 (поля, капча, одноразовая почта), 403 (закрыто, IP заблокирован), 409 (логин или почта заняты),
  429 (лимит с IP), 503 (режим `email` без SMTP).
- POST `/auth/register/verify` `{pending_id, code}` → **201** `{token, user_id, display_name}`.
  Код — 6 цифр, действует 15 минут, 5 неверных попыток — регистрация сбрасывается (429); устарела — 410.
- POST `/auth/register/resend` `{pending_id}` → `{resend_in, expires_in}` — новый код; не чаще раза в минуту
  и не больше 5 писем (429).
- POST `/auth/register` (старый путь, десктоп) работает только в режиме `open`; иначе **403** с текстом
  «Регистрация теперь проходит на сайте …» — десктоп показывает его как ошибку.
- Почта нормализуется для правила «один ящик — один аккаунт»: нижний регистр, без `+метки`, у Gmail без точек.

Заблокированный аккаунт (`users.banned = 1`): вход — **403** «Аккаунт заблокирован администратором»,
все его токены — 401, WS-подключения закрываются.

Админ-панель — только `developer = 1` (остальным 403):
- GET `/admin/users?q=&limit=` → `{users:[{id, username, display_name, avatar_path, email, signup_ip, created_at,
  banned, developer, subscription_tier}], top_ips:[{ip, count, last}], total, last_day, banned}` — `q` ищет по логину,
  имени, почте и IP; `top_ips` — адреса с несколькими регистрациями за 7 дней.
- POST `/admin/users/{id}/ban` `{banned: true|false}` — блокировка завершает все сессии и выводит из чужих
  серверов; администратора заблокировать нельзя.
- DELETE `/admin/users/{id}` — удалить **заблокированный** аккаунт со всеми сообщениями, реакциями, участием и его серверами
  (409, если не заблокирован).
- GET `/admin/blocked-ips` → `{blocked:[{ip, note, created_at, accounts}]}`;
  POST `/admin/blocked-ips` `{ip, note, ban_accounts}` — запретить регистрацию с адреса
  (`ban_accounts` — заодно заблокировать все аккаунты, созданные с него); DELETE `/admin/blocked-ips/{ip}`.

### Подписка **[new]**

Уровни: 0 — бесплатно, 1 — Basic, 2 — Standard, 3 — Ultra (`users.subscription_tier`). Оплаты нет — уровень
выдаёт администратор: POST `/admin/users/{id}/tier` `{tier}` (только `developer = 1`). Лимиты — `backend/utils/Tiers.cc`:

| | Бесплатно | Basic | Standard | Ultra |
|---|---|---|---|---|
| Вложения | 15 МБ | 25 МБ | 50 МБ | 100 МБ |
| Показ экрана | 1080p 30 | 1080p 60 | 1440p 30 | 1440p 60 |
| Камера | 720p | 720p | 720p | 1080p |
| Своих серверов | 10 | 25 | 50 | без лимита |
| «О себе» | 190 | 190 | 400 | 400 |
| Прочее | | ник цветом профиля | + GIF-баннер, цветовые темы | + своя тема, градиентный ник |

Сервер проверяет сам: размер вложения (413), длину «о себе» (400), GIF-баннер (403), число своих серверов
при создании (403; уже созданные не трогаются), цветовые темы (403). Качество камеры и показа экрана выставляет
клиент — WebRTC идёт напрямую между участниками.

- GET `/subscription` → `{tier, current: Plan, plans: [Plan × 4]}`, `Plan` = `{tier, name, files_mb,
  screen:{height, fps}, camera_height, servers (-1 — без лимита), bio, animated_banner, color_themes, custom_theme,
  name_color, gradient_name}`.
- В сообщениях — `author_tier` и `author_accent` (для цветного ника).

### Настройки оформления **[new]**

GET `/settings/appearance` → `{settings, access:{color_themes, custom_theme, tier}, stored}`
(`stored` — сохранялись ли настройки; иначе клиент отправляет свои).
PATCH `/settings/appearance` `{любые поля settings}` → то же. `settings`:

| Поле | Значения |
|---|---|
| `follow_system` | bool — «Как тема устройства» |
| `base_theme` | `light` \| `dark` \| `graphite` \| `black` |
| `color_theme` | null \| id готовой темы (`mint`, `peach`, … — список в `SettingsController.cc` и `web/src/lib/themes.ts`) — **Standard+, иначе 403** `{error, required_tier: 2}` |
| `custom_theme` | null \| `{colors: [2–3 × "#rrggbb"], angle: 0–360, base: "dark"\|"light"}` — **Ultra, иначе 403** `{error, required_tier: 3}`; либо `{from: id}` — тема сообщества (§18), сервер сам подставляет её цвета и хранит `from`, **Standard+, иначе 403** `{required_tier: 2}`; 404, если тему удалили |
| `sync_devices` | bool — синхронизировать между устройствами |
| `apply_to_profiles` | bool — чужие профили в своих цветах |
| `server_theme` | `mine` \| `default` — тема на серверах |
| `accent` | `""` \| `#rrggbb` — свой цвет акцента; пустой — подбирается под тему |
| `style` | `strict` \| `glass` \| `neon` — строгий (плоские панели, без стекла, градиентов и свечений), стекло, неон (свечение акцентом) |
| `panels` | `cards` \| `solid` \| `sharp` — панели карточками с зазором, встык, с острыми углами |
| `columns` | `narrow` \| `normal` \| `wide` — ширина боковых колонок |
| `font_size` | `s` \| `m` \| `l` |
| `radius` | `none` \| `small` \| `medium` \| `large` — скругление углов (`data-radius`) |
| `font_family` | `default` \| `system` \| `comfortaa` \| `oswald` \| `exo` \| `playfair` \| `jetbrains` \| `caveat` \| `lobster` \| `pressstart` \| `russo` \| `unbounded` — шрифт интерфейса (`web/src/lib/fonts.ts`) |
| `font_px` | 0 (авто) или 12–20 — базовый размер шрифта интерфейса |
| `font_weight` | 0 (авто), 400, 500, 600, 700 |
| `scale` | 75 \| 90 \| 100 \| 110 \| 125 — масштаб интерфейса, % |
| `eco` | `off` \| `minimized` \| `unfocused` — экономия эффектов (без размытия и анимаций, пока окно свёрнуто или не в фокусе) |
| `transparency` | bool — полупрозрачные панели поверх градиента или фона |
| `panel_opacity` | 20–100 — непрозрачность панелей, % |
| `glass_blur` | 0–40 — размытие фона под панелями, px |
| `background` | null \| `{image: "/uploads/backgrounds/…"}` (своя картинка, `POST /themes/community/upload`) \| `{from: id}` — фон из мастерской (§18), картинку подставляет сервер и считает установку; 404, если фон удалили |
| `compact`, `reduce_motion`, `high_contrast` | bool |
| `saturation` | 0–100 |

Тема, на которую подписки уже нет, в GET приходит как `null`. Неизвестные поля игнорируются, некорректные значения — 400.

## 1. Доступ к каналам

Канал доступен пользователю, если:
- серверный канал (`channels.server_id` не NULL) — пользователь состоит в `server_members` этого сервера;
- личка/беседа — пользователь есть в `channel_members`.

Все эндпоинты и WS-сообщения, работающие с каналом (чтение/отправка/редактирование/реакции/
вложения/закрепы/поиск/прочтение/голос/набор текста), проверяют доступ и отвечают **403**
(или молча игнорируют WS-сообщение), если доступа нет. Несуществующий канал — **404**.

## 2. Сообщения

Объект сообщения (в REST и в WS `new_message`):

| Поле | Тип | |
|---|---|---|
| `id` | int | монотонно растёт; порядок сообщений — по `id` |
| `channel_id` | int | **[new]** в REST тоже |
| `author_id`, `author_name`, `author_avatar` | | как раньше |
| `text` | string | разметка Vicinity (§23) |
| `created_at` | string | `YYYY-MM-DD HH:MM:SS` UTC |
| `edited` | bool | |
| `attachment` | string | URL вложения-**картинки** или `""`. Старые десктопы показывают это поле как картинку, поэтому у файла (`attachment_type` = `"file"`) здесь `""` |
| `attachment_url` | string | **[new]** URL вложения любого типа (картинки или файла) или `""` — новые клиенты берут URL отсюда |
| `attachment_name` | string | **[new]** исходное имя файла (`""` если нет); у картинки расширение имени заменяется настоящим (`.png`/`.jpg`/`.gif`/`.webp` — по содержимому файла) |
| `attachment_size` | int | **[new]** размер в байтах (0 если нет) |
| `attachment_type` | string | **[new]** `"image"` \| `"file"` \| `""`; у сообщений до обновления с вложением — `"image"` |
| `reactions` | array | `[{emoji, count, users:[ids]}]` |
| `reply_to` | int | **[new]** id сообщения, на которое ответ, или 0 |
| `reply` | object\|null | **[new]** `{id, author_id, author_name, text (≤200 симв.), attachment, webhook}`; `null` если ответа нет или исходное удалено. `webhook` — `{id, name}` у цитаты сообщения вебхука (§22: `author_name` — имя вебхука, `author_id` — его создатель; клиент ставит пометку «ВЕБХУК» и не берёт аватар создателя), иначе `null`. Здесь (как и в `last_message`, §7) `attachment` — URL вложения любого типа: эти объекты старые десктопы не читают |
| `nonce` | string | **[new]** только в WS `new_message` и в ответе POST: эхо клиентского `nonce` |
| `kind` | string | **[new]** `"voice"` — голосовое сообщение, `"call"` — запись о звонке в личке (§12), `""` — обычное |
| `meta` | object\|null | **[new]** у `voice`: `{duration: сек, peaks: [0..1, до 128]}`; у `call`: `{result: "ok"\|"missed"\|"declined", duration: сек}` |
| `author_bot` | bool | **[new]** автор — бот (§21): пометка «БОТ» у имени |
| `reply_markup` | object\|null | **[new]** кнопки под сообщением `{"inline_keyboard": [[кнопка, …], …]}` (бот §21, вебхук §22); кнопка — `{text}` и ровно одно из `callback_data`, `url`, `copy_text: {text}`, `web_app: {url}` |
| `webhook` | object\|null | **[new]** сообщение входящего вебхука канала (§22): `{id, name}`; у такого сообщения `author_name` = имя вебхука, `author_avatar` пустой, оформление профиля создателя не показывается |
| `ephemeral`, `ephemeral_id` | bool, string | **[new]** только в WS `ephemeral_message` (§21): сообщение видит один человек, в истории его нет, `id` = 0 |

### GET `/channels/{id}/messages`
Параметры (все необязательны):
- `limit` — 1..100, по умолчанию 50;
- `before=<message_id>` — сообщения с `id < before`;
- `around=<message_id>` — само сообщение (если оно есть в канале) и до `limit/2` сообщений до и после него
  (для перехода к ответу/закрепу/результату поиска); при `around` параметр `before` не учитывается.

`limit` вне 1..100 приводится к границам, нечисловой — по умолчанию.
Ответ: `{"messages": [...], "has_more": bool}` — `messages` **отсортированы по `id` по убыванию**
(как раньше: новые первыми). `has_more` — есть ли более старые сообщения, чем вернувшиеся. Для `around` дополнительно
`"has_newer": bool` — есть ли более новые.

### POST `/channels/{id}/messages`
`{"text": "...", "attachment": "/uploads/...", "reply_to": 123, "nonce": "abc"}` — всё кроме `text`/`attachment`
необязательно. **[new]** Голосовое сообщение: `"kind": "voice", "meta": {"duration": 3.2, "peaks": [0.1, ...]}` при
`attachment` — аудиофайле из `/uploads/files/` (webm/ogg/opus/m4a/mp4/mp3/wav/aac), иначе 400; `duration` 0..1200,
`peaks` — до 128 чисел 0..1 (лишнее обрезается). `reply_to` должен принадлежать тому же каналу (иначе 400). `nonce` ≤ 64 символов.
Ответ 201: `{id, created_at, status:"sent", nonce}` + **[new]** `reply_to`, `reply`, `attachment_url`, `attachment_name`,
`attachment_size`, `attachment_type` (как в объекте сообщения).
Лимит частоты: не более 10 сообщений за 5 секунд на пользователя (429).

### POST `/channels/{id}/attachments` (multipart, поле `file`)
Картинки: png, jpg/jpeg, gif, webp (проверка сигнатуры) → `/uploads/attachments/...`.
**[new]** Прочие файлы до 15 МБ (кроме html/htm/shtml/xhtml/mht/svg/xml/xsl/js/mjs/cjs/php и исполняемых:
exe/bat/cmd/com/scr/pif/cpl/msi/msp/dll/jar/app/lnk/reg/sh/bash/ps1/psm1/vbs/vbe/wsf/wsh/hta — 415) → `/uploads/files/...`
(расширение — из имени файла). Больше 15 МБ — 413. Бэкенд отдаёт `/uploads/files/` с
`Content-Disposition: attachment; filename="<имя, не-ASCII символы заменены на _>"; filename*=UTF-8''<имя в %-кодировке>`
(исходное имя файла из загрузки; если оно неизвестно — просто `attachment`), nginx пропускает этот заголовок как есть;
все загрузки — с `X-Content-Type-Options: nosniff`.
Ответ 201: `{url, name, size, type: "image"|"file"}` (`name` — имя файла клиента без пути, до 255 символов).
При отправке сообщения клиент передаёт `attachment` = `url` (картинки или файла) и **[new]** необязательно `attachment_name`
(сервер проверяет, что `attachment` — файл из `/uploads/attachments/` или `/uploads/files/`, иначе 400;
без `attachment_name` берётся имя, запомненное при загрузке).
`attachment_size` и `attachment_type` сервер определяет сам по загруженному файлу; присланные клиентом игнорируются.

### Редактирование / удаление / реакции
Без изменений по форме. **[new]** Владелец сервера может удалять чужие сообщения в каналах своего сервера.
Удаление закреплённого сообщения снимает закреп (`pins_updated`, §6).
**[new]** WS `message_edited` после правки ботом (§21) несёт ещё `reply_markup` (текущие кнопки или `null` — кнопки
убраны) и `edited` (bool): `{"type":"message_edited","channel_id":N,"id":M,"text":"…","reply_markup":…,"edited":true}`.
`text` есть всегда — текущий текст; правка только кнопок (`editMessageReplyMarkup`) приходит с прежним `text`
и не ставит `edited`. Сообщения вебхука (§22) через POST `/edit` не правятся (403).

## 3. Набор текста **[new]**
WS клиент → сервер: `{"type":"typing","channel_id":N}` (не чаще раза в 3 с; сервер игнорирует чаще 1 раза в 2 с
от одного пользователя).
Сервер → получатели канала, кроме отправителя: `{"type":"typing","channel_id":N,"user_id":U,"name":"..."}`.
Клиент показывает «X печатает…» 6 секунд или до сообщения от этого пользователя.

## 4. Прочитанное **[new]**
- POST `/channels/{id}/read` `{"message_id": N}` — запомнить последнее прочитанное (только вперёд; не дальше
  последнего сообщения канала). Ответ: `{"channel_id":N,"last_read_id":M}` — текущее значение.
  Если отметка сдвинулась, всем подключениям пользователя (REST-запрос нельзя сопоставить с WS-подключением,
  поэтому и отправившему) уходит WS `{"type":"read_state","channel_id":N,"last_read_id":M}`.
- GET `/unread` → `{"channels":[{"channel_id":N,"unread":K,"mentions":M,"last_message_id":L}]}` — по всем доступным
  каналам с непрочитанным (`unread` > 0). Считаются сообщения других пользователей с `id > last_read_id`
  (не более 999; канал без отметки, например после вступления на сервер, — с начала истории).
  `mentions` — из них содержащие `@<username>` текущего пользователя (без учёта регистра; не часть e-mail
  и не начало более длинного логина: `@bob` не упоминает `bob.smith`, а `@bob.` в конце фразы — упоминает).
- Таблица `channel_reads(user_id, channel_id, last_read_id)`. При первом создании таблицы
  существующим участникам проставляется текущий максимум `id` — чтобы после обновления у всех не загорелась
  вся история (разовая миграция, номер в `PRAGMA user_version`).

## 5. Поиск **[new]**
GET `/search?q=<строка ≥2 символов>&channel_id=N` или `&server_id=S` или без них (все доступные каналы).
Ответ: `{"results":[ <сообщение> + "channel_name", "server_id" (0 для личек/бесед) ]}`, не более 50, новые первыми.
Ищется подстрока в тексте; `%` и `_` — буквально; регистр не учитывается только для латиницы. `q` обрезается по краям,
короче 2 символов — 400. `channel_name` у лички — имя собеседника. Если заданы оба, действует `channel_id`.
Нет канала/сервера — 404, нет доступа — 403. Лимит: 30 запросов в минуту (429).

## 6. Закреплённые **[new]**
- GET `/channels/{id}/pins` → `{"pins":[ <сообщение> + "pinned_by" (id), "pinned_at" ]}`, последние закреплённые первыми.
- POST `/channels/{id}/pins` `{"message_id":N}` → `{"status":"pinned"}` (сообщения нет в канале — 404);
  DELETE `/channels/{id}/pins/{mid}` → `{"status":"unpinned"}`. Оба идемпотентны.
  В личках/беседах — любой участник, в серверных каналах — владелец сервера (иначе 403).
- WS получателям канала, если закрепы изменились: `{"type":"pins_updated","channel_id":N}`.

## 7. Лички и беседы
- GET `/dms` — как раньше + **[new]** `last_message` (`{id, author_id, author_name, text (≤200 симв.), attachment, created_at, kind, webhook}` или `null`; `webhook` — `{id, name}`, если последнее от вебхука §22).
- GET `/channels` (беседы) — как раньше + **[new]** `owner_id`, `last_message`.
- **[new]** GET `/channels/{id}/members` → `{"members":[{id, username, display_name, avatar_path, presence, is_owner}]}`
  (у беседы — в порядке вступления; у канала сервера — участники сервера по имени, `is_owner` — владелец сервера).
- **[new]** POST `/channels/{id}/leave` → `{"status":"left"}` — выйти из беседы (из лички и канала сервера — 400).
  Остальным: WS `{"type":"channel_member_left","channel_id":N,"user_id":U,"owner_id":O}`; ушедшему
  (во все его подключения): `{"type":"channel_removed","channel_id":N}`. Ушёл владелец — владельцем становится
  самый давний участник (`owner_id` в событии); ушёл последний — беседа удаляется.
- **[new]** POST `/channels/{id}/update` `{"name": "..."}` → `{"channel_id":N,"name":"..."}` — переименовать беседу
  (участник беседы) или серверный канал (владелец сервера); личку — 400. WS получателям:
  `{"type":"channel_updated","channel_id":N,"name":"..."}`, для серверного канала ещё `server_channels_changed`.
- **[new]** DELETE `/channels/{id}` → `{"status":"deleted"}` — удалить серверный канал (владелец сервера) или беседу
  (её владелец); личку — 400. Сообщения, реакции, закрепы и отметки прочтения удаляются вместе с каналом,
  сидящие в его голосе выходят из него. WS: для серверного — `server_channels_changed`, для беседы —
  `channel_removed` всем участникам.
- **[new]** при добавлении в беседу остальным участникам: `{"type":"channel_member_joined","channel_id":N,"user_id":U}`
  (добавленному — как раньше `channel_added`).
- **[changed]** POST `/channels/{id}/members` `{user_id}` больше не добавляет сразу, а **приглашает** (§7.1):
  `{"status":"invited"|"already_invited","channel_id":N}`; уже участник — 409, блокировка между людьми — 403,
  больше 30 приглашений в минуту — 429.

## 7.1 Приглашения в беседу и на сервер **[new]**
Человека нельзя добавить без его согласия: ему приходит приглашение, и он сам принимает или отклоняет его.
Вступление на сервер по ссылке/коду (`/servers/join`) работает как раньше — переход по ссылке и есть согласие.
- GET `/invites` → `{"invites":[{id, kind:"group"|"server", target_id, name, icon, members, inviter{id, username,
  display_name, avatar_path}, created_at}]}` — свои ожидающие, новые первыми.
- POST `/invites/{id}/accept` → `{"status":"joined","kind":"group","channel_id":N}` или `{…,"kind":"server","server_id":S}`.
  Беседы/сервера уже нет — 404, бан на сервере — 403 (приглашение при этом снимается). Дальше — как при добавлении:
  остальным `channel_member_joined` / `server_member_joined`, себе во все подключения `channel_added` / `server_added`
  с `"accepted": true`.
- POST `/invites/{id}/decline` → `{"status":"declined"}`. Чужое приглашение — 404.
- WS приглашённому: `{"type":"invite_received","invite":{…как в списке}}`; приглашение закрыто (ответ, вступление
  по ссылке, бан, удаление беседы/сервера) — `{"type":"invite_removed","invite_id":N}`.
- WS пригласившему: `{"type":"invite_answered","kind","target_id","name","accepted":true|false,"user_id","user_name"}`.

## 8. Серверы
- GET `/servers` — как раньше.
- POST `/servers/join` `{code}` — как раньше; **[new]** забаненным — 403.
- **[changed]** POST `/servers/{id}/members` `{user_id}` — **приглашает** (§7.1): `{"status":"invited"|"already_invited",
  "server_id":S}`; уже участник — 409, забаненного или при блокировке между людьми — 403.
- **[removed]** POST `/servers/{id}/join` (вступление без кода по id) — отвечает 403, если у пользователя нет приглашения.
- **[new]** POST `/servers/{id}/leave` → `{"status":"left"}` — выйти (владельцу нельзя — 400, не участнику — 403).
  Ушедшему во все его подключения тоже уходит `server_member_left` про него самого.
- **[new]** DELETE `/servers/{id}` → `{"status":"deleted"}` — удалить сервер (владелец) вместе с каналами, сообщениями,
  реакциями, закрепами, отметками прочтения, участниками и банами. Всем участникам: `server_removed`
  (существующее событие, `{server_id, name}`).
- **[new]** POST `/servers/{id}/update` `{"name": "..."}` — владелец. POST `/servers/{id}/icon` (multipart `file`, картинка
  png/jpg/gif/webp, иначе 415) — владелец. Ответ обоих: `{"server_id":S,"name":"...","icon":"..."}`.
  WS участникам: `{"type":"server_updated","server_id":S,"name":"...","icon":"/uploads/..."}`.
- **[new]** POST `/servers/{id}/invite` — владелец, новый код: `{"invite_code":"..."}`; старый перестаёт работать.
- **[new]** баны (только владелец, иначе 403; сервера нет — 404): POST `/servers/{id}/bans` `{user_id}` → `{"status":"banned"}`
  (заодно исключает: ему `server_removed`, остальным `server_member_left`; себя — 400), DELETE `/servers/{id}/bans/{uid}`
  → `{"status":"unbanned"}`, GET `/servers/{id}/bans` → `{"bans":[{id, username, display_name, avatar_path}]}`.
- **[new]** WS участникам при изменениях состава: `{"type":"server_member_joined","server_id":S,"user_id":U}`,
  `{"type":"server_member_left","server_id":S,"user_id":U}`; при создании/переименовании/удалении канала:
  `{"type":"server_channels_changed","server_id":S}`.

## 9. Аккаунт **[new]**
- POST `/auth/password` `{"old_password","new_password"}` → `{"status":"ok","revoked":N}` — новый ≥ 8 символов (иначе 400);
  неверный старый пароль — 403 (не 401: текущая сессия жива). Остальные сессии завершаются, их WS-подключения
  закрываются; текущая остаётся. Лимит частоты как у входа.
- Подключение завершённой сессии (выход, смена пароля, отзыв, истечение) сразу перестаёт обрабатываться
  и выходит из голоса; сервер шлёт Close с кодом 1008 и причиной `session ended` и через секунду закрывает
  сокет, даже если клиент на Close не ответил. Повторное подключение с этим токеном — 401, REST — 401.
- GET `/auth/sessions` → `{"sessions":[{id, created_at, expires_at, current}]}` — действующие, новые первыми
  (`id` — короткий непрозрачный идентификатор, 16 hex).
- DELETE `/auth/sessions/others` → `{"status":"ok","revoked":N}` — выйти на всех остальных устройствах.
  DELETE `/auth/sessions/{id}` → `{"status":"ok"}` (можно и текущую; чужой/неизвестный id — 404).

## 10. Профили **[new]**
`accent_color` (POST `/profile/customize`, `/profile/accent`) — `#RRGGBB` или `""`; `#AARRGGBB` (так присылает десктоп
цвет с прозрачностью) принимается и сохраняется без альфы, как `#RRGGBB`. Прочее — 400.

При изменении имени/аватара/баннера/цвета/статуса друзьям и участникам общих серверов уходит
`{"type":"user_updated","user_id":U,"display_name":"...","avatar_path":"...","accent_color":"..."}`.

### 10.1 Расширенный профиль **[new]**

POST `/profile/extras` — расширенный профиль целиком → сохранённый объект. В GET `/users/{id}/profile` — `profile_ext`
(украшения без подписки владельца — `null`) и `badge` `{id, name, icon}` выбранного сервера. Отдельно от `profile_json`:
его десктоп перезаписывает своими ключами. Статус и цвет баннера по-прежнему в `profile_json` (`statusText`, `banner.color`).

| Поле | |
|---|---|
| `badge_server` | null | id сервера, где пользователь состоит (иначе 400) |
| `badge_pick` | null | значок из набора клиента: `star`, `flame`, `heart`, `gamepad`, `code`, `music`, `camera`, `palette`, `rocket`, `coffee`, `moon`, `leaf` (иначе 400) |
| `music` | null | трек из каталога `{id, title ≤ 120, artist ≤ 120, album ≤ 120, artwork, preview, url}`; ссылки — только https на `*.mzstatic.com` / `*.apple.com` (иначе 400). Поиск: `GET /music/search?q=…` → `{tracks: [...]}` (через сервер, кэш 10 мин, лимит как у поиска) |
| `frame` | null | `neon`, `gold`, `ice` (Basic), `fire` (Standard), `rainbow` (Ultra) |
| `effect` | null | `stars`, `aurora`, `snow`, `glint` (Ultra) |
| `name_style` | null | `gradient`, `neon`, `metal`, `flame` (Standard), `aurora` (Ultra) |
| `connections` | до 10 × `{type, name ≤ 40, url: "" | https://…}`, type: steam, spotify, epic, xbox, playstation, battlenet, twitch, youtube, github, telegram, vk, website |

### Фон чата

`POST /channels/{id}/update` принимает кроме `name` поле `background` (канал сервера, только владелец):
`{preset}` — один из `lagoon`, `dusk`, `forest`, `ember`, `night`, `dots`, `grid`, `waves`; или `{image}` — url из
`/uploads/backgrounds/`; плюс `dim` 0–80 (затемнение, %, по умолчанию 40) и `blur` (bool). `null` — убрать. Канал в
`GET /servers/{id}/channels` отдаёт `background` строкой JSON (или null); всем в канале уходит `channel_updated` с
`background`. Картинка: `POST /channels/{id}/background` (multipart `image`, владелец) → `{file_url}`.

Фон лички и беседы — личная настройка клиента (виден только себе), сервер хранит лишь картинку:
`POST /profile/chat_background` (multipart `image`) → `{file_url}`. Предложение фона собеседнику — обычное сообщение
вида `Фон чата: preset=lagoon dim=40`.
| `widgets` | `{favorite_game: null | {appid, name, note ≤ 120, tags ≤ 6 из списка}, games: ≤ 20 × {appid, name}, wishlist: ≤ 20 × {appid, name}, order: ["favorite_game" | "games"]}` |

Украшение без нужной подписки — **403**. `cover` у игр сервер ставит сам: `/api/v1/games/{appid}/cover`.

### 10.2 Игры **[new]**

- GET `/games/search?q=` → `{games: [{appid, name, cover}]}` — до 10 игр из магазина Steam (запрос идёт с сервера,
  ответы кэшируются на час; лимит — как у поиска).
- GET `/games/{appid}/cover` (без токена — для `<img>`) → 302 на `/uploads/games/{appid}.jpg`; при первом запросе
  сервер скачивает обложку Steam (вертикальную, иначе горизонтальную). Нет обложки — 404, занято — 503.

### 10.3 Игры «Активностей» **[new]**

`{game}` — `klyaksa` или `hookduel`. Игра зовёт их не сама, а через мессенджер (`Net.api` → `ActivityFrame`).

- GET `/play/{game}/me` → `{best_floor, runs, wins, kills, unlocks: [...], hats: [...], colors: [...], cosmetic: {hat, color}}` —
  `hats`/`colors` — что можно надеть сейчас (за достижения и по подписке: Standard — `cap`/`sky`, Ultra — `halo`/`black`).
- POST `/play/{game}/result` `{floor, kills, won, time_ms, daily?: "YYYY-MM-DD", ach: [...]}` → то же + `fresh` (новые
  достижения). Ежедневный забег принимается за сегодня и вчера (UTC); хранится лучший результат дня.
- POST `/play/{game}/cosmetic` `{hat, color}` — только открытое, иначе 403.
- GET `/play/{game}/daily?day=` → `{day, rows: [{place, me, name, floor, kills, time_ms, won}]}` — до 10 строк:
  я и те, чей профиль мне виден (место — в общей таблице).
- В профиле (`GET /users/{id}`) — `games: {klyaksa: {best_floor, runs, wins}}`.

## 11. Голос **[new]**
- Несколько WS-подключений одного пользователя работают одновременно (десктоп + вкладки браузера):
  события уходят во все подключения; пользователь «в сети», пока открыто хотя бы одно;
  закрытие одного подключения не трогает остальные.
- `voice_join` разрешён только в голосовой канал сервера, где пользователь состоит, или в личку/беседу,
  где он участник. `voice_query` — только участникам сервера.
- Голосом владеет то подключение, которое прислало `voice_join`: бинарные кадры принимаются только от него
  и пересылаются только в голосовые подключения других участников. Закрытие этого подключения = выход из канала.
- Кадр голоса — PCM s16le, 16 кГц, моно, 320 сэмплов (640 байт, 20 мс), без заголовка (как у десктопа).
  Сервер пересылает только кадры чётной длины до 640 байт и не больше 48 КБ/с от пользователя (полтора
  реального потока 50 × 640 байт/с, кадр короче 160 байт считается за 160); лишнее молча отбрасывается.
- Получателю, который не успевает забирать данные (в очереди на отправку больше 256 КБ), голос не
  пересылается; при очереди больше 4 МБ сервер закрывает его подключение.
- **Протокол v2:** `{"type":"voice_join","channel_id":N,"proto":2}`. Получатели v2 получают каждый кадр
  с префиксом из 8 байт — `int64 little-endian` id отправителя — и могут микшировать говорящих по отдельности.
  Получатели v1 (старые десктопы) получают кадр без префикса, как раньше. Отправляют все одинаково — чистый PCM.
- **[new] Видео в голосовом канале (браузеры).** Голос по-прежнему идёт PCM через WebSocket; камера и показ экрана —
  прямые WebRTC-соединения между участниками канала (mesh), сервер только пересылает сигналинг.
  - C→S `{"type":"voice_media","screen":bool,"camera":bool}` — что сейчас транслирует участник. Принимается только от
    подключения, владеющего голосом; хранится до выхода из канала (выход, смена канала, закрытие подключения — сброс).
    Если состояние изменилось, всем, кто видит канал, уходит `voice_state`.
  - `voice_state` рассылается по порядку из одного потока; несколько изменений канала подряд могут прийти одной
    рассылкой с итоговым списком.
  - `voice_state` дополнен: у каждого элемента `users[]` есть `"screen": bool` и `"camera": bool`
    (`{"user_id","name","screen","camera"}`). Старые десктопы лишние поля игнорируют; у десктопа они всегда `false`.
  - C→S `{"type":"voice_rtc","to":U,"kind":"screen"|"camera","action":"watch"|"unwatch"|"offer"|"answer"|"ice"|"stop", ...}` —
    пересылается, только если отправитель (с подключения, владеющего голосом) и `to` сейчас в **одном** голосовом канале;
    адресату — только в его голосовое подключение, с проставленным сервером `"from"`. Иначе молча отбрасывается.
    Пересылаются только `type`, `to`, `from`, `kind`, `action` и строковые `sdp` (≤ 32 КБ), `sdpType` (≤ 16),
    `candidate` (≤ 1024), `mid` (≤ 64), `reason` (≤ 64); сообщение с более длинным значением не пересылается.
    Неизвестные `kind`/`action` — отбрасываются.
  - Порядок: зритель шлёт `watch` → транслирующий создаёт отдельный `RTCPeerConnection` (только отправка) на зрителя
    и вид трансляции и шлёт `offer` (`sdp`, `sdpType:"offer"`) → зритель отвечает `answer` → обе стороны шлют `ice`
    (`candidate`, `mid`, `sdpType`: `"offer"` — кандидат транслирующего, `"answer"` — зрителя: двое могут смотреть
    трансляции друг друга одновременно). Веб-клиент кладёт собранные кандидаты прямо в SDP (ждёт до 1,5 с) и
    досылает `ice` только для найденных позже — сигналинг делит лимит частоты со звонками. `unwatch` (от зрителя) и `stop` (от транслирующего) закрывают соединение; `stop` в ответ на
    `watch` с `reason:"full"` — у трансляции уже максимум зрителей (веб-клиент: 8), без `reason` — трансляции нет.
    Прекратив трансляцию, участник шлёт `stop` всем её зрителям и `voice_media` с новым состоянием.

- **[new] Голос через SFU (docs/VOICE-SFU.md).** GET `/rtc/sfu?channel_id=N` → `{"url":"/livekit","room":"voice-N",
  "token":"<JWT LiveKit>","identity":"u<user_id>"}` — вход в комнату канала на LiveKit; те же правила, что у `voice_join`
  (текстовый канал сервера — 400, посторонним — 403, нет канала — 404), лимит как у `voice_join`. SFU не настроен
  (нет `LIVEKIT_API_KEY/SECRET`) — 404, клиент идёт PCM через WebSocket. Состав канала, `voice_state`, `voice_speaking`
  и всё остальное по-прежнему идёт по `/ws`; LiveKit несёт только звук.

## 12. Звонки 1:1
Сигналинг `call_invite / call_accept / call_reject / call_end / call_busy / rtc_offer / rtc_answer / rtc_ice`
пересылается адресату `to` с проставленным `from` (поля — см. `docs/CALLS.md`).
**[new]** Пересылается, только если у собеседников есть общая личка или они друзья. Если адресат не в сети —
отправителю `{"type":"call_unavailable","user_id":U}`.
**[new]** Адресату уходят только `type`, `to`, `from` (ставит сервер), `name` (у `call_invite`, ставит сервер) и строковые
`sdp` (≤ 32 КБ), `sdpType` (≤ 16), `candidate` (≤ 1024), `mid` (≤ 64), `reason` (≤ 16); остальные поля отбрасываются, сообщение с более
длинным значением не пересылается.
**[new]** История звонков: когда звонок заканчивается, сервер кладёт в личку этих двоих сообщение `kind:"call"` от
звонящего (`new_message` обоим): `result:"ok"` + `duration` в секундах — поговорили (`call_end` после `call_accept`);
`"declined"` — адресат отклонил (`call_reject` без `reason:"timeout"`); `"missed"` — не ответили (`call_reject` с
`reason:"timeout"`, `call_end` звонящего до ответа, `call_busy`) или адресата не было в сети (тогда ему ещё уходит push §14).
Личка создаётся, если её не было.
**[new]** GET `/rtc/ice` → `{"ice_servers":[{"urls":["stun:..."]},{"urls":["turn:host:3478?transport=udp","turn:host:3478?transport=tcp"],"username":"<expiry>:<uid>","credential":"<base64 HMAC-SHA1>"}]}` —
TURN с временными учётками coturn `use-auth-secret`, если в конфиге задан секрет; иначе только STUN.

## 14. Push-уведомления (Web Push) **[new]**
Телефон получает уведомления, когда приложение закрыто: RFC 8030/8291/8292, полезная нагрузка шифруется
`aes128gcm`, подпись VAPID (ключи сервер создаёт при первом запуске, таблица `kv`). Нужен libcurl при сборке;
`custom_config.push.subject` / `VICINITY_PUSH_SUBJECT` — контакт в подписи.
- GET `/push/vapid` → `{"key": "<base64url 65 байт>"}`; пустой `key` — сервер не умеет отправлять.
- POST `/push/subscribe` `{"endpoint": "https://...", "keys": {"p256dh", "auth"}, "prefs": {"muted": [channel_id...],
  "servers": {"<server_id>": "all"|"mentions"|"none"}}}` → `{"ok":true}`. Подписка принадлежит браузеру: тот же
  `endpoint` от другого аккаунта переписывается на него. `endpoint` — только https (loopback по http — для тестов).
- DELETE `/push/subscribe` `{"endpoint"}` — снять подписку (выход, выключение в настройках).

Когда отправляется: новое сообщение в канале — участникам **без единого WS-подключения**; личка и беседа — всегда,
канал сервера — по `prefs.servers` (по умолчанию `mentions`: только `@ник`, `@everyone`, `@here`); каналы из `prefs.muted`
пропускаются. Входящий звонок адресату не в сети — сразу, с `Urgency: high`, TTL 60 с.
Полезная нагрузка (JSON): `{"t":"msg"|"call", "title", "body" (≤160 симв.), "icon", "tag", "url", "from"?}`.
Ответ сервиса 404/410 — подписка удаляется.

## 15. Приватность **[new]**
GET/PATCH `/settings/privacy` → `{status, stats, dm, friend_requests}` (хранится в `user_settings.privacy`):
- `status`: `everyone` | `friends` | `nobody` — кому виден статус в сети. Остальным — `offline` везде: в профиле,
  списках друзей и участников, в событии `presence` (сервер шлёт каждому получателю своё значение).
- `stats`: `everyone` | `friends` | `nobody` — кому виден блок `activity` в профиле (§16) целиком; остальным только
  `{level, streak, title, emblem, hidden:true}`.
- `dm`: `everyone` | `friends` — POST `/dms` от не-друга → 403 «принимает сообщения только от друзей» (старые лички живут).
- `friend_requests`: `everyone` | `friends_of_friends` | `nobody` — POST `/friends/request` → 403.
Некорректное значение — 400.

**Правила по элементам с исключениями (как в Telegram) [new].** В тех же GET/PATCH поле `rules`:
`{status, stats, about, banner, wishlist, games, music, connections, all}`, каждое — `{who: everyone|friends|nobody,
hide_from: [id…], show_to: [id…]}` (до 200 id в списке; свой id и мусор отбрасываются). Порядок проверки для
зрителя: `rules.all.hide_from` («скрыть профиль целиком от этих людей», у `all` только `hide_from`) → `hide_from`
элемента → `show_to` элемента → `who`. `rules.status.who` и `rules.stats.who` — то же, что старые поля `status` и
`stats` (меняются вместе). В PATCH можно слать частичные правила: `{rules: {wishlist: {hide_from: [5]}}}`.
В GET `/users/{id}/profile` скрытое не уходит вовсе: `about` — пустые `bio`, `pronouns`, без `statusText` и `links`
в `profile_json`; `banner` — пустой `banner_path`; `wishlist` / `games` (вместе с рекордами `games` Активностей и
любимой игрой) / `music` / `connections` — пустые в `profile_ext`; `stats` — как раньше `activity.hidden`. Список
скрытых элементов — `hidden: ["about", …]`. Аватар не скрывается: он виден в чатах и списках независимо от профиля.

## 16. Активность и награды **[new]**
Опыт: сообщение +2, минута звонка +1 (до 120 за звонок), минута в голосовом канале +1 (до 240 за заход),
партия в Активностях +10, победа +15. Уровень = ⌊√(xp/40)⌋+1. Серия — дни подряд с хоть одним событием (UTC),
обнуляется после пропуска дня. Таблицы `activity`, `awards`.
- GET `/activity/me` → `{activity:{xp, level, level_xp, next_xp, streak, best_streak, msgs, call_min, voice_min, games, wins,
  title, emblem, awards:[{id, kind:"title"|"emblem", name, rarity, desc, earned_at}]}, catalog:[...все награды]}`.
- GET `/activity/leaderboard` → `{users:[{id, username, display_name, avatar_path, xp, level, streak, title, emblem}]}` —
  друзья и я по убыванию опыта.
- POST `/activity/equip` `{title, emblem}` — надеть заработанные (`""` — снять); не заработано → 400.
- WS `{type:"activity", activity:{...}, fresh:[новые награды], level_up:bool}` — пользователю при заметных событиях.
- Титул и эмблема автора — в объекте сообщения (`author_title`, `author_emblem`) и в `GET /users/{id}/profile`
  (`activity`, с учётом приватности §15). Эмблемы — имена иконок клиента: sparkles, flame, crown, gem, mic, swords, calendar.
  Редкость: common / rare / epic / legendary.

## 17. Подарочные коды подписки **[new]**
Код — 12 символов (`XXXX-XXXX-XXXX`, без 0/O/1/I), один раз. Срок подписки — `users.subscription_until`; истёкшие
снимаются раз в час (`Gifts::expire`). Ручной уровень из админ-панели — бессрочный (`until` = null).
- POST `/admin/gifts` `{tier 1..3, days 1..3650, count 1..50, note}` → `{codes:[{code, tier, days}]}`; GET `/admin/gifts` →
  `{gifts:[{code, tier, days, note, created_at, redeemed_by, redeemed_by_name, redeemed_at}]}` (developer only).
- GET `/gifts/{code}` → `{code, tier, name, days, redeemed}`; 404 — нет такого.
- POST `/gifts/redeem` `{code}` → `{tier, name, until, days}`. Уровень поднимается до `tier`; тот же уровень со сроком —
  продлевается от конца срока; выше текущего → 409; уже активирован → 409; формат неверный → 400.
- GET `/subscription` отдаёт ещё `until`. Ссылка `/gift/<код>` открывает в клиенте карточку активации.

## 13. Лимиты
Помимо входа/регистрации/смены пароля — по пользователю: отправка сообщений (10/5 с), загрузки (20/мин),
заявки в друзья (20/мин), поиск (30/мин); превышение — 429. WS `typing` чаще раза в 2 с молча отбрасывается.
**[new]** Остальные WS-сообщения, которые сервер рассылает многим, сверх лимита тоже молча отбрасываются (на пользователя):
`set_presence` — 10/мин, `voice_join` — 20/мин, `voice_query` — 30/мин, `voice_speaking` — 50 подряд, затем 5/с,
`call_invite` — 10/мин, остальной сигналинг звонков (`call_accept/reject/end/busy`, `rtc_*`) **и `voice_rtc`** — 100 подряд,
затем 5/с (общее ведро), **[new]** `voice_media` — 20/мин;
голос — §11. **[new]** Боты: Bot API 30/с и отправка 20/с на бота, нажатия кнопок 10 за 5 с на человека (§21.6);
входящие вебхуки — 30/мин на вебхук (§22).

## 18. Мастерская: темы и фоны сообщества **[new]**

Своя тема (Ultra) и фон-картинка (Standard+) публикуются для всех. Применить тему из мастерской — Standard+
(`settings.appearance.custom_theme = {from: id}`), фон — всем (`background = {from: id}`), см. §0.6.
Таблицы `community_themes` (`kind` theme|background, `image`, `installs`), `community_theme_likes`
(`backend/controllers/ThemesController.cc`).

| Метод | Путь | Описание |
|---|---|---|
| GET | `/themes/community?sort=top\|new&kind=all\|theme\|background` | `{themes:[{id, name, kind, image, installs, colors, angle, base, likes, liked, mine, created_at, author:{id, display_name}}], can_publish, can_publish_background, own, max_own}` — до 100 записей; `top` — по сердечкам и установкам |
| POST | `/themes/community/upload` | multipart-картинка → `{file_url}` (`/uploads/backgrounds/…`) — для своего фона или публикации |
| POST | `/themes/community` | `{name: 2–30 символов, kind: "theme"\|"background", colors: [2–3 × "#rrggbb"] (у фона необязательно), angle, base, image (у фона — из upload)}` → запись. Тема — **Ultra**, фон — **Standard**, иначе 403; больше 10 своих — 409 |
| POST | `/themes/community/{id}/like` | поставить или снять сердечко → `{likes, liked}` |
| DELETE | `/themes/community/{id}` | только автор или разработчик → `{ok}` |

## 19. Главная **[new]**

GET `/home` → главный экран (`backend/controllers/HomeController.cc`, экран `web/src/components/Home.tsx`, адрес `/home`):

```
{ window_hours: 24,
  digest: { text, source: "ai" | "rules" },
  stats: { messages, people, voice_now, friends_online, friends, friend_requests, streak, voice_hours_total, msgs_total },
  channels: [{ channel_id, kind: dm|group|channel, name, server_id?, server_name?, messages, top_author? }],   // до 6, по числу чужих сообщений за сутки
  voice:    [{ channel_id, kind, name, server_id?, server_name?, users: [{id, name}] }],                     // доступные голосовые каналы, где кто-то есть
  suggestions: [{ id, display_name, avatar_path, shared_servers }] }                                         // люди с общих серверов, ещё не друзья, без блокировок
```
Сводка `digest`: при заданном `ANTHROPIC_API_KEY` (deploy/env.example) факты (без id и аватаров) уходят в Claude API
(модель `VICINITY_AI_MODEL`, по умолчанию `claude-opus-5-5`), ответ кэшируется на пользователя: 10 минут, при тех же фактах — час;
ошибка API или `stop_reason: refusal` → шаблонный текст (`source: rules`). Без ключа — всегда шаблон из тех же фактов.
«Стоит внимания» и «Что нового» клиент собирает сам (непрочитанные, упоминания, приглашения, заявки; `web/src/lib/changelog.ts`).

## 20. Мост с Telegram **[new]**

Бот присылает пользователю новые сообщения из Vicinity, а ответ на такое сообщение в Telegram («Ответить»)
уходит обратно в тот же чат Vicinity от его имени (`backend/utils/Telegram.cc`, экран — Настройки → Уведомления).
Включается токеном бота от @BotFather: `VICINITY_TG_BOT_TOKEN` в `deploy/.env` (`custom_config.telegram.token`);
`VICINITY_TG_API` — другой адрес Bot API (мок в e2e). Сервер сам опрашивает Bot API (`getUpdates`, длинный опрос),
вебхук и открытые порты не нужны. Один токен — один процесс: тот же бот в другом проекте даст 409 Conflict.

| Метод | Путь | |
|---|---|---|
| GET | `/telegram` | `{available, bot_username, linked, tg_username?, tg_name?, enabled?, offline_only?, servers?}`; `available` — токен задан и `getMe` прошёл |
| POST | `/telegram/link` | `{code, url, expires_in: 600}`: `url` = `https://t.me/<бот>?start=<code>`, код одноразовый; бот не настроен — 503 |
| PATCH | `/telegram` | `{enabled?: bool, offline_only?: bool, servers?: "all" \| "mentions" \| "none"}` → статус; не привязан — 404, неверное значение — 400 |
| DELETE | `/telegram` | отвязать (бот пишет «Отключено») → статус |

Привязка: пользователь открывает `url`, жмёт «Start», бот получает `/start <code>` и связывает чат с аккаунтом
(чат и аккаунт — один к одному; повторная привязка заменяет прежнюю). WS-событие `telegram_linked {tg_username}`
приходит в открытые вкладки. В Telegram: `/stop` — отвязать.

Пересылка (при каждом новом сообщении, как Web Push): участники канала, кроме автора, с привязкой и `enabled`;
при `offline_only` (по умолчанию) — только те, у кого нет ни одного подключения к `/ws`. Личные сообщения и беседы —
всегда; сообщения серверов — по `servers` (по умолчанию `mentions`: только `@логин`, `@everyone`, `@here`).
Текст — HTML: `<b>Автор</b> · #канал · Сервер`, затем текст (до 3500 символов, экранирован) или `[файл] имя`,
`[изображение]`, `[голосовое сообщение]`, `[пропущенный звонок]`; при `VICINITY_SITE_URL` — кнопка «Открыть в Vicinity».

**Заметки ↔ Telegram.** У каждого пользователя есть чат «Заметки» (личка из одного участника, таблица
`notes_channels`, создаётся при первом GET `/dms`; в списке первым: `{notes: true, display_name: "Заметки",
user_id: <я>}`, остальным недоступен — 403). Сообщение в Заметках уходит владельцу в Telegram всегда, даже когда
он в сети (`<b>Заметки</b>` + текст), если привязка включена. Обычное сообщение боту, без «Ответить», становится
заметкой; ответ на пересланную заметку — тоже. Пришедшее из Telegram обратно в Telegram не отправляется.

Ответ: сообщение в Telegram с `reply_to_message` на сообщение бота → по таблице `telegram_messages` (хранится 30 дней)
находится канал → проверки как у POST `/channels/{id}/messages` (доступ, блокировка, длина, лимит частоты) → новое
сообщение от имени пользователя, рассылка по WS, Web Push и Telegram остальным; боту — реакция 👌 на ответ.
Без «Ответить» текст уходит в Заметки; не текст — «Пока можно отвечать только текстом».


## 21. Боты и Bot API **[new]**

Бот — пользователь с пометкой `is_bot` (`backend/utils/Bots.cc`). Его создаёт обычный пользователь, а программа бота
работает через **Bot API в стиле Telegram** (подмножество): библиотеки для Telegram (aiogram, python-telegram-bot,
grammY, Telegraf) подключаются сменой адреса сервера. Боту можно написать в личку, добавить его на сервер; он видит
команды, упоминания и ответы на свои сообщения, отправляет сообщения с кнопками, получает нажатия.

### 21.1 Управление ботами (для людей, с токеном сессии)

| Метод | Путь | |
|---|---|---|
| GET | `/bots` | `{bots: [бот]}` — мои боты |
| POST | `/bots` | `{username, display_name?}` → **201** `{bot, token}`; токен показывается **один раз** |
| PATCH | `/bots/{id}` | `{display_name?, description? (≤512), short_description? (≤120, одна строка) **[new]**, read_all?: bool, is_public?: bool **[new]**}` → `{bot}` |
| GET | `/bots/directory?q=&limit=&offset=` | **[new]** каталог ботов, видимых вам (§21.9) → `{bots: [элемент каталога], has_more}` |
| GET | `/bots/by-username/{username}` | **[new]** карточка бота (можно с `@`, без учёта регистра); невидимый вам бот — 404 (§21.9) |
| POST | `/bots/{id}/token` | новый токен → `{bot, token}`; старый сразу перестаёт работать (ждущий `getUpdates` получает 401) |
| DELETE | `/bots/{id}` | удалить бота с его сообщениями и очередью → `{status:"deleted"}`; открытым клиентам — WS `message_deleted` (до 1000 последних его сообщений), `server_member_left` и `channel_member_left` (беседы и лички) |
| GET | `/servers/{id}/bots` | только владелец сервера → `{bots: [{id, username, display_name, avatar_path, description}]}` |
| POST | `/servers/{id}/bots` | только владелец: `{username}` (можно с `@`) или `{bot_id}` → **201** `{bot, status:"added"}` (уже на сервере — 200 `already_member`); бот вступает сразу, без приглашения; участникам WS `server_member_joined` |
| DELETE | `/servers/{id}/bots/{bot_id}` | только владелец → `{status:"removed"}`; WS `server_member_left` |
| POST | `/channels/{id}/members` | `{user_id: <бот>}` — бот входит в беседу **сразу** (приглашения он не принимает) → `{status:"added", channel_id}`; уже в беседе — 409; остальным WS `channel_member_joined` |
| GET | `/channels/{id}/commands` | команды ботов-участников канала для подсказок в композере: `{commands: [{bot_id, bot_username, command, description}]}` (кэшировать ~60 с) |
| POST | `/channels/{id}/messages/{mid}/callback` | нажатие кнопки `{data}` → `{ok:true, query_id}`; у эфемерного сообщения `mid` = 0 и `{data, ephemeral_id}` |
| POST | `/bots/{id}/webapp` | **[new]** открыть мини-приложение (§21.8): `{url, channel_id?, message_id? \| ephemeral_id?, theme_params?}` → `{url_with_fragment, init_data, theme_params, signed, bot: {id, username, display_name}}` |
| GET | `/bots/{id}/menu_button?channel_id=` | **[new]** кнопка меню бота для этого чата (§21.8) → `{menu_button: {type: "default"\|"commands"} \| {type: "web_app", text, web_app: {url}}}` |

Объект бота: `{id, username, display_name, avatar_path, description, short_description, is_public, token_hint, read_all,
webhook_url, webhook_error, commands: [{command, description}], servers: [{id, name}], owner_id, created_at}`. `token_hint` — последние 4 символа
токена, сам токен нигде больше не возвращается (в базе — только sha256).

Правила: `username` — 5–32 символа `[a-z0-9_]` (приводится к нижнему регистру, ведущий `@` убирается), оканчивается
на `bot`, свободен среди всех пользователей (занят — 409); не больше **10 ботов** на владельца (400); имя — 1–32 символа.
Бот не входит паролем (вход — 401), у него нет сессий, WS, присутствия, опыта активности и Web Push; заявка в друзья
боту — 400 «Это бот…». Написать боту в личку может любой (POST `/dms` к боту не смотрит настройки приватности),
бот сам лички не создаёт — пишет только в чаты, где он участник. Пометки: `is_bot` в GET `/users/search`,
`/users/{id}/profile` (+ `bot_description`; профиль бота открыт всем), в списке GET `/dms`, в участниках сервера;
`author_bot` в сообщениях (§2).

Нажатие кнопки: доступ к каналу, сообщение этого канала от бота, в его кнопках есть такой `callback_data`
(иначе 400/404), бот всё ещё участник чата (убрали с сервера или из беседы — 400, боту ничего не уходит),
не чаще 10 нажатий за 5 с (429). Бот получает `callback_query`; его `answerCallbackQuery` приходит
**только нажавшему** WS-событием `{"type":"callback_answer","query_id","channel_id","message_id","text"?,"show_alert":bool,"url"?}`.
Клиент показывает `text` (при `show_alert` — заметно, окном), `url` открывает. Ответа может не быть — ждать ~10 с.
Правка или удаление этого сообщения (`message_edited` / `message_deleted`, для эфемерного — новое `ephemeral_message` с тем
же `ephemeral_id`) сразу снимает ожидание с его кнопок, как в Telegram: меню «подменю → Назад» работает и без
`answerCallbackQuery`; ответ, пришедший после правки, всё равно показывается.

### 21.2 Адрес и формат

`https://<сервер>/api/v1/bot<токен>/<метод>` — GET или POST; параметры в query, `application/x-www-form-urlencoded`,
`multipart/form-data` (текстовые поля и файлы, §21.7) или JSON. Поля-объекты (`reply_markup`, `reply_parameters`, `commands`,
`allowed_updates`) можно передать JSON-строкой. Имя метода без учёта регистра. Ответ —
`{"ok":true,"result":…}` или `{"ok":false,"error_code":N,"description":"…"}` (описания ошибок — как в Telegram,
по-английски: `Bad Request: chat not found`, `Bad Request: message is not modified`, …). Неверный токен — 401
`Unauthorized`, неизвестный метод — 404 `Not Found`, лимит — 429 с `parameters.retry_after` (секунды).
Токен — `<id бота>:<секрет>`; nginx не пишет такие запросы ни в access-лог, ни в error-лог (`deploy/nginx.conf`).
Бот перестаёт работать (401), если заблокирован он сам или его владелец (админ, `users.banned`).

aiogram 3:

```python
from aiogram import Bot
from aiogram.client.session.aiohttp import AiohttpSession
from aiogram.client.telegram import TelegramAPIServer

bot = Bot(TOKEN, session=AiohttpSession(api=TelegramAPIServer.from_base("https://<сервер>/api/v1")))
```

python-telegram-bot: `Application.builder().token(TOKEN).base_url("https://<сервер>/api/v1/bot")`.

### 21.3 Объекты

- **User** `{id, is_bot, first_name, username, language_code?}` (`first_name` — отображаемое имя). Отправитель
  сообщения вебхука канала (§22) — не его создатель, а отдельный «бот»: `{id: 9000000000000 + id вебхука, is_bot: true,
  first_name: имя вебхука}` без `username` (так же в `reply_to_message.from`).
- **Chat** `{id, type, title?, first_name?, username?}`: `id` — id канала Vicinity; личка с ботом — `private`
  (`first_name`, `username` собеседника), беседа — `group` (`title`), канал сервера — `supergroup`
  (`title` = `#канал · Сервер`).
- **Message** `{message_id, from, chat, date (unix), text?, entities?, reply_to_message?, reply_markup?, edit_date?, attachment?}`;
  `entities` — `bot_command` в начале текста, `mention` для каждого `@имя` и `url` для голых http/https-адресов
  (`offset`/`length` в единицах UTF-16, как в Telegram); `attachment` (расширение) — `{url, name, size, type}` вложения.
  Текст — разметка Vicinity (§23). **[new]** У сообщения с вложением вместо `text`/`entities` — `caption`/`caption_entities`
  и одно из полей файла (§21.7): `photo: [PhotoSize]`, `document`, `video`, `audio`, `voice` или `animation` (+ `document`).
  `reply_to_message` — исходное сообщение целиком (с файлом и `caption`), но без своего `reply_to_message`.
  У сообщений одного `sendMediaGroup` — общий `media_group_id` (строка из цифр).
- **PhotoSize** `{file_id, file_unique_id, width, height, file_size}` — один размер, оригинал; ширина и высота
  читаются из заголовка файла (PNG, JPEG, GIF, WEBP; у JPEG с EXIF Orientation 5–8 — как показывается, повёрнутыми),
  не удалось — 0.
- **Document** `{file_id, file_unique_id, file_name, mime_type, file_size}`; **Video** и **Animation** — то же +
  `width, height, duration`; **Audio** — + `duration, performer?, title?`; **Voice** `{file_id, file_unique_id, duration,
  mime_type, file_size}`. `width`/`height`/`duration` — те, что бот передал при отправке, иначе 0 (у GIF — из файла).
  `mime_type` — по расширению; у `voice` и `audio` в контейнере webm/mp4 — `audio/webm`, `audio/mp4`.
- **File** `{file_id, file_unique_id, file_size, file_path}`.
- **CallbackQuery** `{id, from, message, chat_instance, data}`; у эфемерного сообщения `message.message_id` = 0
  и `message.ephemeral_id`.
- **Update** `{update_id, message? | edited_message? | callback_query?}`.

### 21.4 Методы

| Метод | Параметры | Результат |
|---|---|---|
| `getMe` | — | User + `can_join_groups`, `can_read_all_group_messages` (= `read_all`), `supports_inline_queries: false` |
| `getUpdates` | `offset`, `limit` ≤100, `timeout` ≤50, `allowed_updates` | [Update]; длинный опрос: ответ сразу, как придёт обновление, иначе `[]` по тайм-ауту. `offset` подтверждает и удаляет обновления с меньшим `update_id`; отрицательный `offset` = −N, как в Telegram, — только N последних, более ранние забываются (`offset=-1` — пропустить накопленное). Новый вызов того же бота завершает предыдущий пустым ответом. При вебхуке — 409 |
| `setWebhook` | `url`, `secret_token?` (до 256 `[A-Za-z0-9_-]`), `drop_pending_updates?`, `allowed_updates?` | `true`; пустой `url` — снять вебхук. Накопленные обновления уходят на новый адрес по порядку. Сервер без libcurl — 400 `webhooks are not supported` |
| `deleteWebhook` | `drop_pending_updates?` | `true` |
| `getWebhookInfo` | — | `{url, has_custom_certificate:false, pending_update_count, last_error_date?, last_error_message?, max_connections}` |
| `sendMessage` | `chat_id`, `text`, `parse_mode?`, `reply_markup?`, `reply_to_message_id?` \| `reply_parameters.message_id?`, `allow_sending_without_reply?`, `disable_notification?` (игнорируется) | Message; WS `new_message` всем в чате |
| `editMessageText` | `chat_id`, `message_id`, `text`, `parse_mode?`, `reply_markup?` | Message; без `reply_markup` кнопки убираются (как в Telegram); ничего не изменилось — 400 `message is not modified` |
| `editMessageReplyMarkup` | `chat_id`, `message_id`, `reply_markup?` | Message; WS `message_edited` с `reply_markup` |
| `sendPhoto` / `sendDocument` / `sendVideo` / `sendAudio` / `sendAnimation` / `sendVoice` **[new]** | `chat_id`, файл в поле `photo` / `document` / `video` / `audio` / `animation` / `voice` (§21.7), `caption?`, `parse_mode?`, `reply_markup?`, `reply_to_message_id?` \| `reply_parameters?`, `duration?`, `width?`, `height?`, `performer?`, `title?`, `disable_notification?` (игнорируется) | Message с файлом; подпись становится текстом сообщения (0–4096 символов после `parse_mode`) |
| `sendMediaGroup` **[new]** | `chat_id`, `media: [InputMediaPhoto \| InputMediaVideo \| InputMediaDocument \| InputMediaAudio]` (2–10; документы и аудио — только с такими же), `reply_to_message_id?` \| `reply_parameters?` | [Message] — сообщения подряд, подпись только у элементов с `caption`; `reply_markup` — 400 (как в Telegram) |
| `editMessageCaption` **[new]** | `chat_id`, `message_id`, `caption?`, `parse_mode?`, `reply_markup?` | Message; пустая подпись убирает её; у сообщения без файла — 400 `there is no caption in the message to edit`, а `editMessageText` у сообщения с файлом — 400 `there is no text in the message to edit`. WS `message_edited` |
| `editMessageMedia` | — | 400 (не поддерживается: удалите сообщение и отправьте новое) |
| `getFile` **[new]** | `file_id` | File; скачивание — §21.7 |
| `deleteMessage` | `chat_id`, `message_id` | `true`; только свои сообщения бота; WS `message_deleted` |
| `answerCallbackQuery` | `callback_query_id`, `text?` (≤200), `show_alert?`, `url?` (http/https) | `true`; повторный ответ или старше 15 минут — 400 `query is too old or already answered`; бота убрали из чата — 403 `bot is not a member of the chat` |
| `setMyCommands` / `getMyCommands` / `deleteMyCommands` | `commands: [{command (1–32, a-z0-9_), description (1–256)}]` (≤100; `scope`, `language_code` игнорируются) | `true` / [BotCommand] / `true` |
| `setMyDescription` / `getMyDescription` **[new]** | `description?` (0–512, можно с переводами строк), `language_code?` (игнорируется) | `true` / `{description}`; пустое — убрать. Показывается в пустой личке («Что умеет этот бот?») и на странице бота (§21.9); длиннее — 400 `description is too long (at most 512 characters)` |
| `setMyShortDescription` / `getMyShortDescription` **[new]** | `short_description?` (0–120, одна строка), `language_code?` (игнорируется) | `true` / `{short_description}`; текст карточки в каталоге |
| `setMyName` / `getMyName` **[new]** | `name?` (1–32; пустое — оставить как есть), `language_code?` (игнорируется) | `true` / `{name}`; это `display_name` бота, людям — WS `user_updated` |
| `getChat` | `chat_id` | Chat (+ поля ChatFullInfo, которые требуют библиотеки) |
| `sendChatAction` | `chat_id`, `action` | `true`; участникам — обычное WS `typing` (§3) |
| `setChatMenuButton` **[new]** | `chat_id?`, `menu_button?` (`{type: "web_app", text 1–64, web_app: {url}}`, `{type: "commands"}`, `{type: "default"}`) | `true`; без `chat_id` — для всех чатов бота, с `chat_id` — для одного (бот — участник); без `menu_button` или `default` — сброс к общей. Адрес — как у кнопки `web_app` (§21.8) и не на хосте самого Vicinity, иначе 400 `BUTTON_URL_INVALID`. После изменения — WS `{"type":"bot_menu_button_changed","bot_id","channel_id"}` участникам чата (`channel_id` 0 — всем, у кого личка с ботом): шапка лички перечитывает кнопку сразу |
| `getChatMenuButton` **[new]** | `chat_id?` | MenuButton: своя кнопка чата, иначе общая, иначе `{type: "default"}` |
| `answerWebAppQuery` **[new]** | `web_app_query_id` (`query_id` из initData), `result: InlineQueryResultArticle` (`input_message_content.message_text`, `parse_mode?`; `reply_markup?`) | `{}` (SentWebAppMessage). **Отличие от Telegram:** сообщение приходит от самого бота в чат, откуда открыли мини-приложение (от имени человека Vicinity не пишет); один ответ на `query_id`, не позже часа, иначе 400 `QUERY_ID_INVALID`; открыли не из чата или бота убрали — 400 `chat not found` |
| `sendEphemeralMessage` | `chat_id`, `user_id`, `text`, `parse_mode?`, `reply_markup?` | расширение Vicinity: сообщение видит только `user_id` (участник чата, иначе 400), в базе не хранится. Ответ — Message с `message_id: 0` и `ephemeral_id` |
| `logOut`, `close` | — | `true` (ничего не делают) |

`chat_id` — только число (id канала); бот должен быть участником (иначе 400 `chat not found` / 403
`bot is not a member of the chat`), в личке с заблокировавшим — 403.

**Эфемерное сообщение** приходит адресату WS-событием `{"type":"ephemeral_message","channel_id":N,"message":{…объект
сообщения §2 от бота…, "id":0, "ephemeral":true, "ephemeral_id":"<hex>", "created_at"}}`. Клиент показывает его
внизу ленты с подписью «Видно только вам», оно не влияет на непрочитанное и уведомления; его кнопки живут 15 минут.

**parse_mode.** `HTML` — теги `b/strong`, `i/em`, `u/ins`, `s/strike/del`, `code`, `pre` (+`<code class="language-x">`),
`a href` (http/https → `[текст](адрес)`, прочие схемы вроде `tg://user` — только текст), `blockquote`,
`tg-spoiler`/`span class="tg-spoiler"…</span>` → разметка Vicinity; сущности `&lt; &gt; &amp; &quot;` и числовые
раскодируются. Обычный текст буквальный, как в Telegram: символы разметки Vicinity (`\ * _ ~ \` | [ ] <`, а в начале
строки `#`, `>`, `-` и `1.`) экранируются `\`, так что `html.quote(текст пользователя)` не станет заголовком, ссылкой
или меткой времени. Голые адреса и `@имена` остаются как есть (без `\` внутри).
`MarkdownV2`/`Markdown` — `*жирный*` → `**`, `_курсив_` → `*`, `__подчёркнутый__`, `~зачёркнутый~` → `~~`,
`||спойлер||`, код как есть, `>цитата`, экранирующие `\` убираются. `[текст](адрес)`: адрес берётся как есть (снимаются
только `\)` и `\\`), не http/https (`tg://user?id=…` из `mention_markdown_v2`) — остаётся один текст. В голых адресах
и `@имена` экранирование снимается (`https://my\-site\.com` → `https://my-site.com`). Без `parse_mode` текст идёт как
есть (разметка Vicinity, §23). Текст после преобразования — 1–4096 символов.

**reply_markup.** Поддерживается только `inline_keyboard` (`keyboard`, `remove_keyboard`, `force_reply` молча
игнорируются). Кнопка: `text` (1–64) и ровно одно из `callback_data` (1–64 байта), `url` (http/https, ≤512),
`copy_text: {text ≤256}`, `web_app: {url https}` (мини-приложение в панели Vicinity, §21.8). Не больше 10 рядов, 8 кнопок в ряду,
50 всего; нарушение — 400 с понятным `description`.

### 21.5 Какие обновления получает бот

- **Личка с ботом** — каждое сообщение человека (`message`) и его правка (`edited_message`).
- **Беседа и канал сервера** — команды (`/cmd` или `/cmd@имя_бота`; `/cmd@другой_bot` — нет), упоминание
  `@имя_бота` (без учёта регистра), ответ на сообщение бота; с `read_all` — все сообщения.
- Нажатие кнопки сообщения бота — `callback_query`.
- Сообщения самого бота и других ботов не доставляются; сообщения вебхуков (§22) — по тем же правилам
  (отправитель — отдельный `from`, §21.3).
- `allowed_updates` из `getUpdates` или `setWebhook` запоминается у бота (`bots.allowed_updates`, переживает
  перезапуск) и отсекает ненужные типы у обновлений, созданных после вызова; уже накопленные не удаляются.
  Пустой список — все типы.

Если задан вебхук — сервер POST-ит JSON Update на адрес (заголовок `X-Telegram-Bot-Api-Secret-Token`, если задан
секрет) **по порядку `update_id`, по одному запросу в полёте на бота**; тайм-аут 10 с, тело ответа не читается
дальше 16 КБ (нужен только код). Ответ 2xx — обновление доставлено и удаляется из очереди, `webhook_error` сбрасывается.
Иначе ошибка видна в `getWebhookInfo` и в `webhook_error` бота, а доставка повторяется с самого старого обновления
через 5, 10, 20, 40, затем каждые 60 с, пока вебхук установлен (очередь живёт сутки). После `setWebhook`/`deleteWebhook`
следующие обновления идут уже по новому адресу (или ждут `getUpdates`). Без вебхука — очередь для `getUpdates`:
хранится сутки и не больше 1000 обновлений на бота.
Адрес вебхука — только `https://` на публичный адрес; `http://` и частные/локальные адреса (127.0.0.1, 10.x, 192.168.x,
localhost, …) — только при `VICINITY_BOTS_ALLOW_PRIVATE_WEBHOOKS=1` (`custom_config.bots.allow_private_webhooks`,
для разработки и e2e). Без этого флага соединение с частным адресом не открывается и тогда, когда публичное имя
хоста разрешилось в него уже после `setWebhook`. Эфемерные сообщения для нажатий хранятся в памяти 15 минут, не больше
500 и 4 МБ на бота (вытесняются самые старые).

### 21.6 Лимиты

Bot API — 30 запросов в секунду на бота; отправка и правка сообщений (`sendMessage`, `send<файл>`, `edit*`,
`sendEphemeralMessage`; `sendMediaGroup` — по одному на элемент) — 20 в секунду; `sendChatAction` — раз в 2 с (лишние
вызовы молча принимаются). Превышение — 429 `retry_after: 1`. Запросы со скачиванием по ссылкам (§21.7) — не больше 8
одновременно на сервер и 2 на бота, сверх — 429. Новые файлы (multipart и ссылки, не `file_id`) — 20 в минуту на бота,
как загрузки людей; байты новых файлов всех ботов одного владельца — 1 ГБ в час, сверх — 429 `retry_after: 60`.
Размер файла — по подписке владельца бота, как у его собственных вложений (`Tiers`: 15 / 25 / 50 МБ, Ultra — тоже 50):
часть multipart — до этого лимита, все скачивания одного запроса вместе — до 20 МБ и не больше его же.

### 21.7 Картинки и файлы **[new]**

Файл в `sendPhoto` и др. (и `media` в элементах `sendMediaGroup`) передаётся одним из трёх способов:
1. **multipart/form-data**: частью с именем поля (`curl -F photo=@кадр.png`) или строкой `attach://<имя>` со ссылкой на
   часть `<имя>` — так шлёт aiogram (`FSInputFile`, `BufferedInputFile`). Размер — по подписке владельца бота (§21.6),
   больше — 400 `file is too big`. Одна и та же часть в нескольких элементах альбома сохраняется один раз.
2. **file_id**, который вернул этот сервер (в `photo`, `document`, … или `getFile`). Новое сообщение получает свою копию
   под новым именем (жёсткая ссылка: место на диске не тратится), поэтому удаление любого сообщения — автором,
   владельцем сервера или вместе с ботом, каналом, аккаунтом — отзывает его ссылку `/uploads/…`, а копии живут до удаления
   своих сообщений. `file_unique_id` у копий общий; `file_id` у копии свой. Файл исходного сообщения удалили, пока шла
   отправка, — 400 `wrong file identifier/HTTP URL specified`.
3. **http(s)-ссылка**: сервер скачивает файл сам (libcurl, до 3 перенаправлений, 20 с на файл и 40 с на все ссылки
   запроса — дольше 400 `failed to get HTTP URL content`, и ни одно сообщение не отправляется; размер — §21.6).
   Одна и та же ссылка в альбоме скачивается один раз. Частные и локальные
   адреса (127.0.0.1, 10.x, 169.254.x, localhost, …) — как у вебхуков (§21.5) только с `allow_private_webhooks`; проверяется
   адрес каждого соединения, так что перенаправление или DNS-имя на частный адрес не помогают. Имя файла — из пути
   ссылки, без расширения — по `Content-Type`. Ошибка скачивания — 400 `failed to get HTTP URL content`, больше лимита —
   400 `file is too big`. Сервер без libcurl — 400.

Файл сохраняется так же, как вложение человека (§2): картинка (по сигнатуре: PNG, JPEG, GIF, WEBP) — в
`/uploads/attachments/`, прочее — в `/uploads/files/`, запрещённые типы (html, svg, js, exe, …) — 400 `file type is not
allowed`. Сообщение выглядит в клиентах как обычное вложение: картинка в ленте с лайтбоксом и меню, видео и звук с
проигрывателем, файл карточкой; `sendVoice` — голосовое сообщение (`kind: "voice"`, `meta.duration` из `duration`).
`sendPhoto` с не-картинкой — 400 `IMAGE_PROCESS_FAILED`; `sendVideo`/`sendAudio` с картинкой — 400; `sendVoice` —
только аудиофайл (ogg, opus, mp3, m4a, … — по имени или по содержимому). Имя без расширения (aiogram `URLInputFile`
шлёт случайное) получает расширение по содержимому: ogg, mp3, aac, m4a, mp4, mov, webm, mkv, wav, flac, pdf (так же
и у вложений людей — в URL, имя человека не меняется). Вид, которым бот отправил файл, хранится в `meta.media` и возвращается тем
же полем Message. У файлов людей: картинка — `photo` (GIF — `animation` + `document`), mp4/mov/mkv — `video`
(webm — `document`: это бывает и запись звука),
mp3/m4a/ogg/wav/flac — `audio`, голосовое — `voice`, остальное — `document`. Подпись человека — `caption`.

**file_id** — `vca_<имя файла>` (картинка) или `vcf_<имя файла>` (файл); имя — 128 случайных бит, так что подобрать его
нельзя, а без прав он ничего не даёт: бот может использовать (`getFile`, повторная отправка, скачивание) только файл,
который он сам отправил, или вложение сообщения в чате, где он участник; иначе 400 `invalid file_id` /
`wrong file identifier/HTTP URL specified`. `file_unique_id` — `vu` + 20 hex, общий для всех ботов и для копий одного
файла. Удаление бота, канала, сервера или аккаунта удаляет и файлы их сообщений.

**Скачивание:** `GET /api/v1/file/bot<токен>/<file_path>` (`file_path` из `getFile`: `attachments/<имя>` или
`files/<имя>`) — ровно то, что строит aiogram из `TelegramAPIServer.from_base(".../api/v1")`, так что
`bot.download_file(file.file_path, …)` и `bot.download(file_id)` работают без изменений. Ответ — байты файла:
картинка со своим `Content-Type`, остальное — `application/octet-stream`, `Content-Disposition: attachment` с исходным
именем, `nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Cache-Control: private, no-store`.
Неверный токен — 401, нет файла или нет права — 404, `..` и прочие пути вне каталога вложений не проходят маршрут.
nginx не пишет эти адреса в логи (токен в пути).

### 21.8 Мини-приложения (web_app) **[new]**

Кнопка `web_app` под сообщением бота и кнопка меню бота (`setChatMenuButton`, в шапке лички с ботом — «Открыть
мини-приложение: <text>») открывают страницу бота **внутри Vicinity**: окно ~420×720 справа внизу (на телефоне — на весь
экран, модально: остальное приложение `inert`, кроме входящего звонка, тостов и уведомлений; баннеры уведомлений, пока оно
открыто, не показываются — только звук) с шапкой (имя бота, «Мини-приложение · <хост>», «Обновить», «Открыть в браузере», «Закрыть») и
`<iframe sandbox="allow-scripts allow-forms allow-same-origin allow-modals">`. `allow-same-origin` относится
к origin самого мини-приложения: к странице Vicinity (другой origin) у него доступа нет, токен сессии ему не передаётся.
`allow-popups` нет: `window.open` из мини-приложения не работает (ссылки — через `web_app_open_link`, с лимитом), а
ПК-приложение вдобавок открывает окна из любого фрейма не чаще 3 подряд и дальше раза в секунду.
Адрес на хосте самого Vicinity (с любым портом и схемой) не открывается: сервер — 400 и в `/bots/{id}/webapp`, и в
`setChatMenuButton`; клиент — только «Открыть в браузере»; страница, редиректом попавшая на origin Vicinity, сразу
убирается из окна. Адрес — только `https://` до 512 символов на публичный хост; `http://` и частные адреса — только с
`allow_private_webhooks` (разработка, e2e). Хост сервер сверяет так, как его разберёт браузер (WHATWG URL), и записи,
которые браузер понял бы иначе, отклоняет всегда (400 `BUTTON_URL_INVALID`): `\` в адресе, `%`-коды и не-ASCII в хосте
(IDN — только punycode `xn--`), IPv4 не в виде `a.b.c.d` (`127.1`, `0x7f000001`, `2130706433`). Имя, которое DNS
разрешает в частный адрес, сервер не ловит: проверка — по записи адреса. Prod CSP (`deploy/nginx.conf`): `frame-src 'self' https:`.

**Совместимость с `telegram-web-app.js`.** Клиент вызывает `POST /bots/{id}/webapp` и грузит `url_with_fragment` — адрес
бота с фрагментом `#tgWebAppData=<initData, urlencoded>&tgWebAppVersion=7.10&tgWebAppPlatform=web&tgWebAppThemeParams=<JSON>`
(у адреса со своим фрагментом: `#/путь` → `#/путь?tgWebAppData=…`, `#a=b` → `#a=b&tgWebAppData=…`). Официальный скрипт
Telegram работает без изменений: события — `postMessage` JSON-строкой `{eventType, eventData}`. Клиент принимает только
сообщения с `event.source === iframe.contentWindow` (origin не сверяется с адресом кнопки: страница могла уйти
редиректом, например `example.com` → `www.example.com`; сообщения с origin `null` и с origin Vicinity отбрасываются) и
отвечает `iframe.contentWindow.postMessage(…, <origin, с которого iframe написал последним>)`; до первого сообщения — на
origin адреса кнопки. Не больше 60 событий в секунду.

| Событие мини-приложения | Что делает Vicinity |
|---|---|
| `web_app_ready` | убирает индикатор загрузки |
| `web_app_expand`, `web_app_request_viewport` | → `viewport_changed {height, width, is_expanded: true, is_state_stable: true}` (и при каждом изменении размера окна) |
| `web_app_request_theme` | → `theme_changed {theme_params}`; при смене оформления Vicinity — сам |
| `web_app_setup_main_button`, `web_app_setup_secondary_button` | кнопки внизу окна: `text`, `color`/`text_color` (#rrggbb), `is_visible`, `is_active`, `is_progress_visible`; нажатие → `main_button_pressed` / `secondary_button_pressed` |
| `web_app_setup_back_button` | «Назад» в шапке → `back_button_pressed`; `web_app_setup_settings_button` — кнопка настроек → `settings_button_pressed` |
| `web_app_setup_closing_behavior` | `need_confirmation` — закрытие из шапки или Esc спрашивает «Закрыть мини-приложение?» |
| `web_app_open_popup` | окно Vicinity: `title` ≤64, `message` 1–256, `buttons` 1–3 (`default`, `ok`, `close`, `cancel`, `destructive`) → `popup_closed {button_id}`; закрыли крестиком или Esc — `popup_closed {}`. Одно окно за раз и не больше 3 за 10 с; лишний или неверный попап не
показывается, но сразу получает `popup_closed {}` (иначе `telegram-web-app.js` считал бы его открытым и отказывал в следующих) |
| `web_app_open_link` | только http/https, новая вкладка (ПК-приложение — системный браузер); браузер не дал открыть — окно «Открыть <хост>»; не чаще раза в секунду |
| `web_app_set_header_color` (`color` или `color_key`), `web_app_set_background_color`, `web_app_set_bottom_bar_color` | цвет шапки / фона под iframe / полосы кнопок; только #rrggbb. Текст шапки — цветом текста или фона темы, что контрастнее,
и пересчитывается при смене темы Vicinity (`color_key` — тоже); цвет, на котором ни тот, ни другой не дают 4.5:1, не применяется |
| `web_app_read_text_from_clipboard` | → `clipboard_text_received {req_id}` без данных (буфер обмена не отдаём) |
| `web_app_request_safe_area`, `web_app_request_content_safe_area` | → `safe_area_changed` / `content_safe_area_changed` с нулями |
| `web_app_request_phone`, `web_app_request_write_access`, `web_app_open_invoice`, `web_app_open_scan_qr_popup`, `web_app_request_fullscreen`, `web_app_biometry_get_info`, `web_app_check_home_screen`, `web_app_invoke_custom_method` | честный отказ (`cancelled`, `failed`, `UNSUPPORTED`, `available: false`), чтобы приложение не ждало ответа |
| `web_app_close` | закрывает окно без подтверждения |
| прочее (`web_app_data_send`, `web_app_open_tg_link`, `web_app_trigger_haptic_feedback`, …) | игнорируется |

**theme_params** — токены текущей темы в `#rrggbb` (полупрозрачные и `color-mix` сведены поверх `bg-ground`):
`bg_color` ← `bg-panel`, `secondary_bg_color` ← `bg-ground`, `section_bg_color`/`header_bg_color`/`bottom_bar_bg_color` ←
`bg-raised`, `text_color` ← `text`, `subtitle_text_color` ← `text-2`, `hint_color` ← `text-3`,
`link_color`/`accent_text_color`/`section_header_text_color` ← `link`, `button_color` ← `accent`, `button_text_color` ←
`on-accent`, `destructive_text_color` ← `danger-text`, `section_separator_color` ← `border`. Сервер пропускает только эти
ключи со значениями `#rrggbb`.

**POST `/bots/{id}/webapp`** `{url, channel_id?, message_id? | ephemeral_id?, theme_params?}`: с `message_id`
(`ephemeral_id`) — в кнопках этого сообщения бота в канале `channel_id` есть `web_app` ровно с этим `url`, иначе —
`url` совпадает с кнопкой меню бота для `channel_id` (или общей). Доступ к каналу (403/404), бот — участник (иначе 400),
не чаще 10 открытий и нажатий за 5 с (429). Ответ `signed: false` — у бота ещё нет ключа подписи (см. ниже): initData
без `hash`, клиент предупреждает «Бот ещё не активировал мини-приложения».

**initData** (как у Telegram, `aiogram.utils.web_app.safe_parse_webapp_init_data(token, init_data)` проходит):
`query_id` (32 hex, для `answerWebAppQuery`), `user` — JSON `{id, first_name, username, language_code: "ru",
allows_write_to_pm: true}`, `auth_date`, при открытии из чата — `chat_type` (`sender` — личка с самим ботом, `group`,
`supergroup` — канал сервера) и `chat_instance` (id канала), `hash`. `hash = hex(HMAC_SHA256(key = secret_key,
data_check_string))`, `secret_key = HMAC_SHA256(key = "WebAppData", msg = <токен бота>)`, `data_check_string` — пары
`k=v` (раскодированные) без `hash`, по алфавиту, через `\n`. Проверка на стороне бота:

```python
from aiogram.utils.web_app import safe_parse_webapp_init_data
data = safe_parse_webapp_init_data(TOKEN, init_data)   # ValueError, если подпись не сходится
```

Токен хранится только хэшем, поэтому сервер держит отдельно `bots.webapp_key` = `secret_key` (hex): он ставится при
создании бота и перевыпуске токена (старые initData после перевыпуска не проходят), а у ботов, созданных раньше, —
при первом успешном вызове Bot API (любой метод, видно открытый токен). Ключ даёт только подпись initData, вызывать
Bot API им нельзя.

### 21.9 Каталог ботов и кнопка «Начать» **[new]**

**Кто какого бота видит.** Бот виден пользователю, если выполнено хоть одно: владелец включил «Показывать в каталоге»
(`is_public`, по умолчанию выключено; PATCH `/bots/{id}`), это ваш бот, бот состоит на сервере, где состоите и вы,
у вас с ботом есть личка или общая беседа. Бот, заблокированный админом, или бот заблокированного владельца не виден
никому: ни в каталоге, ни в профиле, и личку с ним не открыть (404). Публичного бота можно открыть в личке и по одному
`user_id` (POST `/dms`), остальных — как раньше, по полному `username` (§7); настройки приватности людей боту не мешают,
дружба не нужна. Те же правила видимости действуют для профиля бота (GET `/users/{id}/profile`: невидимый бот — 404, как
несуществующий пользователь; с `?username=<полный ник>` — 200, как личка по нику), для добавления бота на сервер (POST `/servers/{id}/bots` по `bot_id` или `username`) и в
беседу (POST `/channels/{id}/members`): чужого приватного бота, которого вы не видите, по одному id не добавить — 404.
С полным `username` (на сервер — поле `username`, в беседу — `{user_id, username}`) можно, как открыть личку (§7).
Бот, заблокированный админом, или бот заблокированного владельца не добавить никак.

GET `/bots/directory?q=&limit=&offset=` → `{bots, has_more}`. Порядок: ваши, с ваших серверов, с личкой, остальные
публичные; внутри — по имени. `q` (до 64 символов, иначе 400) ищет без учёта регистра (латиница и кириллица) по имени,
`@username` и описаниям; поиск с `q` — не чаще 30 раз в минуту (как другие поиски, 429), список без `q` — не чаще 60 раз
в минуту. `limit` 1–100 (50), `offset` ≥ 0; ограничения на общее число ботов нет — `has_more` честный.
Элемент: `{id, username, display_name, avatar_path, short_description, is_public, mine, servers: [{id, name}] (общие с вами),
has_dm, dm_channel_id (0 — нет)}`; `short_description` — короткое описание, а если его нет — первая строка `description`
(до 120 символов).

GET `/bots/by-username/{username}` → `{bot}`: элемент каталога (здесь `short_description` — как задано, без подстановки)
+ `description`, `commands` (как `getMyCommands`), `owner: {id, username, display_name} | null` (только тем, кому виден
профиль владельца: он сам, друзья, общий чат или сервер), `dm_started` (вы уже писали боту в личку или нажимали его
кнопку там; отметка постоянная — не пропадает, если сообщение удалят), `blocked` (вы заблокировали бота — сам бот
никого не блокирует), `menu_button` (как `getChatMenuButton` для лички, иначе общая).
Невидимый вам, несуществующий или заблокированный бот — 404 `Бот не найден`.

**Клиент.** Раздел «Боты» в рейке и в списке личных сообщений (на телефоне — в меню навигации): адрес `/bots`, страница
бота — `/bots/<username>`. На странице: описание, команды, владелец, «Написать» (открывает личку), «Добавить на сервер»
(серверы, где вы владелец, — POST `/servers/{id}/bots`), «Поделиться» (копирует ссылку `/bots/<username>`).
В личке с ботом, где вы ещё не писали (`dm_started: false` и в ленте нет ваших сообщений), над лентой — карточка бота
(«Что умеет этот бот?», команды), а вместо поля ввода — кнопка «Начать»: она отправляет обычное сообщение `/start`
(бот получает `message` с сущностью `bot_command`, §21.5). Ссылка `/bots/<username>?start=<payload>`
(`payload` — `[A-Za-z0-9_-]{1,64}`, иначе не учитывается) запоминает параметр до перезагрузки, и «Начать» отправляет
`/start <payload>`, как глубокая ссылка Telegram; с таким параметром «Начать» появляется и в уже начатом диалоге.
«Написать своё сообщение» открывает обычное поле ввода сразу. Пока карточка бота грузится, вместо поля ввода — пустая
заглушка той же высоты (без мигания поля ввода и надписи «пусто»).
ПК-приложение и Android открывают `/bots/…` (и `vicinity://bots/…`) в приложении и передают только параметр `start`.

## 22. Входящие вебхуки каналов **[new]**

Адрес, по которому внешний сервис (CI, мониторинг, форма) пишет в текстовый канал сервера — формат совместим
с Discord (`content`, `username`, `embeds`) и Slack (`text`). Управляет только владелец сервера.

| Метод | Путь | |
|---|---|---|
| GET | `/servers/{id}/webhooks` | `{webhooks: [{id, channel_id, channel_name, name, created_by, created_at}]}` |
| POST | `/servers/{id}/webhooks` | `{channel_id, name (1–32)}` → **201** `{webhook, url: "/api/v1/webhooks/<id>/<секрет>"}`; `url` показывается **один раз** (в базе — sha256 секрета). Канал не этого сервера — 404, голосовой — 400, больше 25 вебхуков на сервер — 400 |
| DELETE | `/servers/{id}/webhooks/{wid}` | `{status:"deleted"}`; адрес сразу перестаёт работать |
| POST | `/webhooks/{id}/{секрет}` | **без** токена сессии. JSON `{content \| text, username?, embeds?, reply_markup?}` → **204**; `?wait=true` → 200 и объект сообщения (§2) |

Сообщение: автор — создатель вебхука (`author_id`), но показывается как `author_name` = `username` из запроса
(≤32, иначе имя вебхука) с `webhook: {id, name}` и пометкой «ВЕБХУК». `embeds` (если нет `content`/`text`) →
`**заголовок**` (ссылкой при `url`) и описание. `reply_markup` — только кнопки `url` и `copy_text`. Текст — 1–4096
символов (400), неверный id или секрет — 401, не больше 30 сообщений в минуту на вебхук (429 + `Retry-After`).
Сообщения вебхука рассылаются как обычные (`new_message`), без Web Push, и доставляются ботам канала по правилам §21.5.
Для создателя они **не свои**: считаются в непрочитанном и упоминаниях (§4), в сводке «Главной» (§19), уходят ему
в Telegram (§20; в Telegram и в цитатах ответа имя вебхука помечено «(вебхук)» / «ВЕБХУК»). Вебхук работает, пока его
создатель владеет сервером и не заблокирован на сайте, иначе POST → 403.

## 23. Разметка сообщений **[new]**

Текст сообщений (`text`, §2) — разметка в духе Discord. Сервер хранит текст как есть; разбирает его клиент
(`web/src/lib/markdown.ts`, отрисовка `components/Markdown.tsx`). HTML не интерпретируется. Экранирование — `\` перед
`\ * _ ~ \` | > @ : # - [ ] < .`.

| Синтаксис | Результат |
|---|---|
| `**жирный**`, `*курсив*` / `_курсив_` (только целыми словами), `__подчёркнутый__`, `~~зачёркнутый~~`, `\|\|спойлер\|\|` | выделения, можно вкладывать (до 6 уровней) |
| `` `код` ``, ```` ```язык\nблок``` ```` | код, блок кода |
| `> цитата`, `>>> цитата до конца` | цитата (строки с `> `) |
| `# `, `## `, `### ` в начале строки | заголовки трёх уровней |
| `- пункт`, `* пункт`, `1. пункт` в начале строки | списки (пункт — одна строка); внутри незакрытого `**`, `__`, `\|\|`, `~~` или `` ` `` строка остаётся текстом |
| `https://…` | ссылка (только http/https; хвостовая пунктуация отрезается) |
| `[подпись](https://адрес)` | маскированная ссылка: подпись в одну строку, адрес только http/https, скобки в адресе парами. Если в подписи есть любое доменное имя, отличное от настоящего (`[paypal.com](https://evil.example)`, с точкой, `!` или невидимыми символами в конце — тоже), рядом показывается настоящий домен «(evil.example)» |
| `@логин` | упоминание (подсветка, если такой пользователь известен; считается в «упоминаниях» §4) |
| `<t:UNIX>`, `<t:UNIX:стиль>` | время в часовом поясе читателя, ru-RU: `t` 14:30, `T` 14:30:05, `d` 05.11.2026, `D` 5 ноября 2026 г., `f` (по умолчанию) 5 ноября 2026 г. в 14:30, `F` с днём недели, `R` «через 5 минут» / «3 дня назад» |

Боты получают текст в этой разметке; `parse_mode` Bot API переводится в неё (§21.4). HTML `<pre><code class="language-cpp">`
становится ```` ```cpp ````: тег — первое слово класса после `language-`, до 20 символов `A-Za-z0-9_+#.-`.

**Блоки кода: подсветка синтаксиса** **[new]**. Тег после ```` ``` ```` (без учёта регистра) выбирает язык; в шапке блока —
его имя, а не сырой тег (`py` → «Python», исходный тег — в подсказке). Подсветка — highlight.js (ядро и языки ниже), чанк
грузится лениво при первом блоке с известным языком; цвета — токены `--code-*` темы (`design/tokens.json`), без тем hljs.
Неизвестный тег — подпись как есть, без подсветки; блок без тега — без подписи и без подсветки (язык не угадывается).

| Язык (подпись) | Теги |
|---|---|
| C | `c` |
| C++ | `cpp`, `c++`, `cc`, `cxx`, `h`, `hpp`, `hh`, `hxx` |
| C# | `csharp`, `cs`, `c#` |
| Java / Kotlin | `java` / `kotlin`, `kt`, `kts` |
| Python | `python`, `py`, `python3`, `py3` |
| JavaScript / JSX | `javascript`, `js`, `node`, `mjs`, `cjs` / `jsx` |
| TypeScript / TSX | `typescript`, `ts`, `mts` / `tsx` |
| Go / Rust | `go`, `golang` / `rust`, `rs` |
| PHP / Ruby / Swift / Dart / Lua | `php` / `ruby`, `rb` / `swift` / `dart` / `lua` |
| SQL | `sql` |
| Bash / PowerShell | `bash`, `sh`, `shell`, `zsh` / `powershell`, `ps`, `ps1`, `pwsh` |
| JSON / YAML | `json` / `yaml`, `yml` |
| HTML / XML / SVG | `html`, `htm` / `xml` / `svg` |
| CSS / SCSS | `css` / `scss` |
| Diff | `diff`, `patch` |
| Markdown | `markdown`, `md` |
| Dockerfile | `dockerfile`, `docker` |
| INI / TOML | `ini`, `cfg`, `conf` / `toml` |
| Текст (без подсветки) | `plaintext`, `text`, `txt`, `plain` |

### 23.1 Меню картинок и ПК-приложение 1.3.0

Правая кнопка мыши или долгое нажатие на картинку (в ленте, альбоме, просмотрщике) — меню «Открыть», «Сохранить»,
«Копировать изображение», «Копировать ссылку», «Открыть оригинал в браузере», «Сохранить все из альбома (N)» для
альбома (2+ картинок подряд от одного автора). Имя файла — `attachment_name` с настоящим расширением из адреса.
В браузере сохранение — скачиванием blob, копирование — `navigator.clipboard.write` (webp/gif перекодируются в PNG).

ПК-приложение 1.3.0 (`desktop/src/preload.js`, `window.vicinityDesktop`) добавляет мост; методы есть только у новых
версий — веб-клиент проверяет их наличие и иначе действует как браузер (`web/src/lib/desktop.ts`):

| Метод | Ответ |
|---|---|
| `saveImage(url, name)` | системный диалог «Сохранить как» → `true` сохранено, `null` отмена, `false` не удалось (сеть, тайм-аут 60 с) |
| `saveImages([{url, name}])` | папка выбирается один раз, файлы `имя (1).png`… → число сохранённых, `-1` отмена; не больше 100 |
| `copyImage(url)` | картинка в буфер обмена системы (PNG/JPEG, ≤50 МБ) → `true`/`false` (webp/gif копирует веб) |

Принимаются только адреса картинок своего сервера (`/uploads/attachments/<id>.png|jpg|jpeg|gif|webp`) и запросы
главного окна со страницы Vicinity; расширение файла всегда берётся из адреса. Ещё в 1.3.0 — системное контекстное
меню текста (вырезать, копировать, вставить, выделить всё) с проверкой орфографии ru и en-US.
