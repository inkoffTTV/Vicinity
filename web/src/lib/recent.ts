// Лички и беседы в списке слева: свежие сверху, строка-превью последнего сообщения
import { useEffect, useState } from 'react';
import { LastMessage } from './api';
import { plainText } from './markdown';

type WithLast = { last_message?: LastMessage | null; created_at?: string; id?: number; channel_id?: number };

/** Свежие сверху: по последнему сообщению, беседа без сообщений — по времени создания.
 *  Старый сервер не присылает last_message — тогда порядок сервера не трогаем. */
export function sortRecent<T extends WithLast>(list: T[]): T[] {
  if (list.every((x) => x.last_message === undefined)) return list;
  const key = (x: T) => x.last_message?.created_at ?? x.created_at ?? '';
  // При равном времени (секундная точность) — более новое сообщение, затем более новая беседа
  const id = (x: T) => x.last_message?.id ?? 0;
  const chan = (x: T) => x.channel_id ?? x.id ?? 0;
  return [...list].sort((a, b) =>
    key(a) !== key(b) ? (key(a) < key(b) ? 1 : -1) : id(b) - id(a) || chan(b) - chan(a),
  );
}

/** «Вы: текст», «Аня: текст» (в беседе) или просто текст; вложение — значком */
export function previewText(lm: LastMessage, meId: number | undefined, group: boolean): string {
  const text = plainText(lm.text).replace(/\s+/g, ' ').trim();
  let body = text;
  if (lm.attachment) {
    const file = lm.attachment.startsWith('/uploads/files/');
    body = text ? `📎 ${text}` : file ? '📎 Файл' : '🖼 Изображение';
  }
  if (lm.author_id === meId) return `Вы: ${body}`;
  return group ? `${lm.author_name}: ${body}` : body;
}

/** Текущее время, обновляется раз в минуту — для «5 мин», «вчера» в списках */
export function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}
