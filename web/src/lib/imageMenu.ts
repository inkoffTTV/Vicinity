// Контекстное меню картинки: правая кнопка мыши или долгое нажатие на вложение в ленте и в лайтбоксе.
// Само меню — components/ImageMenu.tsx; устроено как меню пользователя (lib/userMenu.ts).
import { MouseEvent, TouchEvent } from 'react';
import { create } from 'zustand';
import { Message, parseTs } from './api';
import { attachmentName } from './files';
import { useStore } from './store';

export interface ImageItem {
  /** Абсолютный адрес */
  url: string;
  name: string;
}

export interface ImageTarget extends ImageItem {
  /** Подряд идущие картинки того же автора в группе сообщений (вместе с этой); одна — не альбом */
  album: ImageItem[];
  /** Открыть в лайтбоксе; в самом лайтбоксе пункта нет */
  open?: () => void;
}

interface State {
  at: { target: ImageTarget; point: { x: number; y: number } } | null;
  open: (target: ImageTarget, point: { x: number; y: number }) => void;
  close: () => void;
}

export const useImageMenu = create<State>((set) => ({
  at: null,
  open: (target, point) => set({ at: { target, point } }),
  close: () => set({ at: null }),
}));

/** Адрес относительно страницы → абсолютный (для буфера обмена и ПК-приложения) */
export const absoluteUrl = (url: string) => new URL(url, window.location.href).href;

const isImage = (m: Message) => !!m.attachment && m.attachment_type !== 'file' && !m.local;

// Как в MessageList: сообщения одного автора подряд с промежутком меньше 5 минут — одна группа,
// ответ и новый день начинают новую
const GROUP_GAP = 5 * 60_000;
function sameGroup(prev: Message, m: Message): boolean {
  if (prev.author_id !== m.author_id || m.reply_to) return false;
  const a = parseTs(prev.created_at);
  const b = parseTs(m.created_at);
  return a.toDateString() === b.toDateString() && b.getTime() - a.getTime() < GROUP_GAP;
}

const itemOf = (m: Message): ImageItem => ({ url: absoluteUrl(m.attachment), name: attachmentName(m.attachment_name, m.attachment) });

/** Альбом вокруг сообщения: подряд идущие сообщения-картинки одной группы в загруженной ленте канала */
export function albumOf(msg: Message): ImageItem[] {
  const list = useStore.getState().messages[msg.channel_id] ?? [];
  const i = list.findIndex((m) => m.id === msg.id);
  if (!isImage(msg)) return [];
  if (i < 0) return [itemOf(msg)];
  const joins = (k: number) => k > 0 && k < list.length && isImage(list[k - 1]) && isImage(list[k]) && sameGroup(list[k - 1], list[k]);
  let start = i;
  while (joins(start)) start--;
  let end = i;
  while (joins(end + 1)) end++;
  return list.slice(start, end + 1).map(itemOf);
}

/** Цель меню для картинки сообщения */
export function imageTarget(msg: Message, open?: () => void): ImageTarget {
  return { ...itemOf(msg), album: albumOf(msg), open };
}

const LONG_PRESS = 500;
let pressTimer: number | undefined;
let pressStart: { x: number; y: number } | null = null;
// Долгое нажатие открыло меню — следующий «клик» (отпускание пальца) не должен открыть лайтбокс
let swallowClick = false;

const cancel = () => {
  window.clearTimeout(pressTimer);
  pressStart = null;
};

/** Обработчики для картинки; цель вычисляется в момент открытия — альбом по текущей ленте */
export function imageMenuProps(target: () => ImageTarget | null) {
  return {
    onContextMenu: (e: MouseEvent) => {
      const t = target();
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      // Android сам присылает contextmenu на долгое нажатие — свой таймер уже не нужен
      cancel();
      swallowClick = false;
      useImageMenu.getState().open(t, { x: e.clientX, y: e.clientY });
    },
    onTouchStart: (e: TouchEvent) => {
      const t = e.touches[0];
      swallowClick = false;
      if (!t || e.touches.length > 1) return cancel();
      pressStart = { x: t.clientX, y: t.clientY };
      window.clearTimeout(pressTimer);
      pressTimer = window.setTimeout(() => {
        const tg = pressStart && target();
        if (!pressStart || !tg) return;
        swallowClick = true;
        useImageMenu.getState().open(tg, pressStart);
        pressStart = null;
      }, LONG_PRESS);
    },
    onTouchMove: (e: TouchEvent) => {
      const t = e.touches[0];
      // Палец поехал — это прокрутка, а не долгое нажатие
      if (pressStart && t && Math.hypot(t.clientX - pressStart.x, t.clientY - pressStart.y) > 10) cancel();
    },
    onTouchEnd: cancel,
    onTouchCancel: cancel,
    onClickCapture: (e: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}
