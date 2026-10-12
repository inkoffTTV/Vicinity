import { UserX } from 'lucide-react';
import { useStore } from '../lib/store';
import { userMenuProps } from '../lib/userMenu';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { ServerTag } from './ServerTag';
import { OwnerCrown, RoleChips } from './RoleChips';
import { nameCss, parseNameStyle } from '../lib/nameStyle';

/** Стиль ника участника (шрифт, эффект, цвет) — поверх цвета роли */
function memberNameStyle(v: unknown) {
  const s = parseNameStyle(v);
  return s ? nameCss(s, 0) : undefined;
}

export function MemberList({ serverId }: { serverId: number }) {
  const members = useStore((s) => s.membersByServer[serverId] ?? []);
  const presence = useStore((s) => s.presence);
  const me = useStore((s) => s.me)!;
  const server = useStore((s) => s.servers.find((x) => x.id === serverId));
  const showProfile = useStore((s) => s.showProfile);
  const kickMember = useStore((s) => s.kickMember);

  const isOnline = (id: number, fallback?: string) => {
    const p = presence[id] ?? fallback;
    return p && p !== 'offline' && p !== 'invisible';
  };
  const online = members.filter((m) => isOnline(m.id, m.presence));
  const offline = members.filter((m) => !isOnline(m.id, m.presence));
  const amOwner = server?.owner_id === me.user_id;

  const kick = (id: number, name: string) => {
    if (confirm(`Удалить ${name} с сервера?`)) void kickMember(serverId, id);
  };

  const section = (title: string, list: typeof members, dim: boolean) =>
    list.length > 0 && (
      <>
        <div className="side-section">
          {title} — {list.length}
        </div>
        {list.map((m) => {
          const topRole = m.roles[0];
          return (
            <div key={m.id} className={`member${dim ? ' dim' : ''}`}>
              <button className="plain member-main" onClick={() => showProfile(m.id)} {...userMenuProps(m.id)}>
                <Avatar name={m.display_name} src={m.avatar_path} id={m.id} size={32} presence={presence[m.id] ?? m.presence ?? 'offline'} />
                <span className="member-names">
                  <span className="member-name">
                    <span className="ellipsis" style={memberNameStyle(m.name_style) ?? (topRole ? { color: topRole.color } : undefined)}>
                      {m.display_name}
                    </span>
                    {m.badge && <ServerTag tag={m.badge.tag} icon={m.badge.icon} small />}
                    {m.is_owner && <OwnerCrown />}
                  </span>
                  <RoleChips roles={m.roles} />
                </span>
              </button>
              {amOwner && !m.is_owner && (
                <button
                  className="icon-btn small kick"
                  title="Удалить с сервера"
                  aria-label={`Удалить ${m.display_name} с сервера`}
                  onClick={() => kick(m.id, m.display_name)}
                >
                  <Icon icon={UserX} size={16} anim="wiggle" />
                </button>
              )}
            </div>
          );
        })}
      </>
    );

  return (
    <aside className="members" aria-label="Участники сервера">
      {section('В сети', online, false)}
      {section('Не в сети', offline, true)}
    </aside>
  );
}
