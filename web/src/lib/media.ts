import { create } from 'zustand';
import { api } from './api';
import { usePlan } from './plan';

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
  /** Показ экрана: плавность (60 к/с на Ultra) или чёткость текста */
  screenMode: ScreenMode;
  /** Усиление микрофона, 0…2 */
  micGain: number;
  /** Громкость собеседников, 0…2 (в звонке выше 1 не бывает — так устроен <audio>) */
  volume: number;
}

interface PrefsState extends MediaPrefs {
  set: (p: Partial<MediaPrefs>) => void;
}

const PREFS_KEY = 'vicinity.media';
const DEFAULTS: MediaPrefs = { inputId: '', outputId: '', screenMode: 'motion', micGain: 1, volume: 1 };
const clampLevel = (v: unknown, def: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(2, Math.max(0, v)) : def;

function loadPrefs(): MediaPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    return {
      inputId: typeof raw.inputId === 'string' ? raw.inputId : '',
      outputId: typeof raw.outputId === 'string' ? raw.outputId : '',
      screenMode: raw.screenMode === 'detail' ? 'detail' : 'motion',
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
    const { inputId, outputId, screenMode, micGain, volume } = get();
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ inputId, outputId, screenMode, micGain, volume }));
    } catch {
      /* приватный режим — настройки живут до перезагрузки */
    }
  },
}));

// ── ICE-серверы (STUN + временные учётки TURN с бэкенда, docs/API.md §12) ──

const FALLBACK_ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

export async function rtcIceServers(): Promise<RTCIceServer[]> {
  try {
    const list = await api.rtcIce();
    return list.length ? list : FALLBACK_ICE;
  } catch {
    return FALLBACK_ICE;
  }
}

// ── Качество показа экрана по подписке ──
// Потолок задаёт сервер (GET /subscription → screen {height, fps}, backend/utils/Tiers.cc):
// без подписки 1080p30, Basic 1080p60, Standard 1440p30, Ultra 1440p60. Выше 1440p не бывает:
// 4K съедает канал и процессор без заметной пользы. «Чёткость» — то же разрешение при 30 к/с.
// Десктоп-клиент декодирует H264 уровня 3.1 — собеседнику-десктопу больше 1080p30 не шлём.

export type ScreenMode = 'motion' | 'detail';

export interface ScreenQuality {
  width: number;
  height: number;
  fps: number;
  /** Потолок битрейта отправителя, бит/с */
  maxBitrate: number;
  /** «1440p60» — для значка в интерфейсе */
  label: string;
  /** Подписка ограничивает качество — есть смысл подсказать про Ultra */
  upgradable: boolean;
  /** Ограничено собеседником (десктоп) */
  capped: boolean;
  contentHint: 'motion' | 'detail';
}

export const TIER_NAMES = ['Без подписки', 'Basic', 'Standard', 'Ultra'];

/** Битрейт под разрешение и частоту: 1080p30 ≈ 4 Мбит/с, 1440p60 ≈ 9 Мбит/с */
function bitrateFor(height: number, fps: number): number {
  return Math.round(Math.min(10_000_000, 4_000_000 * ((height * height) / (1080 * 1080)) * Math.sqrt(fps / 30)));
}

export function screenQuality(tier: number, mode: ScreenMode, opts: { desktopPeer?: boolean } = {}): ScreenQuality {
  const plan = usePlan.getState().current.screen;
  let height = Math.min(plan.height, 1440);
  let fps = mode === 'motion' ? plan.fps : 30;
  let capped = false;
  if (opts.desktopPeer && (height > 1080 || fps > 30)) {
    height = Math.min(height, 1080);
    fps = 30;
    capped = true;
  }
  return {
    width: Math.round((height * 16) / 9),
    height,
    fps,
    maxBitrate: bitrateFor(height, fps),
    label: `${height}p${fps}`,
    upgradable: tier < 3,
    capped,
    contentHint: mode,
  };
}

/** Параметры getDisplayMedia под выбранное качество */
export function screenCaptureOptions(q: ScreenQuality): DisplayMediaStreamOptions {
  return {
    video: {
      width: { ideal: q.width, max: q.width },
      height: { ideal: q.height, max: q.height },
      frameRate: { ideal: q.fps, max: q.fps },
    },
    audio: false,
  };
}

/** Отладка и e2e: что последний раз запрашивалось у getDisplayMedia и как настроен отправитель */
export const mediaDebug: {
  screen: { label: string; options: DisplayMediaStreamOptions; params?: unknown } | null;
} = { screen: null };
(window as unknown as { __vicinityMedia: typeof mediaDebug }).__vicinityMedia = mediaDebug;

/** Открыть показ экрана в нужном качестве (подсказка содержимого и, если браузер дал больше, — подрезка) */
export async function openScreen(q: ScreenQuality): Promise<MediaStream> {
  const options = screenCaptureOptions(q);
  mediaDebug.screen = { label: q.label, options };
  const stream = await navigator.mediaDevices.getDisplayMedia(options);
  const track = stream.getVideoTracks()[0];
  if (track) {
    track.contentHint = q.contentHint;
    const s = track.getSettings();
    // Некоторые браузеры игнорируют max в getDisplayMedia — дожимаем applyConstraints
    if ((s.height ?? 0) > q.height || (s.width ?? 0) > q.width || (s.frameRate ?? 0) > q.fps + 1)
      await track
        .applyConstraints({ width: { max: q.width }, height: { max: q.height }, frameRate: { max: q.fps } })
        .catch(() => {});
  }
  return stream;
}

/** Отправитель экрана: битрейт, частота, что жертвовать при нехватке канала; кадр больше лимита — уменьшить */
export async function tuneScreenSender(sender: RTCRtpSender, q: ScreenQuality) {
  try {
    const p = sender.getParameters() as RTCRtpSendParameters & { degradationPreference?: string };
    if (!p.encodings?.length) return;
    const enc = p.encodings[0];
    enc.maxBitrate = q.maxBitrate;
    enc.maxFramerate = q.fps;
    const s = sender.track?.getSettings();
    const scale = Math.max(1, (s?.width ?? 0) / q.width, (s?.height ?? 0) / q.height);
    if (scale > 1) enc.scaleResolutionDownBy = scale;
    p.degradationPreference = q.contentHint === 'motion' ? 'maintain-framerate' : 'maintain-resolution';
    await sender.setParameters(p);
    if (mediaDebug.screen) mediaDebug.screen.params = sender.getParameters();
  } catch {
    /* остаются ограничения браузера */
  }
}

/** Отправитель камеры: 30 к/с, до 1.5 Мбит/с (1080p у Ultra — до 3 Мбит/с) */
export async function tuneCameraSender(sender: RTCRtpSender) {
  try {
    const p = sender.getParameters();
    if (!p.encodings?.length) return;
    p.encodings[0].maxBitrate = usePlan.getState().current.camera_height >= 1080 ? 3_000_000 : 1_500_000;
    p.encodings[0].maxFramerate = 30;
    await sender.setParameters(p);
  } catch {
    /* остаются ограничения браузера */
  }
}

/** Камера по подписке (GET /subscription, lib/plan.ts): 720p, у Ultra — 1080p; 30 к/с */
export function cameraConstraints(): MediaTrackConstraints {
  const h = usePlan.getState().current.camera_height;
  return { width: { ideal: Math.round((h * 16) / 9) }, height: { ideal: h }, frameRate: { ideal: 30, max: 30 } };
}
