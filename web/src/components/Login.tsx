import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, RegistrationInfo, api } from '../lib/api';
import { solveAltcha } from '../lib/altcha';
import { useInvite } from '../lib/router';
import { useStore } from '../lib/store';

type Mode = 'login' | 'register' | 'verify';
type Captcha = 'idle' | 'solving' | 'done' | 'error';

const errText = (err: unknown) => {
  const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Ошибка';
  if (msg === 'Invalid credentials') return 'Неверный логин или пароль';
  if (msg === 'Username already taken') return 'Этот логин уже занят';
  return msg;
};

export function Login() {
  const login = useStore((s) => s.login);
  const signInWithToken = useStore((s) => s.signInWithToken);
  const invite = useInvite((s) => s.code);
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState(''); // ловушка для ботов, человеку не видна
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Регистрация: что требует сервер и состояние капчи (решается в фоне, пока заполняют форму)
  const [info, setInfo] = useState<RegistrationInfo | null>(null);
  const [captcha, setCaptcha] = useState<Captcha>('idle');
  const solution = useRef<Promise<string> | null>(null);

  // Шаг с кодом из письма
  const [pending, setPending] = useState<{ id: string; email: string } | null>(null);
  const [code, setCode] = useState('');
  const [resendIn, setResendIn] = useState(0);

  const startCaptcha = useCallback(() => {
    setCaptcha('solving');
    const p = solveAltcha();
    solution.current = p;
    p.then(
      () => solution.current === p && setCaptcha('done'),
      () => solution.current === p && setCaptcha('error'),
    );
    return p;
  }, []);

  useEffect(() => {
    if (mode !== 'register' || info) return;
    api.registrationInfo().then(
      (i) => {
        setInfo(i);
        if (i.captcha) startCaptcha();
      },
      // Старый сервер без /auth/registration — регистрация как раньше
      () => setInfo({ mode: 'open', captcha: false, email: false, open: true }),
    );
  }, [mode, info, startCaptcha]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError('');
  };

  const submitLogin = async () => {
    await login(username.trim(), password);
  };

  const submitRegister = async () => {
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(username.trim()))
      throw new Error('Логин: 3–32 символа, только латиница, цифры и . _ -');
    if (password.length < 8) throw new Error('Пароль должен быть не короче 8 символов');
    if (info?.email && !/^\S+@\S+\.\S+$/.test(email.trim())) throw new Error('Укажите почту — на неё придёт код');

    let altcha: string | undefined;
    if (info?.captcha) {
      try {
        altcha = await (solution.current ?? startCaptcha());
      } catch {
        throw new Error('Проверка «я не робот» не удалась — нажмите «Повторить»');
      }
    }
    try {
      const r = await api.registerStart({
        username: username.trim(),
        password,
        display_name: displayName.trim() || username.trim(),
        email: info?.email ? email.trim() : undefined,
        altcha,
        website,
      });
      if ('token' in r) {
        await signInWithToken(r.token);
      } else {
        setPending({ id: r.pending_id, email: r.email });
        setResendIn(r.resend_in);
        setCode('');
        switchMode('verify');
      }
    } catch (err) {
      // Старый сервер без /register/start
      if (err instanceof ApiError && err.status === 404 && !info?.captcha) {
        const r = await api.register(username.trim(), password, displayName.trim() || username.trim());
        await signInWithToken(r.token);
        return;
      }
      throw err;
    } finally {
      // Решение капчи одноразовое: для следующей попытки — новое
      if (info?.captcha) startCaptcha();
    }
  };

  const submitCode = async () => {
    if (!pending) return;
    const digits = code.replace(/\D/g, '');
    if (digits.length !== 6) throw new Error('Код — 6 цифр из письма');
    try {
      const r = await api.registerVerify(pending.id, digits);
      await signInWithToken(r.token);
    } catch (err) {
      // Регистрация устарела или попытки кончились — назад к форме
      if (err instanceof ApiError && (err.status === 410 || err.status === 429 || err.status === 404)) {
        setPending(null);
        setMode('register');
      }
      throw err;
    }
  };

  const resend = async () => {
    if (!pending || resendIn > 0) return;
    setError('');
    try {
      const r = await api.registerResend(pending.id);
      setResendIn(r.resend_in);
    } catch (err) {
      setError(errText(err));
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') await submitLogin();
      else if (mode === 'register') await submitRegister();
      else await submitCode();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'verify' && pending) {
    return (
      <div className="auth-screen">
        <AuthHero />
        <div className="auth-side">
        <form className="auth-card" onSubmit={submit}>
          <div className="auth-logo">
            <img src="/favicon.svg" alt="" width={48} height={48} />
            <h1>Проверьте почту</h1>
          </div>
          <p className="muted center">
            Мы отправили 6-значный код на <strong>{pending.email}</strong>. Письмо может прийти в течение минуты —
            загляните и в «Спам».
          </p>
          <label>
            Код из письма
            <input
              className="code-input"
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
              required
            />
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="btn primary block" disabled={busy || code.replace(/\D/g, '').length !== 6}>
            {busy ? '…' : 'Подтвердить и войти'}
          </button>
          <div className="row-between">
            <button type="button" className="link-btn" disabled={resendIn > 0} onClick={resend}>
              {resendIn > 0 ? `Отправить снова через ${resendIn} с` : 'Отправить код снова'}
            </button>
            <button type="button" className="link-btn" onClick={() => switchMode('register')}>
              Изменить данные
            </button>
          </div>
        </form>
        </div>
      </div>
    );
  }

  const registering = mode === 'register';
  const closed = registering && info?.mode === 'closed';

  return (
    <div className="auth-screen">
      <AuthHero />
      <div className="auth-side">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-logo">
          <img src="/favicon.svg" alt="" width={48} height={48} />
          <h1>Vicinity</h1>
        </div>
        <p className="muted center">{registering ? 'Создайте аккаунт' : 'С возвращением!'}</p>
        {invite && (
          <div className="invite-hint">
            Вас пригласили на сервер (код <strong>{invite}</strong>). Войдите или зарегистрируйтесь, чтобы принять
            приглашение.
          </div>
        )}

        {closed ? (
          <div className="invite-hint">Регистрация на этом сервере сейчас закрыта.</div>
        ) : (
          <>
            <label>
              Логин
              <input
                autoFocus
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </label>
            {registering && (
              <label>
                Отображаемое имя
                <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={32} />
              </label>
            )}
            {registering && info?.email && (
              <label>
                Почта
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  required
                />
                <span className="muted small">Пришлём код подтверждения. Одна почта — один аккаунт.</span>
              </label>
            )}
            <label>
              Пароль
              <input
                type="password"
                autoComplete={registering ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            {registering && (
              // Невидимое поле: люди его не видят и не заполняют, простые боты заполняют всё подряд
              <div className="hp-field" aria-hidden="true">
                <label>
                  Сайт
                  <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
                </label>
              </div>
            )}
            {registering && info?.captcha && (
              <div className={`captcha-box ${captcha}`} role="status" aria-live="polite">
                <span className="captcha-check" aria-hidden="true">
                  {captcha === 'done' ? '✓' : captcha === 'error' ? '!' : ''}
                </span>
                <span className="grow">
                  {captcha === 'done'
                    ? 'Вы не робот'
                    : captcha === 'error'
                      ? 'Проверка не удалась'
                      : 'Проверяем, что вы не робот…'}
                </span>
                {captcha === 'error' && (
                  <button type="button" className="link-btn" onClick={() => startCaptcha()}>
                    Повторить
                  </button>
                )}
                <span className="captcha-brand muted small">ALTCHA</span>
              </div>
            )}

            {error && <div className="form-error">{error}</div>}

            <button className="btn primary block" disabled={busy || (registering && !info)}>
              {busy ? '…' : registering ? (info?.email ? 'Получить код' : 'Зарегистрироваться') : 'Войти'}
            </button>
          </>
        )}
        <button type="button" className="link-btn" onClick={() => switchMode(registering ? 'login' : 'register')}>
          {registering ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Зарегистрироваться'}
        </button>
      </form>
      </div>
    </div>
  );
}

const PERKS: [string, string][] = [
  ['Чаты, беседы и серверы', 'Личные сообщения, группы и серверы с текстовыми и голосовыми каналами'],
  ['Голос и звонки в браузере', 'Звонки с камерой и демонстрация экрана в 1080p — без установки'],
  ['На компьютере и телефоне', 'Сайт, приложение для ПК и установка на телефон — один аккаунт везде'],
  ['Ваш собственный сервер', 'Переписка хранится у вас, а не у чужой компании'],
  ['Темы и оформление', 'Светлая, тёмная, графит и чёрная — плюс цветовые темы с подпиской'],
  ['Бесплатно', 'Всё основное доступно сразу, подписка только добавляет приятное'],
];

/** Левая колонка экрана входа: что такое Vicinity */
function AuthHero() {
  return (
    <section className="auth-hero" aria-label="О Vicinity">
      <div className="auth-brand">
        <span className="auth-mark" aria-hidden="true">
          V
        </span>
        Vicinity
      </div>
      <div>
        <h1>Мессенджер для своих</h1>
        <p>Общайтесь текстом и голосом, созванивайтесь и показывайте экран — всё в одном месте.</p>
      </div>
      <ul className="auth-perks">
        {PERKS.map(([title, text]) => (
          <li key={title}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12l5 5 9-10" />
            </svg>
            <div>
              <strong>{title}</strong>
              <span>{text}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
