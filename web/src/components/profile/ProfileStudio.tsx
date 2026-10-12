import { X } from 'lucide-react';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { ApiError, Connection, EMPTY_EXT, normalizeExt, parseTs, Presence, Profile, ProfileExt, api } from '../../lib/api';
import { CONNECTIONS } from '../../lib/cosmetics';
import { nameCss } from '../../lib/nameStyle';
import { usePlan } from '../../lib/plan';
import { DEFAULT_ACCENT } from '../../lib/prefs';
import { useStore } from '../../lib/store';
import { Avatar } from '../Avatar';
import { Modal } from '../Modal';
import { bannerColorOf, parseProfileJson, statusOf } from './cardData';
import { NameStyleEditor } from './NameStyleEditor';
import { ProfileThemeEditor } from './ProfileThemeEditor';
import { ProfileBoard } from './ProfileBoard';
import { ConnectionTile, ProfileCard } from './ProfileCard';
import { ServerTag } from '../ServerTag';
import { Icon } from '../Icon';

/** Открыт ли редактор профиля (из своей карточки и из Настройки → Профиль) */
export const useProfileStudio = create<{ open: boolean; show: () => void; hide: () => void }>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));

const errText = (e: unknown) => (e instanceof ApiError ? e.message : 'Ошибка');

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="studio-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export function ProfileStudio() {
  const hide = useProfileStudio((s) => s.hide);
  const me = useStore((s) => s.me)!;
  const refreshMe = useStore((s) => s.refreshMe);
  const toast = useStore((s) => s.toast);
  const myServers = useStore((s) => s.servers);
  const tier = usePlan((s) => s.current.tier);
  const bioMax = usePlan((s) => s.current.bio);
  const pj = useMemo(() => parseProfileJson(me.profile_json), [me.profile_json]);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [ext, setExt] = useState<ProfileExt>(EMPTY_EXT);
  const [displayName, setDisplayName] = useState(me.display_name);
  const [pronouns, setPronouns] = useState(me.pronouns ?? '');
  const [bio, setBio] = useState(me.bio ?? '');
  const [status, setStatus] = useState(statusOf(pj));
  const [accent, setAccent] = useState(me.accent_color || DEFAULT_ACCENT);
  const [bannerColor, setBannerColor] = useState(() => {
    const c = bannerColorOf(pj, me.accent_color);
    return c.startsWith('#') ? c : DEFAULT_ACCENT;
  });
  const [newConn, setNewConn] = useState<Connection>({ type: 'steam', name: '', url: '' });
  const [busy, setBusy] = useState(false);
  const [nameEditor, setNameEditor] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    api.profile(me.user_id).then(
      (p) => {
        setProfile(p);
        setExt(normalizeExt(p.profile_ext));
      },
      (e) => toast(errText(e), 'error'),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const touch = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setDirty(true);
  };
  const editExt = (next: ProfileExt) => {
    setExt(next);
    setDirty(true);
  };

  // Тема профиля без Standard: примерить можно, сохранить — нет
  const themeLocked = !!ext.profile_theme && tier < 2;

  const upload = async (field: 'avatar' | 'banner', file?: File) => {
    if (!file) return;
    if (!/^image\/(png|jpe?g|gif|webp)$/.test(file.type)) return toast('Только PNG, JPG, GIF или WEBP', 'error');
    try {
      await api.uploadMedia(field, file);
      await refreshMe();
      toast(field === 'avatar' ? 'Аватар обновлён' : 'Баннер обновлён');
    } catch (err) {
      toast(errText(err), 'error');
    }
  };
  const clear = async (field: 'avatar' | 'banner') => {
    try {
      await api.clearMedia(field);
      await refreshMe();
    } catch (err) {
      toast(errText(err), 'error');
    }
  };

  const addConnection = () => {
    const name = newConn.name.trim();
    if (!name) return;
    const url = newConn.url.trim();
    if (url && !url.startsWith('https://')) return toast('Ссылка должна начинаться с https://', 'error');
    editExt({ ...ext, connections: [...ext.connections, { type: newConn.type, name, url }].slice(0, 10) });
    setNewConn({ ...newConn, name: '', url: '' });
  };

  const save = async () => {
    if (ext.profile_theme && tier < 2) return toast('Тема профиля — с подпиской Standard', 'error');
    setBusy(true);
    try {
      // Общие с десктопом поля profile_json (статус, цвет баннера) — остальные его ключи сохраняем как есть
      const nextPj = { ...pj, statusText: status.trim(), showStatus: status.trim() !== '' || pj.showStatus === true, banner: { ...(pj.banner ?? {}), type: 'solid', color: bannerColor } };
      const presence: Presence = me.presence === 'offline' ? 'online' : me.presence;
      await api.customize({
        display_name: displayName.trim(),
        bio,
        pronouns,
        presence,
        accent_color: accent,
        profile_json: JSON.stringify(nextPj),
      });
      setExt(normalizeExt(await api.saveProfileExt({ ...ext, frame: null, effect: null })));
      await refreshMe();
      setDirty(false);
      toast('Профиль сохранён');
    } catch (err) {
      toast(errText(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (dirty && !confirm('Выйти без сохранения изменений?')) return;
    hide();
  };

  const badge = myServers.find((s) => s.id === ext.badge_server) ?? null;
  const card = {
    id: me.user_id,
    display_name: displayName.trim() || me.display_name,
    username: me.username,
    avatar_path: me.avatar_path,
    banner_path: me.banner_path,
    banner_color: bannerColor,
    pronouns,
    status_text: status.trim(),
    presence: me.presence,
    bio,
    created_at: profile ? parseTs(profile.created_at) : new Date(),
    badges: profile?.badges ?? [],
    badge: badge ? { id: badge.id, name: badge.name, icon: badge.icon ?? '', tag: badge.tag, tag_icon: badge.tag_icon } : null,
    connections: ext.connections,
    frame: null,
    effect: null,
    name_style: ext.name_style,
    theme: ext.profile_theme,
  };

  return (
    <Modal onClose={close} bare label="Редактор профиля">
      <div className="profile-studio">
        <aside className="studio-editor" aria-label="Настройки профиля">
          <div className="studio-title">Мой профиль</div>

          <Section title="Бейджик">
            <div className="studio-badges" role="radiogroup" aria-label="Тег сервера у ника">
              <button type="button" role="radio" aria-checked={!badge?.tag} className={!badge?.tag ? 'on' : ''} onClick={() => editExt({ ...ext, badge_server: null })}>
                <span className="studio-badge-name">Без тега</span>
              </button>
              {myServers
                .filter((s) => s.tag)
                .map((s) => (
                  <button key={s.id} type="button" role="radio" aria-checked={badge?.id === s.id} className={badge?.id === s.id ? 'on' : ''} onClick={() => editExt({ ...ext, badge_server: s.id })}>
                    <ServerTag tag={s.tag!} icon={s.tag_icon} />
                    <span className="studio-badge-name ellipsis">{s.name}</span>
                  </button>
                ))}
            </div>
            <span className="muted small">
              {myServers.some((s) => s.tag)
                ? 'Тег сервера рядом с ником — в сообщениях, списке участников и профиле. По нажатию другие увидят карточку сервера и смогут вступить.'
                : 'Ни у одного из ваших серверов пока нет тега. Владелец задаёт его в настройках сервера → Обзор.'}
            </span>
          </Section>

          <Section title="Аватар">
            <div className="studio-media">
              <Avatar name={me.display_name} src={me.avatar_path} id={me.user_id} size={56} />
              <label className="btn small">
                Загрузить
                <input type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp" onChange={(e) => upload('avatar', e.target.files?.[0])} />
              </label>
              {me.avatar_path && (
                <button type="button" className="btn small" onClick={() => clear('avatar')}>
                  Убрать
                </button>
              )}
            </div>
          </Section>

          <Section title="Баннер">
            <div className="studio-media">
              <input type="color" value={bannerColor} onChange={(e) => touch(setBannerColor)(e.target.value)} aria-label="Цвет баннера" />
              <label className="btn small">
                Картинка
                <input type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp" onChange={(e) => upload('banner', e.target.files?.[0])} />
              </label>
              {me.banner_path && (
                <button type="button" className="btn small" onClick={() => clear('banner')}>
                  Убрать картинку
                </button>
              )}
            </div>
            <span className="muted small">GIF-баннер — с подпиской Standard</span>
          </Section>

          <Section title="Тема профиля">
            <span className="muted small">Два цвета — верх и низ карточки. Подложка и цвет текста подбираются автоматически.</span>
            <ProfileThemeEditor value={ext.profile_theme} tier={tier} onChange={(profile_theme) => editExt({ ...ext, profile_theme })} />
          </Section>

          <Section title="Стиль ника">
            <button type="button" className="btn studio-name-btn" onClick={() => setNameEditor(true)}>
              <span style={ext.name_style ? nameCss(ext.name_style, 16) : undefined}>{displayName.trim() || me.display_name}</span>
              <span className="muted small">Шрифт, эффект и цвет</span>
            </button>
          </Section>

          <Section title="Основное">
            <label>
              Отображаемое имя
              <input value={displayName} maxLength={32} onChange={(e) => touch(setDisplayName)(e.target.value)} />
            </label>
            <label>
              Местоимения
              <input value={pronouns} maxLength={40} onChange={(e) => touch(setPronouns)(e.target.value)} />
            </label>
            <label>
              Статус
              <input value={status} maxLength={128} placeholder="Что у вас нового?" onChange={(e) => touch(setStatus)(e.target.value)} />
            </label>
            <label>
              О себе <span className="muted small">{bio.length}/{bioMax}</span>
              <textarea value={bio} maxLength={bioMax} rows={4} onChange={(e) => touch(setBio)(e.target.value)} />
            </label>
            <label>
              Цвет профиля (ник в чатах с Basic)
              <input type="color" value={accent} onChange={(e) => touch(setAccent)(e.target.value)} />
            </label>
          </Section>

          <Section title="Подключения">
            <ul className="studio-conns">
              {ext.connections.map((c, i) => (
                <li key={`${c.type}-${i}`}>
                  <ConnectionTile type={c.type} />
                  <span className="grow ellipsis">{c.name}</span>
                  <button type="button" className="icon-btn small" aria-label={`Убрать ${c.name}`} onClick={() => editExt({ ...ext, connections: ext.connections.filter((_, j) => j !== i) })}>
                    <Icon icon={X} size={18} />
                  </button>
                </li>
              ))}
            </ul>
            {ext.connections.length < 10 && (
              <div className="studio-conn-add">
                <select value={newConn.type} onChange={(e) => setNewConn({ ...newConn, type: e.target.value })} aria-label="Сервис">
                  {CONNECTIONS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <input placeholder="Ник или имя" maxLength={40} value={newConn.name} onChange={(e) => setNewConn({ ...newConn, name: e.target.value })} />
                <input placeholder="Ссылка https://… (необязательно)" maxLength={200} value={newConn.url} onChange={(e) => setNewConn({ ...newConn, url: e.target.value })} />
                <button type="button" className="btn small" disabled={!newConn.name.trim()} onClick={addConnection}>
                  Добавить
                </button>
              </div>
            )}
          </Section>

          {tier < 3 && (
            <div className="studio-promo">
              <strong>Прокачайте облик с подпиской</strong>
              <span className="muted small">Цвет ника — с Basic, стили ника и тема профиля — со Standard, все значки приложения — с Ultra. Подписку выдаёт администратор.</span>
            </div>
          )}
        </aside>

        <div className="studio-preview">
          <ProfileCard d={card} />
        </div>

        <div className="studio-board">
          <ProfileBoard ext={ext} editable onChange={editExt} activity={<div className="muted">Здесь другие увидят ваши серверы и общих друзей.</div>} />
        </div>

        {nameEditor && (
          <NameStyleEditor
            initial={ext.name_style}
            onClose={() => setNameEditor(false)}
            onSaved={(name_style) => {
              setExt({ ...ext, name_style });
              setNameEditor(false);
            }}
          />
        )}

        <div className="studio-bar">
          {themeLocked ? (
            <span className="studio-warn">Примерка: тема профиля сохранится с подпиской Standard</span>
          ) : (
            <span className="muted small">{dirty ? 'Есть несохранённые изменения' : 'Изменений нет'}</span>
          )}
          <div className="grow" />
          <button type="button" className="btn" onClick={close}>
            Закрыть
          </button>
          <button type="button" className="btn primary" disabled={busy || !dirty || themeLocked} onClick={save}>
            Сохранить
          </button>
        </div>
      </div>
    </Modal>
  );
}
