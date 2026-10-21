// Лички и беседы в списке слева: свежие сверху, строка-превью последнего сообщения
import { useEffect, useState } from 'react';
import { parseProposal } from './chatBg';
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

export interface PreviewParts {
  /** «Вы: », «Аня: » (в беседе) или '' */
  who: string;
  /** Вложение — показывается значком перед текстом */
  attachment: 'file' | 'image' | null;
  /** Текст сообщения; у вложения без текста — «Файл» или «Изображение» */
  text: string;
}

/** Превью последнего сообщения по частям: кто, значок вложения, текст */
export function previewParts(lm: LastMessage, meId: number | undefined, group: boolean): PreviewParts {
  const text = parseProposal(lm.text) ? 'Предложение фона чата' : plainText(lm.text).replace(/\s+/g, ' ').trim();
  let attachment: PreviewParts['attachment'] = null;
  let body = text;
  if (lm.attachment) {
    attachment = lm.attachment.startsWith('/uploads/files/') ? 'file' : 'image';
    if (!text) body = attachment === 'file' ? 'Файл' : 'Изображение';
  }
  const who = lm.author_id === meId ? 'Вы: ' : group ? `${lm.author_name}: ` : '';
  return { who, attachment, text: body };
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
