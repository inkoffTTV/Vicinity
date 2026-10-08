import { CSSProperties, FocusEvent, KeyboardEvent, MouseEvent, useEffect, useRef, useState } from 'react';
import { Message, parseTs, Reaction } from '../lib/api';
import { copyText } from '../lib/clipboard';
import { isEmojiOnly, mentionsUser, plainText } from '../lib/markdown';
import { usePins } from '../lib/pins';
import { useStore } from '../lib/store';
import { userMenuProps } from '../lib/userMenu';
import { useUserDirectory } from '../lib/users';
import { Attachment } from './Attachment';
import { Avatar } from './Avatar';
import { EmojiPicker } from './EmojiPicker';
import { Markdown } from './Markdown';

/** Ник подписчика: цветом профиля (Basic+), градиентом (Ultra) — utils/Tiers.h на сервере */
function authorNameStyle(msg: Message): { className: string; style?: CSSProperties } {
  const tier = msg.author_tier ?? 0;
  const color = msg.author_accent && /^#[0-9a-f]{6}$/i.test(msg.author_accent) ? msg.author_accent : '';
  if (tier < 1 || !color) return { className: '' };
  return {
    className: tier >= 3 ? ' tier-gradient' : ' tier-color',
    style: { ['--author-color' as string]: color } as CSSProperties,
  };
}

const QUICK_EMOJI = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '👀'];

interface Props {
  msg: Message;
  grouped: boolean;
  tapped: boolean;
  onTap: () => void;
  onImage: (src: string) => void;
  onMediaLoad: () => void;
  /** Подсветить после перехода к сообщению */
  flash: boolean;
  /** Может удалять чужие сообщения (владелец сервера) */
  canModerate: boolean;
  /** Может закреплять: есть права и сервер поддерживает закрепы */
  canPin: boolean;
  pinned: boolean;
}

export function MessageRow({ msg, grouped, tapped, onTap, onImage, onMediaLoad, flash, canModerate, canPin, pinned }: Props) {
  const me = useStore((s) => s.me)!;
  const editingId = useStore((s) => s.editing);
  const setEditing = useStore((s) => s.setEditing);
  const setReplyingTo = useStore((s) => s.setReplyingTo);
  const showProfile = useStore((s) => s.showProfile);
  const react = useStore((s) => s.react);
  const deleteMessage = useStore((s) => s.deleteMessage);
  const retrySend = useStore((s) => s.retrySend);
  const discardSend = useStore((s) => s.discardSend);
  const toast = useStore((s) => s.toast);
  const [picker, setPicker] = useState(false);
  const [fullPicker, setFullPicker] = useState(false);
  const reactBtn = useRef<HTMLButtonElement>(null);
  const mine = msg.author_id === me.user_id;
  const time = parseTs(msg.created_at);
  const editing = editingId === msg.id;
  const mentioned = !mine && mentionsUser(msg.text, me.username);

  const pick = (emoji: string) => {
    setPicker(false);
    void react(msg.channel_id, msg.id, emoji);
  };

  const remove = () => {
    if (confirm(mine ? 'Удалить сообщение?' : `Удалить сообщение ${msg.author_name}?`)) void deleteMessage(msg.channel_id, msg.id);
  };

  const copy = async () => {
    if (await copyText(msg.text)) toast('Текст скопирован');
    else toast('Не удалось скопировать', 'error');
  };

  const togglePin = () => {
    const pins = usePins.getState();
    void (pinned ? pins.unpin(msg.channel_id, msg.id) : pins.pin(msg.channel_id, msg.id));
  };

  // Тап по ссылке, картинке или кнопке делает своё, а не открывает панель действий
  const onClick = (e: MouseEvent) => {
    if (isTouch && !msg.local && !(e.target as HTMLElement).closest('a, button, img, video, audio, textarea, [role=button]'))
      onTap();
  };

  // Фокус ушёл из панели (Tab дальше, клик мимо) — быстрые реакции закрываются
  const onActionsBlur = (e: FocusEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPicker(false);
  };

  const classes = ['msg'];
  if (grouped) classes.push('grouped');
  if (editing) classes.push('editing');
  if (msg.local) classes.push(msg.local === 'sending' ? 'pending' : 'failed');
  if (mentioned) classes.push('mentioned');
  if (flash) classes.push('flash');
  // Только что пришедшее сообщение появляется с анимацией (theme.css .msg.fresh)
  const [fresh] = useState(() => Date.now() - time.getTime() < 8000);
  if (fresh) classes.push('fresh');
  const nameStyle = authorNameStyle(msg);

  return (
    <div className={classes.join(' ')} data-mid={msg.id} onClick={onClick} onMouseLeave={() => setPicker(false)}>
      {msg.reply_to ? <ReplyQuote msg={msg} /> : null}
      <div className="msg-main">
        <div className="msg-gutter">
          {grouped ? (
            <span className="msg-time-hover" title={time.toLocaleString('ru-RU')}>
              {time.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
            </span>
          ) : (
            <button
              className="plain"
              onClick={() => showProfile(msg.author_id)}
              tabIndex={-1}
              aria-hidden="true"
              {...userMenuProps(msg.author_id)}
            >
              <Avatar name={msg.author_name} src={msg.author_avatar} id={msg.author_id} size={40} />
            </button>
          )}
        </div>
        <div className="msg-body">
          {!grouped && (
            <div className="msg-meta">
              <button
                className={`msg-author plain${nameStyle.className}`}
                style={nameStyle.style}
                onClick={() => showProfile(msg.author_id)}
                {...userMenuProps(msg.author_id)}
              >
                {msg.author_name}
              </button>
              <span className="msg-time" title={time.toLocaleString('ru-RU')}>
                {formatTime(time)}
              </span>
            </div>
          )}
          {pinned && (
            <span className="msg-pin-flag" title="Закреплённое сообщение" aria-label="Закреплённое сообщение">
              📌
            </span>
          )}
          {editing ? (
            <EditBox msg={msg} onDone={() => setEditing(null)} />
          ) : (
            msg.text && (
              <div className={`msg-text${isEmojiOnly(msg.text) ? ' jumbo' : ''}`}>
                <Markdown text={msg.text} />
                {msg.edited && (
                  <span
                    className="msg-edited"
                    title={msg.edited_at ? `Изменено ${new Date(msg.edited_at).toLocaleString('ru-RU')}` : 'Сообщение изменено'}
                  >
                    {' '}
                    (изменено)
                  </span>
                )}
              </div>
            )
          )}
          <Attachment msg={msg} onImage={onImage} onMediaLoad={onMediaLoad} />
          {msg.reactions.length > 0 && (
            <div className="reactions">
              {msg.reactions.map((r) => (
                <ReactionButton key={r.emoji} r={r} mine={r.users.includes(me.user_id)} onToggle={() => pick(r.emoji)} />
              ))}
            </div>
          )}
          {msg.local === 'failed' && msg.nonce && (
            <div className="msg-failed small">
              Не отправлено.{' '}
              <button className="link-btn" onClick={() => retrySend(msg.nonce!)}>
                Повторить
              </button>{' '}
              ·{' '}
              <button className="link-btn" onClick={() => discardSend(msg.nonce!)}>
                Удалить
              </button>
            </div>
          )}
        </div>
      </div>
      {!msg.local && (
        <div
          className={`msg-actions${picker || tapped ? ' show' : ''}`}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.key === 'Escape' && picker && (e.stopPropagation(), setPicker(false))}
          onBlur={onActionsBlur}
        >
          <button
            ref={reactBtn}
            className="icon-btn small"
            title="Реакция"
            aria-label="Реакция"
            aria-haspopup="true"
            aria-expanded={picker}
            onClick={() => setPicker((v) => !v)}
          >
            😊
          </button>
          {/* Быстрые реакции сразу за кнопкой — следующие по Tab */}
          {picker && (
            <div className="emoji-picker" role="menu">
              {QUICK_EMOJI.map((e) => (
                <button key={e} role="menuitem" onClick={() => pick(e)}>
                  {e}
                </button>
              ))}
              <button
                role="menuitem"
                className="more"
                title="Другие эмодзи"
                aria-label="Другие эмодзи"
                onClick={() => {
                  setPicker(false);
                  setFullPicker(true);
                }}
              >
                ＋
              </button>
            </div>
          )}
          {mine && msg.text && (
            <button className="icon-btn small" title="Изменить" aria-label="Изменить" onClick={() => setEditing(msg.id)}>
              ✏️
            </button>
          )}
          <button className="icon-btn small" title="Ответить" aria-label="Ответить" onClick={() => setReplyingTo(msg.channel_id, msg)}>
            ↩️
          </button>
          {canPin && (
            <button
              className={`icon-btn small${pinned ? ' on' : ''}`}
              title={pinned ? 'Открепить' : 'Закрепить'}
              aria-label={pinned ? 'Открепить' : 'Закрепить'}
              onClick={togglePin}
            >
              📌
            </button>
          )}
          {msg.text && (
            <button className="icon-btn small" title="Копировать текст" aria-label="Копировать текст" onClick={copy}>
              📋
            </button>
          )}
          {(mine || canModerate) && (
            <button className="icon-btn small" title="Удалить" aria-label="Удалить" onClick={remove}>
              🗑️
            </button>
          )}
        </div>
      )}
      {fullPicker && reactBtn.current && (
        <EmojiPicker anchor={reactBtn.current} onPick={(e) => void react(msg.channel_id, msg.id, e)} onClose={() => setFullPicker(false)} />
      )}
    </div>
  );
}

// Цитата сообщения, на которое ответили; щелчок — переход к нему
function ReplyQuote({ msg }: { msg: Message }) {
  const jumpTo = useStore((s) => s.jumpTo);
  const users = useUserDirectory();
  const r = msg.reply;
  if (!r)
    return (
      <div className="reply-quote deleted">
        <span className="reply-spine" aria-hidden="true" />
        <span className="muted">Исходное сообщение удалено</span>
      </div>
    );
  const author = users.byId.get(r.author_id);
  const preview = r.text ? plainText(r.text) : r.attachment ? '📎 Вложение' : '';
  return (
    <button
      className="reply-quote"
      onClick={(e) => {
        e.stopPropagation();
        void jumpTo(msg.channel_id, r.id);
      }}
      title="Перейти к исходному сообщению"
    >
      <span className="reply-spine" aria-hidden="true" />
      <Avatar name={r.author_name} src={author?.avatar_path} id={r.author_id} size={16} />
      <span className="reply-author">{r.author_name}</span>
      <span className="reply-text ellipsis">{preview}</span>
    </button>
  );
}

// Реакция; при наведении — кто её поставил
function ReactionButton({ r, mine, onToggle }: { r: Reaction; mine: boolean; onToggle: () => void }) {
  const users = useUserDirectory();
  const [tip, setTip] = useState(false);
  const names = r.users.map((id) => users.byId.get(id)?.display_name ?? 'Неизвестный');
  const shown = names.slice(0, 6).join(', ') + (names.length > 6 ? ` и ещё ${names.length - 6}` : '');
  return (
    <button
      className={`reaction${mine ? ' mine' : ''}`}
      aria-pressed={mine}
      aria-label={`${r.emoji} ${r.count}: ${shown}`}
      onClick={onToggle}
      onMouseEnter={() => setTip(true)}
      onMouseLeave={() => setTip(false)}
      onFocus={() => setTip(true)}
      onBlur={() => setTip(false)}
    >
      {r.emoji} <span>{r.count}</span>
      {tip && (
        <span className="reaction-tip" role="tooltip">
          <span className="reaction-tip-emoji">{r.emoji}</span>
          {shown}
        </span>
      )}
    </button>
  );
}

function EditBox({ msg, onDone }: { msg: Message; onDone: () => void }) {
  const [text, setText] = useState(msg.text);
  const [busy, setBusy] = useState(false);
  const editMessage = useStore((s) => s.editMessage);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current!;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const save = async () => {
    if (busy) return;
    const t = text.trim();
    if (!t || t === msg.text) return onDone();
    setBusy(true);
    if (await editMessage(msg.channel_id, msg.id, t)) onDone();
    else setBusy(false);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (composing(e)) return; // Enter/Esc в IME подтверждает или отменяет ввод иероглифов
    if (e.key === 'Escape') {
      // Esc отменяет правку — и только её (не закрывает заодно панели)
      e.preventDefault();
      onDone();
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void save();
    }
  };

  return (
    <div className="edit-box">
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        rows={Math.min(8, text.split('\n').length)}
        maxLength={4096}
        disabled={busy}
        aria-label="Изменить сообщение"
      />
      <div className="muted small">
        Esc — <button className="link-btn" onClick={onDone}>отмена</button> · Enter —{' '}
        <button className="link-btn" onClick={save} disabled={busy}>
          сохранить
        </button>
      </div>
    </div>
  );
}

export function formatTime(d: Date) {
  const now = new Date();
  const hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Сегодня в ${hm}`;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Вчера в ${hm}`;
  return `${d.toLocaleDateString('ru-RU')} ${hm}`;
}

const isTouch = typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches;

/** Клавиша относится к набору в IME (японский, китайский, корейский…), а не к редактору.
 *  Safari присылает подтверждающий Enter с isComposing=false, но keyCode 229. */
export function composing(e: KeyboardEvent) {
  return e.nativeEvent.isComposing || e.keyCode === 229;
}
