import { Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, TelegramStatus } from '../../lib/api';
import { useStore } from '../../lib/store';
import { Icon } from '../Icon';
import { Toggle } from '../SettingControls';

const SERVERS: [NonNullable<TelegramStatus['servers']>, string][] = [
  ['mentions', 'Только упоминания'],
  ['all', 'Все сообщения'],
  ['none', 'Не присылать'],
];

/** Настройки → Уведомления → Telegram (docs/API.md §20): привязка бота и что пересылать */
export function TelegramCard() {
  const toast = useStore((s) => s.toast);
  const [st, setSt] = useState<TelegramStatus | null>(null);
  const [link, setLink] = useState<{ url: string; until: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number>();

  const load = () =>
    api.telegram().then(
      (v) => {
        setSt(v);
        if (v.linked) setLink(null);
        return v;
      },
      () => null,
    );
  useEffect(() => {
    void load();
    return () => window.clearInterval(timer.current);
  }, []);

  // Пока ссылка открыта и ждёт «Start» в Telegram — раз в 3 с спрашиваем, привязался ли
  useEffect(() => {
    window.clearInterval(timer.current);
    if (!link) return;
    timer.current = window.setInterval(() => {
      if (Date.now() > link.until) {
        setLink(null);
        return;
      }
      void load();
    }, 3000);
    return () => window.clearInterval(timer.current);
  }, [link]);

  const connect = async () => {
    setBusy(true);
    try {
      const r = await api.telegramLink();
      setLink({ url: r.url, until: Date.now() + r.expires_in * 1000 });
      window.open(r.url, '_blank', 'noopener');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Не удалось получить ссылку', 'error');
    } finally {
      setBusy(false);
    }
  };
  const patch = async (p: Parameters<typeof api.telegramPatch>[0]) => {
    const prev = st;
    if (st) setSt({ ...st, ...p });
    try {
      setSt(await api.telegramPatch(p));
    } catch (e) {
      setSt(prev);
      toast(e instanceof ApiError ? e.message : 'Не удалось сохранить', 'error');
    }
  };
  const unlink = async () => {
    try {
      setSt(await api.telegramUnlink());
      toast('Telegram отключён');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Не удалось отключить', 'error');
    }
  };

  if (!st) return null;
  if (!st.available)
    return (
      <section className="stack telegram-card" aria-label="Telegram">
        <h3>Telegram</h3>
        <span className="muted small">Бот Telegram на этом сервере не настроен. Его включает администратор сервера.</span>
      </section>
    );

  return (
    <section className="stack telegram-card" aria-label="Telegram">
      <h3>Telegram</h3>
      {!st.linked ? (
        <>
          <span className="muted small">
            Бот @{st.bot_username} будет присылать в Telegram личные сообщения, беседы и упоминания, пока вас нет в Vicinity. Ответ на такое сообщение в Telegram уйдёт обратно в тот же чат.
          </span>
          {link ? (
            <div className="setting-row">
              <span className="grow muted small">Нажмите «Start» в Telegram. Ссылка одноразовая и действует 10 минут.</span>
              <a className="btn small" href={link.url} target="_blank" rel="noopener noreferrer">
                Открыть ещё раз
              </a>
            </div>
          ) : (
            <div>
              <button type="button" className="btn primary" disabled={busy} onClick={() => void connect()}>
                <Icon icon={Send} size={16} />
                Подключить Telegram
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="setting-row">
            <span className="grow">
              <span className="toggle-label">Подключён: {st.tg_username ? `@${st.tg_username}` : st.tg_name || 'Telegram'}</span>
              <span className="muted small toggle-hint">Чтобы ответить, нажмите «Ответить» на сообщении от бота @{st.bot_username}</span>
            </span>
            <button type="button" className="btn small" onClick={() => void unlink()}>
              Отключить
            </button>
          </div>
          <Toggle label="Присылать в Telegram" checked={!!st.enabled} onChange={(enabled) => void patch({ enabled })} />
          <Toggle
            label="Только когда я не в сети"
            hint="Пока Vicinity открыт хотя бы на одном устройстве, в Telegram ничего не придёт"
            checked={!!st.offline_only}
            onChange={(offline_only) => void patch({ offline_only })}
          />
          <label className="setting-row plain-label">
            <span className="grow">
              <span className="toggle-label">Сообщения серверов</span>
              <span className="muted small toggle-hint">Личные сообщения и беседы приходят всегда</span>
            </span>
            <select className="compact-select" aria-label="Сообщения серверов в Telegram" value={st.servers ?? 'mentions'} onChange={(e) => void patch({ servers: e.target.value as TelegramStatus['servers'] })}>
              {SERVERS.map(([v, text]) => (
                <option key={v} value={v}>
                  {text}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
    </section>
  );
}
