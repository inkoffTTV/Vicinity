# Общие токены для web и QML

Источник правды — `tokens.json` в этой системе. Из него генерируются и CSS-переменные для `web/src/theme.css`, и таблица тем для `client/src/core/ThemeManager.cc`. Ни один клиент не держит цвета у себя.

## Схема

```
tokens.json ──► tools/gen-tokens.mjs ──┬──► web/src/tokens.css          (:root[data-theme=…] { --bg-panel: … })
                                       └──► client/src/core/ThemeTokens.h (static const ThemeTable kThemes[] = …)
```

- `web/src/tokens.css` импортируется первым в `theme.css`; блоки палитр в `theme.css` удаляются. Рукописные правила (градиентные темы, `data-contrast`, каркас) остаются в `theme.css` и ссылаются только на `var(--…)`.
- `ThemeTokens.h` — сгенерированный заголовок с четырьмя темами; `ThemeManager::setTheme()` читает цвета из таблицы по id вместо `QColor("#…")`. Публичные `Q_PROPERTY` не меняются: QML продолжает писать `themeManager.accentColor`.
- Шаг сборки: `node tools/gen-tokens.mjs tokens.json web/src/tokens.css client/src/core/ThemeTokens.h`. Сгенерированные файлы коммитятся, чтобы сборка клиентов не зависела от Node.

## Соответствие имён

| Токен | CSS | QML (`themeManager.*`) | Примечание |
| --- | --- | --- | --- |
| `bg-ground` | `--bg-ground` | `backgroundColor` | |
| `bg-panel` | `--bg-panel` | `surfaceColor`, `barColor`, `railColor` | три свойства QML читают одно значение |
| `bg-raised` | `--bg-raised` | `elevatedColor` | |
| `bg-input` | `--bg-input` | `inputColor` | |
| `bg-hover` | `--bg-hover` | `hoverColor` | в QML — `QColor` с альфой, через `themeManager.rgba` не нужно |
| `border` | `--border` | `borderColor` | |
| `text` / `text-2` / `text-3` | `--text` / `--text-2` / `--text-3` | `textColor` / `textMutedColor` / `textFaintColor` | |
| `accent` / `accent-hover` | `--accent` / `--accent-hover` | `accentColor` / `accentHoverColor` (новое) | |
| `accent-soft` | `--accent-soft` | `accentSoftColor` | |
| `on-accent` | `--on-accent` | `accentTextColor` | |
| `ok` / `idle` / `dnd` / `offline` | `--ok` … | `presenceOnline` / `presenceIdle` / `presenceDnd` / `presenceOffline` | `successColor` = `ok`, `warningColor` = `idle` |
| `danger` / `danger-text` / `on-danger` | `--danger` … | `dangerColor` / `dangerTextColor` (новое) / `onDangerColor` (новое) | |
| `link` | `--link` | `linkColor` (новое) | |
| `radius-*` | `--radius-*` | `radiusXs … radiusPill` (новое, `int`) | |
| `space-*` | `--space-*` | `space1 … space12` (новое, `int`) | |
| `dur-*` | `--dur-*` | `durFast / durBase / durSlow` (заменяют `animDuration`) | при `reducedMotion` возвращают 0 |

Пользовательские настройки (`avatarRadiusRatio`, `sidebarWidth`, `compact`, `bgGradientJson`) — не токены, остаются в `ThemeManager` и `prefs.ts`.

## Правила

- Новый цвет нужен → добавляется токен во все четыре темы в `tokens.json`, затем перегенерация. Цвет в компоненте — никогда.
- Имя токена одно для всех платформ; в QML оно превращается в camelCase по таблице выше. Генератор падает, если токен из `tokens.json` не имеет соответствия в таблице — чтобы не появлялось «тихих» токенов, доступных только вебу.
- Алиасы (`mention → accent-soft`, `speaking → ok`) генерируются как `var(--accent-soft)` в CSS и как копия значения в C++.
- Градиентная тема в QML (`bgGradientEnabled`) делает то же, что `data-gradient` в CSS: заменяет `bg-ground` градиентом и даёт `bg-panel` альфу 0.5–0.56. Эти альфы — константы генератора, не отдельные токены.

Скрипт генератора лежит рядом: `tools/gen-tokens.mjs`.
