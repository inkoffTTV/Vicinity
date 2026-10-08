import { ReactNode, useState } from 'react';
import { NOTIFY_LEVELS, serverLevel, useNotifySettings } from '../lib/notify';
import { Popover } from './Popover';

interface Props {
  channelId: number;
  /** Сервер канала; null — личка или беседа */
  serverId: number | null;
  anchor?: HTMLElement;
  point?: { x: number; y: number };
  onClose: () => void;
  /** Пункты над уведомлениями (действия владельца с каналом) */
  children?: ReactNode;
}

/** Меню уведомлений канала: заглушить канал, уровень уведомлений сервера, разрешение браузера */
export function NotifyMenu({ channelId, serverId, anchor, point, onClose, children }: Props) {
  const level = useNotifySettings((s) => (serverId !== null ? serverLevel(s, serverId) : null));
  const muted = useNotifySettings((s) => s.muted.includes(channelId));
  const setServerLevel = useNotifySettings((s) => s.setServerLevel);
  const toggleMute = useNotifySettings((s) => s.toggleMute);
  const [permission, setPermission] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'denied');

  return (
    <Popover anchor={anchor} point={point} onClose={onClose} className="menu" role="menu" label="Уведомления">
      {children}
      <button
        role="menuitemcheckbox"
        aria-checked={muted}
        onClick={() => {
          toggleMute(channelId);
          onClose();
        }}
      >
        {muted ? '🔔 Включить уведомления канала' : '🔕 Заглушить канал'}
      </button>
      {serverId !== null && (
        <>
          <div className="menu-label">Уведомления сервера</div>
          {NOTIFY_LEVELS.map(([value, label]) => (
            <button
              key={value}
              role="menuitemradio"
              aria-checked={level === value}
              onClick={() => {
                setServerLevel(serverId, value);
                onClose();
              }}
            >
              <span className={`menu-radio${level === value ? ' on' : ''}`} aria-hidden="true" />
              {label}
            </button>
          ))}
        </>
      )}
      {permission === 'default' && (
        <button role="menuitem" onClick={() => void Notification.requestPermission().then(setPermission)}>
          🖥 Разрешить уведомления браузера
        </button>
      )}
    </Popover>
  );
}
