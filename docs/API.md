# Vicinity API

Бэкенд — Drogon (C++), база SQLite. Все REST-пути начинаются с `/api/v1`, ответы — JSON,
ошибки — `{"error": "<текст>"}` с HTTP-кодом 4xx/5xx. Авторизация — `Authorization: Bearer <token>`;
WebSocket `/ws` принимает токен в заголовке или как `?token=` (для браузера).

**Совместимость.** У пользователей стоят старые сборки десктоп-клиента. Любое изменение API
только *добавляет* поля, эндпоинты и типы событий; существующие поля, коды ответов и события
сохраняют прежний смысл. Новые поля клиенты обязаны игнорировать, если не понимают их.

Пометка **[new]** — добавлено в ходе доработки веб-версии.

---

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
| `text` | string | |
| `created_at` | string | `YYYY-MM-DD HH:MM:SS` UTC |
| `edited` | bool | |
| `attachment` | string | URL вложения или `""` |
| `attachment_name` | string | **[new]** исходное имя файла (`""` если нет) |
| `attachment_size` | int | **[new]** размер в байтах (0 если нет) |
| `attachment_type` | string | **[new]** `"image"` \| `"file"` \| `""` |
| `reactions` | array | `[{emoji, count, users:[ids]}]` |
| `reply_to` | int | **[new]** id сообщения, на которое ответ, или 0 |
| `reply` | object\|null | **[new]** `{id, author_id, author_name, text (≤200 симв.), attachment}`; `null` если ответа нет или исходное удалено |
| `nonce` | string | **[new]** только в WS `new_message` и в ответе POST: эхо клиентского `nonce` |

### GET `/channels/{id}/messages`
Параметры (все необязательны):
- `limit` — 1..100, по умолчанию 50;
- `before=<message_id>` — сообщения с `id < before`;
- `around=<message_id>` — до `limit/2` сообщений до и после указанного (для перехода к ответу/закрепу/результату поиска).

Ответ: `{"messages": [...], "has_more": bool}` — `messages` **отсортированы по `id` по убыванию**
(как раньше: новые первыми). `has_more` — есть ли более старые сообщения. Для `around` дополнительно
`"has_newer": bool`.

### POST `/channels/{id}/messages`
`{"text": "...", "attachment": "/uploads/...", "reply_to": 123, "nonce": "abc"}` — всё кроме `text`/`attachment`
необязательно. `reply_to` должен принадлежать тому же каналу (иначе 400). `nonce` ≤ 64 символов.
Ответ 201: `{id, created_at, status:"sent", nonce}`.
Лимит частоты: не более 10 сообщений за 5 секунд на пользователя (429).

### POST `/channels/{id}/attachments` (multipart, поле `file`)
Картинки: png, jpg/jpeg, gif, webp (проверка сигнатуры) → `/uploads/attachments/...`.
**[new]** Прочие файлы до 15 МБ (кроме html/htm/svg/js/mjs/xhtml/xml и исполняемых) → `/uploads/files/...`;
nginx отдаёт их с `Content-Disposition: attachment` и `X-Content-Type-Options: nosniff`.
Ответ 201: `{url, name, size, type: "image"|"file"}`. При отправке сообщения клиент передаёт
`attachment` = `url` и **[new]** необязательно `attachment_name`, `attachment_size`, `attachment_type`
(сервер проверяет, что `attachment` начинается с `/uploads/attachments/` или `/uploads/files/`).

### Редактирование / удаление / реакции
Без изменений по форме. **[new]** Владелец сервера может удалять чужие сообщения в каналах своего сервера.

## 3. Набор текста **[new]**
WS клиент → сервер: `{"type":"typing","channel_id":N}` (не чаще раза в 3 с; сервер игнорирует чаще 1 раза в 2 с).
Сервер → получатели канала, кроме отправителя: `{"type":"typing","channel_id":N,"user_id":U,"name":"..."}`.
Клиент показывает «X печатает…» 6 секунд или до сообщения от этого пользователя.

## 4. Прочитанное **[new]**
- POST `/channels/{id}/read` `{"message_id": N}` — запомнить последнее прочитанное (только вперёд).
  Другим подключениям того же пользователя уходит WS `{"type":"read_state","channel_id":N,"last_read_id":M}`.
- GET `/unread` → `{"channels":[{"channel_id":N,"unread":K,"mentions":M,"last_message_id":L}]}` — по всем доступным
  каналам с непрочитанным (`unread` > 0). Считаются сообщения других пользователей с `id > last_read_id`
  (не более 999). `mentions` — из них содержащие `@<username>` текущего пользователя (без учёта регистра).
- Таблица `channel_reads(user_id, channel_id, last_read_id)`. При первом создании таблицы
  существующим участникам проставляется текущий максимум `id` — чтобы после обновления у всех не загорелась
  вся история.

## 5. Поиск **[new]**
GET `/search?q=<строка ≥2 символов>&channel_id=N` или `&server_id=S` или без них (все доступные каналы).
Ответ: `{"results":[ <сообщение> + "channel_name", "server_id" (0 для личек/бесед) ]}`, не более 50, новые первыми.

## 6. Закреплённые **[new]**
- GET `/channels/{id}/pins` → `{"pins":[ <сообщение> + "pinned_by", "pinned_at" ]}`
- POST `/channels/{id}/pins` `{"message_id":N}`; DELETE `/channels/{id}/pins/{mid}`.
  В личках/беседах — любой участник, в серверных каналах — владелец сервера.
- WS получателям канала: `{"type":"pins_updated","channel_id":N}`.

## 7. Лички и беседы
- GET `/dms` — как раньше + **[new]** `last_message` (`{id, author_id, author_name, text, attachment, created_at}` или `null`).
- GET `/channels` (беседы) — как раньше + **[new]** `owner_id`, `last_message`.
- **[new]** GET `/channels/{id}/members` → `{"members":[{id, username, display_name, avatar_path, presence, is_owner}]}`.
- **[new]** POST `/channels/{id}/leave` — выйти из беседы (не из лички). Остальным: WS
  `{"type":"channel_member_left","channel_id":N,"user_id":U}`; ушедшему (во все его подключения):
  `{"type":"channel_removed","channel_id":N}`.
- **[new]** POST `/channels/{id}/update` `{"name": "..."}` — переименовать беседу (участник беседы) или
  серверный канал (владелец сервера). WS получателям: `{"type":"channel_updated","channel_id":N,"name":"..."}`.
- **[new]** DELETE `/channels/{id}` — удалить серверный канал (владелец сервера) или беседу (её владелец).
  WS: для серверного — `server_channels_changed`, для беседы — `channel_removed` всем участникам.
- **[new]** при добавлении в беседу остальным участникам: `{"type":"channel_member_joined","channel_id":N,"user_id":U}`.

## 8. Серверы
- GET `/servers` — как раньше.
- POST `/servers/join` `{code}` — как раньше; **[new]** забаненным — 403.
- **[removed]** POST `/servers/{id}/join` (вступление без кода по id) — отвечает 403, если у пользователя нет приглашения.
- **[new]** POST `/servers/{id}/leave` — выйти (владельцу нельзя — 400).
- **[new]** DELETE `/servers/{id}` — удалить сервер (владелец). Всем участникам: `server_removed` (существующее событие).
- **[new]** POST `/servers/{id}/update` `{"name": "..."}` — владелец. POST `/servers/{id}/icon` (multipart `file`, картинка) — владелец.
  WS участникам: `{"type":"server_updated","server_id":S,"name":"...","icon":"/uploads/..."}`.
- **[new]** POST `/servers/{id}/invite` — владелец, новый код: `{"invite_code":"..."}`.
- **[new]** баны: POST `/servers/{id}/bans` `{user_id}` (владелец; заодно исключает), DELETE `/servers/{id}/bans/{uid}`,
  GET `/servers/{id}/bans` → `{"bans":[{id, username, display_name, avatar_path}]}`.
- **[new]** WS участникам при изменениях состава: `{"type":"server_member_joined","server_id":S,"user_id":U}`,
  `{"type":"server_member_left","server_id":S,"user_id":U}`; при создании/переименовании/удалении канала:
  `{"type":"server_channels_changed","server_id":S}`.

## 9. Аккаунт **[new]**
- POST `/auth/password` `{"old_password","new_password"}` — новый ≥ 8 символов; остальные сессии завершаются.
  Лимит частоты как у входа.
- GET `/auth/sessions` → `{"sessions":[{id, created_at, expires_at, current}]}` (`id` — короткий непрозрачный идентификатор).
- DELETE `/auth/sessions/others` — выйти на всех остальных устройствах. DELETE `/auth/sessions/{id}`.

## 10. Профили **[new]**
При изменении имени/аватара/баннера/цвета/статуса друзьям и участникам общих серверов уходит
`{"type":"user_updated","user_id":U,"display_name":"...","avatar_path":"...","accent_color":"..."}`.

## 11. Голос **[new]**
- Несколько WS-подключений одного пользователя работают одновременно (десктоп + вкладки браузера):
  события уходят во все подключения; пользователь «в сети», пока открыто хотя бы одно;
  закрытие одного подключения не трогает остальные.
- `voice_join` разрешён только в голосовой канал сервера, где пользователь состоит, или в личку/беседу,
  где он участник. `voice_query` — только участникам сервера.
- Голосом владеет то подключение, которое прислало `voice_join`: бинарные кадры принимаются только от него
  и пересылаются только в голосовые подключения других участников. Закрытие этого подключения = выход из канала.
- Кадр голоса — PCM s16le, 16 кГц, моно, 320 сэмплов (640 байт, 20 мс), без заголовка (как у десктопа).
- **Протокол v2:** `{"type":"voice_join","channel_id":N,"proto":2}`. Получатели v2 получают каждый кадр
  с префиксом из 8 байт — `int64 little-endian` id отправителя — и могут микшировать говорящих по отдельности.
  Получатели v1 (старые десктопы) получают кадр без префикса, как раньше. Отправляют все одинаково — чистый PCM.

## 12. Звонки 1:1
Сигналинг `call_invite / call_accept / call_reject / call_end / call_busy / rtc_offer / rtc_answer / rtc_ice`
пересылается адресату `to` с проставленным `from` (поля — см. `docs/CALLS.md`).
**[new]** Пересылается, только если у собеседников есть общая личка или они друзья. Если адресат не в сети —
отправителю `{"type":"call_unavailable","user_id":U}`.
**[new]** GET `/rtc/ice` → `{"ice_servers":[{"urls":["stun:..."]},{"urls":["turn:host:3478?transport=udp","turn:host:3478?transport=tcp"],"username":"<expiry>:<uid>","credential":"<base64 HMAC-SHA1>"}]}` —
TURN с временными учётками coturn `use-auth-secret`, если в конфиге задан секрет; иначе только STUN.

## 13. Лимиты
Помимо входа/регистрации — по пользователю: отправка сообщений (10/5 с), загрузки (20/мин),
заявки в друзья (20/мин), поиск (30/мин); превышение — 429.
