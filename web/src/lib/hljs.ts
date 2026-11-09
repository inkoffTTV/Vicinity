// Ленивая часть подсветки кода: ядро highlight.js и выбранные языки (отдельный чанк, грузится при первом блоке кода).
// Выход hljs — HTML, в котором весь исходный текст экранирован (& < > " '), а разметку добавляют только <span class="hljs-…">.
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import dart from 'highlight.js/lib/languages/dart';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import lua from 'highlight.js/lib/languages/lua';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import plaintext from 'highlight.js/lib/languages/plaintext';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scss from 'highlight.js/lib/languages/scss';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

const LANGUAGES = {
  bash, c, cpp, csharp, css, dart, diff, dockerfile, go, ini, java, javascript, json, kotlin, lua, markdown, php,
  plaintext, powershell, python, ruby, rust, scss, sql, swift, typescript, xml, yaml,
};
for (const [name, lang] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, lang);

/** Подсветить код известного языка; язык не зарегистрирован — null */
export function highlight(code: string, lang: string): string | null {
  if (!hljs.getLanguage(lang)) return null;
  return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
}
