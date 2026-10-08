// Горячие клавиши приложения:
//   Ctrl+K (⌘K)        — быстрый переход
//   Alt+↑ / Alt+↓      — предыдущий / следующий канал в списке слева
//   Alt+Shift+↑ / ↓    — предыдущий / следующий канал с непрочитанным
//   Esc                — закрыть панель (поиск, меню на телефоне, участники поверх ленты)
// Окна (Modal) и всплывающие меню (Popover) закрываются по Esc сами.
import { useEffect, useRef } from 'react';
import { adjacentChannel, adjacentUnread } from './navigation';
import { useSearch } from './search';
import { useStore } from './store';

interface Handlers {
  toggleSwitcher: () => void;
  /** Закрыть открытую панель приложения, если она есть */
  closePanel: () => void;
}

const overlayOpen = () => !!document.querySelector('.modal-backdrop, .popover');

export function useShortcuts(handlers: Handlers) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    // В фазе перехвата: Alt+стрелки не должны достаться полю ввода (там ↑ — правка последнего сообщения)
    const onKeyCapture = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyK') {
        // Быстрый переход открывается поверх ленты, но не поверх других окон (кроме самого себя)
        if (overlayOpen() && !document.querySelector('.modal.switcher')) return;
        e.preventDefault();
        ref.current.toggleSwitcher();
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        if (overlayOpen()) return;
        e.preventDefault();
        e.stopPropagation();
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        const next = e.shiftKey ? adjacentUnread(dir) : adjacentChannel(dir);
        if (next) useStore.getState().open(next);
      }
    };
    // Esc — после того, как его обработали поле ввода (отмена ответа), окна и меню
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || overlayOpen()) return;
      const search = useSearch.getState();
      if (search.open) search.close();
      else ref.current.closePanel();
    };
    window.addEventListener('keydown', onKeyCapture, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKeyCapture, true);
      window.removeEventListener('keydown', onKey);
    };
  }, []);
}
