import {
  ClipboardEvent,
  DragEvent,
  FocusEvent,
  Fragment,
  KeyboardEvent,
  MouseEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { api, ApiError, Message, parseTs, UserSummary } from '../lib/api';
import { useCall } from '../lib/call';
import { activeChannelId, drafts, useStore } from '../lib/store';
import { useVoice } from '../lib/voice';
import { Avatar } from './Avatar';
import { Modal } from './Modal';
import { VoiceRoom } from './VoiceRoom';

const QUICK_EMOJI = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '👀'];
const MAX_UPLOAD = 15 * 1024 * 1024;

interface Props {
  onMenu: () => void;
  membersOpen: boolean;
  onToggleMembers: () => void;
}

export function Chat({ onMenu, membersOpen, onToggleMembers }: Props) {
  const view = useStore((s) => s.view);
  const channelId = activeChannelId(view);
  const dm = useStore((s) => (view.kind === 'dm' ? s.dms.find((d) => d.channel_id === view.channelId) : undefined));
  const group = useStore((s) => (view.kind === 'group' ? s.groups.find((g) => g.id === view.channelId) : undefined));
  const serverChannel = useStore((s) =>
    view.kind === 'server' ? (s.channelsByServer[view.serverId] ?? []).find((c) => c.id === view.channelId) : undefined,
  );
  const presence = useStore((s) => (dm ? s.presence[dm.user_id] : undefined));
  const showProfile = useStore((s) => s.showProfile);
  const callIdle = useCall((s) => s.phase === 'idle');
  const startCall = useCall((s) => s.start);
  const inGroupRoom = useVoice((s) => group !== undefined && s.channelId === group.id);
  const joinVoice = useVoice((s) => s.join);
  const leaveVoice = useVoice((s) => s.leave);
  const [adding, setAdding] = useState(false);

  let title = '';
  let placeholder = '';
  if (dm) {
    title = dm.display_name;
    placeholder = `Написать @${dm.display_name}`;
  } else if (group) {
    title = group.name;
    placeholder = `Написать в «${group.name}»`;
  } else if (serverChannel) {
    title = serverChannel.name;
    placeholder = `Написать в #${serverChannel.name}`;
  }

  return (
    <div className="chat">
      <header className="chat-head">
        <button className="icon-btn menu-btn" onClick={onMenu} aria-label="Меню">
          ☰
        </button>
        {dm ? (
          <button className="chat-title clickable" onClick={() => showProfile(dm.user_id)}>
            <Avatar name={dm.display_name} src={dm.avatar_path} id={dm.user_id} size={26} presence={presence ?? 'offline'} />
            <strong className="ellipsis">{dm.display_name}</strong>
          </button>
        ) : (
          <div className="chat-title">
            <span className="muted">#</span>
            <strong className="ellipsis">{title}</strong>
          </div>
        )}
        <div className="grow" />
        {dm && (
          <button
            className="icon-btn"
            title="Позвонить"
            aria-label="Позвонить"
            disabled={!callIdle}
            onClick={() => void startCall(dm.user_id, dm.display_name)}
          >
            📞
          </button>
        )}
        {group && (
          <button
            className={`icon-btn${inGroupRoom ? ' on' : ''}`}
            title={inGroupRoom ? 'Выйти из голосовой комнаты' : 'Голосовая комната'}
            aria-label={inGroupRoom ? 'Выйти из голосовой комнаты' : 'Голосовая комната'}
            aria-pressed={inGroupRoom}
            onClick={() => (inGroupRoom ? leaveVoice() : void joinVoice(group.id))}
          >
            🎙
          </button>
        )}
        {(view.kind === 'group' || view.kind === 'server') && (
          <button className="icon-btn" title="Добавить участника" aria-label="Добавить участника" onClick={() => setAdding(true)}>
            ➕
          </button>
        )}
        {view.kind === 'server' && (
          <button
            className={`icon-btn${membersOpen ? ' on' : ''}`}
            title="Участники"
            aria-label="Участники"
            aria-pressed={membersOpen}
            onClick={onToggleMembers}
          >
            👥
          </button>
        )}
      </header>
      {(dm || group) && channelId && <VoiceRoom channelId={channelId} />}
      {channelId ? (
        <>
          <MessageList key={channelId} channelId={channelId} />
          <Composer key={`c${channelId}`} channelId={channelId} placeholder={placeholder} />
        </>
      ) : (
        <div className="empty-state">В этом сервере пока нет текстовых каналов</div>
      )}
      {adding && <AddMemberDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

// ── Лента сообщений ──

function MessageList({ channelId }: { channelId: number }) {
  const messages = useStore((s) => s.messages[channelId]);
  const loading = useStore((s) => s.loadingChannel[channelId]);
  const hasMore = useStore((s) => s.hasMore[channelId]);
  const loadingOlder = useStore((s) => s.loadingOlder[channelId]);
  const loadOlder = useStore((s) => s.loadOlder);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  // Позиция от низа до подгрузки старых сообщений — чтобы видимое не прыгало
  const anchor = useRef<{ firstId: number; fromBottom: number } | null>(null);
  const lastRef = useRef<Message>();
  const [lightbox, setLightbox] = useState<string | null>(null);
  // На тач-экране панель действий открывается тапом по одному сообщению
  const [tapped, setTapped] = useState<number | null>(null);

  const older = () => {
    const el = scrollRef.current;
    if (!el || !messages?.length || hasMore !== true || loadingOlder) return;
    anchor.current = { firstId: messages[0].id, fromBottom: el.scrollHeight - el.scrollTop };
    void loadOlder(channelId);
  };

  const onScroll = () => {
    const el = scrollRef.current!;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (el.scrollTop < 200) older();
  };

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Своё новое сообщение — всегда прокручиваем к нему, даже если листали историю
    const last = messages?.[messages.length - 1];
    if (last !== lastRef.current && last?.local === 'sending') stick.current = true;
    lastRef.current = last;
    const a = anchor.current;
    if (a && messages?.length && messages[0].id !== a.firstId) {
      el.scrollTop = el.scrollHeight - a.fromBottom;
      anchor.current = null;
      return;
    }
    if (!loadingOlder) anchor.current = null;
    if (stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, loadingOlder]);

  // Поле ввода растёт, появляется превью вложения, открывается клавиатура — низ ленты остаётся на виду
  const mounted = !!messages;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [mounted]);

  // Картинки догружаются позже — держим низ, пока пользователь не листает вверх
  const onMediaLoad = () => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  };

  if (!messages) return <div className="messages center muted">{loading ? 'Загрузка…' : ''}</div>;

  return (
    <div className="messages" ref={scrollRef} onScroll={onScroll} role="log" aria-label="Сообщения">
      {messages.length === 0 && <div className="empty-state">Здесь пока пусто — напишите первым!</div>}
      {hasMore === true && (
        <div className="history-note">
          <button className="link-btn small" onClick={older} disabled={loadingOlder}>
            {loadingOlder ? 'Загрузка…' : 'Показать более ранние сообщения'}
          </button>
        </div>
      )}
      {hasMore == null && messages.length >= 50 && (
        <div className="history-note muted small">Показаны последние 50 сообщений</div>
      )}
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const d = parseTs(m.created_at);
        const newDay = !prev || parseTs(prev.created_at).toDateString() !== d.toDateString();
        const grouped =
          !newDay && prev && prev.author_id === m.author_id && d.getTime() - parseTs(prev.created_at).getTime() < 5 * 60_000;
        return (
          <Fragment key={m.id}>
            {newDay && (
              <div className="day-sep">
                <span>{d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
              </div>
            )}
            <MessageRow
              msg={m}
              grouped={!!grouped}
              tapped={tapped === m.id}
              onTap={() => setTapped((t) => (t === m.id ? null : m.id))}
              onImage={setLightbox}
              onMediaLoad={onMediaLoad}
            />
          </Fragment>
        );
      })}
      {lightbox && (
        <Modal onClose={() => setLightbox(null)} bare>
          <img className="lightbox" src={lightbox} alt="" onClick={() => setLightbox(null)} />
        </Modal>
      )}
    </div>
  );
}

function MessageRow({
  msg,
  grouped,
  tapped,
  onTap,
  onImage,
  onMediaLoad,
}: {
  msg: Message;
  grouped: boolean;
  tapped: boolean;
  onTap: () => void;
  onImage: (src: string) => void;
  onMediaLoad: () => void;
}) {
  const me = useStore((s) => s.me)!;
  const editingId = useStore((s) => s.editing);
  const setEditing = useStore((s) => s.setEditing);
  const showProfile = useStore((s) => s.showProfile);
  const react = useStore((s) => s.react);
  const deleteMessage = useStore((s) => s.deleteMessage);
  const retrySend = useStore((s) => s.retrySend);
  const discardSend = useStore((s) => s.discardSend);
  const [picker, setPicker] = useState(false);
  const mine = msg.author_id === me.user_id;
  const time = parseTs(msg.created_at);
  const editing = editingId === msg.id;

  const pick = (emoji: string) => {
    setPicker(false);
    void react(msg.channel_id, msg.id, emoji);
  };

  const remove = () => {
    if (confirm('Удалить сообщение?')) void deleteMessage(msg.channel_id, msg.id);
  };

  // Тап по ссылке, картинке или кнопке делает своё, а не открывает панель действий
  const onClick = (e: MouseEvent) => {
    if (isTouch && !msg.local && !(e.target as HTMLElement).closest('a, button, img, textarea')) onTap();
  };

  // Фокус ушёл из панели (Tab дальше, клик мимо) — палитра закрывается
  const onActionsBlur = (e: FocusEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPicker(false);
  };

  return (
    <div
      className={`msg${grouped ? ' grouped' : ''}${editing ? ' editing' : ''}${msg.local ? ` ${msg.local === 'sending' ? 'pending' : 'failed'}` : ''}`}
      onClick={onClick}
      onMouseLeave={() => setPicker(false)}
    >
      <div className="msg-gutter">
        {grouped ? (
          <span className="msg-time-hover">{time.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
        ) : (
          <button className="plain" onClick={() => showProfile(msg.author_id)} tabIndex={-1} aria-hidden="true">
            <Avatar name={msg.author_name} src={msg.author_avatar} id={msg.author_id} size={40} />
          </button>
        )}
      </div>
      <div className="msg-body">
        {!grouped && (
          <div className="msg-meta">
            <button className="msg-author plain" onClick={() => showProfile(msg.author_id)}>
              {msg.author_name}
            </button>
            <span className="msg-time" title={time.toLocaleString('ru-RU')}>
              {formatTime(time)}
            </span>
          </div>
        )}
        {editing ? (
          <EditBox msg={msg} onDone={() => setEditing(null)} />
        ) : (
          msg.text && (
            <div className="msg-text">
              <RichText text={msg.text} />
              {msg.edited && <span className="muted small"> (изменено)</span>}
            </div>
          )
        )}
        {msg.attachment && (
          <button className="plain attachment" onClick={() => onImage(msg.attachment)} aria-label="Открыть изображение">
            <img src={msg.attachment} alt="вложение" onLoad={onMediaLoad} />
          </button>
        )}
        {msg.reactions.length > 0 && (
          <div className="reactions">
            {msg.reactions.map((r) => (
              <button
                key={r.emoji}
                className={`reaction${r.users.includes(me.user_id) ? ' mine' : ''}`}
                aria-pressed={r.users.includes(me.user_id)}
                onClick={() => pick(r.emoji)}
              >
                {r.emoji} <span>{r.count}</span>
              </button>
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
      {!msg.local && (
        <div
          className={`msg-actions${picker || tapped ? ' show' : ''}`}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.key === 'Escape' && picker && (e.stopPropagation(), setPicker(false))}
          onBlur={onActionsBlur}
        >
          <button
            className="icon-btn small"
            title="Реакция"
            aria-label="Реакция"
            aria-haspopup="true"
            aria-expanded={picker}
            onClick={() => setPicker((v) => !v)}
          >
            😊
          </button>
          {mine && msg.text && (
            <button className="icon-btn small" title="Изменить" aria-label="Изменить" onClick={() => setEditing(msg.id)}>
              ✏️
            </button>
          )}
          {mine && (
            <button className="icon-btn small" title="Удалить" aria-label="Удалить" onClick={remove}>
              🗑️
            </button>
          )}
          {picker && (
            <div className="emoji-picker" role="menu">
              {QUICK_EMOJI.map((e) => (
                <button key={e} role="menuitem" onClick={() => pick(e)}>
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
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
    if (e.key === 'Escape') onDone();
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

// Текст с кликабельными ссылками; HTML не интерпретируется (React экранирует)
function RichText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<]+)/g);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <a key={i} href={p} target="_blank" rel="noopener noreferrer">
            {p}
          </a>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

function formatTime(d: Date) {
  const now = new Date();
  const hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Сегодня в ${hm}`;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Вчера в ${hm}`;
  return `${d.toLocaleDateString('ru-RU')} ${hm}`;
}

// ── Поле ввода ──

function Composer({ channelId, placeholder }: { channelId: number; placeholder: string }) {
  const toast = useStore((s) => s.toast);
  const setEditing = useStore((s) => s.setEditing);
  const sendMessage = useStore((s) => s.sendMessage);
  const me = useStore((s) => s.me)!;
  const messages = useStore((s) => s.messages[channelId]);
  const [text, setText] = useState(() => drafts.get(channelId) ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) ref.current?.focus();
  }, []);

  useEffect(() => {
    if (text) drafts.set(channelId, text);
    else drafts.delete(channelId);
  }, [channelId, text]);

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Автовысота поля
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 220) + 'px';
  }, [text]);

  const pickFile = (f: File | undefined | null) => {
    if (!f) return;
    if (!/^image\/(png|jpe?g|gif)$/.test(f.type)) return toast('Можно прикрепить только PNG, JPG или GIF', 'error');
    if (f.size > MAX_UPLOAD) return toast('Файл слишком большой (макс 15 МБ)', 'error');
    setFile(f);
  };

  // Сообщение сразу уходит в ленту как «отправляется»; поле очищается без ожидания сервера
  const send = () => {
    const t = text.trim();
    if (!t && !file) return;
    if (t.length > 4096) return toast('Сообщение слишком длинное (макс 4096 символов)', 'error');
    sendMessage(channelId, t, file);
    setText('');
    setFile(null);
    ref.current?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (composing(e)) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    } else if (e.key === 'ArrowUp' && !text && messages) {
      const last = [...messages].reverse().find((m) => m.author_id === me.user_id && m.text && !m.local);
      if (last) {
        e.preventDefault();
        setEditing(last.id);
      }
    }
  };

  // Office, PDF-просмотрщики и т.п. кладут рядом с текстом картинку-снимок — тогда вставляем текст
  const onPaste = (e: ClipboardEvent) => {
    if (e.clipboardData.getData('text/plain')) return;
    const f = Array.from(e.clipboardData.files)[0];
    if (f) {
      e.preventDefault();
      pickFile(f);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    pickFile(e.dataTransfer.files[0]);
  };

  return (
    <div
      className={`composer${dragging ? ' dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {preview && (
        <div className="upload-preview">
          <img src={preview} alt="" />
          <button className="icon-btn small" onClick={() => setFile(null)} title="Убрать" aria-label="Убрать вложение">
            ✕
          </button>
        </div>
      )}
      <div className="composer-row">
        <button
          className="icon-btn"
          title="Прикрепить изображение"
          aria-label="Прикрепить изображение"
          onClick={() => fileInput.current?.click()}
        >
          ＋
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/gif"
          hidden
          onChange={(e) => {
            pickFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <textarea
          ref={ref}
          rows={1}
          value={text}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          onPaste={onPaste}
          maxLength={4096}
        />
        <button
          className="icon-btn send-btn"
          title="Отправить"
          aria-label="Отправить"
          onClick={send}
          disabled={!text.trim() && !file}
        >
          ➤
        </button>
      </div>
    </div>
  );
}

const isTouch = typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches;

// Клавиша относится к набору в IME (японский, китайский, корейский…), а не к редактору.
// Safari присылает подтверждающий Enter с isComposing=false, но keyCode 229.
function composing(e: KeyboardEvent) {
  return e.nativeEvent.isComposing || e.keyCode === 229;
}

// ── Добавить участника в беседу/сервер ──

function AddMemberDialog({ onClose }: { onClose: () => void }) {
  const view = useStore((s) => s.view);
  const friends = useStore((s) => s.friends);
  const refreshServer = useStore((s) => s.refreshServer);
  const toast = useStore((s) => s.toast);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<UserSummary[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const query = q.trim();
    if (!query) return setResults(null);
    // Ответ на устаревший запрос (пользователь уже печатает дальше) не должен перетереть свежий
    let current = true;
    const t = window.setTimeout(() => {
      api.searchUsers(query).then(
        (r) => current && setResults(r),
        () => current && setResults([]),
      );
    }, 250);
    return () => {
      current = false;
      window.clearTimeout(t);
    };
  }, [q]);

  const add = async (u: UserSummary) => {
    if (busy) return;
    setBusy(true);
    try {
      if (view.kind === 'group') await api.addGroupMember(view.channelId, u.id);
      else if (view.kind === 'server') {
        await api.addServerMember(view.serverId, u.id);
        void refreshServer(view.serverId);
      }
      toast(`${u.display_name} добавлен(а)`);
      onClose();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Ошибка', 'error');
      setBusy(false);
    }
  };

  const list = results ?? friends;
  return (
    <Modal title="Добавить участника" onClose={onClose}>
      <input autoFocus placeholder="Поиск по логину или имени" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="user-list">
        {results === null && <div className="muted small">Друзья</div>}
        {list.length === 0 && <div className="muted">Никого не найдено</div>}
        {list.map((u) => (
          <div key={u.id} className="user-row">
            <Avatar name={u.display_name} src={u.avatar_path} id={u.id} size={32} />
            <div className="grow">
              <div>{u.display_name}</div>
              <div className="muted small">@{u.username}</div>
            </div>
            <button className="btn small primary" onClick={() => add(u)} disabled={busy}>
              Добавить
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}
