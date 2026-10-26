# Дизайн-система (web/)

Источник правды — `design/tokens.json` → `web/src/tokens.css` (`npm run tokens`), правила — `design/README.md`.
- Цвета, отступы, радиусы, шрифты только через токены (`var(--accent)`, `var(--space-3)`, `var(--radius-md)`): никаких «на глаз» 5px/10px/14px и hex в компонентах.
- Один акцент `accent`, на нём всегда `on-accent`. Красный текст — `danger-text`, поверхность — `danger`.
- Глубина светлотой, не тенью: `bg-ground` < `bg-panel` < `bg-raised`; `shadow-modal` только у окон, меню и тостов. Панели без backdrop-filter и overflow: hidden (внутри них окна position: fixed).
- Шрифты: Onest — интерфейс, Unbounded — только заголовки `display` и слово «Vicinity». Пользовательские шрифты интерфейса — через `lib/fonts.ts`.
- Тексты на «вы», коротко, в активном залоге; ошибка говорит, что случилось и что делать; пустой экран — иконка, фраза, кнопка. Эмодзи только как контент пользователя.
- Иконки — lucide-react через `<Icon icon={...} />`, размеры 14/16/18/22.
- Оформление пользователя: атрибуты на `<html>` ставит `lib/prefs.ts` (`data-theme`, `data-gradient`, `data-glass`, `data-bg`, `data-radius`, `data-font`, `data-eco`); новые настройки оформления добавлять и в `prefs.ts` (sanitize + apply), и в `appearanceSync.ts`, и в `SettingsController.cc` (валидация), и в `docs/API.md` §0.6.
- Контрасты текста ≥ 4.5:1 во всех четырёх базовых темах; проверять светлую и тёмную.
