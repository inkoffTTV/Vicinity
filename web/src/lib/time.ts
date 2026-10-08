// Короткое «когда» для списков: сейчас, 5 мин, 14:20, вчера, пн, 12 мар., 12.03.2023

const DAY = 86_400_000;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function shortWhen(d: Date, now = new Date()): string {
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return 'сейчас';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} мин`;
  const days = Math.round((startOfDay(now) - startOfDay(d)) / DAY);
  if (days <= 0) return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (days === 1) return 'вчера';
  if (days < 7) return d.toLocaleDateString('ru-RU', { weekday: 'short' });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  return d.toLocaleDateString('ru-RU');
}

/** Полная дата и время — для подсказок и списка сеансов */
export function fullWhen(d: Date): string {
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
