import { KeyboardEvent, MouseEvent, ReactNode, useMemo, useState } from 'react';
import { copyText } from '../lib/clipboard';
import { MdNode, parseMarkdown } from '../lib/markdown';
import { useStore } from '../lib/store';
import { Directory, resolveLogin, useUserDirectory } from '../lib/users';

interface Props {
  text: string;
  /** Подсветить вхождения (результаты поиска), без учёта регистра */
  highlight?: string;
}

interface Ctx {
  users: Directory;
  highlight: string;
  myId: number | undefined;
  showProfile: (id: number) => void;
}

/** Текст сообщения или «о себе» с разметкой; HTML из текста никогда не интерпретируется */
export function Markdown({ text, highlight }: Props) {
  const nodes = useMemo(() => parseMarkdown(text), [text]);
  const users = useUserDirectory();
  const myId = useStore((s) => s.me?.user_id);
  const showProfile = useStore((s) => s.showProfile);
  const ctx: Ctx = { users, highlight: (highlight ?? '').trim(), myId, showProfile };
  return <>{render(nodes, ctx)}</>;
}

function render(nodes: MdNode[], ctx: Ctx): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text':
        return <Highlighted key={i} text={n.v} query={ctx.highlight} />;
      case 'b':
        return <strong key={i}>{render(n.c, ctx)}</strong>;
      case 'i':
        return <em key={i}>{render(n.c, ctx)}</em>;
      case 'u':
        return <u key={i}>{render(n.c, ctx)}</u>;
      case 's':
        return <s key={i}>{render(n.c, ctx)}</s>;
      case 'spoiler':
        return <Spoiler key={i}>{render(n.c, ctx)}</Spoiler>;
      case 'code':
        return (
          <code key={i} className="md-code">
            <Highlighted text={n.v} query={ctx.highlight} />
          </code>
        );
      case 'link':
        return (
          <a key={i} href={n.href} target="_blank" rel="noopener noreferrer">
            <Highlighted text={n.href} query={ctx.highlight} />
          </a>
        );
      case 'mention': {
        const hit = resolveLogin(ctx.users, n.name);
        if (!hit) return <Highlighted key={i} text={`@${n.name}`} query={ctx.highlight} />;
        const { user, rest } = hit;
        return (
          <span key={i}>
            <button
              type="button"
              className={`mention${user.id === ctx.myId ? ' me' : ''}`}
              title={`@${user.username}`}
              onClick={(e) => {
                e.stopPropagation();
                ctx.showProfile(user.id);
              }}
            >
              @{user.display_name}
            </button>
            {rest}
          </span>
        );
      }
      case 'codeblock':
        return <CodeBlock key={i} lang={n.lang} code={n.v} />;
      case 'quote':
        return (
          <blockquote key={i} className="md-quote">
            {render(n.c, ctx)}
          </blockquote>
        );
    }
  });
}

// Вхождения запроса — в <mark>; регистр не учитывается
function Highlighted({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  // У редких символов строчная форма другой длины — тогда позиции не совпадут, не подсвечиваем
  if (lower.length !== text.length || !lower.includes(q)) return <>{text}</>;
  const parts: ReactNode[] = [];
  let pos = 0;
  for (let at = lower.indexOf(q); at >= 0; at = lower.indexOf(q, pos)) {
    if (at > pos) parts.push(text.slice(pos, at));
    parts.push(<mark key={at}>{text.slice(at, at + q.length)}</mark>);
    pos = at + q.length;
  }
  if (pos < text.length) parts.push(text.slice(pos));
  return <>{parts}</>;
}

function Spoiler({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false);
  if (shown) return <span className="md-spoiler shown">{children}</span>;
  // Скрытая ссылка внутри не открывается: первый щелчок только показывает текст
  const reveal = (e: MouseEvent | KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShown(true);
  };
  return (
    <span
      className="md-spoiler"
      role="button"
      tabIndex={0}
      aria-label="Спойлер — нажмите, чтобы показать"
      onClick={reveal}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && reveal(e)}
    >
      <span aria-hidden="true">{children}</span>
    </span>
  );
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const toast = useStore((s) => s.toast);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!(await copyText(code))) return toast('Не удалось скопировать', 'error');
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="md-codeblock">
      <div className="md-codeblock-head">
        <span className="md-codeblock-lang">{lang}</span>
        <button type="button" className="md-codeblock-copy" onClick={copy}>
          {copied ? 'Скопировано ✓' : 'Копировать'}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}
