import { api, ApiError } from '../lib/api';
import { useStore } from '../lib/store';
import { Avatar } from './Avatar';

export function MemberList({ serverId }: { serverId: number }) {
  const members = useStore((s) => s.membersByServer[serverId] ?? []);
  const presence = useStore((s) => s.presence);
  const me = useStore((s) => s.me)!;
  const server = useStore((s) => s.servers.find((x) => x.id === serverId));
  const showProfile = useStore((s) => s.showProfile);
  const refreshServer = useStore((s) => s.refreshServer);
  const toast = useStore((s) => s.toast);

  const isOnline = (id: number, fallback?: string) => {
    const p = presence[id] ?? fallback;
    return p && p !== 'offline' && p !== 'invisible';
  };
  const online = members.filter((m) => isOnline(m.id, m.presence));
  const offline = members.filter((m) => !isOnline(m.id, m.presence));
  const amOwner = server?.owner_id === me.user_id;

  const kick = async (id: number, name: string) => {
    if (!confirm(`Удалить ${name} с сервера?`)) return;
    try {
      await api.kick(serverId, id);
      await refreshServer(serverId);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Ошибка', 'error');
    }
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
              <button className="plain member-main" onClick={() => showProfile(m.id)}>
                <Avatar name={m.display_name} src={m.avatar_path} id={m.id} size={32} presence={presence[m.id] ?? m.presence ?? 'offline'} />
                <span className="ellipsis" style={topRole ? { color: topRole.color } : undefined}>
                  {m.display_name}
                </span>
                {m.is_owner && <span title="Владелец">👑</span>}
              </button>
              {amOwner && !m.is_owner && (
                <button className="icon-btn small kick" title="Удалить с сервера" onClick={() => kick(m.id, m.display_name)}>
                  ✕
                </button>
              )}
            </div>
          );
        })}
      </>
    );

  return (
    <aside className="members">
      {section('В сети', online, false)}
      {section('Не в сети', offline, true)}
    </aside>
  );
}
