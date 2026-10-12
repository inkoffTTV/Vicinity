import { ChevronUp, ScreenShare, ScreenShareOff, Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import { screenQuality, TIER_NAMES, useMediaPrefs } from '../lib/media';
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

/** Кнопка показа экрана со значком качества и выбором «Плавность / Чёткость» */
export function ScreenShareControl({ active, activeLabel, onToggle, desktopPeer, btnClass }: Props) {
  const tier = useStore((s) => s.me?.subscription_tier ?? 0);
  const mode = useMediaPrefs((s) => s.screenMode);
  const q = screenQuality(tier, mode, { desktopPeer });
  const label = active && activeLabel ? activeLabel : q.label;
  const [menu, setMenu] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const title = active ? 'Остановить показ экрана' : 'Показать экран';
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

/** Выбор режима и объяснение, откуда взялось качество */
export function ScreenQualityPanel({ desktopPeer }: { desktopPeer?: boolean }) {
  const tier = useStore((s) => s.me?.subscription_tier ?? 0);
  const mode = useMediaPrefs((s) => s.screenMode);
  const setPrefs = useMediaPrefs((s) => s.set);
  const motion = screenQuality(tier, 'motion', { desktopPeer });
  const detail = screenQuality(tier, 'detail', { desktopPeer });
  return (
    <div className="stack screen-quality">
      <strong>Качество показа экрана</strong>
      <div className="seg" role="radiogroup" aria-label="Режим показа экрана">
        <button role="radio" aria-checked={mode === 'motion'} className={mode === 'motion' ? 'on' : ''} onClick={() => setPrefs({ screenMode: 'motion' })}>
          Плавность <span className="muted small">{motion.label}</span>
        </button>
        <button role="radio" aria-checked={mode === 'detail'} className={mode === 'detail' ? 'on' : ''} onClick={() => setPrefs({ screenMode: 'detail' })}>
          Чёткость <span className="muted small">{detail.label}</span>
        </button>
      </div>
      <div className="muted small">
        Подписка: {TIER_NAMES[Math.max(0, Math.min(3, tier))]}. Плавность — для игр и видео, чёткость — для текста и кода.
      </div>
      {motion.capped && <div className="muted small">У собеседника десктоп-клиент — не выше 1080p30.</div>}
      {motion.upgradable && (
        <div className="upgrade-hint">
          <Icon icon={Sparkles} size={16} anim="pulse" />
          <span>
            С подпиской <strong>Ultra</strong> — до 1440p и 60 кадров в секунду
            {tier < 2 ? ', со Standard — 1080p30' : ''}.
          </span>
        </div>
      )}
    </div>
  );
}
