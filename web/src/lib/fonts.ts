// Шрифт интерфейса (Настройки → Внешний вид → Шрифт). id совпадают со списком сервера
// (SettingsController.cc, font_family). Файлы шрифтов подключены в main.tsx (@fontsource).

export interface UiFont {
  id: string;
  name: string;
  /** Группа как в ориентире: system | modern | serif | mono | hand | deco | game */
  group: string;
  family: string;
}

export const UI_FONTS: UiFont[] = [
  { id: 'default', name: 'Onest', group: 'modern', family: "'Onest', system-ui, -apple-system, 'Segoe UI', sans-serif" },
  { id: 'system', name: 'Системный', group: 'system', family: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif" },
  { id: 'comfortaa', name: 'Comfortaa', group: 'modern', family: "'Comfortaa', sans-serif" },
  { id: 'exo', name: 'Exo 2', group: 'modern', family: "'Exo 2', sans-serif" },
  { id: 'oswald', name: 'Oswald', group: 'modern', family: "'Oswald', sans-serif" },
  { id: 'unbounded', name: 'Unbounded', group: 'deco', family: "'Unbounded', sans-serif" },
  { id: 'russo', name: 'Russo One', group: 'deco', family: "'Russo One', sans-serif" },
  { id: 'lobster', name: 'Lobster', group: 'deco', family: "'Lobster', cursive" },
  { id: 'playfair', name: 'Playfair Display', group: 'serif', family: "'Playfair Display', serif" },
  { id: 'jetbrains', name: 'JetBrains Mono', group: 'mono', family: "'JetBrains Mono', ui-monospace, monospace" },
  { id: 'caveat', name: 'Caveat', group: 'hand', family: "'Caveat', cursive" },
  { id: 'pressstart', name: 'Press Start 2P', group: 'game', family: "'Press Start 2P', monospace" },
];

export const FONT_GROUPS: [string, string][] = [
  ['system', 'System'],
  ['modern', 'Modern'],
  ['serif', 'Serif'],
  ['mono', 'Mono'],
  ['hand', 'Hand'],
  ['deco', 'Deco'],
  ['game', 'Game'],
];

export const fontById = (id: string) => UI_FONTS.find((f) => f.id === id) ?? UI_FONTS[0];
