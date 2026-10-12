// Режим рации (Настройки → Голос и видео): голос передаётся, только пока зажата назначенная клавиша,
// и ещё «задержку отпускания» после. Браузер слышит клавиши, только пока окно Vicinity активно.
import { create } from 'zustand';
import { useMediaPrefs } from './media';

export const usePtt = create<{ held: boolean }>(() => ({ held: false }));

export const pttHeld = () => usePtt.getState().held;

/** Человеческое название клавиши по KeyboardEvent.code */
export function keyName(code: string): string {
  const named: Record<string, string> = {
    AltLeft: 'Левый Alt',
    AltRight: 'Правый Alt',
    ControlLeft: 'Левый Ctrl',
    ControlRight: 'Правый Ctrl',
    ShiftLeft: 'Левый Shift',
    ShiftRight: 'Правый Shift',
    MetaLeft: 'Левый ⌘/Win',
    MetaRight: 'Правый ⌘/Win',
    Space: 'Пробел',
    CapsLock: 'Caps Lock',
    Backquote: '`',
    Tab: 'Tab',
  };
  if (named[code]) return named[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}

let release: number | undefined;

// Печатные клавиши в поле ввода — это набор текста, а не рация
const typing = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  const editable = !!t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
  return editable && /^(Key|Digit|Space|Backquote|Numpad)/.test(e.code);
};

function down(e: KeyboardEvent) {
  const p = useMediaPrefs.getState();
  if (!p.ptt || e.code !== p.pttKey || typing(e)) return;
  window.clearTimeout(release);
  if (!usePtt.getState().held) usePtt.setState({ held: true });
}

function up(e: KeyboardEvent) {
  const p = useMediaPrefs.getState();
  if (!p.ptt || e.code !== p.pttKey) return;
  // Отпущенный Alt в Firefox открывает меню браузера
  if (e.key === 'Alt') e.preventDefault();
  window.clearTimeout(release);
  release = window.setTimeout(() => usePtt.setState({ held: false }), p.pttDelay);
}

// Окно потеряло фокус — клавишу «отпустили»: keyup уже не придёт
function blur() {
  window.clearTimeout(release);
  if (usePtt.getState().held) usePtt.setState({ held: false });
}

window.addEventListener('keydown', down, true);
window.addEventListener('keyup', up, true);
window.addEventListener('blur', blur);
