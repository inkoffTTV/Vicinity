// Мета-прогресс на устройстве: задания дня, «искры» за матчи и задания, облики героев за искры.
// Хранится в профиле (localStorage); облик в сетевой игре уходит на сервер, его видят все.
import { HERO, type RoleId } from '@pereprava/shared';

export interface MatchResult {
  win: boolean;
  hero: string;
  kills: number;
  assists: number;
  lastHits: number;
  chaos: boolean;
  boss: boolean;
  online: boolean;
}

export interface Daily {
  date: string;
  ids: string[];
  prog: number[];
}

export interface MetaProfile {
  sparks?: number;
  /** Открытые облики: 'hero:номер' */
  unlocked?: string[];
  daily?: Daily;
}

interface Quest {
  id: string;
  name: string;
  goal: number;
  reward: number;
  /** На сколько матч продвигает задание */
  step(r: MatchResult): number;
}

const role = (hero: string): RoleId | undefined => HERO[hero]?.roleId;

export const QUESTS: Quest[] = [
  { id: 'win1', name: 'Выиграйте матч', goal: 1, reward: 80, step: (r) => (r.win ? 1 : 0) },
  { id: 'play2', name: 'Сыграйте 2 матча', goal: 2, reward: 50, step: () => 1 },
  { id: 'lh60', name: 'Добейте 60 крипов', goal: 60, reward: 60, step: (r) => r.lastHits },
  { id: 'ka8', name: 'Наберите 8 убийств и помощей', goal: 8, reward: 70, step: (r) => r.kills + r.assists },
  { id: 'sup', name: 'Сыграйте за поддержку', goal: 1, reward: 50, step: (r) => (role(r.hero) === 'support' ? 1 : 0) },
  { id: 'tank', name: 'Сыграйте за танка', goal: 1, reward: 50, step: (r) => (role(r.hero) === 'tank' ? 1 : 0) },
  { id: 'mage', name: 'Сыграйте за мага', goal: 1, reward: 50, step: (r) => (role(r.hero) === 'mage' ? 1 : 0) },
  { id: 'chaos', name: 'Сыграйте в «Хаос»', goal: 1, reward: 50, step: (r) => (r.chaos ? 1 : 0) },
  { id: 'boss', name: 'Победите Стража реки', goal: 1, reward: 100, step: (r) => (r.boss ? 1 : 0) },
  { id: 'net', name: 'Сыграйте с друзьями по сети', goal: 1, reward: 60, step: (r) => (r.online ? 1 : 0) },
];
const QUEST = Object.fromEntries(QUESTS.map((q) => [q.id, q]));

export const SKINS = [
  { id: 0, name: 'Обычный', cost: 0 },
  { id: 1, name: 'Сумеречный', cost: 150 },
  { id: 2, name: 'Королевский', cost: 300 },
];

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

/** Задания на сегодня: три из списка, одинаковые весь день */
export function daily(p: MetaProfile): Daily {
  const date = today();
  if (p.daily?.date === date) return p.daily;
  let h = 0;
  for (const ch of date) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const pool = QUESTS.map((q) => q.id);
  const ids: string[] = [];
  while (ids.length < 3) {
    h = (h * 1103515245 + 12345) >>> 0;
    const id = pool[h % pool.length];
    if (!ids.includes(id)) ids.push(id);
  }
  p.daily = { date, ids, prog: [0, 0, 0] };
  return p.daily;
}

export const questOf = (id: string) => QUEST[id];

/** Итоги матча: искры за матч и выполненные задания */
export function applyMatch(p: MetaProfile, r: MatchResult): { sparks: number; done: string[] } {
  const d = daily(p);
  let sparks = r.win ? 20 : 8;
  const done: string[] = [];
  d.ids.forEach((id, i) => {
    const q = QUEST[id];
    if (!q || d.prog[i] >= q.goal) return;
    d.prog[i] = Math.min(q.goal, d.prog[i] + q.step(r));
    if (d.prog[i] >= q.goal) {
      sparks += q.reward;
      done.push(q.name);
    }
  });
  p.sparks = (p.sparks ?? 0) + sparks;
  return { sparks, done };
}

export const hasSkin = (p: MetaProfile, hero: string, skin: number) =>
  skin === 0 || (p.unlocked ?? []).includes(`${hero}:${skin}`);

/** Купить облик за искры */
export function buySkin(p: MetaProfile, hero: string, skin: number): boolean {
  const s = SKINS[skin];
  if (!s || hasSkin(p, hero, skin) || (p.sparks ?? 0) < s.cost) return false;
  p.sparks = (p.sparks ?? 0) - s.cost;
  p.unlocked = [...(p.unlocked ?? []), `${hero}:${skin}`];
  return true;
}
