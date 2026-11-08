// Разметка сообщений в духе Discord. Текст разбирается в дерево узлов, HTML не интерпретируется:
// отрисовка (components/Markdown.tsx) строит из дерева React-элементы, ссылки — только http/https.

export type MdNode =
  | { t: 'text'; v: string }
  | { t: 'b' | 'i' | 'u' | 's' | 'spoiler'; c: MdNode[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string }
  /** @логин как написан в тексте; есть ли такой пользователь, решает отрисовка */
  | { t: 'mention'; name: string }
  | { t: 'codeblock'; lang: string; v: string }
  | { t: 'quote'; c: MdNode[] }
  /** Заголовок «# », «## », «### » в начале строки */
  | { t: 'h'; level: 1 | 2 | 3; c: MdNode[] }
  /** Список «- »/«* » или «1. »; пункт — одна строка */
  | { t: 'list'; ordered: boolean; start: number; items: MdNode[][] }
  /** [текст](https://…): host — настоящий домен, если подпись сама похожа на ссылку на другой сайт */
  | { t: 'mlink'; href: string; c: MdNode[]; host?: string }
  /** <t:UNIX> и <t:UNIX:стиль> — время в часовом поясе читателя */
  | { t: 'time'; unix: number; style: TimeStyle };

export type TimeStyle = 't' | 'T' | 'd' | 'D' | 'f' | 'F' | 'R';

// Глубже вложенные выделения остаются текстом — защита от патологического ввода
const MAX_DEPTH = 6;

// «.» — для «1\. » в начале строки: не нумерованный список (так экранирует Bot API в режиме HTML)
const ESCAPABLE = new Set(['\\', '*', '_', '~', '`', '|', '>', '@', ':', '#', '-', '[', ']', '<', '.']);
// Экранирование внутри голого адреса или @логина снимается: «https://a.b/x\_y» → «https://a.b/x_y»
const unescapeMd = (s: string) => s.replace(/\\([\\*_~`|>@:#\-[\]<.])/g, '$1');

// Сопоставление идёт с позиции (флаг y); выделения — как в Discord (simple-markdown)
const RE = {
  code: /(`+)([\s\S]*?[^`])\1(?!`)/y,
  url: /https?:\/\/[^\s<]+/y,
  mention: /(?<![A-Za-z0-9])@((?:[A-Za-z0-9_.-]|\\[_.-])+)/y,
  spoiler: /\|\|([\s\S]+?)\|\|/y,
  strike: /~~([\s\S]+?)~~/y,
  bold: /\*\*([\s\S]+?)\*\*(?!\*)/y,
  underline: /__([\s\S]+?)__(?!_)/y,
  // *курсив*: после открывающей звёздочки не пробел; **жирное** внутри не закрывает курсив
  italicStar: /\*(?=\S)((?:\*\*|\\[\s\S]|\s+(?:\\[\s\S]|[^\s*\\]|\*\*)|[^\s*\\])+?)\*(?!\*)/y,
  // _курсив_ — только целыми словами: snake_case_name остаётся как есть
  italicUnderscore: /(?<![\p{L}\p{N}_])_((?:__|\\[\s\S]|[^\\_])+?)_(?![\p{L}\p{N}_])/uy,
  // [подпись](https://адрес) — подпись в одну строку, адрес только http/https, скобки в адресе — парами
  masked: /\[((?:\\[\s\S]|[^\[\]\\\n]){1,256})\]\(\s*<?(https?:\/\/[^\s<>()]+(?:\([^\s<>()]*\)[^\s<>()]*)*)>?\s*\)/y,
  time: /<t:(-?\d{1,13})(?::([tTdDfFR]))?>/y,
};

// Похожее на домен в подписи маскированной ссылки: «example.com», «https://example.com/путь», «paypal.com.»
const DOMAIN_LIKE = /(?:https?:\/\/)?((?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,})/giu;
// Невидимые символы (нулевой ширины, направление текста, мягкий перенос) — ими прячут домен от проверки
const INVISIBLE = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

function hostOf(href: string): string {
  try {
    return new URL(href).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Домен ссылки, который нужно показать рядом с подписью: подпись выдаёт себя за другой адрес */
function spoofedHost(label: string, href: string): string | undefined {
  const real = hostOf(href);
  if (!real) return undefined;
  const strip = (h: string) => h.replace(/^www\./, '');
  // Любой домен в подписи, кроме настоящего, — показать настоящий (пунктуация и невидимые символы не мешают)
  for (const m of label.replace(INVISIBLE, '').matchAll(DOMAIN_LIKE)) {
    const shown = hostOf(`https://${m[1]}`);
    if (shown && strip(shown) !== strip(real)) return real;
  }
  return undefined;
}

function at(re: RegExp, s: string, i: number): RegExpExecArray | null {
  re.lastIndex = i;
  return re.exec(s);
}

// Хвостовая пунктуация к ссылке не относится; «)» — только если в ссылке есть парная «(»
function trimUrl(url: string): string {
  let end = url.length;
  for (;;) {
    const ch = url[end - 1];
    if ('.,:;!?"\''.includes(ch) || ch === ']') end--;
    else if (ch === ')') {
      const head = url.slice(0, end);
      if ((head.match(/\(/g) ?? []).length < (head.match(/\)/g) ?? []).length) end--;
      else break;
    } else break;
  }
  return url.slice(0, end);
}

// inLink: внутри подписи ссылки — без вложенных ссылок и упоминаний (кнопка внутри <a> недопустима)
function inline(s: string, depth: number, inLink = false): MdNode[] {
  const out: MdNode[] = [];
  let text = '';
  const push = (n: MdNode) => {
    if (text) out.push({ t: 'text', v: text });
    text = '';
    out.push(n);
  };

  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    let m: RegExpExecArray | null;

    if (ch === '\\' && ESCAPABLE.has(s[i + 1])) {
      text += s[i + 1];
      i += 2;
      continue;
    }
    if (ch === '`' && (m = at(RE.code, s, i))) {
      let v = m[2];
      // `` `код` `` — по одному пробелу по краям служат только отбивкой от обратных кавычек
      if (v.length > 2 && v.startsWith(' ') && v.endsWith(' ') && v.trim()) v = v.slice(1, -1);
      push({ t: 'code', v });
      i += m[0].length;
      continue;
    }
    if (ch === '[' && !inLink && depth < MAX_DEPTH && (m = at(RE.masked, s, i))) {
      const href = m[2];
      const c = inline(m[1], depth + 1, true);
      if (c.length && href.length > href.indexOf('//') + 2) {
        push({ t: 'mlink', href, c, host: spoofedHost(flat(c), href) });
        i += m[0].length;
        continue;
      }
    }
    if (ch === '<' && (m = at(RE.time, s, i))) {
      const unix = Number(m[1]);
      if (Number.isFinite(new Date(unix * 1000).getTime())) {
        push({ t: 'time', unix, style: (m[2] as TimeStyle | undefined) ?? 'f' });
        i += m[0].length;
        continue;
      }
    }
    if (ch === 'h' && !inLink && !/[\p{L}\p{N}]/u.test(s[i - 1] ?? '') && (m = at(RE.url, s, i))) {
      const raw = trimUrl(m[0]);
      const href = unescapeMd(raw);
      if (href.length > href.indexOf('//') + 2) {
        push({ t: 'link', href });
        i += raw.length;
        continue;
      }
    }
    if (ch === '@' && !inLink && (m = at(RE.mention, s, i))) {
      push({ t: 'mention', name: unescapeMd(m[1]) });
      i += m[0].length;
      continue;
    }
    if (depth < MAX_DEPTH) {
      if (ch === '|' && (m = at(RE.spoiler, s, i))) {
        push({ t: 'spoiler', c: inline(m[1], depth + 1, inLink) });
        i += m[0].length;
        continue;
      }
      if (ch === '~' && (m = at(RE.strike, s, i))) {
        push({ t: 's', c: inline(m[1], depth + 1, inLink) });
        i += m[0].length;
        continue;
      }
      if (ch === '*' || ch === '_') {
        // Жирный, подчёркнутый и курсив соревнуются: побеждает самое длинное совпадение
        // (***оба*** — курсив с жирным внутри)
        const candidates: [RegExp, 'b' | 'u' | 'i', number][] =
          ch === '*'
            ? [
                [RE.italicStar, 'i', 0.2],
                [RE.bold, 'b', 0.1],
              ]
            : [
                [RE.italicUnderscore, 'i', 0.2],
                [RE.underline, 'u', 0],
              ];
        let best: { m: RegExpExecArray; t: 'b' | 'u' | 'i'; q: number } | null = null;
        for (const [re, t, bonus] of candidates) {
          const hit = at(re, s, i);
          if (hit && (!best || hit[0].length + bonus > best.q)) best = { m: hit, t, q: hit[0].length + bonus };
        }
        if (best) {
          push({ t: best.t, c: inline(best.m[1], depth + 1, inLink) });
          i += best.m[0].length;
          continue;
        }
      }
    }
    text += ch;
    i++;
  }
  if (text) out.push({ t: 'text', v: text });
  return out;
}

const HEADING = /^(#{1,3}) +(\S.*)$/;

// В тексте до строки остался незакрытый **, __, ||, ~~ или ` — строка-«пункт» внутри него не блок,
// иначе выделение, начатое выше, развалится (так было до заголовков и списков)
function openSpan(lines: string[]): boolean {
  if (!lines.length) return false;
  const t = lines.join('\n').replace(/\\[\s\S]/g, '');
  if ((t.match(/`/g) ?? []).length % 2) return true;
  const noCode = t.replace(/`[^`]*`/g, '');
  return ['**', '__', '||', '~~'].some((d) => (noCode.split(d).length - 1) % 2 === 1);
}
const BULLET = /^[-*] +(\S.*)$/;
const NUMBERED = /^(\d{1,9})\. +(\S.*)$/;

// Заголовки и списки — отдельными блоками по строкам, остальное — текст как есть. Строки, ставшие
// блоками, переводы строк вокруг себя «съедают»: блок и так начинается с новой строки (white-space: pre-wrap)
function lineBlocks(lines: string[], out: MdNode[]) {
  let plain: string[] = [];
  let list: { ordered: boolean; start: number; items: MdNode[][] } | null = null;
  const flushPlain = () => {
    if (plain.length) out.push(...inline(plain.join('\n'), 0));
    plain = [];
  };
  const flushList = () => {
    if (list) out.push({ t: 'list', ...list });
    list = null;
  };
  for (const line of lines) {
    if (openSpan(plain)) {
      plain.push(line);
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      flushPlain();
      flushList();
      out.push({ t: 'h', level: h[1].length as 1 | 2 | 3, c: inline(h[2].trimEnd(), 0) });
      continue;
    }
    const b = BULLET.exec(line);
    const n = b ? null : NUMBERED.exec(line);
    if (b || n) {
      const ordered = !!n;
      flushPlain();
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, start: n ? Number(n[1]) : 1, items: [] };
      list.items.push(inline(b ? b[1] : n![2], 0));
      continue;
    }
    flushList();
    plain.push(line);
  }
  flushPlain();
  flushList();
}

// Цитаты: строки с «> »; «>>> » цитирует всё до конца фрагмента
function blocks(seg: string, out: MdNode[]) {
  const lines = seg.split('\n');
  let plain: string[] = [];
  let quote: string[] = [];
  const flushPlain = () => {
    if (plain.length) lineBlocks(plain, out);
    plain = [];
  };
  const flushQuote = () => {
    if (quote.length) {
      const c: MdNode[] = [];
      lineBlocks(quote, c);
      out.push({ t: 'quote', c });
    }
    quote = [];
  };
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k];
    if (line.startsWith('>>> ')) {
      flushPlain();
      quote.push(line.slice(4), ...lines.slice(k + 1));
      break;
    }
    if (line.startsWith('> ')) {
      flushPlain();
      quote.push(line.slice(2));
    } else {
      flushQuote();
      plain.push(line);
    }
  }
  flushPlain();
  flushQuote();
}

export function parseMarkdown(text: string): MdNode[] {
  const out: MdNode[] = [];
  let pos = 0;
  let afterBlock = false;
  const segment = (seg: string, beforeBlock: boolean) => {
    // Перевод строки рядом с блоком кода — граница блока, а не пустая строка
    if (afterBlock && seg.startsWith('\n')) seg = seg.slice(1);
    if (beforeBlock && seg.endsWith('\n')) seg = seg.slice(0, -1);
    if (seg) blocks(seg, out);
  };
  for (;;) {
    const start = text.indexOf('```', pos);
    const end = start < 0 ? -1 : text.indexOf('```', start + 3);
    if (end < 0) break;
    let body = text.slice(start + 3, end);
    if (!body.trim()) {
      // ``` ``` без содержимого — обычный текст
      segment(text.slice(pos, end + 3), false);
      afterBlock = false;
      pos = end + 3;
      continue;
    }
    segment(text.slice(pos, start), true);
    let lang = '';
    const head = /^([A-Za-z0-9_+#.-]{1,20})\n/.exec(body);
    if (head) {
      lang = head[1];
      body = body.slice(head[0].length);
    } else if (body.startsWith('\n')) body = body.slice(1);
    if (body.endsWith('\n')) body = body.slice(0, -1);
    out.push({ t: 'codeblock', lang, v: body });
    afterBlock = true;
    pos = end + 3;
  }
  segment(text.slice(pos), false);
  return out;
}

function flat(nodes: MdNode[]): string {
  return nodes
    .map((n) => {
      switch (n.t) {
        case 'text':
        case 'code':
          return n.v;
        case 'codeblock':
          return ` ${n.v} `;
        case 'link':
          return n.href;
        case 'mlink':
          return flat(n.c);
        case 'mention':
          return `@${n.name}`;
        case 'spoiler':
          return '▮▮▮';
        case 'quote':
        case 'h':
          return ` ${flat(n.c)} `;
        case 'list':
          return ` ${n.items.map(flat).join(' ')} `;
        case 'time':
          return formatTime(n.unix, n.style);
        default:
          return flat(n.c);
      }
    })
    .join('');
}

/** Текст без разметки в одну строку — для превью (цитата ответа, уведомление); спойлер скрыт */
export function plainText(text: string): string {
  return flat(parseMarkdown(text)).replace(/\s+/g, ' ').trim();
}

// ── Метки времени <t:UNIX:стиль> ──

const RU = 'ru-RU';
const REL_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86400],
  ['month', 30 * 86400],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
];

/** Время в часовом поясе читателя: t 14:30, T 14:30:05, d 05.11.2026, D 5 ноября 2026 г.,
 *  f 5 ноября 2026 г. в 14:30, F с днём недели, R «через 5 минут» / «3 дня назад» */
export function formatTime(unix: number, style: TimeStyle, now = Date.now()): string {
  const d = new Date(unix * 1000);
  const hm: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
  const date: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' };
  switch (style) {
    case 't':
      return d.toLocaleTimeString(RU, hm);
    case 'T':
      return d.toLocaleTimeString(RU, { ...hm, second: '2-digit' });
    case 'd':
      return d.toLocaleDateString(RU, { day: '2-digit', month: '2-digit', year: 'numeric' });
    case 'D':
      return d.toLocaleDateString(RU, date);
    case 'F':
      return d.toLocaleString(RU, { weekday: 'long', ...date, ...hm });
    case 'R': {
      const sec = (unix * 1000 - now) / 1000;
      const abs = Math.abs(sec);
      const rtf = new Intl.RelativeTimeFormat(RU, { numeric: 'auto' });
      for (const [unit, size] of REL_UNITS) if (abs >= size || unit === 'second') return rtf.format(Math.round(sec / size), unit);
      return '';
    }
    default:
      return d.toLocaleString(RU, { ...date, ...hm });
  }
}

// ── Упоминания ──

const isLoginChar = (c: string | undefined) => !!c && /[a-z0-9_.-]/.test(c);
const asciiLower = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

/**
 * Упоминает ли текст @login — те же правила, что у сервера при подсчёте упоминаний (docs/API.md §4):
 * без учёта регистра, не часть e-mail, не начало более длинного логина (@bob. в конце фразы — упоминание).
 */
export function mentionsUser(text: string, login: string): boolean {
  if (!login) return false;
  const lower = asciiLower(text);
  const needle = '@' + asciiLower(login);
  for (let pos = lower.indexOf(needle); pos >= 0; pos = lower.indexOf(needle, pos + 1)) {
    if (pos > 0 && /[a-z0-9]/.test(lower[pos - 1])) continue;
    const end = pos + needle.length;
    const next = lower[end];
    if (!isLoginChar(next)) return true;
    if ((next === '.' || next === '-') && !isLoginChar(lower[end + 1])) return true;
  }
  return false;
}

// ── Только эмодзи ──

const EMOJI_SEQ =
  /(?:\p{RI}\p{RI}|[#*0-9]️?⃣|\p{Extended_Pictographic}(?:️|\p{EMod})?[\u{E0020}-\u{E007F}]*(?:‍\p{Extended_Pictographic}(?:️|\p{EMod})?)*)/gu;

/** Сообщение из одних эмодзи (не больше 27, как в Discord) показывается крупно */
export function isEmojiOnly(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 300) return false;
  const found = t.match(EMOJI_SEQ);
  return !!found && found.length <= 27 && !t.replace(EMOJI_SEQ, '').trim();
}
