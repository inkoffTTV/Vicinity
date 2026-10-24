import { Lock, Mic, Video } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  applyOutput,
  cameraConstraints,
  canPickOutput,
  canShareScreen,
  effectiveProcessing,
  InputProfile,
  mediaAvailable,
  mediaError,
  micConstraints,
  NoiseMode,
  SCREEN_FPS,
  SCREEN_HEIGHTS,
  screenQuality,
  stopStream,
  TIER_NAMES,
  useDenoise,
  useMediaPrefs,
} from '../../lib/media';
import { usePlan } from '../../lib/plan';
import { keyName } from '../../lib/ptt';
import { useStore } from '../../lib/store';
import { Icon } from '../Icon';
import { Segmented, Toggle } from '../SettingControls';

const BARS = 40;

function useDevices() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md?.enumerateDevices) return;
    const load = () => md.enumerateDevices().then(setDevices, () => {});
    void load();
    md.addEventListener('devicechange', load);
    return () => md.removeEventListener('devicechange', load);
  }, []);
  // «default» — то же, что пустой выбор («по умолчанию»)
  return (kind: MediaDeviceKind) => devices.filter((d) => d.kind === kind && d.deviceId && d.deviceId !== 'default');
}

function Slider({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  return (
    <label className="vs-slider">
      <span className="row-between">
        {label} <span className="muted small">{`${value}${unit}`}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

/** Полоски громкости: горят до текущего уровня; ниже порога — серые */
function Meter({ level, threshold }: { level: number; threshold: number | null }) {
  return (
    <div className="vs-meter" aria-hidden="true">
      {Array.from({ length: BARS }, (_, i) => {
        const at = (i + 0.5) / BARS;
        const lit = at < level;
        const below = threshold !== null && at < threshold;
        return <span key={i} className={lit ? (below ? 'lit below' : 'lit') : ''} />;
      })}
      {threshold !== null && <i className="vs-meter-thr" style={{ left: `${threshold * 100}%` }} />}
    </div>
  );
}

/** Проверка микрофона: открываем его с текущей обработкой, показываем уровень и даём услышать себя */
function useMicTest(on: boolean) {
  const prefs = useMediaPrefs();
  const [level, setLevel] = useState(0);
  const [error, setError] = useState('');
  const gainRef = useRef<GainNode | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!on) {
      setLevel(0);
      return;
    }
    let stop = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let raf = 0;
    setError('');
    navigator.mediaDevices
      .getUserMedia({ audio: micConstraints(prefs.inputId) })
      .then((s) => {
        if (stop) return stopStream(s);
        stream = s;
        ctx = new AudioContext();
        const src = ctx.createMediaStreamSource(s);
        const gain = ctx.createGain();
        gain.gain.value = useMediaPrefs.getState().micGain;
        gainRef.current = gain;
        const an = ctx.createAnalyser();
        an.fftSize = 1024;
        const dest = ctx.createMediaStreamDestination();
        src.connect(gain);
        gain.connect(an);
        gain.connect(dest);
        const audio = new Audio();
        audio.srcObject = dest.stream;
        audio.volume = Math.min(1, useMediaPrefs.getState().volume);
        applyOutput(audio, useMediaPrefs.getState().outputId);
        void audio.play().catch(() => {});
        audioRef.current = audio;
        const buf = new Float32Array(an.fftSize);
        const tick = () => {
          an.getFloatTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) sum += v * v;
          const db = 20 * Math.log10(Math.sqrt(sum / buf.length) || 1e-6);
          setLevel(Math.min(1, Math.max(0, (db + 100) / 100)));
          raf = requestAnimationFrame(tick);
        };
        tick();
      })
      .catch((e) => !stop && setError(mediaError(e)));
    return () => {
      stop = true;
      cancelAnimationFrame(raf);
      stopStream(stream);
      audioRef.current?.pause();
      audioRef.current = null;
      gainRef.current = null;
      void ctx?.close().catch(() => {});
    };
    // Обработка и устройство поменялись — открываем заново
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, prefs.inputId, JSON.stringify(effectiveProcessing(prefs))]);

  // Громкость и устройство вывода — на лету
  useEffect(() => {
    if (gainRef.current) gainRef.current.gain.value = prefs.micGain;
  }, [prefs.micGain]);
  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = Math.min(1, prefs.volume);
    applyOutput(audioRef.current, prefs.outputId);
  }, [prefs.volume, prefs.outputId]);

  return { level, error };
}

function CameraPreview({ deviceId }: { deviceId: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let stop = false;
    let stream: MediaStream | null = null;
    setError('');
    navigator.mediaDevices.getUserMedia({ video: cameraConstraints() }).then(
      (s) => {
        if (stop) return stopStream(s);
        stream = s;
        if (ref.current) ref.current.srcObject = s;
      },
      (e) => !stop && setError(mediaError(e, 'camera')),
    );
    return () => {
      stop = true;
      stopStream(stream);
    };
  }, [deviceId]);
  return (
    <div className="vs-cam">
      {error ? <span className="muted small">{error}</span> : <video ref={ref} autoPlay muted playsInline />}
      <span className="vs-cam-tag">Превью · {usePlan.getState().current.camera_height}p</span>
    </div>
  );
}

const PROFILES: { id: InputProfile; title: string; desc: string }[] = [
  { id: 'iso', title: 'Изоляция голоса', desc: 'Убираем шум и эхо — слышно только вас' },
  { id: 'studio', title: 'Студия', desc: 'Без обработки: чистый звук для хорошего микрофона' },
  { id: 'custom', title: 'Пользовательский', desc: 'Все параметры настраиваете вручную' },
];

/** Лестница качества демонстрации экрана — как в backend/utils/Tiers.cc */
const SCREEN_FALLBACK = [
  { tier: 0, height: 1080, fps: 30 },
  { tier: 1, height: 1080, fps: 60 },
  { tier: 2, height: 1440, fps: 30 },
  { tier: 3, height: 1440, fps: 60 },
];

/** Настройки → Голос и видео (макет 03): устройства, проверка, профиль ввода, обработка, рация, камера, экран */
export function VoiceScreen() {
  const denoise = useDenoise();
  const prefs = useMediaPrefs();
  const set = prefs.set;
  const devices = useDevices();
  const tier = useStore((s) => s.me?.subscription_tier ?? 0);
  const plans = usePlan((s) => s.plans);
  const [testing, setTesting] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const { level, error: testError } = useMicTest(testing);

  const eff = effectiveProcessing(prefs);
  const locked = prefs.inputProfile !== 'custom';
  const inputs = devices('audioinput');
  const outputs = devices('audiooutput');
  const cameras = devices('videoinput');
  const threshold = !eff.autoSens && !prefs.ptt ? (prefs.thresholdDb + 100) / 100 : null;

  // Назначение клавиши рации: следующая нажатая клавиша, Esc — отмена
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== 'Escape') set({ pttKey: e.code });
      setCapturing(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing, set]);

  const ladder = (plans.length ? plans.map((p) => ({ tier: p.tier, height: p.screen.height, fps: p.screen.fps })) : SCREEN_FALLBACK).sort((a, b) => a.tier - b.tier);
  const myTier = Math.max(0, Math.min(3, tier));
  const best = ladder.filter((q) => q.tier <= myTier).pop();
  const next = ladder.find((q) => q.tier > myTier && (q.height > (best?.height ?? 0) || q.fps > (best?.fps ?? 0)));

  if (!mediaAvailable())
    return (
      <div className="settings voice-screen">
        <header className="settings-head">
          <h1 className="display">Голос и видео</h1>
          <p className="muted">Голос и камера работают только по https://</p>
        </header>
      </div>
    );

  return (
    <div className="settings voice-screen">
      <header className="settings-head">
        <h1 className="display">Голос и видео</h1>
        <p className="muted">Устройства, обработка звука и камера</p>
      </header>

      <section className="acc-section" aria-labelledby="vs-dev">
        <h2 id="vs-dev" className="acc-section-title">
          Устройства
        </h2>
        <div className="acc-box vs-grid">
          <div className="vs-col">
            <label>
              Микрофон
              <select value={prefs.inputId} onChange={(e) => set({ inputId: e.target.value })}>
                <option value="">По умолчанию</option>
                {inputs.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Микрофон ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
            <Slider label="Громкость микрофона" value={Math.round(prefs.micGain * 100)} min={0} max={200} step={5} unit="%" onChange={(v) => set({ micGain: v / 100 })} />
          </div>
          <div className="vs-col">
            {canPickOutput ? (
              <label>
                Динамик
                <select value={prefs.outputId} onChange={(e) => set({ outputId: e.target.value })}>
                  <option value="">По умолчанию</option>
                  {outputs.map((d, i) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Устройство вывода ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="muted small">Этот браузер не позволяет выбрать устройство вывода звука.</span>
            )}
            <Slider label="Громкость звука" value={Math.round(prefs.volume * 100)} min={0} max={200} step={5} unit="%" onChange={(v) => set({ volume: v / 100 })} />
          </div>
        </div>
      </section>

      <section className="acc-section" aria-labelledby="vs-test">
        <h2 id="vs-test" className="acc-section-title">
          Проверка микрофона
        </h2>
        <div className="acc-box vs-test">
          <button type="button" className={`btn${testing ? '' : ' primary'}`} aria-pressed={testing} onClick={() => setTesting(!testing)}>
            <Icon icon={Mic} size={16} /> {testing ? 'Остановить' : 'Проверить'}
          </button>
          <div className="grow vs-test-body">
            <Meter level={level} threshold={threshold} />
            <span className="muted small">
              {testError || (testing ? 'Говорите — вы слышите себя в динамике. Полоски показывают громкость.' : 'Нажмите «Проверить» и скажите что-нибудь — мы воспроизведём ваш голос.')}
            </span>
          </div>
        </div>
      </section>

      <section className="acc-section" aria-labelledby="vs-prof">
        <h2 id="vs-prof" className="acc-section-title">
          Профиль ввода
        </h2>
        <div className="vs-profiles" role="radiogroup" aria-labelledby="vs-prof">
          {PROFILES.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={prefs.inputProfile === p.id} className={`vs-profile${prefs.inputProfile === p.id ? ' on' : ''}`} onClick={() => set({ inputProfile: p.id })}>
              <span className="vs-radio" aria-hidden="true" />
              <span>
                <strong>{p.title}</strong>
                <span className="muted small">{p.desc}</span>
              </span>
            </button>
          ))}
        </div>
        {locked && (
          <p className="muted small vs-note">
            Настройки ниже заданы профилем «{PROFILES.find((p) => p.id === prefs.inputProfile)?.title}». Чтобы менять их вручную, выберите «Пользовательский».
          </p>
        )}
        <fieldset className={`acc-box vs-proc${locked ? ' locked' : ''}`} disabled={locked}>
          <Toggle label="Автоматически определять чувствительность" hint="Микрофон включается, когда вы начинаете говорить" checked={eff.autoSens} onChange={(autoSens) => set({ autoSens })} />
          {!eff.autoSens && (
            <div className="vs-threshold">
              <Slider label="Порог срабатывания" value={prefs.thresholdDb} min={-100} max={0} step={1} unit=" дБ" onChange={(thresholdDb) => set({ thresholdDb })} />
              <Meter level={level} threshold={(prefs.thresholdDb + 100) / 100} />
              <span className="muted small">Тише порога — микрофон молчит, громче — передаём голос. {testing ? '' : 'Включите проверку выше, чтобы видеть свой уровень.'}</span>
            </div>
          )}
          <div className="acc-sep" />
          <Segmented<NoiseMode>
            label="Шумоподавление"
            value={eff.noise}
            options={[
              ['off', 'Выключено'],
              ['std', 'Стандартное'],
              ['max', 'Усиленное'],
            ]}
            onChange={(noise) => set({ noise })}
          />
          <span className="muted small vs-hint">Убирает клавиатуру, вентилятор и фоновые голоса</span>
          <Toggle
            label="Нейросетевое шумоподавление (RNNoise)"
            hint={
              denoise.status === 'on'
                ? 'Работает: голос проходит через модель RNNoise'
                : denoise.status === 'loading'
                  ? 'Загружается модель…'
                  : denoise.status === 'error'
                    ? `Не удалось: ${denoise.error}`
                    : 'Поверх браузерного: модель RNNoise убирает шум улицы и клавиатуры, а между фразами фон прижимается гейтом. Модель ~5 МБ грузится при входе в голос'
            }
            checked={prefs.denoise}
            onChange={(denoise) => set({ denoise })}
          />
          <div className="acc-sep" />
          <Toggle label="Эхоподавление" hint="Собеседники не услышат себя из ваших динамиков" checked={eff.echo} onChange={(echo) => set({ echo })} />
          <Toggle label="Автоусиление" hint="Выравнивает громкость, если вы отходите от микрофона" checked={eff.agc} onChange={(agc) => set({ agc })} />
        </fieldset>
      </section>

      <section className="acc-section" aria-labelledby="vs-ptt">
        <h2 id="vs-ptt" className="acc-section-title">
          Режим рации
        </h2>
        <div className="acc-box">
          <Toggle label="Режим рации" hint="Голос передаётся, только пока зажата клавиша. Работает, пока окно Vicinity активно." checked={prefs.ptt} onChange={(ptt) => set({ ptt })} />
          {prefs.ptt && (
            <>
              <div className="acc-sep" />
              <div className="acc-row">
                <div className="grow">
                  <span className="acc-label">Клавиша</span>
                  <span className="acc-value">{capturing ? 'Нажмите клавишу… Esc — отмена' : keyName(prefs.pttKey)}</span>
                </div>
                <button type="button" className={`btn${capturing ? ' primary vs-capturing' : ''}`} onClick={() => setCapturing(!capturing)}>
                  {capturing ? 'Отмена' : 'Изменить'}
                </button>
              </div>
              <Slider label="Задержка отпускания" value={prefs.pttDelay} min={0} max={1000} step={20} unit=" мс" onChange={(pttDelay) => set({ pttDelay })} />
            </>
          )}
        </div>
      </section>

      <section className="acc-section" aria-labelledby="vs-video">
        <h2 id="vs-video" className="acc-section-title">
          Видео
        </h2>
        <div className="acc-box vs-video">
          <div className="vs-col">
            <label>
              Камера
              <select value={prefs.cameraId} onChange={(e) => set({ cameraId: e.target.value })}>
                <option value="">По умолчанию</option>
                {cameras.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Камера ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn" aria-pressed={camOn} onClick={() => setCamOn(!camOn)}>
              <Icon icon={Video} size={16} /> {camOn ? 'Выключить превью' : 'Проверить видео'}
            </button>
            <span className="muted small">Превью видите только вы. Камера выключится, когда вы закроете настройки.</span>
          </div>
          {camOn ? (
            <CameraPreview deviceId={prefs.cameraId} />
          ) : (
            <div className="vs-cam off">
              <Icon icon={Video} size={28} />
              <span className="muted small">Камера выключена</span>
            </div>
          )}
        </div>
      </section>

      {canShareScreen() && (
        <section className="acc-section" aria-labelledby="vs-screen">
          <h2 id="vs-screen" className="acc-section-title">
            Качество демонстрации экрана
          </h2>
          <div className="acc-box">
            <div className="vs-ladder" role="list">
              {ladder.map((q) => {
                const avail = q.tier <= myTier;
                const mine = q.tier === myTier;
                return (
                  <div key={q.tier} role="listitem" className={`vs-rung${mine ? ' on' : ''}${avail ? '' : ' locked'}`}>
                    <strong>
                      {q.height}p {q.fps}
                    </strong>
                    <span className={`vs-tier t${q.tier}`}>{TIER_NAMES[q.tier]}</span>
                    {!avail && <Icon icon={Lock} size={12} />}
                  </div>
                );
              })}
            </div>
            <span className="muted small">
              Ваш предел — {best ? `${best.height}p ${best.fps}` : '1080p 30'}.{' '}
              {next ? `${next.height}p ${next.fps} открывается с ${TIER_NAMES[next.tier]}. Подписку выдаёт администратор.` : 'Это максимальное качество.'}
            </span>
            <div className="acc-sep" />
            <Segmented
              label="Разрешение"
              value={String(screenQuality(myTier).height)}
              options={SCREEN_HEIGHTS.filter((h) => h <= screenQuality(myTier).limit.height).map((h) => [String(h), `${h}p`] as [string, string])}
              onChange={(v) => set({ screenHeight: Number(v) })}
            />
            <Segmented
              label="Кадров в секунду"
              value={String(screenQuality(myTier).fps)}
              options={SCREEN_FPS.filter((f) => f <= screenQuality(myTier).limit.fps).map((f) => [String(f), String(f)] as [string, string])}
              onChange={(v) => set({ screenFps: Number(v) })}
            />
            <span className="muted small vs-hint">60 кадров — для игр и видео, 30 и 15 — для текста и кода и слабого интернета. Что выше подписки — не показано.</span>
          </div>
        </section>
      )}
    </div>
  );
}
