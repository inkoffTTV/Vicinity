import { create } from 'zustand';

// Микрофон, камера и вывод звука — общее для голосовых каналов и звонков

export const HTTPS_REQUIRED =
  'Голос и звонки работают только по защищённому соединению — откройте Vicinity по адресу https://';

/** Браузер даёт микрофон только в защищённом контексте (https или localhost) */
export function mediaAvailable(): boolean {
  return window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;
}

export const canPickOutput = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
export const canShareScreen = () => !!navigator.mediaDevices?.getDisplayMedia;

export function micConstraints(deviceId: string): MediaTrackConstraints {
  return {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  };
}

export function stopStream(s: MediaStream | null) {
  s?.getTracks().forEach((t) => t.stop());
}

/** Микрофон с выбранного устройства; выбранное пропало — с устройства по умолчанию */
export async function openMic(deviceId: string): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: micConstraints(deviceId) });
  } catch (e) {
    if (!deviceId || !(e instanceof DOMException) || e.name !== 'OverconstrainedError') throw e;
    return navigator.mediaDevices.getUserMedia({ audio: micConstraints('') });
  }
}

/** Понятный текст ошибки getUserMedia/getDisplayMedia */
export function mediaError(e: unknown, what: 'mic' | 'camera' | 'screen' = 'mic'): string {
  const device = what === 'mic' ? 'микрофон' : what === 'camera' ? 'камеру' : 'экран';
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return what === 'screen' ? 'Показ экрана отменён' : `Нет доступа: разрешите ${device} в настройках сайта`;
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return what === 'mic' ? 'Микрофон не найден' : what === 'camera' ? 'Камера не найдена' : 'Экран недоступен';
  if (name === 'NotReadableError' || name === 'AbortError')
    return `Не удалось открыть ${device}: он занят другим приложением`;
  return `Не удалось включить ${device}`;
}

/** Направить звук элемента на выбранное устройство вывода (где браузер это умеет) */
export function applyOutput(el: HTMLMediaElement, deviceId: string) {
  if (!canPickOutput) return;
  el.setSinkId(deviceId).catch(() => {
    /* устройство отключили — играет устройство по умолчанию */
  });
}

// ── Настройки звука (запоминаются в браузере) ──

interface MediaPrefs {
  inputId: string;
  outputId: string;
  /** Усиление микрофона, 0…2 */
  micGain: number;
  /** Громкость собеседников, 0…2 (в звонке выше 1 не бывает — так устроен <audio>) */
  volume: number;
}

interface PrefsState extends MediaPrefs {
  set: (p: Partial<MediaPrefs>) => void;
}

const PREFS_KEY = 'vicinity.media';
const DEFAULTS: MediaPrefs = { inputId: '', outputId: '', micGain: 1, volume: 1 };
const clampLevel = (v: unknown, def: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(2, Math.max(0, v)) : def;

function loadPrefs(): MediaPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    return {
      inputId: typeof raw.inputId === 'string' ? raw.inputId : '',
      outputId: typeof raw.outputId === 'string' ? raw.outputId : '',
      micGain: clampLevel(raw.micGain, DEFAULTS.micGain),
      volume: clampLevel(raw.volume, DEFAULTS.volume),
    };
  } catch {
    return DEFAULTS;
  }
}

export const useMediaPrefs = create<PrefsState>((set, get) => ({
  ...loadPrefs(),
  set: (p) => {
    set(p);
    const { inputId, outputId, micGain, volume } = get();
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ inputId, outputId, micGain, volume }));
    } catch {
      /* приватный режим — настройки живут до перезагрузки */
    }
  },
}));
