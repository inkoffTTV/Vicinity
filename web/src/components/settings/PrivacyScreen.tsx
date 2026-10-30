import { Plus, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, ApiError, PrivacyPatch, PrivacyRule, PrivacyRuleKey, PrivacySettings } from '../../lib/api';
import { useStore } from '../../lib/store';
import { KnownUser, useUserDirectory } from '../../lib/users';
import { Avatar } from '../Avatar';
import { Icon } from '../Icon';

const RULE: PrivacyRule = { who: 'everyone', hide_from: [], show_to: [] };
const RULE_KEYS: PrivacyRuleKey[] = ['status', 'stats', 'about', 'banner', 'wishlist', 'games', 'music', 'connections', 'all'];
const DEFAULTS: PrivacySettings = {
  status: 'everyone',
  stats: 'everyone',
  dm: 'everyone',
  friend_requests: 'everyone',
  rules: Object.fromEntries(RULE_KEYS.map((k) => [k, { ...RULE }])) as PrivacySettings['rules'],
};

type Key = 'dm' | 'friend_requests';
const ROWS: { key: Key; label: string; hint: string; options: [string, string][] }[] = [
  {
    key: 'dm',
    label: 'Кто может написать мне в личку',
    hint: 'Уже открытые лички остаются; незнакомым со «только друзья» написать первым нельзя',
    options: [
      ['everyone', 'Все'],
      ['friends', 'Только друзья'],
    ],
  },
  {
    key: 'friend_requests',
    label: 'Кто может отправить заявку в друзья',
    hint: 'Друзья друзей — те, у кого с вами есть общий друг',
    options: [
      ['everyone', 'Все'],
      ['friends_of_friends', 'Друзья друзей'],
      ['nobody', 'Никто'],
    ],
  },
];

/** Элементы профиля с правилом «кому видно» и исключениями, как в Telegram */
const ELEMENTS: { key: Exclude<PrivacyRuleKey, 'all'>; label: string; hint: string }[] = [
  { key: 'status', label: 'Статус в сети', hint: 'Остальным вы всегда «не в сети»; «Невидимый» в меню статуса скрывает вас от всех разом' },
  { key: 'stats', label: 'Уровень, серия и награды', hint: 'Титул и эмблема у ника видны всем в любом случае' },
  { key: 'about', label: 'О себе', hint: 'Текст «о себе», местоимения, статус и ссылки в карточке' },
  { key: 'banner', label: 'Баннер', hint: 'Картинка в шапке профиля; цвет и тема карточки остаются' },
  { key: 'wishlist', label: 'Вишлист', hint: 'Вкладка «Вишлист» на доске профиля' },
  { key: 'games', label: 'Игры', hint: 'Любимая игра, список игр и рекорды в играх «Активностей»' },
  { key: 'music', label: 'Музыка', hint: 'Трек в карточке профиля' },
  { key: 'connections', label: 'Интеграции', hint: 'Steam, Twitch, Telegram и другие ссылки на ваши аккаунты' },
];

const WHO: [PrivacyRule['who'], string][] = [
  ['everyone', 'Все'],
  ['friends', 'Только друзья'],
  ['nobody', 'Никто'],
];

/** Настройки → Приватность (docs/API.md §15): хранится на сервере и проверяется им же */
export function PrivacyScreen() {
  const toast = useStore((s) => s.toast);
  const [p, setP] = useState<PrivacySettings>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    api.privacy().then(
      (v) => {
        setP({ ...DEFAULTS, ...v, rules: { ...DEFAULTS.rules, ...(v.rules ?? {}) } });
        setLoaded(true);
      },
      () => setLoaded(true),
    );
  }, []);

  const save = async (patch: PrivacyPatch, next: PrivacySettings) => {
    const prev = p;
    setP(next);
    try {
      const v = await api.patchPrivacy(patch);
      setP({ ...DEFAULTS, ...v, rules: { ...DEFAULTS.rules, ...(v.rules ?? {}) } });
    } catch (e) {
      setP(prev);
      toast(e instanceof ApiError ? e.message : 'Не удалось сохранить', 'error');
    }
  };
  const change = (key: Key, value: string) => void save({ [key]: value } as PrivacyPatch, { ...p, [key]: value } as PrivacySettings);
  const setRule = (key: PrivacyRuleKey, rule: PrivacyRule) =>
    void save({ rules: { [key]: rule } }, { ...p, rules: { ...p.rules, [key]: rule } });

  return (
    <div className="settings">
      <header className="settings-head">
        <h1>Приватность</h1>
        <p className="muted">Кто что видит в вашем профиле, кто может писать и добавлять в друзья. Проверяет сервер, подменой запроса не обойти.</p>
      </header>

      <section className="settings-card stack" aria-busy={!loaded} aria-label="Скрыть профиль целиком">
        <div className="setting-row">
          <span className="grow">
            <span className="toggle-label">Скрыть профиль целиком от этих людей</span>
            <span className="muted small toggle-hint">Они увидят только имя и аватар: ни «о себе», ни игр, ни статуса, ни наград</span>
          </span>
        </div>
        <PeopleList label="Не показывать" ids={p.rules.all.hide_from} onChange={(ids) => setRule('all', { ...p.rules.all, hide_from: ids })} disabled={!loaded} />
      </section>

      <section className="settings-card stack" aria-busy={!loaded} aria-label="Элементы профиля">
        <span className="muted small">Для каждого элемента: кому видно, и исключения: кому не показывать никогда, а кому показывать всегда.</span>
        {ELEMENTS.map((el) => {
          const rule = p.rules[el.key] ?? RULE;
          return (
            <div key={el.key} className="privacy-element" data-key={el.key}>
              <label className="setting-row plain-label">
                <span className="grow">
                  <span className="toggle-label">{el.label}</span>
                  <span className="muted small toggle-hint">{el.hint}</span>
                </span>
                <select className="compact-select" aria-label={`${el.label}: кому видно`} value={rule.who} onChange={(e) => setRule(el.key, { ...rule, who: e.target.value as PrivacyRule['who'] })} disabled={!loaded}>
                  {WHO.map(([v, text]) => (
                    <option key={v} value={v}>
                      {text}
                    </option>
                  ))}
                </select>
              </label>
              <div className="privacy-exceptions">
                {rule.who !== 'nobody' && (
                  <PeopleList label="Не показывать" ids={rule.hide_from} onChange={(ids) => setRule(el.key, { ...rule, hide_from: ids })} disabled={!loaded} />
                )}
                {rule.who !== 'everyone' && (
                  <PeopleList label="Всегда показывать" ids={rule.show_to} onChange={(ids) => setRule(el.key, { ...rule, show_to: ids })} disabled={!loaded} />
                )}
              </div>
            </div>
          );
        })}
      </section>

      <section className="settings-card stack" aria-busy={!loaded} aria-label="Сообщения и заявки">
        {ROWS.map((r) => (
          <label key={r.key} className="setting-row plain-label">
            <span className="grow">
              <span className="toggle-label">{r.label}</span>
              <span className="muted small toggle-hint">{r.hint}</span>
            </span>
            <select className="compact-select" value={p[r.key]} onChange={(e) => change(r.key, e.target.value)} disabled={!loaded}>
              {r.options.map(([v, text]) => (
                <option key={v} value={v}>
                  {text}
                </option>
              ))}
            </select>
          </label>
        ))}
      </section>
    </div>
  );
}

/** Список людей-исключений: чипы с удалением и добавление из знакомых (друзья, лички, участники серверов и бесед) */
function PeopleList({ label, ids, onChange, disabled }: { label: string; ids: number[]; onChange: (ids: number[]) => void; disabled?: boolean }) {
  const dir = useUserDirectory();
  const me = useStore((s) => s.me?.user_id);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const candidates = useMemo(() => {
    const term = q.trim().toLowerCase();
    const out: KnownUser[] = [];
    dir.byId.forEach((u) => {
      if (u.id === me || ids.includes(u.id)) return;
      if (term && !u.display_name.toLowerCase().includes(term) && !u.username.toLowerCase().includes(term)) return;
      out.push(u);
    });
    return out.sort((a, b) => a.display_name.localeCompare(b.display_name, 'ru')).slice(0, 8);
  }, [dir, ids, me, q]);

  return (
    <div className="people-list" role="group" aria-label={label}>
      <span className="muted small people-list-label">{label}:</span>
      {ids.map((id) => {
        const u = dir.byId.get(id);
        return (
          <span key={id} className="chip people-chip">
            <Avatar name={u?.display_name ?? '?'} src={u?.avatar_path} id={id} size={18} />
            {u?.display_name ?? `id ${id}`}
            <button type="button" className="plain" aria-label={`Убрать ${u?.display_name ?? id}`} disabled={disabled} onClick={() => onChange(ids.filter((x) => x !== id))}>
              <Icon icon={X} size={12} />
            </button>
          </span>
        );
      })}
      {open ? (
        <span className="people-add">
          <input
            autoFocus
            type="search"
            placeholder="Имя или логин"
            aria-label={`${label}: кого добавить`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
              if (e.key === 'Enter' && candidates[0]) {
                onChange([...ids, candidates[0].id]);
                setQ('');
              }
            }}
            onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          />
          {candidates.length > 0 && (
            <ul className="people-add-list" role="listbox">
              {candidates.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onChange([...ids, u.id]);
                      setQ('');
                      setOpen(false);
                    }}
                  >
                    <Avatar name={u.display_name} src={u.avatar_path} id={u.id} size={22} />
                    <span className="ellipsis">{u.display_name}</span>
                    <span className="muted small">@{u.username}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </span>
      ) : (
        <button type="button" className="chip people-chip add" disabled={disabled} onClick={() => setOpen(true)}>
          <Icon icon={Plus} size={12} />
          Добавить
        </button>
      )}
    </div>
  );
}
