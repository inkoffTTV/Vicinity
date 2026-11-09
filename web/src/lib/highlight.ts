// Подсветка блоков кода: highlight.js грузится отдельным чанком при первом блоке кода с известным языком (lib/hljs.ts).
// Блок без тега не угадываем: highlightAuto на коротком коде часто ошибается (Python принимает за CSS) — лучше простой
// моноширинный текст, чем уверенно неверная подсветка.
import { codeLang } from './codeLangs';

type Hljs = typeof import('./hljs');

let mod: Hljs | null = null;
let loading: Promise<Hljs | null> | null = null;

/** Загрузить подсветку (один раз); не загрузилась — блоки остаются без цвета */
export function loadHighlighter(): Promise<Hljs | null> {
  loading ??= import('./hljs').then(
    (m) => (mod = m),
    () => {
      loading = null; // сеть моргнула — попробуем при следующем блоке
      return null;
    },
  );
  return loading;
}

/** Уже загружено — можно подсветить синхронно, без мигания */
export const highlighterReady = () => mod;

const cache = new Map<string, string | null>();
const CACHE_MAX = 200;

/** HTML подсветки блока; null — показывать как простой текст. Нужен загруженный модуль */
export function highlightBlock(m: Hljs, tag: string, code: string): string | null {
  const key = `${tag}\u0000${code}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const lang = codeLang(tag);
  let html: string | null = null;
  try {
    html = lang && lang.id !== 'plaintext' ? m.highlight(code, lang.id) : null;
  } catch {
    html = null;
  }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, html);
  return html;
}

/** Нужна ли блоку подсветка (чтобы не грузить библиотеку ради «```text» или блока без языка) */
export function wantsHighlight(tag: string): boolean {
  const lang = tag ? codeLang(tag) : null;
  return !!lang && lang.id !== 'plaintext';
}
