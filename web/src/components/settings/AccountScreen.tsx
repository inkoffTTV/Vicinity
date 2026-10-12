import { ChevronRight, Copy, Download, KeyRound, Laptop, MonitorSmartphone, Pencil, ShieldCheck, ShieldQuestion, Smartphone } from 'lucide-react';
import QRCode from 'qrcode';
import { FormEvent, ReactNode, useCallback, useEffect, useState } from 'react';
import { ADMIN_USERNAME, isAdminUsername, openAdminDm } from '../../lib/admin';
import { AccountInfo, ApiError, api, parseTs, Session } from '../../lib/api';
import { copyText } from '../../lib/clipboard';
import { usePlan } from '../../lib/plan';
import { useStore } from '../../lib/store';
import { fullWhen } from '../../lib/time';
import { Avatar } from '../Avatar';
import { Icon } from '../Icon';
import { Modal } from '../Modal';
import { PasswordForm } from '../Settings';

const errText = (e: unknown) => (e instanceof ApiError ? e.message : 'Ошибка');
const TIER_NAMES = ['', 'Basic', 'Standard', 'Ultra'];

type Dialog = null | 'username' | 'email-show' | 'email-change' | 'password' | 'twofa' | 'twofa-off' | 'sessions';

/** «Изменён 3 месяца назад» */
function ago(ts: string): string {
  if (!ts) return 'Ещё не меняли';
  const days = Math.floor((Date.now() - parseTs(ts).getTime()) / 86400000);
  if (days < 1) return 'Изменён сегодня';
  if (days < 30) return `Изменён ${days} дн. назад`;
  const months = Math.floor(days / 30);
  return months < 12 ? `Изменён ${months} мес. назад` : 'Изменён больше года назад';
}

/** Настройки → Аккаунт: карточка, логин и почта, пароль, 2FA, сеансы (макет «3 · Аккаунт») */
export function AccountScreen({ onEditProfile }: { onEditProfile: () => void }) {
  const me = useStore((s) => s.me)!;
  const tier = usePlan((s) => s.current.tier);
  const [info, setInfo] = useState<AccountInfo | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.account().then(setInfo, (e) => setError(errText(e)));
    api.sessions().then(setSessions, () => {});
  }, []);
  useEffect(load, [load]);

  const done = () => {
    setDialog(null);
    load();
  };

  return (
    <div className="settings account-screen">
      <header className="settings-head">
        <h1 className="display">Аккаунт</h1>
        <p className="muted">Логин, почта и безопасность входа</p>
      </header>

      <section className="acc-card" aria-label="Ваш аккаунт">
        <div className="acc-card-banner" />
        <div className="acc-card-body">
          <span className="acc-card-avatar">
            <Avatar name={me.display_name} src={me.avatar_path} id={me.user_id} size={80} presence={me.presence} />
          </span>
          <div className="grow acc-card-names">
            <div className="acc-card-name">
              <strong>{me.display_name}</strong>
              {tier > 0 && <span className={`tier-tag t${tier}`}>{TIER_NAMES[tier]}</span>}
            </div>
            <span className="muted">@{me.username}</span>
          </div>
          <button type="button" className="btn primary" onClick={onEditProfile}>
            <Icon icon={Pencil} size={16} /> Редактировать профиль
          </button>
        </div>
      </section>

      {error && <div className="form-error">{error}</div>}

      <section className="acc-section" aria-labelledby="acc-info">
        <h2 id="acc-info" className="acc-section-title">Информация об учётной записи</h2>
        <div className="acc-box">
          <div className="acc-row">
            <div className="grow">
              <span className="acc-label">Логин</span>
              <span className="acc-value">{me.username}</span>
            </div>
            <button type="button" className="btn" onClick={() => setDialog('username')}>
              Изменить
            </button>
          </div>
          <div className="acc-sep" />
          <div className="acc-row">
            <div className="grow">
              <span className="acc-label">Почта</span>
              <span className="acc-value">
                {info?.has_email ? (
                  <>
                    <span className="tabular">{info.email_masked}</span>
                    <button type="button" className="link-btn strong" onClick={() => setDialog('email-show')}>
                      Показать
                    </button>
                  </>
                ) : (
                  <span className="muted">Не привязана</span>
                )}
              </span>
            </div>
            <button type="button" className="btn" onClick={() => setDialog('email-change')}>
              {info?.has_email ? 'Изменить' : 'Привязать'}
            </button>
          </div>
        </div>
      </section>

      <section className="acc-section" aria-labelledby="acc-sec">
        <h2 id="acc-sec" className="acc-section-title">Пароль и безопасность</h2>
        <div className="acc-box padded">
          <div className="acc-row">
            <span className="acc-icon"><Icon icon={KeyRound} size={18} /></span>
            <div className="grow">
              <span className="acc-title">Пароль</span>
              <span className="muted small">{info ? ago(info.password_changed_at) : ' '}</span>
            </div>
            <button type="button" className="btn" onClick={() => setDialog('password')}>
              Изменить
            </button>
          </div>
          <div className="acc-sep inset" />
          <button type="button" className="acc-row link" onClick={() => setDialog(info?.totp_enabled ? 'twofa-off' : 'twofa')}>
            <span className="acc-icon"><Icon icon={ShieldCheck} size={18} /></span>
            <span className="grow">
              <span className="acc-title">Двухфакторная аутентификация</span>
              <span className="muted small acc-status">
                <span className={`dot ${info?.totp_enabled ? 'ok' : 'warn'}`} />
                {info?.totp_enabled ? 'Включена — код из приложения при входе' : 'Не настроена — код из приложения при входе'}
              </span>
            </span>
            <span className={info?.totp_enabled ? 'muted' : 'acc-action'}>{info?.totp_enabled ? 'Отключить' : 'Настроить'}</span>
            <Icon icon={ChevronRight} size={18} />
          </button>
          <div className="acc-sep inset" />
          <button type="button" className="acc-row link" onClick={() => setDialog('sessions')}>
            <span className="acc-icon"><Icon icon={MonitorSmartphone} size={18} /></span>
            <span className="grow">
              <span className="acc-title">Активные сеансы</span>
              <span className="muted small">Где выполнен вход в ваш аккаунт</span>
            </span>
            <span className="muted">{devicesLabel(sessions.length)}</span>
            <Icon icon={ChevronRight} size={18} />
          </button>
        </div>
      </section>

      {!isAdminUsername(me.username) && (
        <section className="settings-card admin-card" aria-label="Связь с администратором">
          <span className="admin-card-icon" aria-hidden="true">
            <Icon icon={ShieldQuestion} size={22} />
          </span>
          <div className="grow">
            <strong>Вопрос, ошибка или идея?</strong>
            <div className="muted small">Напишите администратору @{ADMIN_USERNAME} в личные сообщения.</div>
          </div>
          <button
            type="button"
            className="btn small primary"
            onClick={async () => {
              if (await openAdminDm()) useStore.getState().setSettingsOpen(false);
            }}
          >
            Написать администратору
          </button>
        </section>
      )}

      {dialog === 'username' && info && <UsernameDialog info={info} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'email-show' && <EmailShowDialog onClose={() => setDialog(null)} onChange={() => setDialog('email-change')} />}
      {dialog === 'email-change' && info && <EmailChangeDialog info={info} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'password' && (
        <Modal title="Смена пароля" onClose={() => setDialog(null)}>
          <PasswordForm />
        </Modal>
      )}
      {dialog === 'twofa' && <TwoFactorDialog onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'twofa-off' && <TwoFactorOffDialog onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'sessions' && <SessionsDialog onClose={done} />}
    </div>
  );
}

function devicesLabel(n: number): string {
  if (!n) return '';
  const m10 = n % 10, m100 = n % 100;
  const word = m10 === 1 && m100 !== 11 ? 'устройство' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'устройства' : 'устройств';
  return `${n} ${word}`;
}

// ── Логин ──

function UsernameDialog({ info, onClose, onDone }: { info: AccountInfo; onClose: () => void; onDone: () => void }) {
  const refreshMe = useStore((s) => s.refreshMe);
  const toast = useStore((s) => s.toast);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [check, setCheck] = useState<{ state: 'idle' | 'checking' | 'free' | 'taken' | 'invalid' | 'same'; suggestions: string[] }>({ state: 'idle', suggestions: [] });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const waitDays = Math.ceil(info.username_wait / 86400);

  // Проверка «свободен ли» на лету, через полсекунды после ввода
  useEffect(() => {
    const u = name.trim();
    if (!u) return setCheck({ state: 'idle', suggestions: [] });
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(u)) return setCheck({ state: 'invalid', suggestions: [] });
    setCheck((c) => ({ ...c, state: 'checking' }));
    const t = setTimeout(() => {
      api.checkUsername(u).then(
        (r) => setCheck({ state: r.available ? 'free' : r.reason === 'same' ? 'same' : r.reason === 'invalid' ? 'invalid' : 'taken', suggestions: r.suggestions }),
        () => setCheck({ state: 'idle', suggestions: [] }),
      );
    }, 450);
    return () => clearTimeout(t);
  }, [name]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.setUsername(name.trim(), password);
      await refreshMe();
      toast('Логин изменён');
      onDone();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Изменить логин" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted">По логину вас находят друзья. Менять можно раз в 7 дней.</p>
        {waitDays > 0 ? (
          <div className="acc-note warn">Следующая смена через {waitDays} дн.</div>
        ) : (
          <>
            <label>
              Новый логин
              <input
                autoFocus
                value={name}
                maxLength={32}
                placeholder={info.username}
                onChange={(e) => setName(e.target.value)}
                className={check.state === 'taken' || check.state === 'invalid' ? 'invalid' : check.state === 'free' ? 'valid' : ''}
              />
            </label>
            <div className="acc-check" aria-live="polite">
              {check.state === 'checking' && <span className="muted small">Проверяем…</span>}
              {check.state === 'free' && <span className="ok-text small">Логин свободен</span>}
              {check.state === 'invalid' && <span className="form-error small">Только латиница, цифры, «_», «.» и «-» — от 3 до 32 символов</span>}
              {check.state === 'same' && <span className="muted small">Это ваш текущий логин</span>}
              {check.state === 'taken' && (
                <span className="small">
                  Логин <strong>@{name.trim()}</strong> уже занят.{check.suggestions.length > 0 && ' Свободны:'}
                  <span className="acc-suggest">
                    {check.suggestions.map((s) => (
                      <button key={s} type="button" className="tag-chip" onClick={() => setName(s)}>
                        {s}
                      </button>
                    ))}
                  </span>
                </span>
              )}
            </div>
            <label>
              Текущий пароль
              <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
          </>
        )}
        {error && <div className="form-error">{error}</div>}
        <div className="row end">
          <div className="grow" />
          <button type="button" className="btn" onClick={onClose}>
            Отмена
          </button>
          {waitDays <= 0 && (
            <button className="btn primary" disabled={busy || check.state !== 'free' || !password}>
              Сохранить
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}

// ── Почта ──

function EmailShowDialog({ onClose, onChange }: { onClose: () => void; onChange: () => void }) {
  const [email, setEmail] = useState('');
  useEffect(() => {
    api.accountEmail().then(setEmail, () => setEmail(''));
  }, []);
  return (
    <Modal title="Ваша почта" onClose={onClose}>
      <div className="stack">
        <div className="acc-email">{email || '…'}</div>
        <p className="muted small">Почту видите только вы. Она нужна для входа и восстановления пароля.</p>
        <div className="row end">
          <div className="grow" />
          <button type="button" className="btn" onClick={onClose}>
            Скрыть
          </button>
          <button type="button" className="btn primary" onClick={onChange}>
            Изменить почту
          </button>
        </div>
      </div>
    </Modal>
  );
}

function EmailChangeDialog({ info, onClose, onDone }: { info: AccountInfo; onClose: () => void; onDone: () => void }) {
  const toast = useStore((s) => s.toast);
  const [step, setStep] = useState<'form' | 'code' | 'done'>('form');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const run = async (fn: () => Promise<void>) => {
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(errText(err));
      if (err instanceof ApiError && (err.status === 410 || err.status === 429) && step === 'code') setStep('form');
    } finally {
      setBusy(false);
    }
  };

  if (!info.mail)
    return (
      <Modal title="Смена почты" onClose={onClose}>
        <div className="stack">
          <p>Отправка писем на сервере пока не настроена — смена почты недоступна.</p>
          <p className="muted small">Администратору: заполните VICINITY_SMTP_* в deploy/.env (DEPLOY-VPS.md).</p>
          <div className="row end">
            <button type="button" className="btn" onClick={onClose}>
              Понятно
            </button>
          </div>
        </div>
      </Modal>
    );

  return (
    <Modal title={step === 'done' ? 'Почта изменена' : step === 'code' ? 'Код из письма' : 'Новая почта'} onClose={onClose}>
      {step === 'form' && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const r = await api.emailStart(email.trim(), password);
              setSentTo(r.send_to);
              setResendIn(r.resend_in);
              setStep('code');
            });
          }}
        >
          <p className="muted">Отправим на неё код подтверждения.</p>
          <label>
            Почта
            <input type="email" autoFocus autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            Текущий пароль
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          {error && <div className="form-error">{error}</div>}
          <div className="row end">
            <div className="grow" />
            <button type="button" className="btn" onClick={onClose}>
              Отмена
            </button>
            <button className="btn primary" disabled={busy || !email.trim() || !password}>
              Отправить код
            </button>
          </div>
        </form>
      )}
      {step === 'code' && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api.emailVerify(code);
              setStep('done');
            });
          }}
        >
          <p className="muted">
            Отправили 6 цифр на <strong>{sentTo}</strong>
          </p>
          <input className="code-input" autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="000000" value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))} aria-label="Код из письма" />
          <button
            type="button"
            className="link-btn"
            disabled={resendIn > 0}
            onClick={() =>
              void run(async () => {
                const r = await api.emailResend();
                setResendIn(r.resend_in);
                toast('Код отправлен ещё раз');
              })
            }
          >
            {resendIn > 0 ? `Отправить снова через 0:${String(resendIn).padStart(2, '0')}` : 'Отправить код снова'}
          </button>
          {error && <div className="form-error">{error}</div>}
          <div className="row end">
            <button type="button" className="btn" onClick={() => setStep('form')}>
              Назад
            </button>
            <div className="grow" />
            <button className="btn primary" disabled={busy || code.replace(/\D/g, '').length !== 6}>
              Подтвердить
            </button>
          </div>
        </form>
      )}
      {step === 'done' && (
        <div className="stack">
          <p>
            Теперь входите через <strong>{sentTo}</strong>. На прежний адрес мы отправили уведомление.
          </p>
          <div className="row end">
            <button type="button" className="btn primary" onClick={onDone}>
              Готово
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── Двухфакторная аутентификация ──

function TwoFactorDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useStore((s) => s.toast);
  const [step, setStep] = useState<'password' | 'scan' | 'code' | 'backup'>('password');
  const [password, setPassword] = useState('');
  const [secret, setSecret] = useState('');
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [backup, setBackup] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const spaced = secret.replace(/(.{4})/g, '$1 ').trim();
  const backupText = `Резервные коды Vicinity — каждый работает один раз\n\n${backup.join('\n')}\n`;
  const download = () => {
    const url = URL.createObjectURL(new Blob([backupText], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vicinity-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const steps = { password: 0, scan: 1, code: 2, backup: 3 } as const;
  const titles: Record<typeof step, string> = {
    password: 'Двухфакторная аутентификация',
    scan: 'Подключите приложение-аутентификатор',
    code: 'Код из приложения',
    backup: 'Сохраните резервные коды',
  };

  return (
    <Modal title={titles[step]} onClose={step === 'backup' && !saved ? () => {} : onClose}>
      <div className="stack twofa">
        {step !== 'password' && (
          <div className="steps" aria-label={`Шаг ${steps[step]} из 3`}>
            {[1, 2, 3].map((n) => (
              <span key={n} className={n <= steps[step] ? 'on' : ''} />
            ))}
          </div>
        )}
        {step === 'password' && (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const r = await api.totpSetup(password);
                setSecret(r.secret);
                setQr(await QRCode.toDataURL(r.uri, { margin: 1, width: 200, color: { dark: '#0e1015', light: '#ffffff' } }));
                setStep('scan');
              });
            }}
          >
            <p className="muted">При входе, кроме пароля, понадобится код из приложения на телефоне: Google Authenticator, Яндекс Ключ, Aegis и других.</p>
            <label>
              Текущий пароль
              <input type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
            {error && <div className="form-error">{error}</div>}
            <div className="row end">
              <div className="grow" />
              <button type="button" className="btn" onClick={onClose}>
                Отмена
              </button>
              <button className="btn primary" disabled={busy || !password}>
                Далее
              </button>
            </div>
          </form>
        )}
        {step === 'scan' && (
          <>
            <p className="muted">Отсканируйте QR-код в любом приложении для одноразовых кодов.</p>
            <div className="twofa-qr">{qr && <img src={qr} alt="QR-код для приложения-аутентификатора" width={200} height={200} />}</div>
            <div className="twofa-key">
              <span className="muted small">Не сканируется? Введите ключ вручную</span>
              <div className="row">
                <code className="grow">{spaced}</code>
                <button type="button" className="btn small" onClick={async () => toast((await copyText(secret)) ? 'Ключ скопирован' : 'Не удалось скопировать')}>
                  <Icon icon={Copy} size={14} /> Скопировать
                </button>
              </div>
            </div>
            <div className="row end">
              <div className="grow" />
              <button type="button" className="btn" onClick={onClose}>
                Отмена
              </button>
              <button type="button" className="btn primary" onClick={() => setStep('code')}>
                Далее
              </button>
            </div>
          </>
        )}
        {step === 'code' && (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const r = await api.totpEnable(code);
                setBackup(r.backup_codes);
                setStep('backup');
              });
            }}
          >
            <input className="code-input" autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="000000" value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))} aria-label="Код из приложения" />
            {error && <div className="form-error">{error}</div>}
            <div className="row end">
              <button type="button" className="btn" onClick={() => setStep('scan')}>
                Назад
              </button>
              <div className="grow" />
              <button className="btn primary" disabled={busy || code.replace(/\D/g, '').length !== 6}>
                {busy ? 'Проверяем…' : 'Подтвердить'}
              </button>
            </div>
          </form>
        )}
        {step === 'backup' && (
          <>
            <p className="muted">Если телефона не будет под рукой — войдёте по коду. Каждый работает один раз.</p>
            <ul className="backup-codes">
              {backup.map((c) => (
                <li key={c}>
                  <code>{c}</code>
                </li>
              ))}
            </ul>
            <div className="row">
              <button type="button" className="btn small" onClick={download}>
                <Icon icon={Download} size={14} /> Скачать .txt
              </button>
              <button type="button" className="btn small" onClick={async () => toast((await copyText(backupText)) ? 'Коды скопированы' : 'Не удалось скопировать')}>
                <Icon icon={Copy} size={14} /> Скопировать
              </button>
            </div>
            <label className="check-row">
              <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
              <span>Я сохранил коды в надёжном месте</span>
            </label>
            <div className="row end">
              <div className="grow" />
              <button
                type="button"
                className="btn primary"
                disabled={!saved}
                onClick={() => {
                  toast('Двухфакторная аутентификация включена');
                  onDone();
                }}
              >
                Готово
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function TwoFactorOffDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useStore((s) => s.toast);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Отключить двухфакторную аутентификацию" onClose={onClose}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await api.totpDisable(code.trim());
            toast('Двухфакторная аутентификация отключена');
            onDone();
          } catch (err) {
            setError(errText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="muted">Введите код из приложения или резервный код. Без защиты аккаунт останется только под паролем.</p>
        <input className="code-input" autoFocus autoComplete="one-time-code" maxLength={9} placeholder="000000" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Код" />
        {error && <div className="form-error">{error}</div>}
        <div className="row end">
          <div className="grow" />
          <button type="button" className="btn" onClick={onClose}>
            Отмена
          </button>
          <button className="btn danger" disabled={busy || code.replace(/[\s-]/g, '').length < 6}>
            Отключить
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Активные сеансы ──

/** Устройство по User-Agent: «Chrome · Windows», «Приложение для ПК», «Safari · iPhone» */
export function deviceOf(ua: string | undefined): { name: string; kind: 'pc' | 'phone' | 'app' | 'unknown' } {
  if (!ua) return { name: 'Неизвестное устройство', kind: 'unknown' };
  if (/Vicinity|\bQt\//i.test(ua)) return { name: 'Приложение для ПК', kind: 'app' };
  const browser = /YaBrowser/.test(ua) ? 'Яндекс Браузер' : /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Браузер';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  const phone = /iPhone|Android|Mobile/.test(ua);
  return { name: os ? `${browser} · ${os}` : browser, kind: phone ? 'phone' : 'pc' };
}

function SessionsDialog({ onClose }: { onClose: () => void }) {
  const toast = useStore((s) => s.toast);
  const [list, setList] = useState<Session[] | null>(null);
  const [ending, setEnding] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  const load = useCallback(() => {
    api.sessions().then(setList, (e) => toast(errText(e), 'error'));
  }, [toast]);
  useEffect(load, [load]);

  const current = (list ?? []).filter((s) => s.current);
  const others = (list ?? []).filter((s) => !s.current);

  const row = (s: Session, actions?: ReactNode) => {
    const d = deviceOf(s.user_agent);
    return (
      <li key={s.id} className="session-row">
        <span className="acc-icon">
          <Icon icon={d.kind === 'phone' ? Smartphone : Laptop} size={18} />
        </span>
        <span className="grow">
          <span className="acc-title">{d.name}</span>
          <span className="muted small">
            {s.current ? 'Активен сейчас' : `Вход ${fullWhen(parseTs(s.created_at))}`}
            {s.ip ? ` · ${s.ip}` : ''}
          </span>
        </span>
        {actions}
      </li>
    );
  };

  return (
    <Modal title="Активные сеансы" onClose={onClose} className="sessions-modal">
      <div className="stack">
        <p className="muted">Не узнаёте устройство? Завершите сеанс и смените пароль.</p>
        {list === null && <div className="muted small">Загрузка…</div>}
        {current.length > 0 && (
          <>
            <span className="acc-section-title">Это устройство</span>
            <ul className="session-list-v">{current.map((s) => row(s))}</ul>
          </>
        )}
        {list !== null && (
          <>
            <span className="acc-section-title">Другие устройства · {others.length}</span>
            {others.length === 0 ? (
              <div className="acc-empty">
                <strong>Других активных сеансов нет</strong>
                <span className="muted small">Вы вошли только на этом устройстве.</span>
              </div>
            ) : (
              <ul className="session-list-v">
                {others.map((s) =>
                  row(
                    s,
                    <button
                      type="button"
                      className="btn small"
                      disabled={ending === s.id}
                      onClick={async () => {
                        setEnding(s.id);
                        try {
                          await api.revokeSession(s.id);
                          toast('Сеанс завершён');
                        } catch (e) {
                          toast(errText(e), 'error');
                        }
                        setEnding(null);
                        load();
                      }}
                    >
                      {ending === s.id ? 'Завершаем…' : 'Завершить'}
                    </button>,
                  ),
                )}
              </ul>
            )}
          </>
        )}
        {others.length > 0 &&
          (confirmAll ? (
            <div className="acc-note warn row">
              <span className="grow">Выйти на всех остальных устройствах? Этот браузер останется в аккаунте.</span>
              <button type="button" className="btn small" onClick={() => setConfirmAll(false)}>
                Отмена
              </button>
              <button
                type="button"
                className="btn small danger"
                onClick={async () => {
                  try {
                    const r = await api.revokeOtherSessions();
                    toast(`Завершено сеансов: ${r.revoked}`);
                  } catch (e) {
                    toast(errText(e), 'error');
                  }
                  setConfirmAll(false);
                  load();
                }}
              >
                Выйти
              </button>
            </div>
          ) : (
            <button type="button" className="btn danger" onClick={() => setConfirmAll(true)}>
              Выйти на всех остальных
            </button>
          ))}
      </div>
    </Modal>
  );
}
