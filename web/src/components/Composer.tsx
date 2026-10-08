import {
  ClipboardEvent,
  DragEvent,
  KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useChannelMembers } from '../lib/channelMembers';
import { fileIcon, formatSize, uploadProblem } from '../lib/files';
import { drafts, isImageFile, useStore } from '../lib/store';
import { resetTyping, sendTyping, typingText, useTyping } from '../lib/typing';
import { Avatar } from './Avatar';
import { EmojiPicker } from './EmojiPicker';
import { composing } from './Message';

// Файлов в очереди на отправку за раз — каждый уходит отдельным сообщением
const MAX_QUEUE = 10;
const MAX_SUGGEST = 8;

interface Staged {
  key: number;
  file: File;
  /** Превью картинки (object URL) или '' */
  url: string;
}

interface Candidate {
  id: number;
  username: string;
  display_name: string;
  avatar_path: string;
}

let stagedSeq = 0;

export function Composer({ channelId, placeholder }: { channelId: number; placeholder: string }) {
  const toast = useStore((s) => s.toast);
  const setEditing = useStore((s) => s.setEditing);
  const sendMessage = useStore((s) => s.sendMessage);
  const setReplyingTo = useStore((s) => s.setReplyingTo);
  const me = useStore((s) => s.me)!;
  const messages = useStore((s) => s.messages[channelId]);
  const reply = useStore((s) => s.replyingTo[channelId]);
  const typists = useTyping((s) => s.byChannel[channelId]);
  const candidates = useCandidates(channelId, me.user_id);
  const [text, setText] = useState(() => drafts.get(channelId) ?? '');
  const [files, setFiles] = useState<Staged[]>([]);
  const [dragging, setDragging] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  // @упоминание, которое сейчас набирается: где начинается и что набрано после @
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [selected, setSelected] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const emojiBtn = useRef<HTMLButtonElement>(null);
  // Куда поставить курсор после вставки (применяется, когда React обновит поле)
  const caret = useRef<number | null>(null);
  const staged = useRef(files);
  staged.current = files;

  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) ref.current?.focus();
  }, []);

  useEffect(() => {
    if (text) drafts.set(channelId, text);
    else drafts.delete(channelId);
  }, [channelId, text]);

  // Превью ещё не отправленных файлов освобождаются вместе с полем ввода
  useEffect(() => () => staged.current.forEach((f) => f.url && URL.revokeObjectURL(f.url)), []);

  // Выбрали «Ответить» — сразу печатать ответ
  useEffect(() => {
    if (reply) ref.current?.focus();
  }, [reply]);

  // Автовысота поля и курсор после вставки
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 220) + 'px';
    if (caret.current !== null) {
      el.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  }, [text]);

  const suggestions = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    return candidates
      .filter(
        (u) =>
          u.username.toLowerCase().startsWith(q) ||
          u.display_name
            .toLowerCase()
            .split(/\s+/)
            .some((w) => w.startsWith(q)),
      )
      .slice(0, MAX_SUGGEST);
  }, [mention, candidates]);
  const suggesting = suggestions.length > 0;

  useEffect(() => setSelected(0), [mention?.start, mention?.query]);

  // Набирается ли @упоминание прямо перед курсором
  const detectMention = (value: string, pos: number) => {
    const m = /(?:^|\s)@([\p{L}\p{N}_.-]{0,32})$/u.exec(value.slice(0, pos));
    setMention(m ? { start: pos - m[1].length - 1, query: m[1] } : null);
  };

  const insertMention = (u: Candidate) => {
    const el = ref.current;
    if (!el || !mention) return;
    const before = text.slice(0, mention.start);
    const ins = `@${u.username} `;
    caret.current = before.length + ins.length;
    setText(before + ins + text.slice(el.selectionStart));
    setMention(null);
    el.focus();
  };

  const insertText = (s: string) => {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart;
    caret.current = start + s.length;
    setText(text.slice(0, start) + s + text.slice(el.selectionEnd));
  };

  const addFiles = (list: File[]) => {
    const ok: Staged[] = [];
    for (const f of list) {
      const problem = uploadProblem(f);
      if (problem) toast(problem, 'error');
      else ok.push({ key: ++stagedSeq, file: f, url: isImageFile(f) ? URL.createObjectURL(f) : '' });
    }
    const room = MAX_QUEUE - files.length;
    if (ok.length > room) {
      toast(`За раз можно отправить не больше ${MAX_QUEUE} файлов`, 'error');
      ok.slice(Math.max(0, room)).forEach((f) => f.url && URL.revokeObjectURL(f.url));
    }
    if (room > 0 && ok.length) setFiles([...files, ...ok.slice(0, room)]);
  };

  const unstage = (key: number) => {
    const f = files.find((x) => x.key === key);
    if (f?.url) URL.revokeObjectURL(f.url);
    setFiles(files.filter((x) => x.key !== key));
  };

  // Сообщение сразу уходит в ленту как «отправляется»; поле очищается без ожидания сервера.
  // Текст — вместе с первым файлом, остальные файлы — отдельными сообщениями.
  const send = () => {
    const t = text.trim();
    if (!t && !files.length) return;
    if (t.length > 4096) return toast('Сообщение слишком длинное (макс 4096 символов)', 'error');
    const [first, ...rest] = files;
    sendMessage(channelId, t, first?.file ?? null, reply ?? null);
    rest.forEach((f) => sendMessage(channelId, '', f.file, null));
    files.forEach((f) => f.url && URL.revokeObjectURL(f.url));
    setFiles([]);
    setText('');
    setMention(null);
    if (reply) setReplyingTo(channelId, null);
    resetTyping(channelId);
    ref.current?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (composing(e)) return;
    if (suggesting) {
      const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
      if (step) {
        e.preventDefault();
        setSelected((i) => (i + step + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(suggestions[Math.min(selected, suggestions.length - 1)]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMention(null);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    } else if (e.key === 'Escape' && reply) {
      e.preventDefault();
      setReplyingTo(channelId, null);
    } else if (e.key === 'ArrowUp' && !text && messages) {
      const last = [...messages].reverse().find((m) => m.author_id === me.user_id && m.text && !m.local);
      if (last) {
        e.preventDefault();
        setEditing(last.id);
      }
    }
  };

  // Курсор ушёл стрелками или мышью — подсказка относится уже не к тому слову
  const onCaretMove = () => {
    const el = ref.current;
    if (el && (mention || el.value.includes('@'))) detectMention(el.value, el.selectionStart);
  };

  // Office, PDF-просмотрщики и т.п. кладут рядом с текстом картинку-снимок — тогда вставляем текст
  const onPaste = (e: ClipboardEvent) => {
    if (e.clipboardData.getData('text/plain')) return;
    const list = Array.from(e.clipboardData.files);
    if (list.length) {
      e.preventDefault();
      addFiles(list);
    }
  };

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    setDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  };

  const listId = `mentions-${channelId}`;
  return (
    <div
      className={`composer${dragging ? ' dragging' : ''}`}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDragging(false)}
      onDrop={onDrop}
    >
      {suggesting && (
        <div className="mention-popup" role="listbox" id={listId} aria-label="Участники">
          <div className="mention-popup-head">Участники</div>
          {suggestions.map((u, i) => (
            <div
              key={u.id}
              id={`${listId}-${u.id}`}
              role="option"
              aria-selected={i === selected}
              className={`mention-option${i === selected ? ' selected' : ''}`}
              onMouseEnter={() => setSelected(i)}
              // mousedown, а не click: поле ввода не теряет фокус
              onMouseDown={(e) => {
                e.preventDefault();
                insertMention(u);
              }}
            >
              <Avatar name={u.display_name} src={u.avatar_path} id={u.id} size={24} />
              <span className="ellipsis">{u.display_name}</span>
              <span className="muted small ellipsis">@{u.username}</span>
            </div>
          ))}
        </div>
      )}
      {reply && (
        <div className="reply-bar">
          <span className="ellipsis">
            Ответ пользователю <strong>{reply.author_name}</strong>
          </span>
          <button
            className="icon-btn small"
            title="Отменить ответ (Esc)"
            aria-label="Отменить ответ"
            onClick={() => setReplyingTo(channelId, null)}
          >
            ✕
          </button>
        </div>
      )}
      {files.length > 0 && (
        <div className="upload-queue">
          {files.map((f) => (
            <div key={f.key} className="upload-preview">
              {f.url ? (
                <img src={f.url} alt={f.file.name} />
              ) : (
                <div className="upload-file">
                  <span className="file-icon" aria-hidden="true">
                    {fileIcon(f.file.name)}
                  </span>
                  <span className="ellipsis">{f.file.name}</span>
                  <span className="muted small">{formatSize(f.file.size)}</span>
                </div>
              )}
              <button
                className="icon-btn small"
                onClick={() => unstage(f.key)}
                title="Убрать"
                aria-label={`Убрать вложение «${f.file.name}»`}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      <div className={`composer-row${reply ? ' replying' : ''}`}>
        <button
          className="icon-btn"
          title="Прикрепить файлы"
          aria-label="Прикрепить файлы"
          onClick={() => fileInput.current?.click()}
        >
          ＋
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
        <textarea
          ref={ref}
          rows={1}
          value={text}
          placeholder={placeholder}
          aria-label={placeholder}
          aria-autocomplete="list"
          aria-controls={suggesting ? listId : undefined}
          aria-activedescendant={suggesting ? `${listId}-${suggestions[selected]?.id}` : undefined}
          onChange={(e) => {
            const v = e.target.value;
            setText(v);
            detectMention(v, e.target.selectionStart);
            if (v.trim()) sendTyping(channelId);
          }}
          onKeyDown={onKey}
          onKeyUp={(e) => ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) && onCaretMove()}
          onClick={onCaretMove}
          onBlur={() => setMention(null)}
          onPaste={onPaste}
          maxLength={4096}
        />
        <button
          ref={emojiBtn}
          className={`icon-btn${emojiOpen ? ' on' : ''}`}
          title="Эмодзи"
          aria-label="Эмодзи"
          aria-haspopup="dialog"
          aria-expanded={emojiOpen}
          onClick={() => setEmojiOpen((v) => !v)}
        >
          😊
        </button>
        <button
          className="icon-btn send-btn"
          title="Отправить"
          aria-label="Отправить"
          onClick={send}
          disabled={!text.trim() && !files.length}
        >
          ➤
        </button>
      </div>
      <div className="typing-line" aria-live="polite">
        {typists?.length ? (
          <>
            <span className="typing-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="ellipsis">{typingText(typists)}</span>
          </>
        ) : null}
      </div>
      {emojiOpen && emojiBtn.current && (
        <EmojiPicker anchor={emojiBtn.current} closeOnPick={false} onPick={insertText} onClose={() => setEmojiOpen(false)} />
      )}
    </div>
  );
}

// Кого можно упомянуть в канале: участники сервера, беседы или собеседник в личке (кроме себя)
function useCandidates(channelId: number, meId: number): Candidate[] {
  const view = useStore((s) => s.view);
  const serverMembers = useStore((s) => (view.kind === 'server' ? s.membersByServer[view.serverId] : undefined));
  const dm = useStore((s) => (view.kind === 'dm' ? s.dms.find((d) => d.channel_id === channelId) : undefined));
  const groupMembers = useChannelMembers((s) => (view.kind === 'group' ? s.byChannel[channelId] : undefined));
  return useMemo(() => {
    const list: Candidate[] = dm
      ? [{ id: dm.user_id, username: dm.username, display_name: dm.display_name, avatar_path: dm.avatar_path }]
      : serverMembers ?? groupMembers ?? [];
    return list.filter((u) => u.id !== meId);
  }, [dm, serverMembers, groupMembers, meId]);
}
