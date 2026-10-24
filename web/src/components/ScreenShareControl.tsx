import { ChevronUp, Lock, ScreenShare, ScreenShareOff, Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import { canShareScreen, SCREEN_FPS, SCREEN_HEIGHTS, screenQuality, screenUnlockTier, TIER_NAMES, useMediaPrefs } from '../lib/media';
import { usePlan } from '../lib/plan';
import { useStore } from '../lib/store';
import { Icon } from './Icon';
import { Popover } from './Popover';

interface Props {
  /** Показ экрана идёт */
  active: boolean;
  /** Качество идущего показа («1440p60»); пока не показываем — то, что будет */
  activeLabel?: string;
  onToggle: () => void;
  /** Собеседник — десктоп (звонок 1:1): не выше 1080p30 */
  desktopPeer?: boolean;
  /** Класс кнопки (call-btn в звонке, stage-btn в голосовом канале) */
  btnClass: string;
}

/** Кнопка показа экрана со значком качества и выбором разрешения и частоты кадров */
export function ScreenShareControl({ active, activeLabel, onToggle, desktopPeer, btnClass }: Props) {
  const tier = useStore((s) => s.me?.subscription_tier ?? 0);
  const prefH = useMediaPrefs((s) => s.screenHeight);
  const prefF = useMediaPrefs((s) => s.screenFps);
  const plan = usePlan((s) => s.current.screen);
  const q = screenQuality(tier, { desktopPeer, height: prefH, fps: prefF, plan });
  const label = active && activeLabel ? activeLabel : q.label;
  const [menu, setMenu] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const title = active ? 'Остановить показ экрана' : 'Показать экран';
  // Телефоны (и приложение для Android) не умеют показывать экран — кнопки нет
  if (!canShareScreen()) return null;
  return (
    <span className="screen-ctl">
      <button
        className={`${btnClass}${active ? ' on' : ''}`}
        aria-pressed={active}
        title={`${title} (${label})`}
        aria-label={title}
        onClick={onToggle}
      >
        <Icon key={String(active)} icon={active ? ScreenShareOff : ScreenShare} anim="pop" size={22} />
        <span className={`quality-badge${active ? ' live' : ''}`} data-quality={label}>
          {label}
        </span>
      </button>
      <button
        ref={more}
        className="screen-ctl-more"
        title="Качество показа экрана"
        aria-label="Качество показа экрана"
        aria-haspopup="dialog"
        aria-expanded={menu}
        onClick={() => setMenu((v) => !v)}
      >
        <Icon icon={ChevronUp} size={14} />
      </button>
      {menu && more.current && (
        <Popover anchor={more.current} onClose={() => setMenu(false)} className="screen-quality-menu" role="dialog" label="Качество показа экрана">
          <ScreenQualityPanel desktopPeer={desktopPeer} />
        </Popover>
      )}
    </span>
  );
}

/** Разрешение и кадры в секунду — на выбор, что выше подписки — заперто с подсказкой */
export function ScreenQualityPanel({ desktopPeer }: { desktopPeer?: boolean }) {
  const tier = useStore((s) => s.me?.subscription_tier ?? 0);
  const prefH = useMediaPrefs((s) => s.screenHeight);
  const prefF = useMediaPrefs((s) => s.screenFps);
  const setPrefs = useMediaPrefs((s) => s.set);
  const screenAudio = useMediaPrefs((s) => s.screenAudio);
  const plan = usePlan((s) => s.current.screen);
  const plans = usePlan((s) => s.plans);
  const q = screenQuality(tier, { desktopPeer, height: prefH, fps: prefF, plan });
  const lockTitle = (height: number, fps: number) => {
    const t = screenUnlockTier(height, fps, plans);
    return t === null ? 'Нет в тарифах' : `Со ${TIER_NAMES[t]}`;
  };
  const chip = (kind: 'height' | 'fps', value: number) => {
    const locked = kind === 'height' ? value > q.limit.height : value > q.limit.fps;
    const on = kind === 'height' ? q.height === value : q.fps === value;
    const title = locked ? (q.capped && (value > 1080 || value > 30) ? 'Собеседник на десктопе — не выше 1080p30' : lockTitle(kind === 'height' ? value : 720, kind === 'fps' ? value : 15)) : undefined;
    return (
      <button
        key={value}
        role="radio"
        aria-checked={on}
        aria-disabled={locked}
        disabled={locked}
        title={title}
        className={`${on ? 'on' : ''}${locked ? ' locked' : ''}`}
        onClick={() => setPrefs(kind === 'height' ? { screenHeight: value } : { screenFps: value })}
      >
        {kind === 'height' ? `${value}p` : value}
        {locked && <Icon icon={Lock} size={12} />}
      </button>
    );
  };
  return (
    <div className="stack screen-quality">
      <strong>Качество показа экрана</strong>
      <span className="seg-label" id="sq-res">
        Разрешение
      </span>
      <div className="seg" role="radiogroup" aria-labelledby="sq-res">
        {SCREEN_HEIGHTS.map((h) => chip('height', h))}
      </div>
      <span className="seg-label" id="sq-fps">
        Кадров в секунду
      </span>
      <div className="seg" role="radiogroup" aria-labelledby="sq-fps">
        {SCREEN_FPS.map((f) => chip('fps', f))}
      </div>
      <label className="row screen-audio">
        <input type="checkbox" checked={screenAudio} onChange={(e) => setPrefs({ screenAudio: e.target.checked })} />
        <span>
          Звук экрана <span className="muted small">— включается со следующего показа; в окне выбора отметьте «Поделиться звуком»</span>
        </span>
      </label>
      <div className="muted small">
        Подписка: {TIER_NAMES[Math.max(0, Math.min(3, tier))]} — до {q.limit.height}p{q.limit.fps}. 60 кадров — для игр и видео, 30 и 15 — для
        текста и кода (и слабого интернета).
      </div>
      {q.capped && <div className="muted small">У собеседника десктоп-клиент — не выше 1080p30.</div>}
      {q.upgradable && (
        <div className="upgrade-hint">
          <Icon icon={Sparkles} size={16} anim="pulse" />
          <span>
            {tier < 1 ? 'С Basic — 1080p60, со Standard — 1440p30, ' : tier < 2 ? 'Со Standard — 1440p30, ' : ''}
            с <strong>Ultra</strong> — 1440p и 60 кадров в секунду.
          </span>
        </div>
      )}
    </div>
  );
}
