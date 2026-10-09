import { useEffect, useState } from 'react';
import { api, ApiError, Member, normalizeExt, Profile } from '../lib/api';
import { useCall } from '../lib/call';
import { useAppearance } from '../lib/prefs';
import { useStore } from '../lib/store';
import { userMenuProps } from '../lib/userMenu';
import { Avatar, PRESENCE_LABEL } from './Avatar';
import { Modal } from './Modal';
import { RoleChips } from './RoleChips';
import { ServerIcon } from './ServerRail';
import { cardFromProfile } from './profile/cardData';
import { ProfileBoard } from './profile/ProfileBoard';
import { ProfileCard } from './profile/ProfileCard';
import { useProfileStudio } from './profile/ProfileStudio';

const NO_ROLES: Member['roles'] = [];

export function ProfileModal({ userId }: { userId: number }) {
  // «Применить тему к профилям других пользователей» — чужие карточки в моих цветах (Настройки → Тема)
  const applyMine = useAppearance((s) => s.applyToProfiles);
  const showProfile = useStore((s) => s.showProfile);
  const openDmWith = useStore((s) => s.openDmWith);
  const refreshFriends = useStore((s) => s.refreshFriends);
  const openStudio = useProfileStudio((s) => s.show);
  const livePresence = useStore((s) => s.presence[userId]);
  const toast = useStore((s) => s.toast);
  const open = useStore((s) => s.open);
  const servers = useStore((s) => s.servers);
  // Роли — из списков участников серверов, где этот пользователь уже встречался
  const roles = useStore((s) => Object.values(s.membersByServer).flat().find((m) => m.id === userId)?.roles ?? NO_ROLES);
  const callIdle = useCall((s) => s.phase === 'idle');
  const startCall = useCall((s) => s.start);
  const [p, setP] = useState<Profile | null>(null);
  const [error, setError] = useState('');

  const load = () =>
    api.profile(userId).then(setP, (e) => setError(e instanceof ApiError ? e.message : 'Ошибка'));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const close = () => showProfile(null);

  const friendAction = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await Promise.all([load(), refreshFriends()]);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Ошибка', 'error');
    }
  };

  if (!p)
    return (
      <Modal onClose={close} bare>
        <div className="profile-card center muted" style={{ padding: 40 }}>
          {error || 'Загрузка…'}
        </div>
      </Modal>
    );

  const presence = p.friendship_status === 'self' ? p.presence : livePresence ?? p.presence;
  const ext = normalizeExt(p.profile_ext);
  const self = p.friendship_status === 'self';
  const card = cardFromProfile(p, ext, presence);
  // «Применить тему к профилям других пользователей» — чужая карточка в моих цветах
  if (applyMine && !self) {
    card.banner_path = '';
    card.banner_color = 'var(--theme-gradient, var(--accent))';
  }

  const actions = self ? (
    <button
      className="btn primary"
      onClick={() => {
        close();
        openStudio();
      }}
    >
      Редактировать профиль
    </button>
  ) : (
    <>
      <button className="btn primary" onClick={() => openDmWith(p.id)}>
        Сообщение
      </button>
      {p.friendship_status === 'none' && (
        <button className="btn" onClick={() => friendAction(() => api.friendRequest(p.id))}>
          Добавить в друзья
        </button>
      )}
      {p.friendship_status === 'pending_out' && (
        <button className="btn" onClick={() => friendAction(() => api.friendRemove(p.id))}>
          Отменить заявку
        </button>
      )}
      {p.friendship_status === 'pending_in' && (
        <button className="btn" onClick={() => friendAction(() => api.friendRespond(p.id, true))}>
          Принять заявку
        </button>
      )}
      {p.friendship_status === 'friends' && (
        <button
          className="btn ok"
          disabled={!callIdle}
          onClick={() => {
            close();
            void startCall(p.id, p.display_name);
          }}
        >
          Позвонить
        </button>
      )}
      {p.friendship_status === 'friends' && (
        <button className="btn" onClick={() => friendAction(() => api.friendRemove(p.id))}>
          Удалить из друзей
        </button>
      )}
    </>
  );

  const activity = (
    <div className="pactivity">
      <section className="widget">
        <strong>Сейчас</strong>
        <p className="muted">
          {PRESENCE_LABEL[presence] ?? ''}
          {card.status_text && <> · {card.status_text}</>}
        </p>
      </section>
      {roles.length > 0 && (
        <section className="widget">
          <strong>Роли</strong>
          <RoleChips roles={roles} />
        </section>
      )}
      {p.mutual_servers.length > 0 && (
        <section className="widget">
          <strong>{self ? 'Серверы' : 'Общие серверы'} — {p.mutual_servers.length}</strong>
          <div className="profile-links">
            {p.mutual_servers.map((s) => (
              <button
                key={s.id}
                className="profile-link"
                onClick={() => {
                  close();
                  open({ kind: 'server', serverId: s.id, channelId: null });
                }}
              >
                <span className="profile-link-icon">
                  <ServerIcon name={s.name} icon={servers.find((x) => x.id === s.id)?.icon ?? ''} />
                </span>
                <span className="ellipsis">{s.name}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      {p.mutual_friends.length > 0 && (
        <section className="widget">
          <strong>Общие друзья — {p.mutual_friends.length}</strong>
          <div className="profile-links">
            {p.mutual_friends.map((f) => (
              <button key={f.id} className="profile-link" onClick={() => showProfile(f.id)} {...userMenuProps(f.id)}>
                <Avatar name={f.display_name} src={f.avatar_path} id={f.id} size={20} />
                <span className="ellipsis">{f.display_name}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );

  return (
    <Modal onClose={close} bare label={`Профиль ${p.display_name}`}>
      <div className="profile-view">
        <button className="icon-btn profile-close" onClick={close} aria-label="Закрыть">
          ✕
        </button>
        <ProfileCard
          d={card}
          actions={actions}
          onBadge={
            card.badge
              ? () => {
                  close();
                  open({ kind: 'server', serverId: card.badge!.id, channelId: null });
                }
              : undefined
          }
        />
        <ProfileBoard ext={ext} activity={activity} />
      </div>
    </Modal>
  );
}
