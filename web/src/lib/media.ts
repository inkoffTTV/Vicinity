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

/** Обработка микрофона с учётом профиля ввода (Настройки → Голос и видео) */
// rnnoise — поток дальше пройдёт через RNNoise: встроенное шумоподавление браузера тогда выключаем,
// иначе голос давят дважды и он звучит «металлически» (эхоподавление и АРУ остаются)
export function micConstraints(deviceId: string, p: MediaPrefs = useMediaPrefs.getState(), rnnoise = false): MediaTrackConstraints {
  const e = effectiveProcessing(p);
  return {
    channelCount: 1,
    echoCancellation: e.echo,
    noiseSuppression: e.noise !== 'off' && !rnnoise,
    autoGainControl: e.agc,
    // «Усиленное» — изоляция голоса, где браузер её умеет (Chrome на macOS/Windows); остальные ограничение пропустят
    ...(e.noise === 'max' && !rnnoise ? ({ voiceIsolation: true } as MediaTrackConstraints) : {}),
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  };
}

export type InputProfile = 'iso' | 'studio' | 'custom';
export type NoiseMode = 'off' | 'std' | 'max';

export interface Processing {
  autoSens: boolean;
  noise: NoiseMode;
  echo: boolean;
  agc: boolean;
}

/** Профили ввода (макет 03): «Изоляция голоса» и «Студия» задают обработку сами */
export const INPUT_PROFILES: Record<Exclude<InputProfile, 'custom'>, Processing> = {
  iso: { autoSens: true, noise: 'max', echo: true, agc: true },
  studio: { autoSens: false, noise: 'off', echo: false, agc: false },
};

export function effectiveProcessing(p: MediaPrefs): Processing {
  if (p.inputProfile !== 'custom') return INPUT_PROFILES[p.inputProfile];
  return { autoSens: p.autoSens, noise: p.noise, echo: p.echo, agc: p.agc };
}

/** Ключ обработки: поменялся — микрофон надо открыть заново */
export const processingKey = (p: MediaPrefs) => JSON.stringify({ ...effectiveProcessing(p), denoise: p.denoise });

/** Порог «говорит» в единицах RMS 16-битного звука; автоматический — как раньше (≈ −39 дБ) */
export const AUTO_SPEAK_RMS = 380;
export function speakThreshold(p: MediaPrefs = useMediaPrefs.getState()): number {
  return effectiveProcessing(p).autoSens ? AUTO_SPEAK_RMS : 32768 * Math.pow(10, p.thresholdDb / 20);
}

// Поток, собранный из другого (RNNoise): остановить его — значит остановить и исходный микрофон, и контекст
const cleanups = new WeakMap<MediaStream, () => void>();

export function stopStream(s: MediaStream | null) {
  if (!s) return;
  s.getTracks().forEach((t) => t.stop());
  cleanups.get(s)?.();
  cleanups.delete(s);
}

/** RNNoise включён в настройках и браузер его потянет */
export const wantDenoise = () => useMediaPrefs.getState().denoise && canDenoise();

/** Микрофон с выбранного устройства; выбранное пропало — с устройства по умолчанию.
 *  С включённым RNNoise поток проходит через worklet шумоподавления (звонки). inline — RNNoise вставит
 *  вызывающий в свой же AudioContext (голосовые каналы): поток без второго контекста, только без
 *  встроенного шумоподавления браузера */
export async function openMic(deviceId: string, opts: { inline?: boolean } = {}): Promise<MediaStream> {
  const rnnoise = wantDenoise();
  let mic: MediaStream;
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(deviceId, undefined, rnnoise) });
  } catch (e) {
    if (!deviceId || !(e instanceof DOMException) || e.name !== 'OverconstrainedError') throw e;
    mic = await navigator.mediaDevices.getUserMedia({ audio: micConstraints('', undefined, rnnoise) });
  }
  return rnnoise && !opts.inline ? denoise(mic) : mic;
}

/**
 * Узел RNNoise в данном контексте (модель загружена и готова). Голосовые каналы ставят его прямо в свой
 * граф: один контекст — одни часы, без моста MediaStream между контекстами, который рвётся (треск),
 * когда другое приложение забирает звуковое устройство (alt-tab в игру).
 */
export async function createDenoiseNode(ctx: BaseAudioContext): Promise<AudioWorkletNode> {
  useDenoise.setState({ status: 'loading', error: '' });
  try {
    await ctx.audioWorklet.addModule(DENOISE_URL);
    const node = new AudioWorkletNode(ctx, 'vicinity-denoise', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    await new Promise<void>((resolve, reject) => {
      node.port.onmessage = (e) => {
        if (e.data?.ready) resolve();
        else if (e.data?.error) reject(new Error(String(e.data.error)));
      };
      window.setTimeout(() => reject(new Error('Модель не загрузилась за 20 с')), 20_000);
    });
    useDenoise.setState({ status: 'on', error: '' });
    return node;
  } catch (e) {
    useDenoise.setState({ status: 'error', error: e instanceof Error ? e.message : 'Не удалось загрузить RNNoise' });
    throw e;
  }
}

// ── RNNoise: нейросетевое шумоподавление (public/worklets/voice-denoise.js) ──

export type DenoiseStatus = 'off' | 'loading' | 'on' | 'error';
/** Состояние RNNoise — для подсказки в настройках голоса */
export const useDenoise = create<{ status: DenoiseStatus; error: string }>(() => ({ status: 'off', error: '' }));

const DENOISE_URL = `${import.meta.env.BASE_URL}worklets/voice-denoise.js`;
const canDenoise = () => typeof AudioWorkletNode !== 'undefined' && typeof WebAssembly !== 'undefined';

/** Пропустить микрофон через RNNoise; не получилось (нет worklet, не загрузился wasm) — отдать как есть */
async function denoise(mic: MediaStream): Promise<MediaStream> {
  if (!canDenoise()) {
    useDenoise.setState({ status: 'error', error: 'Браузер не поддерживает AudioWorklet' });
    return mic;
  }
  useDenoise.setState({ status: 'loading', error: '' });
  let ctx: AudioContext | null = null;
  try {
    // RNNoise обучен на 48 кГц; Firefox не примет микрофон в контекст с другой частотой — тогда родная частота
    try {
      ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
      ctx.createMediaStreamSource(mic).disconnect();
    } catch {
      void ctx?.close().catch(() => {});
      ctx = new AudioContext({ latencyHint: 'interactive' });
    }
    void ctx.resume().catch(() => {});
    await ctx.audioWorklet.addModule(DENOISE_URL);
    const node = new AudioWorkletNode(ctx, 'vicinity-denoise', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    const ready = new Promise<void>((resolve, reject) => {
      node.port.onmessage = (e) => {
        if (e.data?.ready) resolve();
        else if (e.data?.error) reject(new Error(String(e.data.error)));
      };
      window.setTimeout(() => reject(new Error('Модель не загрузилась за 20 с')), 20_000);
    });
    const source = ctx.createMediaStreamSource(mic);
    const dest = ctx.createMediaStreamDestination();
    source.connect(node).connect(dest);
    await ready;
    const out = dest.stream;
    const audioCtx = ctx;
    cleanups.set(out, () => {
      mic.getTracks().forEach((t) => t.stop());
      void audioCtx.close().catch(() => {});
      if (useDenoise.getState().status === 'on') useDenoise.setState({ status: 'off' });
    });
    // Исходный микрофон отвалился (устройство отключили) — выходная дорожка тоже должна закончиться
    mic.getAudioTracks()[0]?.addEventListener('ended', () => out.getAudioTracks().forEach((t) => t.stop()));
    useDenoise.setState({ status: 'on', error: '' });
    return out;
  } catch (e) {
    void ctx?.close().catch(() => {});
    useDenoise.setState({ status: 'error', error: e instanceof Error ? e.message : 'Не удалось загрузить RNNoise' });
    return mic;
  }
}

/** Понятный текст ошибки getUserMedia/getDisplayMedia */
export function mediaError(e: unknown, what: 'mic' | 'camera' | 'screen' = 'mic'): string {
  const device = what === 'mic' ? 'микрофон' : what === 'camera' ? 'камеру' : 'экран';
  const name = e instanceof DOMException ? e.name : '';
  // В ПК-приложении отмена окна выбора экрана приходит как AbortError
  if (what === 'screen' && name === 'AbortError') return 'Показ экрана отменён';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return what === 'screen' ? 'Показ экрана отменён' : `Нет доступа: разрешите ${device} в настройках сайта`;
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return what === 'mic' ? 'Микрофон не найден' : what === 'camera' ? 'Камера не найдена' : 'Экран недоступен';
  if (name === 'NotReadableError' || name === 'AbortError')
    return `Не удалось открыть ${device}: он занят другим приложением`;
  return `Не удалось включить ${device}`;
}

/** То же для AudioContext (Chrome 110+): звук, который идёт через контекст, а не через <audio> */
export function applyOutputToContext(ctx: AudioContext, deviceId: string) {
  const c = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
  if (!canPickOutput || typeof c.setSinkId !== 'function') return;
  void c.setSinkId(deviceId || '').catch(() => {});
}

/** Направить звук элемента на выбранное устройство вывода (где браузер это умеет) */
export function applyOutput(el: HTMLMediaElement, deviceId: string) {
  if (!canPickOutput) return;
  el.setSinkId(deviceId).catch(() => {
    /* устройство отключили — играет устройство по умолчанию */
  });
}

// ── Настройки звука (запоминаются в браузере) ──

export interface MediaPrefs {
  inputId: string;
  outputId: string;
  cameraId: string;
  inputProfile: InputProfile;
  /** Ручные значения профиля «Пользовательский» */
  autoSens: boolean;
  noise: NoiseMode;
  echo: boolean;
  agc: boolean;
  /** Порог срабатывания при ручной чувствительности, дБ (−100…0) */
  thresholdDb: number;
  /** Режим рации: голос идёт, только пока зажата клавиша */
  ptt: boolean;
  /** KeyboardEvent.code */
  pttKey: string;
  /** Задержка отпускания, мс */
  pttDelay: number;
  /** Показ экрана: плавность (60 к/с на Ultra) или чёткость текста */
  screenMode: ScreenMode;
  /** Показ экрана со звуком (вкладки, окна, всего экрана — что даёт браузер) */
  screenAudio: boolean;
  /** Усиление микрофона, 0…2 */
  micGain: number;
  /** Нейросетевое шумоподавление RNNoise поверх браузерного (загружает ~5 МБ модели); включено по умолчанию */
  denoise: boolean;
  /** Громкость собеседников, 0…2 (в звонке выше 1 не бывает — так устроен <audio>) */
  volume: number;
}

interface PrefsState extends MediaPrefs {
  set: (p: Partial<MediaPrefs>) => void;
}

const PREFS_KEY = 'vicinity.media';
const DEFAULTS: MediaPrefs = {
  inputId: '',
  outputId: '',
  cameraId: '',
  inputProfile: 'custom',
  autoSens: true,
  noise: 'std',
  echo: true,
  agc: true,
  thresholdDb: -45,
  ptt: false,
  pttKey: 'AltLeft',
  pttDelay: 200,
  screenMode: 'motion',
  screenAudio: true,
  micGain: 1,
  volume: 1,
  denoise: true,
};
const clampNum = (v: unknown, min: number, max: number, def: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
const clampLevel = (v: unknown, def: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(2, Math.max(0, v)) : def;

function loadPrefs(): MediaPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    return {
      inputId: typeof raw.inputId === 'string' ? raw.inputId : '',
      outputId: typeof raw.outputId === 'string' ? raw.outputId : '',
      cameraId: typeof raw.cameraId === 'string' ? raw.cameraId : '',
      inputProfile: raw.inputProfile === 'iso' || raw.inputProfile === 'studio' ? raw.inputProfile : 'custom',
      autoSens: bool(raw.autoSens, DEFAULTS.autoSens),
      noise: raw.noise === 'off' || raw.noise === 'max' ? raw.noise : 'std',
      echo: bool(raw.echo, DEFAULTS.echo),
      agc: bool(raw.agc, DEFAULTS.agc),
      thresholdDb: clampNum(raw.thresholdDb, -100, 0, DEFAULTS.thresholdDb),
      ptt: bool(raw.ptt, DEFAULTS.ptt),
      pttKey: typeof raw.pttKey === 'string' && raw.pttKey ? raw.pttKey : DEFAULTS.pttKey,
      pttDelay: clampNum(raw.pttDelay, 0, 1000, DEFAULTS.pttDelay),
      screenMode: raw.screenMode === 'detail' ? 'detail' : 'motion',
      screenAudio: bool(raw.screenAudio, DEFAULTS.screenAudio),
      micGain: clampLevel(raw.micGain, DEFAULTS.micGain),
      volume: clampLevel(raw.volume, DEFAULTS.volume),
      denoise: bool(raw.denoise, DEFAULTS.denoise),
    };
  } catch {
    return DEFAULTS;
  }
}

export const useMediaPrefs = create<PrefsState>((set, get) => ({
  ...loadPrefs(),
  set: (p) => {
    set(p);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { set: _set, ...prefs } = get();
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
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

/** Параметры getDisplayMedia под выбранное качество (и со звуком, если он включён в настройках) */
export function screenCaptureOptions(q: ScreenQuality, audio = useMediaPrefs.getState().screenAudio): DisplayMediaStreamOptions {
  return {
    video: {
      width: { ideal: q.width, max: q.width },
      height: { ideal: q.height, max: q.height },
      frameRate: { ideal: q.fps, max: q.fps },
    },
    // Звук как есть: без шумодава и эхоподавления (это музыка и игры, а не голос).
    // restrictOwnAudio — не захватывать звук самого Vicinity (голоса собеседников), где браузер это умеет
    audio: audio
      ? ({
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          suppressLocalAudioPlayback: false,
          restrictOwnAudio: true,
        } as MediaTrackConstraints)
      : false,
    // Chrome: предложить звук всего экрана и звук окна, а не только вкладки
    ...(audio ? ({ systemAudio: 'include', windowAudio: 'system' } as object) : {}),
  };
}

/** Звук экрана поверх микрофона — одной дорожкой (в звонке 1:1 линии фиксированы, новую не добавить) */
export interface ScreenMix {
  track: MediaStreamTrack;
  setMic(track: MediaStreamTrack | undefined): void;
  close(): void;
}

export function mixScreenAudio(mic: MediaStreamTrack | undefined, screen: MediaStreamTrack): ScreenMix {
  // 48 кГц — частота Opus в WebRTC: иначе смесь передискретизируется дважды. Firefox может не принять
  // дорожку с другой частотой — тогда контекст на частоте устройства
  let ctx: AudioContext;
  try {
    ctx = new AudioContext({ sampleRate: 48000 });
  } catch {
    ctx = new AudioContext();
  }
  const dest = ctx.createMediaStreamDestination();
  const scr = ctx.createMediaStreamSource(new MediaStream([screen]));
  scr.connect(dest);
  let micSrc: MediaStreamAudioSourceNode | null = null;
  const setMic = (t: MediaStreamTrack | undefined) => {
    micSrc?.disconnect();
    micSrc = t ? ctx.createMediaStreamSource(new MediaStream([t])) : null;
    micSrc?.connect(dest);
  };
  setMic(mic);
  void ctx.resume().catch(() => {});
  return {
    track: dest.stream.getAudioTracks()[0],
    setMic,
    close() {
      micSrc?.disconnect();
      scr.disconnect();
      void ctx.close().catch(() => {});
    },
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

// ── Видеокодек ──
// Браузер по умолчанию кодирует VP8 (или H264, если так попросили ради десктопа) программно — на 1440p60
// это упирается в процессор: кадры теряются, картинка мылится. Поэтому первым ставим кодек, который
// у этого компьютера кодирует видеокарта (Media Capabilities: powerEfficient), а без неё — VP8 для
// плавности или VP9 для чёткого текста. Остальные кодеки остаются в списке: собеседник выберет из них то,
// что умеет сам (десктоп ищет H264 по всему списку, порядок ему не важен).

type Target = { width: number; height: number; fps: number; maxBitrate: number };

const hwCache = new Map<string, Promise<boolean>>();

/** Кодирует ли видеокарта этот кодек в таком размере и частоте */
function hardwareEncodes(mime: string, t: Target): Promise<boolean> {
  const mc = navigator.mediaCapabilities;
  if (!mc?.encodingInfo) return Promise.resolve(false);
  const key = `${mime} ${t.width}x${t.height}@${t.fps}`;
  let r = hwCache.get(key);
  if (!r) {
    r = mc
      .encodingInfo({
        type: 'webrtc',
        video: { contentType: mime, width: t.width, height: t.height, bitrate: t.maxBitrate, framerate: t.fps },
      } as MediaEncodingConfiguration)
      .then((info) => info.supported && info.powerEfficient)
      .catch(() => false);
    hwCache.set(key, r);
  }
  return r;
}

export interface CodecChoice {
  /** Порядок MIME-типов: первый — желаемый */
  order: string[];
  /** Первый кодек кодирует видеокарта — несколько копий потока процессору не страшны */
  hardware: boolean;
}

/** Порядок кодеков для отправки видео такого размера; detail — чёткость важнее плавности */
export async function chooseVideoCodecs(t: Target, detail: boolean): Promise<CodecChoice> {
  // Аппаратные — по качеству на бит: VP9 и AV1 заметно лучше H264 на тексте и интерфейсах
  const candidates = ['video/VP9', 'video/AV1', 'video/H264'];
  const hw = await Promise.all(candidates.map((m) => hardwareEncodes(m, t)));
  const fast = candidates.filter((_, i) => hw[i]);
  const soft = detail ? ['video/VP9', 'video/VP8', 'video/H264'] : ['video/VP8', 'video/VP9', 'video/H264'];
  return { order: [...fast, ...soft.filter((m) => !fast.includes(m))], hardware: fast.length > 0 };
}

/** Применить порядок кодеков к линии; H264 внутри — packetization-mode=1 и Baseline первыми (как у десктопа) */
export function applyCodecOrder(t: RTCRtpTransceiver, order: string[]) {
  if (typeof t.setCodecPreferences !== 'function' || typeof RTCRtpReceiver.getCapabilities !== 'function') return;
  const codecs = RTCRtpReceiver.getCapabilities('video')?.codecs ?? [];
  const rank = (c: RTCRtpCodec) => {
    const i = order.findIndex((m) => m.toLowerCase() === c.mimeType.toLowerCase());
    // rtx, red, ulpfec и прочие служебные — после видеокодеков, но остаются в списке
    const base = (i === -1 ? order.length : i) * 10;
    if (c.mimeType.toLowerCase() !== 'video/h264') return base;
    const fmtp = c.sdpFmtpLine ?? '';
    if (!/packetization-mode=1/.test(fmtp)) return base + 3;
    return base + (/profile-level-id=42e01f/i.test(fmtp) ? 0 : /profile-level-id=42/i.test(fmtp) ? 1 : 2);
  };
  try {
    t.setCodecPreferences([...codecs].sort((a, b) => rank(a) - rank(b)));
  } catch {
    /* браузер оставит свой порядок */
  }
}

/**
 * Стартовый битрейт видео в удалённом описании (x-google-start-bitrate, только Chromium; остальные
 * браузеры параметр игнорируют). Без него оценка канала начинается с ~300 кбит/с, и первые секунды
 * трансляция выглядит мылом, пока скорость не разгонится.
 */
export function withStartBitrate(sdp: string, kbps: number): string {
  const nl = sdp.includes('\r\n') ? '\r\n' : '\n';
  const lines = sdp.split(/\r?\n/);
  // PT видеокодеков (без rtx, red, ulpfec) и у каких из них уже есть строка fmtp
  const videoPts = new Set<string>();
  const withFmtp = new Set<string>();
  let inVideo = false;
  for (const l of lines) {
    if (l.startsWith('m=')) inVideo = l.startsWith('m=video');
    const rtp = inVideo ? /^a=rtpmap:(\d+) (VP8|VP9|AV1|H264)\//i.exec(l) : null;
    if (rtp) videoPts.add(rtp[1]);
    const fmtp = /^a=fmtp:(\d+) /.exec(l);
    if (fmtp) withFmtp.add(fmtp[1]);
  }
  const param = `x-google-start-bitrate=${Math.round(kbps)}`;
  const out: string[] = [];
  for (const l of lines) {
    const fmtp = /^a=fmtp:(\d+) /.exec(l);
    if (fmtp && videoPts.has(fmtp[1]) && !l.includes('x-google-start-bitrate')) {
      out.push(`${l};${param}`);
      continue;
    }
    out.push(l);
    const rtp = /^a=rtpmap:(\d+) /.exec(l);
    if (rtp && videoPts.has(rtp[1]) && !withFmtp.has(rtp[1])) out.push(`a=fmtp:${rtp[1]} ${param}`);
  }
  return out.join(nl);
}

// Для e2e: выбор кодеков проверяется на настоящих SDP браузера
(window as unknown as { __vicinityCodecs: unknown }).__vicinityCodecs = {
  chooseVideoCodecs: (t: Target, detail: boolean) => chooseVideoCodecs(t, detail),
  applyCodecOrder: (t: RTCRtpTransceiver, order: string[]) => applyCodecOrder(t, order),
  withStartBitrate: (sdp: string, kbps: number) => withStartBitrate(sdp, kbps),
};

/** Отправитель экрана: битрейт, частота, что жертвовать при нехватке канала; кадр больше лимита — уменьшить */
export async function tuneScreenSender(sender: RTCRtpSender, q: ScreenQuality, share: { bitrate?: number; scale?: number } = {}) {
  try {
    const p = sender.getParameters() as RTCRtpSendParameters & { degradationPreference?: string };
    if (!p.encodings?.length) return;
    const enc = p.encodings[0];
    enc.maxBitrate = share.bitrate ?? q.maxBitrate;
    enc.maxFramerate = q.fps;
    const s = sender.track?.getSettings();
    const scale = Math.max(1, (s?.width ?? 0) / q.width, (s?.height ?? 0) / q.height) * (share.scale ?? 1);
    if (scale > 1) enc.scaleResolutionDownBy = scale;
    p.degradationPreference = q.contentHint === 'motion' ? 'maintain-framerate' : 'maintain-resolution';
    await sender.setParameters(p);
    if (mediaDebug.screen) mediaDebug.screen.params = sender.getParameters();
  } catch {
    /* остаются ограничения браузера */
  }
}

/** Камера как цель кодирования (для выбора кодека): размер по подписке, 30 к/с */
export function cameraTarget() {
  const height = usePlan.getState().current.camera_height;
  return { width: Math.round((height * 16) / 9), height, fps: 30, maxBitrate: height >= 1080 ? 3_000_000 : 1_500_000 };
}

/** Отправитель камеры: 30 к/с, до 1.5 Мбит/с (1080p у Ultra — до 3 Мбит/с) */
export async function tuneCameraSender(sender: RTCRtpSender) {
  try {
    const p = sender.getParameters();
    if (!p.encodings?.length) return;
    p.encodings[0].maxBitrate = cameraTarget().maxBitrate;
    p.encodings[0].maxFramerate = 30;
    await sender.setParameters(p);
  } catch {
    /* остаются ограничения браузера */
  }
}

/** Камера по подписке (GET /subscription, lib/plan.ts): 720p, у Ultra — 1080p; 30 к/с */
export function cameraConstraints(): MediaTrackConstraints {
  const h = usePlan.getState().current.camera_height;
  const id = useMediaPrefs.getState().cameraId;
  return {
    width: { ideal: Math.round((h * 16) / 9) },
    height: { ideal: h },
    frameRate: { ideal: 30, max: 30 },
    ...(id ? { deviceId: { ideal: id } } : {}),
  };
}

// ── Громкость отдельных трансляций (экран собеседника в звонке или в голосовом канале) ──
// Множитель 0…1 поверх общей громкости, запоминается по человеку: чей-то громкий экран убавил один раз.

const STREAM_VOLUME_KEY = 'vicinity.streamVolume';

function loadStreamVolumes(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(STREAM_VOLUME_KEY) ?? '{}');
    const out: Record<string, number> = {};
    if (raw && typeof raw === 'object')
      for (const [k, v] of Object.entries(raw)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.min(1, Math.max(0, v));
    return out;
  } catch {
    return {};
  }
}

export const useStreamVolume = create<{ volumes: Record<string, number>; set: (userId: number, v: number) => void }>((set, get) => ({
  volumes: loadStreamVolumes(),
  set: (userId, v) => {
    const volumes = { ...get().volumes, [String(userId)]: Math.min(1, Math.max(0, v)) };
    set({ volumes });
    try {
      localStorage.setItem(STREAM_VOLUME_KEY, JSON.stringify(volumes));
    } catch {
      /* приватный режим */
    }
  },
}));

/** Множитель громкости трансляции этого человека (1 — не трогали) */
export const streamGain = (volumes: Record<string, number>, userId: number) => volumes[String(userId)] ?? 1;
