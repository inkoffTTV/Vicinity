// Иконки «Переправы»: сетка 24×24, линия 2 px, скруглённые концы, без заливок.
// Правило набора: каждая иконка узнаётся по силуэту без цвета; раздел лавки дополнительно
// кодируется формой подложки (SECTION_FRAME), цвет — только подсказка. Всё своё.

export type Section = 'consum' | 'attack' | 'defense' | 'magic' | 'speed' | 'final';

/** Подложка раздела: на 40 px и крупнее, на мелких размерах иконка без неё */
export const SECTION_FRAME: Record<Section, string> = {
  consum: '<circle cx="12" cy="12" r="11"/>',
  attack: '<path d="M12 1l11 11-11 11L1 12z"/>',
  defense: '<path d="M12 1l10 3.5V12c0 6-4.5 9.5-10 11C6.5 21.5 2 18 2 12V4.5z"/>',
  magic: '<path d="M12 1l9.5 5.5v11L12 23l-9.5-5.5v-11z"/>',
  speed: '<path d="M2 3h14l6 9-6 9H2l6-9z"/>',
  final: '<path d="M7 1h10l6 6v10l-6 6H7l-6-6V7z"/>',
};

/** Значок раздела для вкладок лавки */
export const SECTION_ICON: Record<Section, string> = {
  consum: '<path d="M10 3h4M11 3v4l-4 7a4 4 0 0 0 3.5 6h3a4 4 0 0 0 3.5-6l-4-7V3"/><path d="M8 14h8"/>',
  attack: '<path d="M19 3l-9.5 9.5M19 3h2v2l-9.5 9.5"/><path d="M7 11l6 6M9.5 14.5L4 20M3 19l2 2"/>',
  defense: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  magic: '<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>',
  speed: '<path d="M4 6l6 6-6 6M11 6l6 6-6 6"/>',
  final: '<path d="M4 18l1-10 4.5 4L12 5l2.5 7L19 8l1 10z"/><path d="M4 21h16"/>',
};

/** Предметы: силуэт по id (раздел берётся из данных предмета) */
export const ITEM_ICON: Record<string, string> = {
  // Расходники
  potion: '<path d="M10 3h4M10.5 3v4.5a6 6 0 1 0 3 0V3"/><path d="M7.5 14.5h9"/>',
  ward: '<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/><path d="M12 18v4M9 22h6"/>',
  recall: '<path d="M6 5h11a2 2 0 0 1 0 4H8a2 2 0 0 0 0 4h9"/><path d="M12 17H5M8 14l-3 3 3 3"/>',
  // Атака
  blade: '<path d="M5 19L17 7l2-4-4 2L3 17z"/><path d="M7 15l2 2"/>',
  staff:
    '<path d="M4 20l8.5-8.5"/><circle cx="16" cy="8" r="4"/><path d="M16 2v2M22 8h-2M20.2 3.8l-1.4 1.4M20.2 12.2l-1.4-1.4"/>',
  gloves:
    '<path d="M7 21v-6l-2-5 2-1 2 3V5a1.5 1.5 0 0 1 3 0v5V4a1.5 1.5 0 0 1 3 0v6-4a1.5 1.5 0 0 1 3 0v9l-2 6z"/><path d="M8 18h8"/>',
  fang: '<path d="M6 3c5 0 10 2 12 6-3 1-5 4-6 8l-1 4c-2-6-5-11-5-18z"/><path d="M15 15c0 2 1 3 2 3s2-1 2-3l-2-3z"/>',
  warblade: '<path d="M14 3h7v7L10 21l-3-3 2-2-4-4 2-2 4 4z"/><path d="M3 21l3-3"/>',
  vampblade:
    '<path d="M20 4c-8 0-14 5-15 12l3 1c1-6 6-10 12-11z"/><path d="M8 17l-4 4"/><path d="M15 15c0 2 1 3 2 3s2-1 2-3l-2-3z"/>',
  // Защита
  mail: '<path d="M7 4h10l3 4-2.5 2v10h-11V10L4 8z"/><path d="M9.5 12h5M9.5 15h5M9.5 18h5"/>',
  cloak: '<path d="M9 3h6l1 3 4 15H4L8 6z"/><path d="M9.5 6h5M12 9v12"/>',
  ring: '<circle cx="12" cy="15" r="6"/><path d="M9 7l3-4 3 4-3 2z"/>',
  leaf: '<path d="M5 19C5 10 10 4 20 4c0 10-6 15-15 15z"/><path d="M5 19l9-9"/>',
  gem: '<path d="M7 4h10l4 5-9 12L3 9z"/><path d="M3 9h18M9 4l3 5 3-5M12 9v12"/>',
  bulwark: '<path d="M5 3h14v9c0 5-3 8-7 9-4-1-7-4-7-9z"/><path d="M12 7v10M8 11h8"/>',
  lifegem: '<path d="M12 21C6 16 4 12 4 9a4 4 0 0 1 8-1 4 4 0 0 1 8 1c0 3-2 7-8 12z"/><path d="M9 10l3 3 3-3"/>',
  spikemail: '<path d="M7 6h10l3 4-2.5 2v9h-11v-9L4 10z"/><path d="M7 6L5 2M17 6l2-4M12 6V2"/>',
  // Магия
  ember: '<path d="M12 4c2 3 5 5 5 9a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-8z"/><path d="M5 21h14"/>',
  hourglass: '<path d="M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9"/>',
  flame: '<path d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 .5 2 1.5 3 3 3 0-3-1-6 0-9z"/>',
  // Скорость
  boots: '<path d="M8 3h5v10l5 2.5a2 2 0 0 1 1 1.7V20H6V3z"/><path d="M2 8h4M3 12h3"/>',
  stone: '<path d="M14 3l5 5-5 13-5-13z"/><path d="M9 8h10M3 9h3M2 13h4M4 17h4"/>',
  swiftboots: '<path d="M9 5h5v8l5 2.5a2 2 0 0 1 1 1.7V20H7V5z"/><path d="M9 5C7 3 4 3 2 4M9 8C7 7 4 7 3 8"/>',
  pathboots: '<path d="M8 3h5v10l5 2.5a2 2 0 0 1 1 1.7V20H6V3z"/><path d="M8 7h5M2 21c1-1 2-1 3 0"/>',
  // Итоговые
  stormblade: '<path d="M14 3h7v7L10 21l-3-3 2-2-4-4 2-2 4 4z"/><path d="M6 2L4 6h3l-2 4"/>',
  reaper: '<path d="M6 21L14 6"/><path d="M14 6c3-2 6-2 8 0-4 0-7 2-9 5"/>',
  archstaff:
    '<path d="M6 21l8-8"/><path d="M16 3l1.5 3.5L21 8l-3.5 1.5L16 13l-1.5-3.5L11 8l3.5-1.5z"/><path d="M5 5v3M3.5 6.5h3M19 16v3M17.5 17.5h3"/>',
  sage: '<path d="M8 3h8l2 4 2 14H4L6 7z"/><path d="M12 7l1.5 3 3 .5-2 2 .5 3-3-1.5-3 1.5.5-3-2-2 3-.5z"/>',
  citadel: '<path d="M4 21V9h3v3h3V8h4v4h3V9h3v12z"/><path d="M10 21v-4h4v4M12 3v5M12 3h4l-1 1.5L16 6h-4"/>',
  windwalker:
    '<path d="M8 5h5v8l5 2.5a2 2 0 0 1 1 1.7V20H6V5z"/><path d="M3 6c3-2 6 0 9-2M2 11c3-1 5 0 8-1"/><path d="M15 3l2-1 1 2"/>',
  // Лесные находки
  n_claw: '<path d="M5 21c1-7 4-12 10-16M9 21c1-5 3-9 8-12M13 21c1-3 2-6 6-8"/>',
  n_amulet: '<circle cx="12" cy="15" r="5"/><path d="M8 4l4 6 4-6"/><path d="M12 13v4M10 15h4"/>',
  n_heartwood:
    '<path d="M12 21v-6"/><path d="M12 15c-5 0-8-3-8-7 3 0 6 1 8 4 2-3 5-4 8-4 0 4-3 7-8 7z"/><circle cx="12" cy="8" r="2"/>',
  n_feather: '<path d="M20 4C10 4 5 10 5 19l-2 2"/><path d="M20 4c0 9-6 13-14 14M9 15l4-1M12 11l4-1M15 7l3-1"/>',
  n_spark:
    '<path d="M12 2v6M12 16v6M2 12h6M16 12h6"/><path d="M12 8l1.5 2.5L16 12l-2.5 1.5L12 16l-1.5-2.5L8 12l2.5-1.5z"/>',
};

/** Умения: иконка по типу (ai.kind у умения), цвет — из цветов самого умения.
 *  Так 96 умений получают читаемые иконки без 96 отдельных рисунков. */
export const ABILITY_KIND_ICON: Record<string, string> = {
  nuke: '<circle cx="15" cy="9" r="4.5"/><path d="M11.5 12.5L4 20M9 9l-5 3M15 15l-3 5"/>',
  aoe: '<path d="M2 18h20"/><path d="M12 18l-2-4 3-3-2-4 2-4"/><path d="M5 14l2 4M19 14l-2 4"/>',
  disable: '<path d="M5 21c0-6 2-8 7-8s7 2 7 8"/><path d="M8 13c-2-3-1-7 1-9M16 13c2-3 1-7-1-9M12 13V3"/>',
  escape:
    '<path d="M4 18l4-4M9.5 12.5l2-2M13 9l4-4"/><path d="M17 5h3v3"/><circle cx="5" cy="7" r="1.5"/><circle cx="19" cy="18" r="1.5"/>',
  defend: '<circle cx="12" cy="12" r="8.5"/><path d="M8 9.5a5 5 0 0 1 4-2.5"/>',
  buff: '<path d="M12 21V8M7 13l5-5 5 5"/><path d="M7 4h10"/>',
  heal: '<path d="M12 20s-8-5-8-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 15 12 20 12 20z"/><path d="M12 10v6M9 13h6"/>',
  finish: '<path d="M4 4l16 16M20 4L4 20"/><path d="M4 4h4M4 4v4M20 20h-4M20 20v-4"/>',
  passive:
    '<circle cx="12" cy="12" r="3.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
};

/** Готовая SVG-разметка иконки (обводка — currentColor) */
export const svg = (inner: string, size = 24) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
