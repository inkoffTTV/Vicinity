import { ChevronLeft, LogOut, Search, X } from 'lucide-react';
import { FormEvent, useCallback, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { NOTIFY_LEVELS, serverLevel, useNotifySettings } from '../lib/notify';
import { usePlan } from '../lib/plan';
import { useStore } from '../lib/store';
import { AdminPanel } from './AdminPanel';
import { SettingsAppLinks } from './AppDownloads';
import { VoiceScreen } from './settings/VoiceScreen';
import { AppIconScreen } from './settings/AppIconScreen';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { Toggle } from './SettingControls';
import { ProfileStudioPanel } from './profile/ProfileStudio';
import { AccessibilityTab, SubscriptionTab, ThemeTab } from './ThemeSettings';
import { AccountScreen } from './settings/AccountScreen';

type Tab = 'account' | 'profile' | 'theme' | 'appicon' | 'voice' | 'notifications' | 'hotkeys' | 'accessibility' | 'subscription' | 'admin';

interface NavItem {
  id: Tab;
  label: string;
  /** Слова для поиска по настройкам */
  keywords: string;
}

// Разделы — как в макете: учётная запись, приложение, подписка (+ администрирование для developer)
const GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Учётная запись',
    items: [
      { id: 'account', label: 'Аккаунт', keywords: 'логин почта пароль двухфакторная 2fa сеансы устройства безопасность' },
      { id: 'profile', label: 'Профиль', keywords: 'имя аватар баннер о себе статус цвет тема ник бейджик тег' },
    ],
  },
  {
    title: 'Приложение',
    items: [
      { id: 'theme', label: 'Внешний вид', keywords: 'тема светлая тёмная графит чёрная цвет оформление' },
      { id: 'appicon', label: 'Значок приложения', keywords: 'иконка значок вкладка favicon лого' },
      { id: 'voice', label: 'Голос и видео', keywords: 'микрофон динамик звук камера громкость' },
      { id: 'notifications', label: 'Уведомления', keywords: 'звук оповещения упоминания' },
      { id: 'hotkeys', label: 'Горячие клавиши', keywords: 'клавиатура сочетания ctrl alt' },
      { id: 'accessibility', label: 'Доступность', keywords: 'контраст насыщенность шрифт анимация компактный' },
    ],
  },
  { title: 'Подписка', items: [{ id: 'subscription', label: 'О подписке', keywords: 'basic standard ultra тариф' }] },
];

const TIER_NAMES = ['', 'Basic', 'Standard', 'Ultra'];

export function Settings() {
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const me = useStore((s) => s.me)!;
  const logout = useStore((s) => s.logout);
  const tier = usePlan((s) => s.current.tier);
  const isAdmin = Boolean(me.developer);
  const [tab, setTab] = useState<Tab>('account');
  // Телефон: сначала список разделов, потом раздел (кнопка «Назад»)
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState('');
  const close = useCallback(() => setSettingsOpen(false), [setSettingsOpen]);

  const groups = isAdmin
    ? [...GROUPS, { title: 'Сервер', items: [{ id: 'admin' as Tab, label: 'Администрирование', keywords: 'пользователи блокировка ip подписки' }] }]
    : GROUPS;
  const q = query.trim().toLowerCase();
  const visible = groups
    .map((g) => ({ ...g, items: g.items.filter((it) => !q || `${it.label} ${it.keywords}`.toLowerCase().includes(q)) }))
    .filter((g) => g.items.length > 0);
  const current = groups.flatMap((g) => g.items).find((it) => it.id === tab);

  const go = (t: Tab) => {
    setTab(t);
    setMobileOpen(true);
  };

  return (
    <Modal onClose={close} bare label="Настройки">
      <div className={`settings-shell${mobileOpen ? ' show-content' : ''}`}>
        <nav className="settings-nav" aria-label="Разделы настроек">
          <div className="settings-me">
            <Avatar name={me.display_name} src={me.avatar_path} id={me.user_id} size={40} presence={me.presence} />
            <div className="grow">
              <strong className="ellipsis">{me.display_name}</strong>
              <span className="ellipsis">{me.username}</span>
            </div>
            {tier > 0 && <span className={`tier-tag t${tier}`}>{TIER_NAMES[tier]}</span>}
            <button type="button" className="icon-btn settings-nav-close" aria-label="Закрыть настройки" onClick={close}>
              <Icon icon={X} size={20} />
            </button>
          </div>
          <label className="settings-search">
            <Icon icon={Search} size={16} />
            <input type="search" placeholder="Поиск по настройкам" aria-label="Поиск по настройкам" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div className="settings-groups">
            {visible.map((g) => (
              <div key={g.title} className="settings-group">
                <span className="settings-group-title">{g.title}</span>
                {g.items.map((it) => (
                  <button key={it.id} type="button" aria-current={tab === it.id ? 'page' : undefined} onClick={() => go(it.id)}>
                    <span className="grow">{it.label}</span>
                  </button>
                ))}
              </div>
            ))}
            {visible.length === 0 && <span className="muted small settings-nothing">Ничего не нашлось</span>}
          </div>
          <div className="settings-nav-foot">
            <SettingsAppLinks />
            <button type="button" className="settings-logout" onClick={() => void logout()}>
              <Icon icon={LogOut} size={16} />
              Выйти
            </button>
          </div>
        </nav>
        <main className="settings-main" aria-label={current?.label}>
          <div className="settings-main-bar">
            <button type="button" className="icon-btn settings-back" aria-label="К разделам" onClick={() => setMobileOpen(false)}>
              <Icon icon={ChevronLeft} size={20} />
            </button>
            <span className="grow" />
            <button type="button" className="icon-btn settings-close" aria-label="Закрыть настройки" onClick={close}>
              <Icon icon={X} size={20} />
            </button>
          </div>
          <div className="settings-main-body">
            {tab === 'account' && <AccountScreen onEditProfile={() => go('profile')} />}
            {tab === 'profile' && <ProfileTab />}
            {tab === 'theme' && <ThemeTab goTo={(t) => go(t === 'accessibility' ? 'accessibility' : 'subscription')} />}
            {tab === 'appicon' && <AppIconScreen goSubscription={() => go('subscription')} />}
            {tab === 'voice' && <VoiceScreen />}
            {tab === 'notifications' && <NotificationsTab />}
            {tab === 'hotkeys' && <HotkeysScreen />}
            {tab === 'accessibility' && <AccessibilityTab />}
            {tab === 'subscription' && <SubscriptionTab />}
            {tab === 'admin' && isAdmin && <AdminPanel />}
          </div>
        </main>
      </div>
    </Modal>
  );
}

// ── Горячие клавиши (lib/shortcuts.ts) ──

const HOTKEYS: [string[], string][] = [
  [['Ctrl', 'K'], 'Быстрый переход к каналу или беседе'],
  [['Alt', '↑'], 'Предыдущий канал в списке'],
  [['Alt', '↓'], 'Следующий канал в списке'],
  [['Alt', 'Shift', '↑'], 'Предыдущий канал с непрочитанным'],
  [['Alt', 'Shift', '↓'], 'Следующий канал с непрочитанным'],
  [['↑'], 'Изменить своё последнее сообщение (в пустом поле ввода)'],
  [['Ctrl', 'V'], 'Вставить картинку из буфера в сообщение'],
  [['Shift', 'Enter'], 'Новая строка в сообщении'],
  [['Esc'], 'Закрыть окно, меню или панель'],
];

function HotkeysScreen() {
  return (
    <div className="settings">
      <header className="settings-head">
        <h1 className="display">Горячие клавиши</h1>
        <p className="muted">На Mac вместо Ctrl — ⌘</p>
      </header>
      <ul className="hotkeys">
        {HOTKEYS.map(([keys, what]) => (
          <li key={what}>
            <span className="grow">{what}</span>
            <span className="hotkey-keys">
              {keys.map((k) => (
                <kbd key={k}>{k}</kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const errText = (e: unknown) => (e instanceof ApiError ? e.message : 'Ошибка');

// ── Профиль ──

/** Вкладка «Профиль» — это и есть редактор профиля, одна форма на всё (components/profile/ProfileStudio.tsx) */
function ProfileTab() {
  return <ProfileStudioPanel />;
}
function strength(p: string): number {
  if (!p) return 0;
  let score = p.length >= 8 ? 1 : 0;
  if (p.length >= 12) score++;
  if (/[a-zа-яё]/.test(p) && /[A-ZА-ЯЁ]/.test(p)) score++;
  if (/\d/.test(p) && /[^\p{L}\d]/u.test(p)) score++;
  return Math.max(1, Math.min(4, score));
}
const STRENGTH = ['', 'Слабый', 'Средний', 'Хороший', 'Надёжный'];

// Смена пароля завершает другие сеансы — открытые списки сеансов перечитываются
const SESSIONS_CHANGED = 'vicinity:sessions-changed';

/** Смена пароля (Настройки → Аккаунт → Пароль) */
export function PasswordForm() {
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
