// Всплывающие уведомления в приложении: баннер о новом сообщении в чате, который сейчас не открыт.
// Когда показывать, решает lib/notify.ts (заглушённые каналы, уровни серверов, «Не беспокоить», свои сообщения).
import { create } from 'zustand';

/** Не больше стольких баннеров сразу; более старые схлопываются в счётчик «Ещё N» */
export const MAX_POPUPS = 3;
/** Баннер скрывается сам через столько, если на него не навели */
export const POPUP_TTL = 5000;

export interface PopupInput {
  channelId: number;
  messageId: number;
  authorId: number;
  authorName: string;
  avatar: string;
  where: string;
  text: string;
  mentioned: boolean;
  /** Открыть чат на этом сообщении */
  open: () => void;
}

export interface Popup extends PopupInput {
  id: number;
  /** Сколько сообщений этого чата собрано в баннере */
  count: number;
  /** Меняется с каждым новым сообщением — перезапускает таймер скрытия */
  stamp: number;
}

interface State {
  list: Popup[];
  /** Сколько баннеров ушло из-за лимита, пока стопка не опустела */
  overflow: number;
  dismiss: (id: number) => void;
  clear: () => void;
}

let seq = 0;

/** Что сейчас на экране. Решает NotifyPopups: он знает про настройки, сцену звонка и мини-приложение */
export interface PopupSurface {
  /** Чат закрыт другим экраном (настройки, сцена звонка) — его сообщения тоже заслуживают баннера */
  chatHidden: boolean;
  /** Баннеры сейчас некуда показать (мини-приложение на весь экран телефона) — только звук */
  blocked: boolean;
}
let surface = (): PopupSurface => ({ chatHidden: false, blocked: false });
export const setPopupSurface = (fn: () => PopupSurface) => {
  surface = fn;
};
export const popupSurface = () => surface();

export const usePopups = create<State>((set, get) => ({
  list: [],
  overflow: 0,
  dismiss: (id) => {
    const list = get().list.filter((p) => p.id !== id);
    set({ list, overflow: list.length ? get().overflow : 0 });
  },
  clear: () => set({ list: [], overflow: 0 }),
}));

/** Показать баннер; новое сообщение того же чата обновляет его баннер, а не добавляет второй */
export function showPopup(p: PopupInput) {
  const { list, overflow } = usePopups.getState();
  const same = list.find((x) => x.channelId === p.channelId);
  const item: Popup = { ...p, id: same?.id ?? ++seq, count: (same?.count ?? 0) + 1, stamp: ++seq, mentioned: p.mentioned || !!same?.mentioned };
  // Новые сверху
  const rest = list.filter((x) => x !== same);
  const next = [item, ...rest];
  const dropped = Math.max(0, next.length - MAX_POPUPS);
  usePopups.setState({ list: next.slice(0, MAX_POPUPS), overflow: overflow + dropped });
}
