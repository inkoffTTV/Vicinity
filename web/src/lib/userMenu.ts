// Контекстное меню пользователя: правая кнопка мыши или долгое нажатие на имя/аватар
// (в ленте, списке участников, друзьях). Само меню — components/UserMenu.tsx.
import { MouseEvent, TouchEvent } from 'react';
import { create } from 'zustand';

interface State {
  at: { userId: number; point: { x: number; y: number } } | null;
  open: (userId: number, point: { x: number; y: number }) => void;
  close: () => void;
}

export const useUserMenu = create<State>((set) => ({
  at: null,
  open: (userId, point) => set({ at: { userId, point } }),
  close: () => set({ at: null }),
}));

const LONG_PRESS = 500;
let pressTimer: number | undefined;
let pressStart: { x: number; y: number } | null = null;
// Долгое нажатие открыло меню — следующий «клик» (отпускание пальца) не должен ничего открыть
let swallowClick = false;

const cancel = () => {
  window.clearTimeout(pressTimer);
  pressStart = null;
};

/** Обработчики для элемента, который представляет пользователя */
export function userMenuProps(userId: number) {
  return {
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // Android сам присылает contextmenu на долгое нажатие — свой таймер уже не нужен
      cancel();
      useUserMenu.getState().open(userId, { x: e.clientX, y: e.clientY });
    },
    onTouchStart: (e: TouchEvent) => {
      const t = e.touches[0];
      swallowClick = false;
      if (!t || e.touches.length > 1) return cancel();
      pressStart = { x: t.clientX, y: t.clientY };
      window.clearTimeout(pressTimer);
      pressTimer = window.setTimeout(() => {
        if (!pressStart) return;
        swallowClick = true;
        useUserMenu.getState().open(userId, pressStart);
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
