import { ExternalLink } from 'lucide-react';
import { ReactNode } from 'react';
import { Connection, Presence } from '../../lib/api';
import { connectionType } from '../../lib/cosmetics';
import { badgeById } from '../../lib/badges';
import { NameStyle, nameCss } from '../../lib/nameStyle';
import { ProfileTheme, themeSurface } from '../../lib/profileTheme';
import { Avatar, PRESENCE_LABEL } from '../Avatar';
import { Markdown } from '../Markdown';
import { ServerIcon } from '../ServerRail';
import { Icon } from '../Icon';
import { ServerTag } from '../ServerTag';

export interface CardData {
  id: number;
  display_name: string;
  username: string;
  avatar_path: string;
  banner_path: string;
  /** Цвет баннера, если нет картинки (CSS-значение) */
  banner_color: string;
  pronouns: string;
  status_text: string;
  presence: Presence;
  bio: string;
  created_at: Date;
  badges: { id: string; label: string; color: string }[];
  badge: { id: number; name: string; icon: string; tag?: string; tag_icon?: string } | null;
  /** Значок из набора (lib/badges.ts) */
  badge_pick: string | null;
  connections: Connection[];
  frame: string | null;
  effect: string | null;
  name_style: NameStyle | null;
  /** Тема профиля: градиент карточки, подложка и цвет текста по контрасту */
  theme?: ProfileTheme | null;
}

/** Ссылка подключённого аккаунта: своя или по имени (Twitch, GitHub, Telegram…) */
export function connectionUrl(c: Connection): string {
  if (c.url) return c.url;
  return connectionType(c.type).url?.(c.name) ?? '';
}

export function ConnectionTile({ type }: { type: string }) {
  const t = connectionType(type);
  return (
    <span className="conn-tile" style={{ background: t.color }} aria-hidden="true">
      {t.icon ? (
        <svg viewBox="0 0 24 24" width="16" height="16">
          <path d={t.icon} fill="currentColor" />
        </svg>
      ) : (
        t.mark
      )}
    </span>
  );
}

/** Значок профиля из набора — рядом с именем в карточке и в панели пользователя */
export function BadgePick({ id, compact }: { id: string | null | undefined; compact?: boolean }) {
  const b = badgeById(id);
  if (!b) return null;
  return (
    <span className={`badge-pick${compact ? ' compact' : ''}`} title={b.label} aria-label={`Значок: ${b.label}`}>
      <span className="badge-pick-ico" style={{ color: b.color }}>
        <Icon icon={b.icon} size={compact ? 14 : 13} />
      </span>
      {!compact && b.label}
    </span>
  );
}

/** Карточка профиля: баннер, аватар с рамкой, статус, имя в выбранном стиле, бейджи, о себе, подключения */
export function ProfileCard({ d, actions, onBadge }: { d: CardData; actions?: ReactNode; onBadge?: () => void }) {
  return (
    <article
      className={`pcard${d.effect ? ` effect-${d.effect}` : ''}${d.theme ? ` themed${themeSurface(d.theme).light ? ' light' : ''}` : ''}`}
      style={d.theme ? themeSurface(d.theme).vars : undefined}
      aria-label={`Профиль ${d.display_name}`}
    >
      <div
        className="pcard-banner"
        style={d.banner_path ? { backgroundImage: `url("${d.banner_path}")` } : d.theme ? undefined : { background: d.banner_color }}
      />
      {d.effect && <div className={`pcard-effect fx-${d.effect}`} aria-hidden="true" />}
      <div className="pcard-head">
        <div className={`pcard-avatar${d.frame ? ` frame frame-${d.frame}` : ''}`}>
          <Avatar name={d.display_name} src={d.avatar_path} id={d.id} size={96} presence={d.presence} />
        </div>
        {d.status_text && (
          <div className="pcard-status" title={d.status_text}>
            {d.status_text}
          </div>
        )}
      </div>
      <div className="pcard-body">
        <h2 className="pcard-name">{d.name_style ? <span style={nameCss(d.name_style, 24)}>{d.display_name}</span> : d.display_name}</h2>
        <div className="pcard-sub">
          <span>@{d.username}</span>
          {d.pronouns && <span>• {d.pronouns}</span>}
          <BadgePick id={d.badge_pick} />
          {d.badge?.tag ? (
            <ServerTag tag={d.badge.tag} icon={d.badge.tag_icon} serverId={onBadge ? d.badge.id : undefined} />
          ) : d.badge && (
            <button type="button" className="pcard-guild" onClick={onBadge} title={d.badge.name} disabled={!onBadge}>
              <span className="pcard-guild-icon">
                <ServerIcon name={d.badge.name} icon={d.badge.icon} />
              </span>
              {d.badge.name.slice(0, 4).toUpperCase()}
            </button>
          )}
        </div>
        <div className="pcard-presence muted small">{PRESENCE_LABEL[d.presence] ?? ''}</div>
        {d.badges.length > 0 && (
          <div className="pcard-badges">
            {d.badges.map((b) => (
              <span key={b.id} className="pcard-badge" style={{ color: b.color, borderColor: b.color }}>
                {b.label}
              </span>
            ))}
          </div>
        )}
        {actions && <div className="pcard-actions">{actions}</div>}
        {d.bio && (
          <section>
            <h4>О себе</h4>
            <div className="bio">
              <Markdown text={d.bio} />
            </div>
          </section>
        )}
        <section>
          <h4>В Vicinity с</h4>
          <p>{d.created_at.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </section>
        {d.connections.length > 0 && (
          <section>
            <h4>Подключения</h4>
            <ul className="pcard-conns">
              {d.connections.map((c, i) => {
                const url = connectionUrl(c);
                return (
                  <li key={`${c.type}-${i}`}>
                    <ConnectionTile type={c.type} />
                    {url ? (
                      <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="ellipsis">
                        {c.name} <Icon icon={ExternalLink} size={12} />
                      </a>
                    ) : (
                      <span className="ellipsis">{c.name}</span>
                    )}
                    <span className="muted small">{connectionType(c.type).name}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </article>
  );
}
