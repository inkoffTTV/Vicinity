import { FormEvent, useState } from 'react';
import { ApiError } from '../lib/api';
import { useStore } from '../lib/store';

export function Login() {
  const login = useStore((s) => s.login);
  const register = useStore((s) => s.register);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (mode === 'register') {
      if (!/^[A-Za-z0-9._-]{3,32}$/.test(username))
        return setError('Логин: 3–32 символа, только латиница, цифры и . _ -');
      if (password.length < 8) return setError('Пароль должен быть не короче 8 символов');
    }
    setBusy(true);
    try {
      if (mode === 'login') await login(username.trim(), password);
      else await register(username.trim(), password, displayName.trim() || username.trim());
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Ошибка';
      setError(msg === 'Invalid credentials' ? 'Неверный логин или пароль' : msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-logo">
          <img src="/favicon.svg" alt="" width={48} height={48} />
          <h1>Vicinity</h1>
        </div>
        <p className="muted center">{mode === 'login' ? 'С возвращением!' : 'Создайте аккаунт'}</p>

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
        {mode === 'register' && (
          <label>
            Отображаемое имя
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={32} />
          </label>
        )}
        <label>
          Пароль
          <input
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        {error && <div className="form-error">{error}</div>}

        <button className="btn primary block" disabled={busy}>
          {busy ? '…' : mode === 'login' ? 'Войти' : 'Зарегистрироваться'}
        </button>
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError('');
          }}
        >
          {mode === 'login' ? 'Нет аккаунта? Зарегистрироваться' : 'Уже есть аккаунт? Войти'}
        </button>
      </form>
    </div>
  );
}
