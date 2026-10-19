// Модификаторы — баффы и дебаффы. На юните лежат только данные { id, t, v, src };
// что модификатор делает, описано здесь: флаги (стан, сайленс…), вклад в характеристики,
// поведение каждый тик.
import type { Modifier, Unit } from '../types';
import { DT, damage, recallHome, unitById, type World } from './world';

export type ModFlag = 'stun' | 'silence' | 'root' | 'disarm' | 'invisible' | 'immune';
/** Характеристики, в которые модификаторы добавляют значение v (или своё число) */
export type ModStat =
  | 'armor'
  | 'slow'
  | 'haste'
  | 'heal'
  | 'atkSpeed'
  | 'dmgAmp'
  | 'vuln'
  | 'resist'
  /** Доля физического урона, которая возвращается напавшему вблизи */
  | 'thorns'
  /** Шанс уклониться от физического удара */
  | 'evade'
  /** Вампиризм от модификатора (сверх предметов) */
  | 'lifesteal';

export interface ModifierDef {
  name: string;
  /** Положительный эффект (для интерфейса и развеивания) */
  buff: boolean;
  flags?: ModFlag[];
  /** Вклад в характеристику: по умолчанию — v модификатора */
  stats?: Partial<Record<ModStat, number | 'v'>>;
  /** Каждый тик (урон со временем и т. п.) */
  tick?(w: World, u: Unit, m: Modifier): void;
  /** Время вышло (не вызывается при снятии) */
  expire?(w: World, u: Unit, m: Modifier): void;
}

export const MODIFIERS: Record<string, ModifierDef> = {
  shield: { name: 'Щит', buff: true },
  potion: { name: 'Зелье лечения', buff: true, stats: { heal: 50 } },
  stun: { name: 'Оглушение', buff: false, flags: ['stun'] },
  slow: { name: 'Замедление', buff: false, stats: { slow: 'v' } },
  root: { name: 'Корни', buff: false, flags: ['root'] },
  silence: { name: 'Безмолвие', buff: false, flags: ['silence'] },
  armorUp: { name: 'Броня', buff: true, stats: { armor: 'v' } },
  armorDown: { name: 'Ослабленная броня', buff: false, stats: { armor: 'v' } },
  haste: { name: 'Ускорение', buff: true, stats: { haste: 'v' } },
  frenzy: { name: 'Ярость', buff: true, stats: { atkSpeed: 'v' } },
  regen: { name: 'Восстановление', buff: true, stats: { heal: 'v' } },
  dmgAmp: { name: 'Двойной урон', buff: true, stats: { dmgAmp: 'v' } },
  vuln: { name: 'Уязвимость', buff: false, stats: { vuln: 'v' } },
  invisible: { name: 'Невидимость', buff: true, flags: ['invisible'] },
  resist: { name: 'Защита купола', buff: true, stats: { resist: 'v' } },
  keeperAura: { name: 'Аура стойкости', buff: true, stats: { armor: 3, heal: 3 } },
  runeHaste: { name: 'Руна скорости', buff: true, stats: { haste: 0.4 } },
  runeDamage: { name: 'Руна силы', buff: true, stats: { dmgAmp: 0.6 } },
  runeRegen: { name: 'Руна восстановления', buff: true, stats: { heal: 'v' } },
  recall: {
    name: 'Возвращение',
    buff: true,
    tick(_w, u, m) {
      // Урон сбивает возвращение
      if (u.hurtTick > m.v) m.t = -2;
    },
    expire(w, u) {
      recallHome(w, u);
    },
  },
  poison: {
    name: 'Яд',
    buff: false,
    tick(w, u, m) {
      damage(w, u, m.v * DT, unitById(w, m.src) ?? null, 'magical');
    },
  },
  bleed: {
    name: 'Кровотечение',
    buff: false,
    tick(w, u, m) {
      damage(w, u, m.v * DT, unitById(w, m.src) ?? null, 'physical');
    },
  },
  taunt: { name: 'Вызов', buff: false },
  // Ауры-пассивки на себя (обновляются каждый тик, пока герой жив)
  sap: {
    name: 'Сок земли',
    buff: true,
    tick(_w, u) {
      const o = u.hero?.order;
      if (o && (o.type === 'move' || o.type === 'amove')) return;
      u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.015 * DT);
    },
  },
  thickhide: {
    name: 'Толстокожесть',
    buff: true,
    stats: { resist: 'v' },
    tick(_w, u, m) {
      m.v = Math.min(0.3, u.maxHp / 10000);
    },
  },
  bloodlust: {
    name: 'Жажда битвы',
    buff: true,
    stats: { atkSpeed: 'v' },
    tick(_w, u, m) {
      m.v = 0.6 * (1 - u.hp / u.maxHp);
    },
  },
  spiritAura: { name: 'Связь духов', buff: true, stats: { heal: 3, haste: 0.08 } },
  graceAura: { name: 'Благодать', buff: true, stats: { armor: 2, heal: 2 } },
  thorns: { name: 'Шипы', buff: true, stats: { thorns: 'v' } },
  evade: { name: 'Бесплотность', buff: true, stats: { evade: 'v' } },
  undying: { name: 'Неистовство', buff: true },
  immune: { name: 'Неуязвимость', buff: true, flags: ['immune'] },
  iceblock: { name: 'Ледяная глыба', buff: true, flags: ['stun', 'immune'] },
  sleep: { name: 'Сон', buff: false, flags: ['stun'] },
  hex: { name: 'Сглаз', buff: false, flags: ['silence', 'disarm'], stats: { slow: 0.35 } },
  parry: { name: 'Парирование', buff: true },
  deathmark: {
    name: 'Метка смерти',
    buff: false,
    // Спала — ещё раз почти половина урона, полученного под меткой
    expire(w, u, m) {
      if (u.alive && m.v > 1) damage(w, u, (m.v - 1) * 0.45, unitById(w, m.src) ?? null, 'pure');
    },
  },
  combo: { name: 'Серия', buff: true },
  rage: { name: 'Ярость', buff: true, stats: { atkSpeed: 'v', vuln: 0.15, lifesteal: 0.15 } },
  wolfform: { name: 'Облик волка', buff: true, stats: { dmgAmp: 0.35, haste: 0.25, armor: 5, lifesteal: 0.12 } },
  fortress: { name: 'Крепость', buff: true, stats: { armor: 18, resist: 0.3 } },
  song: { name: 'Баллада', buff: true, stats: { atkSpeed: 0.3, haste: 0.15 } },
  atkSlow: { name: 'Вялость', buff: false, stats: { atkSpeed: 'v' } },
  burn: {
    name: 'Горение',
    buff: false,
    tick(w, u, m) {
      damage(w, u, m.v * DT, unitById(w, m.src) ?? null, 'magical');
    },
  },
};

export function hasFlag(u: Unit, flag: ModFlag): boolean {
  for (const m of u.mods) if (MODIFIERS[m.id]?.flags?.includes(flag)) return true;
  return false;
}

export function modValue(u: Unit, stat: ModStat): number {
  let s = 0;
  for (const m of u.mods) {
    const c = MODIFIERS[m.id]?.stats?.[stat];
    if (c === undefined) continue;
    s += c === 'v' ? m.v : c;
  }
  // Замедление не больше 80%
  return stat === 'slow' ? Math.min(0.8, s) : s;
}

export const getMod = (u: Unit, id: string) => u.mods.find((m) => m.id === id);

/** Наложить модификатор; такой же — обновить (берём большее время и силу) */
export function addMod(u: Unit, id: string, t: number, v = 0, src = 0): Modifier {
  const old = getMod(u, id);
  if (old) {
    old.t = old.t < 0 || t < 0 ? -1 : Math.max(old.t, t);
    old.v = Math.max(old.v, v);
    old.src = src || old.src;
    return old;
  }
  const m: Modifier = { id, t, v, src };
  u.mods.push(m);
  return m;
}

export function removeMod(u: Unit, id: string) {
  u.mods = u.mods.filter((m) => m.id !== id);
}

/** Развеять дебаффы (сильное развеивание снимает и оглушение) */
export function dispel(u: Unit, strong = false) {
  u.mods = u.mods.filter((m) => MODIFIERS[m.id]?.buff || (!strong && m.id === 'stun'));
}

export function tickModifiers(w: World, u: Unit) {
  const expired: Modifier[] = [];
  for (const m of u.mods) {
    MODIFIERS[m.id]?.tick?.(w, u, m);
    if (m.t > 0) {
      m.t = Math.max(0, m.t - DT);
      if (m.t === 0) expired.push(m);
    }
  }
  // t = -2 — снят досрочно (без срабатывания expire)
  if (u.mods.some((m) => m.t === 0 || m.t === -2)) u.mods = u.mods.filter((m) => m.t !== 0 && m.t !== -2);
  for (const m of expired) MODIFIERS[m.id]?.expire?.(w, u, m);
}
