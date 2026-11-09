// Языки блоков кода ```lang: тег (и его синонимы) → язык highlight.js и подпись в шапке блока.
// Сама библиотека грузится лениво (lib/highlight.ts) — эта таблица маленькая и живёт в основном бандле.

export interface CodeLang {
  /** Имя языка в highlight.js (lib/highlight.ts регистрирует ровно эти) */
  id: string;
  /** Подпись в шапке блока */
  label: string;
}

const LANGS: [id: string, label: string, aliases: string[]][] = [
  ['c', 'C', []],
  ['cpp', 'C++', ['c++', 'cc', 'cxx', 'h', 'hpp', 'hh', 'hxx']],
  ['csharp', 'C#', ['cs', 'c#']],
  ['java', 'Java', []],
  ['kotlin', 'Kotlin', ['kt', 'kts']],
  ['python', 'Python', ['py', 'python3', 'py3']],
  ['javascript', 'JavaScript', ['js', 'jsx', 'node', 'mjs', 'cjs']],
  ['typescript', 'TypeScript', ['ts', 'tsx', 'mts']],
  ['go', 'Go', ['golang']],
  ['rust', 'Rust', ['rs']],
  ['php', 'PHP', []],
  ['ruby', 'Ruby', ['rb']],
  ['swift', 'Swift', []],
  ['sql', 'SQL', []],
  ['bash', 'Bash', ['sh', 'shell', 'zsh']],
  ['powershell', 'PowerShell', ['ps', 'ps1', 'pwsh']],
  ['json', 'JSON', []],
  ['yaml', 'YAML', ['yml']],
  ['xml', 'HTML', ['html', 'htm', 'svg']],
  ['css', 'CSS', []],
  ['scss', 'SCSS', []],
  ['lua', 'Lua', []],
  ['dart', 'Dart', []],
  ['diff', 'Diff', ['patch']],
  ['markdown', 'Markdown', ['md']],
  ['dockerfile', 'Dockerfile', ['docker']],
  ['ini', 'INI', ['toml', 'cfg', 'conf']],
  ['plaintext', 'Текст', ['text', 'txt', 'plain']],
];

const BY_TAG = new Map<string, CodeLang>();
for (const [id, label, aliases] of LANGS) for (const tag of [id, ...aliases]) BY_TAG.set(tag, { id, label });
// Подписи, которые точнее общего имени языка
BY_TAG.set('xml', { id: 'xml', label: 'XML' });
BY_TAG.set('svg', { id: 'xml', label: 'SVG' });
BY_TAG.set('toml', { id: 'ini', label: 'TOML' });
BY_TAG.set('jsx', { id: 'javascript', label: 'JSX' });
BY_TAG.set('tsx', { id: 'typescript', label: 'TSX' });

/** Язык по тегу блока (без учёта регистра); неизвестный тег — null */
export function codeLang(tag: string): CodeLang | null {
  return BY_TAG.get(tag.trim().toLowerCase()) ?? null;
}
