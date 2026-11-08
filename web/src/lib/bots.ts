// Боты на стороне клиента (docs/API.md §21): эфемерные сообщения, нажатия кнопок и их ответы, команды для «/».
// Отдельно от основного store: эфемерные сообщения не попадают в ленту, непрочитанное и «последнее сообщение».
import { create } from 'zustand';
import { api, ApiError, ChannelCommand, InlineButton, Message, withAttachmentUrl } from './api';
import { copyText } from './clipboard';
import { desktop } from './desktop';
import { useStore } from './store';
import { socket, WsEvent } from './ws';

// Ответа бота на нажатие ждём не дольше этого — потом кнопка снова доступна
const ANSWER_TIMEOUT = 10_000;
// Команды бота меняются редко: список канала живёт минуту (события об изменении нет)
const COMMANDS_TTL = 60_000;
// Эфемерных сообщений в канале держим не больше этого (старые уходят)
const MAX_EPHEMERAL = 20;

/** Заметный ответ бота (show_alert) — окно с текстом; url — ссылка, которую браузер не дал открыть сам */
export interface BotAlert {
  text: string;
  url?: string;
}

interface State {
  /** Эфемерные сообщения по каналам — видны только мне и до перезагрузки */
  ephemeral: Record<number, Message[]>;
  /** Нажатые кнопки, ждущие ответа бота: ключ кнопки → query_id ('' — запрос ещё идёт) */
  pending: Record<string, string>;
  commands: Record<number, { at: number; list: ChannelCommand[] }>;
  alert: BotAlert | null;
  hideEphemeral: (channelId: number, ephemeralId: string) => void;
  press: (msg: Message, button: InlineButton) => Promise<void>;
  loadCommands: (channelId: number) => void;
  closeAlert: () => void;
}

/** Ключ кнопки для индикатора ожидания */
export const buttonKey = (msg: Message, data: string) => `${msg.channel_id}:${msg.ephemeral_id || msg.id}:${data}`;

/** Ссылка кнопки — только http(s) (сервер проверяет так же) */
export function safeUrl(url: string | undefined): URL | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u : null;
  } catch {
    return null;
  }
}

const timers = new Map<string, number>();
// Ответ бота может прийти раньше, чем сервер вернул query_id нажатия
const early = new Map<string, WsEvent>();
const loadingCommands = new Set<number>();

export const useBots = create<State>((set, get) => ({
  ephemeral: {},
  pending: {},
  commands: {},
  alert: null,

  hideEphemeral: (channelId, ephemeralId) => {
    const list = get().ephemeral[channelId];
    if (!list) return;
    set({ ephemeral: { ...get().ephemeral, [channelId]: list.filter((m) => m.ephemeral_id !== ephemeralId) } });
  },

  press: async (msg, button) => {
    const toast = useStore.getState().toast;
    if (button.copy_text) {
      if (await copyText(button.copy_text.text)) toast('Скопировано');
      else toast('Не удалось скопировать', 'error');
      return;
    }
    const data = button.callback_data;
    if (!data) return;
    const key = buttonKey(msg, data);
    if (key in get().pending) return;
    set({ pending: { ...get().pending, [key]: '' } });
    window.clearTimeout(timers.get(key));
    timers.set(key, window.setTimeout(() => finish(key), ANSWER_TIMEOUT));
    try {
      const r = await api.pressButton(msg.channel_id, msg.ephemeral ? 0 : msg.id, data, msg.ephemeral ? msg.ephemeral_id : undefined);
      if (!(key in get().pending)) return;
      const answer = early.get(r.query_id);
      if (answer) {
        early.delete(r.query_id);
        finish(key);
        showAnswer(answer);
      } else set({ pending: { ...get().pending, [key]: r.query_id } });
    } catch (e) {
      finish(key);
      toast(e instanceof ApiError ? e.message : 'Не удалось нажать кнопку', 'error');
    }
  },

  loadCommands: (channelId) => {
    const cached = get().commands[channelId];
    if ((cached && Date.now() - cached.at < COMMANDS_TTL) || loadingCommands.has(channelId)) return;
    loadingCommands.add(channelId);
    api
      .channelCommands(channelId)
      .catch(() => [] as ChannelCommand[]) // старый сервер или нет доступа — просто без подсказок
      .then((list) => set({ commands: { ...get().commands, [channelId]: { at: Date.now(), list } } }))
      .finally(() => loadingCommands.delete(channelId));
  },

  closeAlert: () => set({ alert: null }),
}));

function finish(key: string) {
  window.clearTimeout(timers.get(key));
  timers.delete(key);
  const { [key]: _, ...rest } = useBots.getState().pending;
  useBots.setState({ pending: rest });
}

function showAnswer(ev: WsEvent) {
  const text = typeof ev.text === 'string' ? ev.text.trim() : '';
  if (text) {
    if (ev.show_alert) useBots.setState({ alert: { text } });
    else useStore.getState().toast(text);
  }
  const url = safeUrl(typeof ev.url === 'string' ? ev.url : undefined);
  if (!url) return;
  // Ответ приходит по WebSocket, без нажатия: браузер может заблокировать окно. С noopener window.open
  // всегда возвращает null, поэтому opener обнуляем сами. В ПК-приложении ссылка уходит в системный браузер
  const w = window.open(url.href, '_blank');
  if (w) {
    w.opener = null;
    return;
  }
  if (desktop) return;
  useBots.setState({ alert: { text: text || 'Бот предлагает открыть ссылку', url: url.href } });
}

socket.on((ev: WsEvent) => {
  const s = useBots.getState();
  switch (ev.type) {
    case 'ephemeral_message': {
      const raw = ev.message;
      if (!raw || typeof raw.ephemeral_id !== 'string') return;
      const channelId: number = ev.channel_id ?? raw.channel_id;
      const msg: Message = {
        ...withAttachmentUrl(raw as Message),
        id: 0,
        channel_id: channelId,
        reactions: [],
        ephemeral: true,
        author_bot: true,
        reply_markup: raw.reply_markup ?? null,
      };
      const list = (s.ephemeral[channelId] ?? []).filter((m) => m.ephemeral_id !== msg.ephemeral_id);
      useBots.setState({ ephemeral: { ...s.ephemeral, [channelId]: [...list, msg].slice(-MAX_EPHEMERAL) } });
      break;
    }
    case 'callback_answer': {
      const key = Object.keys(s.pending).find((k) => s.pending[k] === ev.query_id);
      if (key) {
        finish(key);
        showAnswer(ev);
      } else if (typeof ev.query_id === 'string') {
        // Нажатие ещё не вернуло query_id — запомним ответ ненадолго
        early.set(ev.query_id, ev);
        window.setTimeout(() => early.delete(ev.query_id), ANSWER_TIMEOUT);
      }
      break;
    }
    case 'server_member_left':
    case 'channel_member_left':
      // Бота могли убрать или удалить — подсказки команд перечитаются при следующем «/»
      if (Object.keys(s.commands).length) useBots.setState({ commands: {} });
      break;
    case 'channel_removed':
      if (s.ephemeral[ev.channel_id]) {
        const { [ev.channel_id]: _, ...rest } = s.ephemeral;
        useBots.setState({ ephemeral: rest });
      }
      break;
  }
});

// Другой пользователь вошёл в этой вкладке — чужие эфемерные сообщения и команды не показываем
let owner = useStore.getState().me?.user_id;
useStore.subscribe((st) => {
  const id = st.me?.user_id;
  if (id === owner) return;
  owner = id;
  useBots.setState({ ephemeral: {}, pending: {}, commands: {}, alert: null });
});
