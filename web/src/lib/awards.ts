// Награды за активность (docs/API.md §16): титулы показываются текстом, эмблемы — иконкой из lucide.
// Редкость задаёт цвет; каталог и состояние — с сервера (api.activityMe), здесь только оформление.
import { CalendarDays, Crown, Flame, Gem, type LucideIcon, Mic, Sparkles, Swords } from 'lucide-react';
import { create } from 'zustand';
import { ActivitySummary, Award, AwardRarity } from './api';

export const EMBLEM_ICONS: Record<string, LucideIcon> = {
  sparkles: Sparkles,
  flame: Flame,
  crown: Crown,
  gem: Gem,
  mic: Mic,
  swords: Swords,
  calendar: CalendarDays,
};

export const RARITY_LABEL: Record<AwardRarity, string> = {
  common: 'Обычная',
  rare: 'Редкая',
  epic: 'Эпическая',
  legendary: 'Легендарная',
};

/** Процент опыта внутри текущего уровня */
export function levelProgress(a: Pick<ActivitySummary, 'xp' | 'level_xp' | 'next_xp'>): number {
  const span = Math.max(1, a.next_xp - a.level_xp);
  return Math.max(0, Math.min(100, Math.round(((a.xp - a.level_xp) / span) * 100)));
}

export const awardName = (catalog: Award[], id: string) => catalog.find((a) => a.id === id)?.name ?? '';

interface State {
  /** Своя активность — приходит WS-событием activity и из api.activityMe */
  me: Partial<ActivitySummary> | null;
}
export const useActivity = create<State>(() => ({ me: null }));

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
