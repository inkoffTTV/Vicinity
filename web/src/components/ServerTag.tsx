import { Crosshair, Crown, Flame, Gamepad2, Heart, Leaf, type LucideIcon, Moon, Music, Shield, Star, SquareTerminal, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError, api, ServerCard } from '../lib/api';
import { useStore } from '../lib/store';
import { Icon } from './Icon';
import { Popover } from './Popover';
import { ServerIcon } from './ServerRail';

/** Значки тега сервера — id совпадают с сервером (ServerController.cc, tagIcons) */
export const TAG_ICONS: { id: string; icon: LucideIcon; name: string }[] = [
  { id: 'zap', icon: Zap, name: 'Молния' },
  { id: 'crosshair', icon: Crosshair, name: 'Прицел' },
  { id: 'shield', icon: Shield, name: 'Щит' },
  { id: 'terminal', icon: SquareTerminal, name: 'Терминал' },
  { id: 'star', icon: Star, name: 'Звезда' },
  { id: 'flame', icon: Flame, name: 'Пламя' },
  { id: 'heart', icon: Heart, name: 'Сердце' },
  { id: 'gamepad', icon: Gamepad2, name: 'Геймпад' },
  { id: 'music', icon: Music, name: 'Музыка' },
  { id: 'moon', icon: Moon, name: 'Луна' },
  { id: 'leaf', icon: Leaf, name: 'Лист' },
  { id: 'crown', icon: Crown, name: 'Корона' },
];

export const tagIcon = (id: string | undefined) => TAG_ICONS.find((t) => t.id === id)?.icon ?? Zap;

/** Тег сервера у ника: «⚡ DIVE». С serverId — по нажатию мини-карточка сервера с «Вступить» */
export function ServerTag({ tag, icon, serverId, small }: { tag: string; icon?: string; serverId?: number; small?: boolean }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const body = (
    <>
      <Icon icon={tagIcon(icon)} size={small ? 11 : 12} />
      {tag}
    </>
  );
  if (!serverId)
    return (
      <span className={`server-tag${small ? ' small' : ''}`} title={`Тег сервера ${tag}`}>
        {body}
      </span>
    );
  return (
    <>
      <button
        type="button"
        className={`server-tag${small ? ' small' : ''}`}
        title={`Тег сервера ${tag}`}
        aria-haspopup="dialog"
        onClick={(e) => {
          e.stopPropagation();
          setAnchor(anchor ? null : e.currentTarget);
        }}
      >
        {body}
      </button>
      {anchor && <ServerCardPopover serverId={serverId} anchor={anchor} onClose={() => setAnchor(null)} />}
    </>
  );
}

function ServerCardPopover({ serverId, anchor, onClose }: { serverId: number; anchor: HTMLElement; onClose: () => void }) {
  const open = useStore((s) => s.open);
  const refreshServers = useStore((s) => s.refreshServers);
  const toast = useStore((s) => s.toast);
  const showProfile = useStore((s) => s.showProfile);
  const [card, setCard] = useState<ServerCard | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.serverCard(serverId).then(setCard, (e) => setError(e instanceof ApiError ? e.message : 'Ошибка'));
  }, [serverId]);

  const go = () => {
    onClose();
    showProfile(null);
    open({ kind: 'server', serverId, channelId: null });
  };

  const join = async () => {
    setBusy(true);
    try {
      await api.joinServer(serverId);
      await refreshServers();
      toast(`Вы вступили на сервер «${card?.name}»`);
      go();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Не удалось вступить', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover anchor={anchor} onClose={onClose} className="server-card" role="dialog" label="Сервер">
      {!card ? (
        <div className="server-card-body muted small">{error || 'Загрузка…'}</div>
      ) : (
        <>
          <div className="server-card-banner" />
          <div className="server-card-body">
            <span className="server-card-icon">
              {card.icon ? <ServerIcon name={card.name} icon={card.icon} /> : <Icon icon={tagIcon(card.tag_icon)} size={22} />}
            </span>
            <div className="server-card-title">
              <strong className="ellipsis">{card.name}</strong>
              {card.tag && <ServerTag tag={card.tag} icon={card.tag_icon} small />}
            </div>
            <div className="server-card-stats">
              <span>
                <i className="dot ok" /> {card.online} в сети
              </span>
              <span>
                <i className="dot muted-dot" /> {card.members} участников
              </span>
            </div>
            {card.description && <p className="server-card-desc">{card.description}</p>}
            {card.is_member ? (
              <button type="button" className="btn primary block" onClick={go}>
                Открыть сервер
              </button>
            ) : (
              <button type="button" className="btn primary block" disabled={busy} onClick={join}>
                Вступить
              </button>
            )}
          </div>
        </>
      )}
    </Popover>
  );
}
