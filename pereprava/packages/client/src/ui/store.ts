// Профиль и настройки в localStorage (ключи как в прототипе: pereprava:*). Любая ошибка доступа —
// просто значения по умолчанию: приватный режим, запрет cookie и т. п.
export const store = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem('pereprava:' + k);
      return v ? (JSON.parse(v) as T) : d;
    } catch {
      return d;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem('pereprava:' + k, JSON.stringify(v));
    } catch {
      /* без сохранения */
    }
  },
};
