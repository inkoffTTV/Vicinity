import { FormEvent, ReactNode, useCallback, useEffect, useState } from 'react';
import { AdminUser, AdminUsers, ApiError, BlockedIp, api, parseTs , GiftCode} from '../lib/api';
import { useStore } from '../lib/store';
import { giftLink } from '../lib/routes';
import { copyText } from '../lib/clipboard';
import { fullWhen } from '../lib/time';
import { Avatar } from './Avatar';
import { ConfirmDialog } from './ConfirmDialog';

const errText = (e: unknown) => (e instanceof ApiError ? e.message : 'Ошибка');
const TIERS = ['', 'Basic', 'Standard', 'Ultra'];
const TIER_NAMES = ['Без подписки', 'Basic', 'Standard', 'Ultra'];

interface Confirm {
  title: string;
  text: ReactNode;
  action: string;
  run: () => Promise<unknown>;
}

/** Настройки → Администрирование (только developer): пользователи, блокировки, запрет IP */
export function AdminPanel() {
  const toast = useStore((s) => s.toast);
  const [query, setQuery] = useState('');
  const [data, setData] = useState<AdminUsers | null>(null);
  const [blocked, setBlocked] = useState<BlockedIp[]>([]);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [newIp, setNewIp] = useState('');

  const load = useCallback(
    (q: string) =>
      Promise.all([api.adminUsers(q), api.adminBlockedIps()]).then(
        ([users, ips]) => {
          setData(users);
          setBlocked(ips);
          setError('');
        },
        (e) => setError(errText(e)),
      ),
    [],
  );

  useEffect(() => {
    const t = setTimeout(() => void load(query), query ? 300 : 0);
    return () => clearTimeout(t);
  }, [query, load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
    } catch (e) {
      toast(errText(e), 'error');
    }
    await load(query);
  };

  const askBlockIp = (ip: string, count?: number) =>
    setConfirm({
      title: 'Заблокировать адрес',
      text: (
        <>
          С адреса <code>{ip}</code> больше нельзя будет зарегистрироваться
          {count ? `, а ${count} аккаунт(ов), созданных с него, будут заблокированы` : ', а аккаунты с него — заблокированы'}.
          Администраторов это не затронет.
        </>
      ),
      action: 'Заблокировать',
      run: () =>
        act(
          () => api.adminBlockIp(ip, 'из админ-панели', true),
          `Адрес ${ip} заблокирован`,
        ),
    });

  const askBan = (u: AdminUser) =>
    u.banned
      ? act(() => api.adminBan(u.id, false), `@${u.username} разблокирован`)
      : setConfirm({
          title: `Заблокировать @${u.username}?`,
          text: 'Он не сможет войти, все его сеансы завершатся, он выйдет из чужих серверов. Разблокировать можно здесь же.',
          action: 'Заблокировать',
          run: () => act(() => api.adminBan(u.id, true), `@${u.username} заблокирован`),
        });

  const askDelete = (u: AdminUser) =>
    setConfirm({
      title: `Удалить @${u.username} навсегда?`,
      text: 'Аккаунт, его сообщения, реакции и участие в серверах будут удалены. Это нельзя отменить.',
      action: 'Удалить',
      run: () => act(() => api.adminDeleteUser(u.id), `@${u.username} удалён`),
    });

  const submitIp = (e: FormEvent) => {
    e.preventDefault();
    if (newIp.trim()) askBlockIp(newIp.trim());
  };

  return (
    <div className="settings admin-panel">
      {error && <div className="form-error">{error}</div>}
      {data && (
        <section className="settings-card admin-stats" aria-label="Сводка">
          <div>
            <strong>{data.total}</strong>
            <span className="muted small">аккаунтов</span>
          </div>
          <div>
            <strong>{data.last_day}</strong>
            <span className="muted small">за сутки</span>
          </div>
          <div>
            <strong>{data.banned}</strong>
            <span className="muted small">заблокировано</span>
          </div>
        </section>
      )}

      {data && data.top_ips.length > 0 && (
        <section className="settings-card stack" aria-label="Частые адреса регистраций">
          <h3>Много регистраций с одного адреса (7 дней)</h3>
          <ul className="admin-list">
            {data.top_ips.map((t) => (
              <li key={t.ip}>
                <button type="button" className="link-btn mono" onClick={() => setQuery(t.ip)}>
                  {t.ip}
                </button>
                <span className="grow muted small">
                  {t.count} аккаунт(ов), последний {fullWhen(parseTs(t.last))}
                </span>
                {blocked.some((b) => b.ip === t.ip) ? (
                  <span className="admin-tag">заблокирован</span>
                ) : (
                  <button type="button" className="btn small danger" onClick={() => askBlockIp(t.ip, t.count)}>
                    Заблокировать IP
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="settings-card stack" aria-label="Пользователи">
        <div className="row-between center-y">
          <h3>Пользователи</h3>
          <input
            className="admin-search"
            type="search"
            placeholder="Логин, имя, почта или IP"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {!data && !error && <div className="muted small">Загрузка…</div>}
        <ul className="admin-users">
          {(data?.users ?? []).map((u) => (
            <li key={u.id} className={u.banned ? 'banned' : ''}>
              <Avatar name={u.display_name} src={u.avatar_path} id={u.id} size={32} />
              <div className="grow admin-user-info">
                <div className="ellipsis">
                  <strong>{u.display_name}</strong> <span className="muted">@{u.username}</span>
                  {u.developer && <span className="admin-tag">админ</span>}
                  {u.subscription_tier > 0 && <span className="admin-tag">{TIERS[u.subscription_tier]}</span>}
                  {u.banned && <span className="admin-tag danger">заблокирован</span>}
                </div>
                <div className="muted small ellipsis">
                  #{u.id} · {fullWhen(parseTs(u.created_at))}
                  {u.email && <> · {u.email}</>}
                  {u.signup_ip && (
                    <>
                      {' · '}
                      <button type="button" className="link-btn mono small" onClick={() => setQuery(u.signup_ip)}>
                        {u.signup_ip}
                      </button>
                    </>
                  )}
                </div>
              </div>
              <select
                aria-label={`Подписка @${u.username}`}
                className="admin-tier"
                value={u.subscription_tier}
                onChange={(e) => {
                  const tier = Number(e.target.value);
                  void act(() => api.adminSetTier(u.id, tier), `@${u.username}: ${TIER_NAMES[tier]}`);
                }}
              >
                {TIER_NAMES.map((n, i) => (
                  <option key={n} value={i}>
                    {n}
                  </option>
                ))}
              </select>
              {!u.developer && (
                <div className="stack-row">
                  <button type="button" className="btn small" onClick={() => askBan(u)}>
                    {u.banned ? 'Разблокировать' : 'Заблокировать'}
                  </button>
                  {u.banned && (
                    <button type="button" className="btn small danger" onClick={() => askDelete(u)}>
                      Удалить
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
        {data && data.users.length === 0 && <div className="muted small">Никого не найдено</div>}
      </section>

      <section className="settings-card stack" aria-label="Заблокированные адреса">
        <h3>Заблокированные адреса</h3>
        <form className="stack-row" onSubmit={submitIp}>
          <input
            className="grow"
            placeholder="IP-адрес, например 203.0.113.5"
            value={newIp}
            onChange={(e) => setNewIp(e.target.value)}
          />
          <button className="btn small danger" disabled={!newIp.trim()}>
            Заблокировать
          </button>
        </form>
        {blocked.length === 0 && <div className="muted small">Пока никого</div>}
        <ul className="admin-list">
          {blocked.map((b) => (
            <li key={b.ip}>
              <span className="mono">{b.ip}</span>
              <span className="grow muted small">
                с {fullWhen(parseTs(b.created_at))} · аккаунтов с него: {b.accounts}
              </span>
              <button
                type="button"
                className="btn small"
                onClick={() => act(() => api.adminUnblockIp(b.ip), `Адрес ${b.ip} разблокирован`)}
              >
                Снять блокировку
              </button>
            </li>
          ))}
        </ul>
        <div className="muted small">
          Блокировка IP запрещает новые регистрации с этого адреса. Домашние адреса иногда меняются — надёжнее
          всего защищают капча и подтверждение почты.
        </div>
      </section>

      <GiftCodes />

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          action={confirm.action}
          danger
          onConfirm={async () => {
            await confirm.run();
            setConfirm(null);
          }}
          onClose={() => setConfirm(null)}
        >
          {confirm.text}
        </ConfirmDialog>
      )}
    </div>
  );
}

// ── Подарочные коды подписки (docs/API.md §17) ──

function GiftCodes() {
  const toast = useStore((s) => s.toast);
  const [gifts, setGifts] = useState<GiftCode[]>([]);
  const [tier, setTier] = useState(2);
  const [days, setDays] = useState(30);
  const [count, setCount] = useState(1);
  const [note, setNote] = useState('');
  const [fresh, setFresh] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const reload = useCallback(() => api.adminGifts().then(setGifts, () => {}), []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const codes = await api.adminCreateGifts(tier, days, count, note);
      setFresh(codes.map((c) => c.code));
      toast(`Создано кодов: ${codes.length}`);
      await reload();
    } catch (err) {
      toast(errText(err), 'error');
    }
    setBusy(false);
  };

  return (
    <section className="settings-card stack" aria-label="Подарочные коды">
      <h3>Подарочные коды подписки</h3>
      <form className="gift-form" onSubmit={(e) => void create(e)}>
        <label>
          Уровень
          <select className="compact-select" value={tier} onChange={(e) => setTier(Number(e.target.value))}>
            {[1, 2, 3].map((t) => (
              <option key={t} value={t}>
                {TIER_NAMES[t]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Дней
          <input type="number" min={1} max={3650} value={days} onChange={(e) => setDays(Number(e.target.value))} />
        </label>
        <label>
          Штук
          <input type="number" min={1} max={50} value={count} onChange={(e) => setCount(Number(e.target.value))} />
        </label>
        <label className="grow">
          Заметка
          <input value={note} maxLength={80} placeholder="Кому или за что" onChange={(e) => setNote(e.target.value)} />
        </label>
        <button className="btn primary" disabled={busy}>
          Создать
        </button>
      </form>
      {fresh.length > 0 && (
        <div className="gift-fresh" role="status">
          <strong>Новые коды</strong> — скопируйте ссылку и отправьте получателю:
          <ul className="admin-list">
            {fresh.map((c) => (
              <li key={c}>
                <span className="mono">{c}</span>
                <span className="grow" />
                <button type="button" className="btn small" onClick={() => void copyText(giftLink(c)).then(() => toast('Ссылка скопирована'))}>
                  Скопировать ссылку
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {gifts.length === 0 && <div className="muted small">Кодов ещё не было</div>}
      <ul className="admin-list">
        {gifts.slice(0, 50).map((g) => (
          <li key={g.code} className={g.redeemed ? 'muted' : undefined}>
            <span className="mono">{g.code}</span>
            <span className="grow small">
              {TIER_NAMES[g.tier]} · {g.days} дн.{g.note && <> · {g.note}</>}
              {g.redeemed ? <> · активирован @{g.redeemed_by_name}</> : ''}
            </span>
            {!g.redeemed && (
              <button type="button" className="btn small" onClick={() => void copyText(giftLink(g.code)).then(() => toast('Ссылка скопирована'))}>
                Ссылка
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
