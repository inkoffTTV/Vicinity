#!/usr/bin/env node
// Vicinity — генератор токенов: tokens.json → web/src/tokens.css + client/src/core/ThemeTokens.h
// Запуск: node tools/gen-tokens.mjs tokens.json web/src/tokens.css client/src/core/ThemeTokens.h
import { readFileSync, writeFileSync } from 'node:fs';

const [src = 'tokens.json', outCss = 'tokens.css', outHpp = 'ThemeTokens.h'] = process.argv.slice(2);
const t = JSON.parse(readFileSync(src, 'utf8'));

// Токен → свойство QML (camelCase). Токен без записи здесь — ошибка сборки.
const QML = {
  'bg-ground': 'backgroundColor', 'bg-panel': 'surfaceColor', 'bg-raised': 'elevatedColor', 'bg-input': 'inputColor',
  'bg-modal': 'modalColor', 'bg-hover': 'hoverColor', 'bg-active': 'activeColor', 'border': 'borderColor',
  'text': 'textColor', 'text-2': 'textMutedColor', 'text-3': 'textFaintColor', 'text-faint': 'textDisabledColor',
  'accent': 'accentColor', 'accent-hover': 'accentHoverColor', 'accent-soft': 'accentSoftColor', 'on-accent': 'accentTextColor',
  'link': 'linkColor', 'ok': 'presenceOnline', 'idle': 'presenceIdle', 'dnd': 'presenceDnd', 'offline': 'presenceOffline',
  'danger': 'dangerColor', 'danger-text': 'dangerTextColor', 'on-danger': 'onDangerColor', 'mention': 'mentionColor', 'speaking': 'speakingColor',
  'on-ok': 'onOkColor', 'scrim': 'scrimColor', 'on-scrim': 'onScrimColor',
};

const themes = t.color.themes.map((x) => x.id);
const first = themes[0];
const byName = Object.fromEntries(t.color.tokens.map((c) => [c.name, c]));
const resolve = (name, theme, depth = 0) => {
  const c = byName[name];
  if (!c || depth > 16) throw new Error(`alias to missing token: ${name}`);
  const raw = typeof c.value === 'string' ? c.value : (c.value[theme] ?? c.value[first]);
  const m = /^\{(.+)\}$/.exec(raw);
  return m ? resolve(m[1], theme, depth + 1) : raw;
};

// ── CSS ──
let css = `/* Vicinity — generated from tokens.json; не редактировать руками */\n`;
for (const theme of themes) {
  const sel = theme === first ? `:root,\n:root[data-theme='${theme}']` : `:root[data-theme='${theme}']`;
  css += `${sel} {\n`;
  for (const c of t.color.tokens) {
    const raw = typeof c.value === 'string' ? c.value : (c.value[theme] ?? c.value[first]);
    const m = /^\{(.+)\}$/.exec(raw);
    css += `  --${c.name}: ${m ? `var(--${m[1]})` : raw};\n`;
  }
  for (const s of t.shadow?.tokens ?? []) css += `  --${s.name}: ${typeof s.value === 'string' ? s.value : (s.value[theme] ?? s.value[first])};\n`;
  css += `  color-scheme: ${theme === 'light' ? 'light' : 'dark'};\n}\n`;
}
css += `:root {\n`;
for (const fam of ['spacing', 'radius', 'size', 'duration', 'easing']) for (const x of t[fam]?.tokens ?? []) css += `  --${x.name}: ${x.value};\n`;
for (const [k, v] of Object.entries(t.type.families)) css += `  --font-${k}: ${v};\n`;
// Размеры текстовых стилей как переменные — для font-size в существующих правилах без смены класса
for (const g of t.type.groups) for (const x of g.styles) css += `  --fs-${x.name}: ${x.fontSize}; --lh-${x.name}: ${x.lineHeight};\n`;
css += `}\n@media (prefers-reduced-motion: reduce) {\n  :root { --dur-fast: 0ms; --dur-base: 0ms; --dur-slow: 0ms; --dur-enter: 0ms; }\n}\n`;
for (const g of t.type.groups) for (const s of g.styles) {
  css += `.${s.name} { font-family: var(--font-${s.family ?? g.family}); font-size: ${s.fontSize}; line-height: ${s.lineHeight}; font-weight: ${s.fontWeight};${s.letterSpacing ? ` letter-spacing: ${s.letterSpacing};` : ''} }\n`;
}
writeFileSync(outCss, css);

// ── C++ (Qt) ──
const hexToQ = (hex) => { // #rrggbb[aa] → QColor(r,g,b,a)
  const h = hex.slice(1); const n = parseInt(h.slice(0, 6), 16); const a = h.length === 8 ? parseInt(h.slice(6), 16) : 255;
  return `QColor(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};
const missing = t.color.tokens.filter((c) => !QML[c.name]).map((c) => c.name);
if (missing.length) throw new Error(`Нет соответствия QML для токенов: ${missing.join(', ')} — добавьте в таблицу QML`);
let hpp = `// Vicinity — generated from tokens.json; не редактировать руками\n#pragma once\n#include <QColor>\n#include <QString>\n\nstruct ThemeTable {\n    const char* id;\n`;
for (const c of t.color.tokens) hpp += `    QColor ${QML[c.name]};\n`;
hpp += `};\n\nstatic const ThemeTable kThemes[] = {\n`;
for (const theme of themes) {
  hpp += `    { "${theme}",\n`;
  for (const c of t.color.tokens) hpp += `      /* ${c.name.padEnd(12)} */ ${hexToQ(resolve(c.name, theme))},\n`;
  hpp += `    },\n`;
}
hpp += `};\n\n`;
for (const fam of ['spacing', 'radius', 'size']) for (const x of t[fam]?.tokens ?? []) {
  const id = x.name.replace(/-([a-z0-9])/g, (_, ch) => ch.toUpperCase());
  hpp += `static constexpr int k${id[0].toUpperCase()}${id.slice(1)} = ${parseInt(x.value, 10)};\n`;
}
for (const x of t.duration?.tokens ?? []) {
  const id = x.name.replace(/-([a-z0-9])/g, (_, ch) => ch.toUpperCase());
  hpp += `static constexpr int k${id[0].toUpperCase()}${id.slice(1)}Ms = ${parseInt(x.value, 10)};\n`;
}
writeFileSync(outHpp, hpp);
console.log(`ok: ${themes.length} темы, ${t.color.tokens.length} цветов → ${outCss}, ${outHpp}`);
