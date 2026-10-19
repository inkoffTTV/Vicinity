# Внешние ресурсы

Модели, текстуры и звуки игры свои: модели собраны из примитивов three.js, звук генерируется
Web Audio. Ниже — всё стороннее, что попадает в сборку.

| Ресурс           | Где используется | Источник                                                                  | Лицензия                  |
| ---------------- | ---------------- | ------------------------------------------------------------------------- | ------------------------- |
| three.js 0.170.0 | рендер           | https://github.com/mrdoob/three.js                                        | MIT                       |
| Шрифт Russo One  | заголовки, цифры | https://fonts.google.com/specimen/Russo+One (пакет @fontsource/russo-one) | SIL Open Font License 1.1 |
| Шрифт Rubik      | текст интерфейса | https://fonts.google.com/specimen/Rubik (пакет @fontsource/rubik)         | SIL Open Font License 1.1 |
| ws 8             | WebSocket-сервер | https://github.com/websockets/ws                                          | MIT                       |

Для выкладки на сервер (не входит в сборку игры, скачивается Docker при установке):

| Программа  | Зачем                               | Источник                           | Лицензия   |
| ---------- | ----------------------------------- | ---------------------------------- | ---------- |
| Node.js 22 | среда игрового сервера              | https://nodejs.org                 | MIT        |
| nginx 1.27 | отдаёт клиент, проксирует WebSocket | https://nginx.org                  | BSD-2      |
| certbot    | сертификаты Let's Encrypt           | https://github.com/certbot/certbot | Apache 2.0 |
