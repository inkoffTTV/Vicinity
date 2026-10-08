import { useEffect, useState } from 'react';
import { api, ApiError, parseTs, Profile } from '../lib/api';
import { useCall } from '../lib/call';
import { useStore } from '../lib/store';
import { Avatar, PRESENCE_LABEL } from './Avatar';
import { Markdown } from './Markdown';
import { Modal } from './Modal';

export function ProfileModal({ userId }: { userId: number }) {
  const showProfile = useStore((s) => s.showProfile);
  const openDmWith = useStore((s) => s.openDmWith);
  const refreshFriends = useStore((s) => s.refreshFriends);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const livePresence = useStore((s) => s.presence[userId]);
  const toast = useStore((s) => s.toast);
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
  const accent = p.accent_color || '#5865f2';

  return (
    <Modal onClose={close} bare>
      <div className="profile-card">
        <div
          className="profile-banner"
          style={p.banner_path ? { backgroundImage: `url("${p.banner_path}")` } : { background: accent }}
        />
        <div className="profile-avatar">
          <Avatar name={p.display_name} src={p.avatar_path} id={p.id} size={88} presence={presence} />
        </div>
        <button className="icon-btn profile-close" onClick={close} aria-label="Закрыть">
          ✕
        </button>
        <div className="profile-content">
          <h2>{p.display_name}</h2>
          <div className="muted">
            @{p.username}
            {p.pronouns && <> · {p.pronouns}</>}
          </div>
          <div className="small muted">{PRESENCE_LABEL[presence] ?? ''}</div>
          {p.badges.length > 0 && (
            <div className="badges">
              {p.badges.map((b) => (
                <span key={b.id} className="pill" style={{ borderColor: b.color, color: b.color }}>
                  {b.label}
                </span>
              ))}
            </div>
          )}
          {p.bio && (
            <section>
              <h4>О себе</h4>
              <div className="bio">
                <Markdown text={p.bio} />
              </div>
            </section>
          )}
          <section>
            <h4>В Vicinity с</h4>
            <p>{parseTs(p.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
          </section>
          {p.mutual_servers.length > 0 && p.friendship_status !== 'self' && (
            <section>
              <h4>Общие серверы — {p.mutual_servers.length}</h4>
              <p>{p.mutual_servers.map((s) => s.name).join(', ')}</p>
            </section>
          )}
          {p.mutual_friends.length > 0 && (
            <section>
              <h4>Общие друзья — {p.mutual_friends.length}</h4>
              <p>{p.mutual_friends.map((s) => s.display_name).join(', ')}</p>
            </section>
          )}
          <div className="profile-actions">
            {p.friendship_status === 'self' ? (
              <button
                className="btn primary"
                onClick={() => {
                  close();
                  setSettingsOpen(true);
                }}
              >
                Редактировать профиль
              </button>
            ) : (
              <>
                <button className="btn primary" onClick={() => openDmWith(p.id)}>
                  Написать
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
                    📞 Позвонить
                  </button>
                )}
                {p.friendship_status === 'friends' && (
                  <button className="btn" onClick={() => friendAction(() => api.friendRemove(p.id))}>
                    Удалить из друзей
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
