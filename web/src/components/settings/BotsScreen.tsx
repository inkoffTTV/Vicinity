import { Bot as BotIcon, Copy, KeyRound, MessageSquare, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError, Bot } from '../../lib/api';
import { copyText } from '../../lib/clipboard';
import { useStore } from '../../lib/store';
import { Avatar } from '../Avatar';
import { ConfirmDialog } from '../ConfirmDialog';
import { Icon } from '../Icon';
import { Toggle } from '../SettingControls';

const errText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
// Как на сервере (docs/API.md §21.1): 5–32 символа [a-z0-9_], в конце «bot»
const USERNAME_RE = /^[a-z0-9_]{2,29}bot$/;
const MAX_BOTS = 10;

/** Настройки → Боты: свои боты для Bot API в стиле Telegram (docs/API.md §21) */
export function BotsScreen() {
  const toast = useStore((s) => s.toast);
  const [bots, setBots] = useState<Bot[] | null>(null);
  const [error, setError] = useState('');
  // Только что выданный токен: показывается один раз
  const [fresh, setFresh] = useState<{ bot: Bot; token: string } | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'token' | 'delete'; bot: Bot } | null>(null);

  const load = () =>
    api.bots().then(
      (list) => (setBots(list), setError('')),
      (e) => setError(errText(e, 'Не удалось загрузить ботов')),
    );
  useEffect(() => {
    void load();
  }, []);

  const replace = (b: Bot) => setBots((list) => (list ?? []).map((x) => (x.id === b.id ? b : x)));

  const patch = async (b: Bot, p: { read_all?: boolean }) => {
    replace({ ...b, ...p });
    try {
      replace(await api.patchBot(b.id, p));
    } catch (e) {
      replace(b);
      toast(errText(e, 'Не удалось сохранить'), 'error');
    }
  };

  const runConfirm = async () => {
    if (!confirm) return;
    const { kind, bot } = confirm;
    try {
      if (kind === 'token') {
        const r = await api.botToken(bot.id);
        replace(r.bot);
        setFresh(r);
      } else {
        await api.deleteBot(bot.id);
        setBots((list) => (list ?? []).filter((x) => x.id !== bot.id));
        if (fresh?.bot.id === bot.id) setFresh(null);
        toast(`Бот @${bot.username} удалён`);
      }
    } catch (e) {
      toast(errText(e, kind === 'token' ? 'Не удалось выпустить токен — попробуйте ещё раз' : 'Не удалось удалить бота — попробуйте ещё раз'), 'error');
    }
    setConfirm(null);
  };

  const write = (b: Bot) => {
    const s = useStore.getState();
    // Свой бот — «незнакомец» для проверки доступа: личку открываем по его полному нику
    void s.openDmWith(b.id, { username: b.username }).then(() => s.setSettingsOpen(false));
  };

  return (
    <div className="settings bots-screen">
      <header className="settings-head">
        <h1>Боты</h1>
        <p className="muted">
          Бот — программа, которая отвечает в чатах Vicinity. Он работает через Bot API в стиле Telegram, поэтому подходят
          библиотеки для Telegram: aiogram, python-telegram-bot, grammY.
        </p>
      </header>

      {fresh && <TokenCard bot={fresh.bot} token={fresh.token} onDone={() => setFresh(null)} />}

      <CreateBot
        disabled={(bots?.length ?? 0) >= MAX_BOTS}
        onCreated={(r) => {
          setBots((list) => [...(list ?? []), r.bot]);
          setFresh(r);
        }}
      />

      <section className="settings-card stack" aria-label="Мои боты">
        <h3>Мои боты</h3>
        {error && <div className="form-error">{error}</div>}
        {bots === null && !error && <span className="muted small">Загрузка…</span>}
        {bots?.length === 0 && (
          <div className="bots-empty">
            <Icon icon={BotIcon} size={22} />
            <span className="muted">Ботов пока нет. Создайте первого — форма выше.</span>
          </div>
        )}
        <ul className="bot-list">
          {(bots ?? []).map((b) => (
            <li key={b.id} className="bot-item">
              <div className="bot-item-head">
                <Avatar name={b.display_name} src={b.avatar_path} id={b.id} size={40} />
                <div className="grow bot-item-name">
                  <strong className="ellipsis">
                    {b.display_name} <span className="bot-tag">Бот</span>
                  </strong>
                  <span className="muted small ellipsis">@{b.username}</span>
                </div>
              </div>
              <dl className="bot-facts small">
                <dt>Токен</dt>
                <dd>
                  <code>…{b.token_hint}</code>
                </dd>
                <dt>Обновления</dt>
                <dd className="ellipsis" title={b.webhook_url || undefined}>
                  {b.webhook_url ? `вебхук ${hostOf(b.webhook_url)}` : 'getUpdates (длинный опрос)'}
                </dd>
                {b.webhook_error && (
                  <>
                    <dt>Ошибка вебхука</dt>
                    <dd className="bot-fact-error">{b.webhook_error}</dd>
                  </>
                )}
                <dt>Команды</dt>
                <dd>{b.commands.length ? b.commands.map((c) => `/${c.command}`).join(' ') : <span className="muted">не заданы (setMyCommands)</span>}</dd>
                <dt>Серверы</dt>
                <dd>{b.servers.length ? b.servers.map((s) => s.name).join(', ') : <span className="muted">нет</span>}</dd>
              </dl>
              <Toggle
                label="Читать все сообщения"
                hint="В беседах и на серверах бот получит каждое сообщение, а не только команды, упоминания и ответы ему"
                checked={!!b.read_all}
                onChange={(read_all) => void patch(b, { read_all })}
              />
              <div className="stack-row wrap">
                <button type="button" className="btn small" onClick={() => write(b)}>
                  <Icon icon={MessageSquare} size={14} />
                  Написать
                </button>
                <button type="button" className="btn small" onClick={() => setConfirm({ kind: 'token', bot: b })}>
                  <Icon icon={KeyRound} size={14} />
                  Новый токен
                </button>
                <button type="button" className="btn small danger" onClick={() => setConfirm({ kind: 'delete', bot: b })}>
                  <Icon icon={Trash2} size={14} />
                  Удалить
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <HowTo />

      {confirm && (
        <ConfirmDialog
          title={confirm.kind === 'token' ? `Новый токен для @${confirm.bot.username}` : `Удалить бота @${confirm.bot.username}?`}
          action={confirm.kind === 'token' ? 'Выпустить новый' : 'Удалить'}
          danger={confirm.kind === 'delete'}
          onConfirm={runConfirm}
          onClose={() => setConfirm(null)}
        >
          {confirm.kind === 'token'
            ? 'Старый токен сразу перестанет работать — программу бота нужно будет перезапустить с новым.'
            : 'Бот, его сообщения и очередь обновлений будут удалены. Это действие нельзя отменить.'}
        </ConfirmDialog>
      )}
    </div>
  );
}

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function CreateBot({ disabled, onCreated }: { disabled: boolean; onCreated: (r: { bot: Bot; token: string }) => void }) {
  const toast = useStore((s) => s.toast);
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const u = username.trim().replace(/^@/, '').toLowerCase();
  const valid = USERNAME_RE.test(u);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    try {
      const r = await api.createBot(u, name.trim() || u);
      onCreated(r);
      setName('');
      setUsername('');
    } catch (err) {
      toast(errText(err, 'Не удалось создать бота'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="settings-card stack" onSubmit={submit} aria-label="Новый бот">
      <h3>Новый бот</h3>
      <div className="bot-create-fields">
        <label>
          Имя
          <input value={name} maxLength={32} placeholder="Погодный бот" onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Имя пользователя
          <input
            value={username}
            maxLength={33}
            placeholder="weather_bot"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className={username && !valid ? 'invalid' : ''}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
      </div>
      <span className="muted small">
        {disabled
          ? `Можно создать не больше ${MAX_BOTS} ботов — удалите ненужного.`
          : 'Латиница, цифры и «_», от 5 до 32 символов; в конце — «bot», например weather_bot.'}
      </span>
      <div className="row end">
        <button className="btn primary" disabled={disabled || busy || !valid}>
          <Icon icon={Plus} size={16} />
          Создать бота
        </button>
      </div>
    </form>
  );
}

// Токен показывается один раз: копирование и предупреждение
function TokenCard({ bot, token, onDone }: { bot: Bot; token: string; onDone: () => void }) {
  const toast = useStore((s) => s.toast);
  const copy = async () => {
    if (await copyText(token)) toast('Токен скопирован');
    else toast('Не удалось скопировать — выделите токен вручную', 'error');
  };
  return (
    <section className="settings-card stack bot-token-card" aria-label={`Токен бота @${bot.username}`}>
      <h3>Токен бота @{bot.username}</h3>
      <div className="invite-link">
        <input readOnly value={token} aria-label="Токен бота" className="mono" onFocus={(e) => e.target.select()} />
        <button type="button" className="btn primary" onClick={() => void copy()}>
          <Icon icon={Copy} size={16} />
          Копировать
        </button>
      </div>
      <p className="bot-token-warn small no-margin">
        <Icon icon={TriangleAlert} size={16} />
        <span>
          Сохраните токен сейчас: больше он не покажется. С ним можно писать от имени бота — не публикуйте его и не
          передавайте. Потеряли — выпустите новый.
        </span>
      </p>
      <div className="row end">
        <button type="button" className="btn small" onClick={onDone}>
          Готово
        </button>
      </div>
    </section>
  );
}

function HowTo() {
  const toast = useStore((s) => s.toast);
  const base = `${location.origin}/api/v1`;
  const example = `from aiogram import Bot, Dispatcher
from aiogram.client.session.aiohttp import AiohttpSession
from aiogram.client.telegram import TelegramAPIServer

session = AiohttpSession(api=TelegramAPIServer.from_base("${base}"))
bot = Bot("ТОКЕН", session=session)
dp = Dispatcher()`;
  const copy = async (text: string, ok: string) => {
    if (await copyText(text)) toast(ok);
    else toast('Не удалось скопировать — выделите текст вручную', 'error');
  };
  return (
    <section className="settings-card stack" aria-label="Как подключить">
      <h3>Как подключить</h3>
      <span className="muted small">
        Укажите в библиотеке адрес API вместо api.telegram.org. Методы: getUpdates, sendMessage с кнопками,
        editMessageText, answerCallbackQuery, setMyCommands и другие — список в документации сервера.
      </span>
      <div className="invite-link">
        <input readOnly value={base} aria-label="Адрес Bot API" className="mono" onFocus={(e) => e.target.select()} />
        <button type="button" className="btn small" onClick={() => void copy(base, 'Адрес скопирован')}>
          <Icon icon={Copy} size={14} />
          Копировать
        </button>
      </div>
      <pre className="bot-example" aria-label="Пример для aiogram 3">
        <code>{example}</code>
      </pre>
      <span className="muted small">
        Боту можно написать в личку, добавить его в беседу или на сервер (Настройки сервера → Боты). В беседах и на серверах
        он видит команды, упоминания и ответы на свои сообщения.
      </span>
    </section>
  );
}
