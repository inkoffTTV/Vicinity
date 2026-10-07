import { Presence } from '../lib/api';

const COLORS = ['#5865f2', '#3ba55c', '#faa61a', '#ed4245', '#eb459e', '#9b59b6', '#1abc9c', '#e67e22'];

interface Props {
  name: string;
  src?: string;
  id?: number;
  size?: number;
  presence?: Presence;
  speaking?: boolean;
}

export function Avatar({ name, src, id = 0, size = 40, presence, speaking }: Props) {
  const letter = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      className={`avatar${speaking ? ' speaking' : ''}`}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {src ? (
        <img src={src} alt="" loading="lazy" />
      ) : (
        <span className="avatar-letter" style={{ background: COLORS[Math.abs(id) % COLORS.length] }}>
          {letter}
        </span>
      )}
      {presence && <span className={`presence-dot p-${presence}`} />}
    </span>
  );
}

export const PRESENCE_LABEL: Record<Presence, string> = {
  online: 'В сети',
  idle: 'Не активен',
  dnd: 'Не беспокоить',
  invisible: 'Невидимый',
  offline: 'Не в сети',
};
