import { CSSProperties, FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError, parseTs, Presence, Session } from '../lib/api';
import { copyText } from '../lib/clipboard';
import { NOTIFY_LEVELS, serverLevel, useNotifySettings } from '../lib/notify';
import { ACCENTS, DEFAULT_ACCENT, FontSize, Theme, useAppearance } from '../lib/prefs';
import { useStore } from '../lib/store';
import { fullWhen } from '../lib/time';
import { AudioSettingsPanel } from './AudioSettings';
import { Avatar, PRESENCE_LABEL } from './Avatar';
import { Modal } from './Modal';

type Tab = 'profile' | 'account' | 'appearance' | 'notifications' | 'voice';

const TABS: [Tab, string][] = [
  ['profile', 'Профиль'],
  ['account', 'Аккаунт'],
  ['appearance', 'Внешний вид'],
  ['notifications', 'Уведомления'],
  ['voice', 'Голос и видео'],
];

export function Settings() {
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const [tab, setTab] = useState<Tab>('profile');
  const close = useCallback(() => setSettingsOpen(false), [setSettingsOpen]);

  return (
    <Modal title="Настройки" onClose={close} className="settings-modal">
      <div className="settings-layout">
        <div className="settings-tabs" role="tablist" aria-label="Разделы настроек">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              role="tab"
              id={`settings-tab-${id}`}
              aria-selected={tab === id}
              aria-controls="settings-panel"
              className={tab === id ? 'on' : ''}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="settings-panel" role="tabpanel" id="settings-panel" aria-labelledby={`settings-tab-${tab}`}>
          {tab === 'profile' && <ProfileTab onClose={close} />}
          {tab === 'account' && <AccountTab />}
          {tab === 'appearance' && <AppearanceTab />}
          {tab === 'notifications' && <NotificationsTab />}
          {tab === 'voice' && <AudioSettingsPanel />}
        </div>
      </div>
    </Modal>
  );
}

const errText = (e: unknown) => (e instanceof ApiError ? e.message : 'Ошибка');

// ── Профиль ──

function ProfileTab({ onClose }: { onClose: () => void }) {
  const me = useStore((s) => s.me)!;
  const refreshMe = useStore((s) => s.refreshMe);
  const logout = useStore((s) => s.logout);
  const toast = useStore((s) => s.toast);
  const [displayName, setDisplayName] = useState(me.display_name);
  const [bio, setBio] = useState(me.bio ?? '');
  const [pronouns, setPronouns] = useState(me.pronouns ?? '');
  const [accent, setAccent] = useState(me.accent_color || DEFAULT_ACCENT);
  const [presence, setPresence] = useState<Presence>(me.presence === 'offline' ? 'online' : me.presence);
  const [busy, setBusy] = useState(false);

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
      onClose();
    } catch (err) {
      toast(errText(err), 'error');
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

  return (
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

      <div className="row end">
        <button type="button" className="btn danger" onClick={() => logout()}>
          Выйти
        </button>
        <div className="grow" />
        <button type="button" className="btn" onClick={onClose}>
          Отмена
        </button>
        <button className="btn primary" disabled={busy}>
          Сохранить
        </button>
      </div>
    </form>
  );
}

// ── Аккаунт и безопасность ──

function AccountTab() {
  const me = useStore((s) => s.me)!;
  const toast = useStore((s) => s.toast);

  const copy = async (text: string, what: string) => {
    if (await copyText(text)) toast(`${what} скопирован`);
    else toast('Не удалось скопировать', 'error');
  };

  return (
    <div className="settings">
      <section className="settings-card account-card">
        <Avatar name={me.display_name} src={me.avatar_path} id={me.user_id} size={48} />
        <div className="grow">
          <strong className="ellipsis">{me.display_name}</strong>
          <div className="muted small">
            @{me.username} · ID {me.user_id}
          </div>
        </div>
        <div className="stack-row wrap">
          <button type="button" className="btn small" onClick={() => copy(`@${me.username}`, 'Логин')}>
            Копировать @логин
          </button>
          <button type="button" className="btn small" onClick={() => copy(String(me.user_id), 'ID')}>
            Копировать ID
          </button>
        </div>
      </section>
      <PasswordForm />
      <Sessions />
    </div>
  );
}

/** Оценка пароля для подсказки: 0 — пусто, 1..4 — от слабого к надёжному */
function strength(p: string): number {
  if (!p) return 0;
  let score = p.length >= 8 ? 1 : 0;
  if (p.length >= 12) score++;
  if (/[a-zа-яё]/.test(p) && /[A-ZА-ЯЁ]/.test(p)) score++;
  if (/\d/.test(p) && /[^\p{L}\d]/u.test(p)) score++;
  return Math.max(1, Math.min(4, score));
}
const STRENGTH = ['', 'Слабый', 'Средний', 'Хороший', 'Надёжный'];

function PasswordForm() {
  const toast = useStore((s) => s.toast);
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const score = strength(newPw);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPw.length < 8) return setError('Новый пароль должен быть не короче 8 символов');
    if (newPw !== repeat) return setError('Пароли не совпадают');
    setBusy(true);
    try {
      const r = await api.changePassword(oldPw, newPw);
      setOldPw('');
      setNewPw('');
      setRepeat('');
      toast(r.revoked > 0 ? `Пароль изменён. Завершено сеансов на других устройствах: ${r.revoked}` : 'Пароль изменён');
      window.dispatchEvent(new Event(SESSIONS_CHANGED));
    } catch (err) {
      setError(err instanceof ApiError && err.status === 403 ? 'Неверный текущий пароль' : errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="settings-card stack" onSubmit={submit}>
      <h3>Смена пароля</h3>
      <label>
        Текущий пароль
        <input type="password" autoComplete="current-password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} required />
      </label>
      <label>
        Новый пароль
        <input type="password" autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} required />
      </label>
      {score > 0 && (
        <div className={`pw-strength s${score}`} aria-live="polite">
          <span className="pw-strength-bar" aria-hidden="true">
            <i />
          </span>
          <span className="small">
            {STRENGTH[score]}
            {newPw.length < 8 && ' — нужно не меньше 8 символов'}
          </span>
        </div>
      )}
      <label>
        Повторите новый пароль
        <input type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} required />
      </label>
      <div className="muted small">После смены пароля все остальные устройства выйдут из аккаунта.</div>
      {error && <div className="form-error">{error}</div>}
      <div className="row end">
        <div className="grow" />
        <button className="btn primary" disabled={busy || !oldPw || !newPw || !repeat}>
          Сменить пароль
        </button>
      </div>
    </form>
  );
}

// Смена пароля завершает другие сеансы — список надо перечитать
const SESSIONS_CHANGED = 'vicinity:sessions-changed';

function Sessions() {
  const toast = useStore((s) => s.toast);
  const [list, setList] = useState<Session[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(
    () =>
      api.sessions().then(
        (s) => (setList(s), setError('')),
        (e) => setError(errText(e)),
      ),
    [],
  );
  useEffect(() => {
    void load();
    window.addEventListener(SESSIONS_CHANGED, load);
    return () => window.removeEventListener(SESSIONS_CHANGED, load);
  }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
    } catch (e) {
      toast(errText(e), 'error');
    }
    await load();
  };

  const others = (list ?? []).filter((s) => !s.current).length;

  return (
    <section className="settings-card stack" aria-label="Активные сеансы">
      <div className="row-between center-y">
        <h3>Активные сеансы</h3>
        <button
          type="button"
          className="btn small danger"
          disabled={others === 0}
          onClick={() => act(() => api.revokeOtherSessions(), 'Выполнен выход на других устройствах')}
        >
          Выйти на других устройствах
        </button>
      </div>
      {error && <div className="form-error">{error}</div>}
      {list === null && !error && <div className="muted small">Загрузка…</div>}
      <ul className="session-list">
        {(list ?? []).map((s) => (
          <li key={s.id} className="session">
            <span className="session-icon" aria-hidden="true">
              {s.current ? '💻' : '🔑'}
            </span>
            <div className="grow">
              <div>
                {s.current ? <strong>Это устройство</strong> : <span>Сеанс {s.id.slice(0, 6)}</span>}
              </div>
              <div className="muted small">
                Вход {fullWhen(parseTs(s.created_at))} · действует до {fullWhen(parseTs(s.expires_at))}
              </div>
            </div>
            {!s.current && (
              <button
                type="button"
                className="btn small"
                onClick={() => act(() => api.revokeSession(s.id), 'Сеанс завершён')}
              >
                Завершить
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Внешний вид ──

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div className="setting-row">
      <span className="setting-label" id={`seg-${label}`}>
        {label}
      </span>
      <div className="segmented" role="radiogroup" aria-labelledby={`seg-${label}`}>
        {options.map(([v, text]) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle-row">
      <span className="grow">
        <span className="toggle-label">{label}</span>
        {hint && <span className="muted small toggle-hint">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function AppearanceTab() {
  const a = useAppearance();
  const accent = a.accent || DEFAULT_ACCENT;
  return (
    <div className="settings">
      <Segmented<Theme>
        label="Тема"
        value={a.theme}
        options={[
          ['system', 'Как в системе'],
          ['light', 'Светлая'],
          ['dark', 'Тёмная'],
        ]}
        onChange={(theme) => a.set({ theme })}
      />
      <div className="setting-row">
        <span className="setting-label">Акцентный цвет</span>
        <div className="swatches">
          {ACCENTS.map((c) => (
            <button
              key={c}
              type="button"
              className={`swatch${accent === c ? ' on' : ''}`}
              aria-label={`Цвет ${c}`}
              aria-pressed={accent === c}
              style={{ '--swatch': c } as CSSProperties}
              onClick={() => a.set({ accent: c === DEFAULT_ACCENT ? '' : c })}
            />
          ))}
          <label className="swatch custom" title="Свой цвет">
            <input type="color" aria-label="Свой цвет" value={accent} onChange={(e) => a.set({ accent: e.target.value })} />
          </label>
        </div>
      </div>
      <Segmented<FontSize>
        label="Размер шрифта сообщений"
        value={a.fontSize}
        options={[
          ['s', 'Мелкий'],
          ['m', 'Обычный'],
          ['l', 'Крупный'],
        ]}
        onChange={(fontSize) => a.set({ fontSize })}
      />
      <Toggle
        label="Компактный режим"
        hint="Меньше отступы и аватары — больше сообщений на экране"
        checked={a.compact}
        onChange={(compact) => a.set({ compact })}
      />
      <Toggle
        label="Уменьшить анимацию"
        hint="Анимации выключаются и так, если это задано в системе"
        checked={a.reducedMotion}
        onChange={(reducedMotion) => a.set({ reducedMotion })}
      />
      <div className="row end">
        <div className="grow" />
        <button type="button" className="btn" onClick={a.reset}>
          Сбросить оформление
        </button>
      </div>
    </div>
  );
}

// ── Уведомления ──

function NotificationsTab() {
  const servers = useStore((s) => s.servers);
  const dms = useStore((s) => s.dms);
  const groups = useStore((s) => s.groups);
  const channelsByServer = useStore((s) => s.channelsByServer);
  const notify = useNotifySettings();
  const [permission, setPermission] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'denied');

  const channelName = (id: number) => {
    const dm = dms.find((d) => d.channel_id === id);
    if (dm) return `@${dm.display_name}`;
    const g = groups.find((x) => x.id === id);
    if (g) return g.name;
    for (const srv of servers) {
      const c = (channelsByServer[srv.id] ?? []).find((x) => x.id === id);
      if (c) return `#${c.name} — ${srv.name}`;
    }
    return null;
  };
  const muted = notify.muted.map((id) => [id, channelName(id)] as const).filter(([, name]) => name !== null);

  return (
    <div className="settings">
      <div className="setting-row">
        <span className="grow">
          <span className="toggle-label">Уведомления браузера</span>
          <span className="muted small toggle-hint">
            {typeof Notification === 'undefined'
              ? 'Этот браузер не поддерживает уведомления'
              : permission === 'granted'
                ? 'Включены — о личных сообщениях и упоминаниях'
                : permission === 'denied'
                  ? 'Запрещены в настройках браузера для этого сайта'
                  : 'Не включены'}
          </span>
        </span>
        {typeof Notification !== 'undefined' && permission === 'default' && (
          <button type="button" className="btn small primary" onClick={() => void Notification.requestPermission().then(setPermission)}>
            Включить
          </button>
        )}
      </div>
      <Toggle label="Звук новых сообщений" checked={notify.sound} onChange={notify.setSound} />
      {servers.length > 0 && (
        <section className="stack">
          <h3>Серверы</h3>
          {servers.map((srv) => (
            <label key={srv.id} className="setting-row plain-label">
              <span className="grow ellipsis">{srv.name}</span>
              <select
                className="compact-select"
                value={serverLevel(notify, srv.id)}
                onChange={(e) => notify.setServerLevel(srv.id, e.target.value as (typeof NOTIFY_LEVELS)[number][0])}
              >
                {NOTIFY_LEVELS.map(([v, text]) => (
                  <option key={v} value={v}>
                    {text}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </section>
      )}
      {muted.length > 0 && (
        <section className="stack">
          <h3>Заглушённые каналы</h3>
          {muted.map(([id, name]) => (
            <div key={id} className="setting-row">
              <span className="grow ellipsis">{name}</span>
              <button type="button" className="btn small" onClick={() => notify.toggleMute(id)}>
                Включить
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
