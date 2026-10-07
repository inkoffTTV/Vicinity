import { FormEvent, useState } from 'react';
import { api, ApiError, Presence } from '../lib/api';
import { useStore } from '../lib/store';
import { Avatar, PRESENCE_LABEL } from './Avatar';
import { Modal } from './Modal';

export function Settings() {
  const me = useStore((s) => s.me)!;
  const refreshMe = useStore((s) => s.refreshMe);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const logout = useStore((s) => s.logout);
  const toast = useStore((s) => s.toast);
  const [displayName, setDisplayName] = useState(me.display_name);
  const [bio, setBio] = useState(me.bio ?? '');
  const [pronouns, setPronouns] = useState(me.pronouns ?? '');
  const [accent, setAccent] = useState(me.accent_color || '#5865f2');
  const [presence, setPresence] = useState<Presence>(me.presence === 'offline' ? 'online' : me.presence);
  const [busy, setBusy] = useState(false);
  const [notif, setNotif] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'denied');

  const close = () => setSettingsOpen(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.customize({
        display_name: displayName.trim(),
        bio,
        pronouns,
        presence,
        accent_color: accent,
        profile_json: me.profile_json ?? '', // настройки оформления десктоп-клиента — не трогаем
      });
      // Сообщить друзьям о смене статуса
      useStore.getState().setPresence(presence);
      await refreshMe();
      toast('Профиль сохранён');
      close();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Ошибка', 'error');
    } finally {
      setBusy(false);
    }
  };

  const upload = async (field: 'avatar' | 'banner', file?: File) => {
    if (!file) return;
    if (!/^image\/(png|jpe?g|gif)$/.test(file.type)) return toast('Только PNG, JPG или GIF', 'error');
    if (file.size > 15 * 1024 * 1024) return toast('Файл слишком большой (макс 15 МБ)', 'error');
    try {
      await api.uploadMedia(field, file);
      await refreshMe();
      toast(field === 'avatar' ? 'Аватар обновлён' : 'Баннер обновлён');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Ошибка', 'error');
    }
  };

  const clear = async (field: 'avatar' | 'banner') => {
    try {
      await api.clearMedia(field);
      await refreshMe();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Ошибка', 'error');
    }
  };

  return (
    <Modal title="Настройки профиля" onClose={close} wide>
      <form onSubmit={save} className="settings">
        <div className="settings-media">
          <div
            className="settings-banner"
            style={me.banner_path ? { backgroundImage: `url("${me.banner_path}")` } : { background: accent }}
          >
            <label className="btn small">
              Баннер…
              <input type="file" hidden accept="image/png,image/jpeg,image/gif" onChange={(e) => upload('banner', e.target.files?.[0])} />
            </label>
            {me.banner_path && (
              <button type="button" className="btn small" onClick={() => clear('banner')}>
                Убрать
              </button>
            )}
          </div>
          <div className="settings-avatar">
            <Avatar name={displayName} src={me.avatar_path} id={me.user_id} size={80} />
            <div className="stack-row">
              <label className="btn small">
                Аватар…
                <input type="file" hidden accept="image/png,image/jpeg,image/gif" onChange={(e) => upload('avatar', e.target.files?.[0])} />
              </label>
              {me.avatar_path && (
                <button type="button" className="btn small" onClick={() => clear('avatar')}>
                  Убрать
                </button>
              )}
            </div>
          </div>
        </div>

        <label>
          Отображаемое имя
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={32} required />
        </label>
        <label>
          Местоимения
          <input value={pronouns} onChange={(e) => setPronouns(e.target.value)} maxLength={40} />
        </label>
        <label>
          О себе <span className="muted small">{bio.length}/190</span>
          <textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={190} rows={3} />
        </label>
        <div className="row">
          <label>
            Цвет профиля
            <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} />
          </label>
          <label className="grow">
            Статус
            <select value={presence} onChange={(e) => setPresence(e.target.value as Presence)}>
              {(['online', 'idle', 'dnd', 'invisible'] as Presence[]).map((p) => (
                <option key={p} value={p}>
                  {PRESENCE_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {typeof Notification !== 'undefined' && notif !== 'granted' && (
          <button
            type="button"
            className="btn"
            disabled={notif === 'denied'}
            onClick={() => Notification.requestPermission().then(setNotif)}
          >
            {notif === 'denied' ? 'Уведомления запрещены в браузере' : '🔔 Включить уведомления о сообщениях'}
          </button>
        )}

        <div className="row end">
          <button type="button" className="btn danger" onClick={() => logout()}>
            Выйти
          </button>
          <div className="grow" />
          <button type="button" className="btn" onClick={close}>
            Отмена
          </button>
          <button className="btn primary" disabled={busy}>
            Сохранить
          </button>
        </div>
      </form>
    </Modal>
  );
}
