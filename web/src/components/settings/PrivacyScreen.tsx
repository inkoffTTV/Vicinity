import { useEffect, useState } from 'react';
import { api, ApiError, PrivacySettings } from '../../lib/api';
import { useStore } from '../../lib/store';

const DEFAULTS: PrivacySettings = { status: 'everyone', stats: 'everyone', dm: 'everyone', friend_requests: 'everyone' };

type Key = keyof PrivacySettings;
const ROWS: { key: Key; label: string; hint: string; options: [string, string][] }[] = [
  {
    key: 'status',
    label: 'Кто видит мой статус в сети',
    hint: 'Остальным вы всегда «не в сети»; «Невидимый» в меню статуса скрывает вас от всех разом',
    options: [
      ['everyone', 'Все'],
      ['friends', 'Только друзья'],
      ['nobody', 'Никто'],
    ],
  },
  {
    key: 'stats',
    label: 'Кто видит уровень, серию и награды',
    hint: 'Титул и эмблема у ника видны всем в любом случае',
    options: [
      ['everyone', 'Все'],
      ['friends', 'Только друзья'],
      ['nobody', 'Никто'],
    ],
  },
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

/** Настройки → Приватность (docs/API.md §15): хранится на сервере и проверяется им же */
export function PrivacyScreen() {
  const toast = useStore((s) => s.toast);
  const [p, setP] = useState<PrivacySettings>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    api.privacy().then(
      (v) => {
        setP(v);
        setLoaded(true);
      },
      () => setLoaded(true),
    );
  }, []);

  const change = async (key: Key, value: string) => {
    const prev = p;
    setP({ ...p, [key]: value } as PrivacySettings);
    try {
      setP(await api.patchPrivacy({ [key]: value } as Partial<PrivacySettings>));
    } catch (e) {
      setP(prev);
      toast(e instanceof ApiError ? e.message : 'Не удалось сохранить', 'error');
    }
  };

  return (
    <div className="settings">
      <header className="settings-head">
        <h1>Приватность</h1>
        <p className="muted">Кто видит ваш статус и активность, кто может писать и добавлять в друзья. Проверяет сервер, подменой запроса не обойти.</p>
      </header>
      <section className="settings-card stack" aria-busy={!loaded}>
        {ROWS.map((r) => (
          <label key={r.key} className="setting-row plain-label">
            <span className="grow">
              <span className="toggle-label">{r.label}</span>
              <span className="muted small toggle-hint">{r.hint}</span>
            </span>
            <select className="compact-select" value={p[r.key]} onChange={(e) => void change(r.key, e.target.value)} disabled={!loaded}>
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
