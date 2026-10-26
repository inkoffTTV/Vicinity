# Vicinity — правила для Claude

Мессенджер с голосом: backend C++17 Drogon + SQLite (`backend/`), веб-клиент React + Vite (`web/`),
ПК-оболочка Electron, которая открывает веб с сервера (`desktop/`), мини-игра «Переправа» Node + ws
(`pereprava/`), деплой Docker Compose + nginx (`deploy/`). Qt-клиент `client/` не используется и не собирается.

## Железные правила (есть хуки в `.claude/hooks`)
- Пушить только в рабочую ветку текущей сессии (сейчас `claude/zen-feynman-rcs2s3`). Никогда в `main`/`master`.
- Историю не переписывать: без `rebase`, `commit --amend` после пуша и `push --force`. Перед пушем всегда `git fetch` + `git merge`.
- Пароли, токены, секреты не спрашивать, не писать в чат, в файлы и в коммиты. Токен бота живёт только в `.env` на сервере.
- `deploy/ti-it-top/` (телеграм-бот) не трогать, кроме явной просьбы.
- PR не создавать, пока не попросят.

## Как работать
- Коммиты осмысленные, на русском. Перед словом «готово» прогнать typecheck и нужные e2e.
- Отвечать коротко, по делу, на русском; экономить токены: grep и чтение нужных строк, не целых файлов.
- В игре и интерфейсе никаких ассетов, названий и героев из Dota 2 и других игр. Только своё или CC0 с записью в `pereprava/ASSETS.md`.
- Телефон — первый приоритет при вёрстке: проверять ширину 390px.
- Новые API-эндпоинты и WS-события описывать в `docs/API.md` (нумерованные разделы), звонки и голос — в `docs/CALLS.md`, сделанное — строкой в `docs/BACKLOG.md`.

## Команды
- Backend: `cmake -S backend -B build/backend && cmake --build build/backend -j4` (бинарник `build/backend/VicinityServer`).
- Web: `cd web && npm run typecheck`; сборка `npm run build`; e2e `VICINITY_SERVER_BIN=../build/backend/VicinityServer npx playwright test <spec>`.
- Pereprava: `cd pereprava && npm run typecheck && npm test`.
- Сервер обновляется сам: `deploy/autoupdate.sh` по cron раз в 5 минут тянет рабочую ветку и запускает `deploy/update.sh`. Руками: `sh deploy/autoupdate.sh now`, состояние — `status`.

## Грабли
- e2e запускать последовательно: порты 18080 (backend) и 4173 (vite preview) одни на всех. Падения под полным прогоном перепроверять спеком отдельно.
- Playwright запускать только из `web/`, иначе в корне появится мусорный `test-results/`.
- Поддельный микрофон Chromium пищит чистым тоном, RNNoise считает его шумом: `registerUser` в e2e отключает модель, тест RNNoise включает её через `{ denoise: true }`.
- `Segmented` рендерит `role="radio"`, `Toggle` — `role="switch"` (проверять `toHaveJSProperty('checked')`). Вкладка оформления в настройках называется «Внешний вид».
- Chrome: `position: sticky` внутри CSS grid ограничен контейнером грида, а не ячейкой.
- Prod-CSP в `deploy/nginx.conf`: любой WebAssembly требует `'wasm-unsafe-eval'` в `script-src`; в dev и e2e заголовка нет, поэтому там не воспроизводится.
- Drogon `execSqlSync` не принимает `const std::string` как параметр — передавать не-const копию.
- `.claude/skills/` и `CLAUDE.local.md` в git не попадают; правила и хуки — попадают.
- Подписки: уровень ставит админ или подарочный код; цветовые темы и мастерская — Standard, своя тема — Ultra; проверки на сервере (`Tiers`), замок в интерфейсе не защита.
