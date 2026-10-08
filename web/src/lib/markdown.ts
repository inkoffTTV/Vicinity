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
  | { t: 'quote'; c: MdNode[] };

// Глубже вложенные выделения остаются текстом — защита от патологического ввода
const MAX_DEPTH = 6;

const ESCAPABLE = new Set(['\\', '*', '_', '~', '`', '|', '>', '@', ':']);

// Сопоставление идёт с позиции (флаг y); выделения — как в Discord (simple-markdown)
const RE = {
  code: /(`+)([\s\S]*?[^`])\1(?!`)/y,
  url: /https?:\/\/[^\s<]+/y,
  mention: /(?<![A-Za-z0-9])@([A-Za-z0-9_.-]+)/y,
  spoiler: /\|\|([\s\S]+?)\|\|/y,
  strike: /~~([\s\S]+?)~~/y,
  bold: /\*\*([\s\S]+?)\*\*(?!\*)/y,
  underline: /__([\s\S]+?)__(?!_)/y,
  // *курсив*: после открывающей звёздочки не пробел; **жирное** внутри не закрывает курсив
  italicStar: /\*(?=\S)((?:\*\*|\\[\s\S]|\s+(?:\\[\s\S]|[^\s*\\]|\*\*)|[^\s*\\])+?)\*(?!\*)/y,
  // _курсив_ — только целыми словами: snake_case_name остаётся как есть
  italicUnderscore: /(?<![\p{L}\p{N}_])_((?:__|\\[\s\S]|[^\\_])+?)_(?![\p{L}\p{N}_])/uy,
};

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

function inline(s: string, depth: number): MdNode[] {
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
    if (ch === 'h' && !/[\p{L}\p{N}]/u.test(s[i - 1] ?? '') && (m = at(RE.url, s, i))) {
      const href = trimUrl(m[0]);
      if (href.length > href.indexOf('//') + 2) {
        push({ t: 'link', href });
        i += href.length;
        continue;
      }
    }
    if (ch === '@' && (m = at(RE.mention, s, i))) {
      push({ t: 'mention', name: m[1] });
      i += m[0].length;
      continue;
    }
    if (depth < MAX_DEPTH) {
      if (ch === '|' && (m = at(RE.spoiler, s, i))) {
        push({ t: 'spoiler', c: inline(m[1], depth + 1) });
        i += m[0].length;
        continue;
      }
      if (ch === '~' && (m = at(RE.strike, s, i))) {
        push({ t: 's', c: inline(m[1], depth + 1) });
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
          push({ t: best.t, c: inline(best.m[1], depth + 1) });
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

// Цитаты: строки с «> »; «>>> » цитирует всё до конца фрагмента
function blocks(seg: string, out: MdNode[]) {
  const lines = seg.split('\n');
  let plain: string[] = [];
  let quote: string[] = [];
  const flushPlain = () => {
    if (plain.length) out.push(...inline(plain.join('\n'), 0));
    plain = [];
  };
  const flushQuote = () => {
    if (quote.length) out.push({ t: 'quote', c: inline(quote.join('\n'), 0) });
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

/** Текст без разметки в одну строку — для превью (цитата ответа, уведомление); спойлер скрыт */
export function plainText(text: string): string {
  const flat = (nodes: MdNode[]): string =>
    nodes
      .map((n) => {
        switch (n.t) {
          case 'text':
          case 'code':
            return n.v;
          case 'codeblock':
            return ` ${n.v} `;
          case 'link':
            return n.href;
          case 'mention':
            return `@${n.name}`;
          case 'spoiler':
            return '▮▮▮';
          case 'quote':
            return ` ${flat(n.c)} `;
          default:
            return flat(n.c);
        }
      })
      .join('');
  return flat(parseMarkdown(text)).replace(/\s+/g, ' ').trim();
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
