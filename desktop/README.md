# Vicinity для Windows

Приложение — окно Electron с веб-клиентом с сервера (`APP_URL` в `src/main.js`). Дизайн и функции
обновляются вместе с сайтом; само приложение отвечает за трей, уведомления, выбор экрана для показа
(со звуком компьютера), автозапуск и автообновление.

## Сборка

```sh
npm install
node node_modules/electron/install.js   # если npm не скачал Electron сам
npm run dist                            # → dist/Vicinity-Setup-<версия>.exe и dist/latest.yml
```

В терминале VS Code перед `npm start` сбросьте `ELECTRON_RUN_AS_NODE` — иначе Electron запустится как Node.

## Выпуск версии

1. Поднять `version` в `package.json`, собрать `npm run dist`.
2. Скопировать на сервер в `~/vicinity/deploy/downloads/`: `Vicinity-Setup-<версия>.exe`,
   его `.blockmap`, `latest.yml`, и тот же установщик под именем `Vicinity-Setup.exe` (ссылка «Скачать»).
3. Установленные приложения сами найдут `latest.yml`, скачают обновление и предложат перезапуск.

Установщик не подписан сертификатом — Windows SmartScreen при первом запуске покажет предупреждение
(«Подробнее» → «Выполнить в любом случае»).
