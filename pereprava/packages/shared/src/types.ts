// Состояние мира — простые данные (без классов и ссылок на объекты): его можно сравнить, сохранить,
// отправить по сети и перенести на C++ один к одному. Поведение живёт в реестрах способностей,
// модификаторов и предметов (data/*), а юниты ссылаются на них по строковому id.

export type Team = 0 | 1;
/** 2 — нейтралы (лесные лагеря) */
export type Side = Team | 2;
export type UnitKind = 'hero' | 'creep' | 'tower' | 'ancient' | 'neutral';
export type DamageType = 'physical' | 'magical' | 'pure';

/** Бафф или дебафф: стан, щит, замедление, зелье, руна… Поведение — в MODIFIERS[id] */
export interface Modifier {
  id: string;
  /** Осталось секунд; -1 — бессрочный */
  t: number;
  /** Сила эффекта: запас щита, доля замедления, лечение в секунду… */
  v: number;
  /** Кто наложил (id юнита), 0 — никто */
  src: number;
}

export type Order =
  | { type: 'move'; x: number; z: number; st: number; best: number; path?: { x: number; z: number }[] }
  | { type: 'attack'; id: number; auto: boolean }
  /** Атака с передвижением: идти к точке, по пути бить врагов, оказавшихся рядом (tgt — текущий) */
  | {
      type: 'amove';
      x: number;
      z: number;
      st: number;
      best: number;
      path?: { x: number; z: number }[];
      tgt: number;
    }
  /** Подойти к цели на дальность умения и применить его */
  | { type: 'cast'; slot: number; id: number };

/** Замах перед применением (каст-пойнт): способность сработает, когда t дойдёт до нуля */
export interface Casting {
  ability: string;
  t: number;
  total: number;
  x: number;
  z: number;
  id: number;
}

export interface HeroState {
  def: string;
  player: number;
  level: number;
  xp: number;
  gold: number;
  items: (string | null)[];
  /** Перезарядка способностей по слотам Q W E R, секунды */
  cd: number[];
  /** Перезарядка активных предметов по слотам инвентаря (0–5 — основные, 6–8 — рюкзак) */
  itemCd: number[];
  /** Когда куплен предмет в слоте (время мира) и сколько за него заплачено — для возврата в первые 10 с */
  itemT: number[];
  itemPaid: number[];
  respawn: number;
  order: Order | null;
  casting: Casting | null;
  /** Умение, нажатое во время замаха другого: сработает сразу после него */
  queued: { slot: number; aim: { x: number; z: number; id: number } | null } | null;
  // Бонусы от предметов и уровня (пересчитываются в recalc)
  baseHp: number;
  baseDmg: number;
  regen: number;
  /** Множитель урона способностей (Сердце пламени и т. п.) */
  spellAmp: number;
  bonusArmor: number;
  bonusAtkSpeed: number;
  lifesteal: number;
  /** Сокращение перезарядки способностей, доля */
  cdr: number;
  /** Счётчик для пассивок («каждый 4-й выстрел») */
  stacks: number;
}

export interface Unit {
  id: number;
  kind: UnitKind;
  team: Side;
  x: number;
  z: number;
  rot: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  invuln: boolean;
  radius: number;
  speed: number;
  dmg: number;
  range: number;
  /** Секунд между атаками */
  atkInt: number;
  atkTimer: number;
  ranged: boolean;
  armor: number;
  magicRes: number;
  target: number;
  retarget: number;
  /** Вышка: сколько ещё держит агро на герое, напавшем на героя */
  forced: number;
  moving: boolean;
  /** Тики последней атаки, полученного урона и каста — клиент по ним анимирует */
  atkTick: number;
  hurtTick: number;
  castTick: number;
  /** Высота полоски здоровья над землёй (для клиента) */
  barH: number;
  /** Модель для клиента: id героя, 'melee', 'ranged', 'tower', 'ancient', id нейтрала */
  model: string;
  mods: Modifier[];
  hero?: HeroState;
  /** Ярус вышки: 1 — внешняя, 2 — внутренняя */
  tier?: number;
  /** Линия вышки или крипа (индекс в MapDef.lanes) */
  lane?: number;
  /** Лесной лагерь, к которому привязан нейтрал */
  camp?: number;
  homeX?: number;
  homeZ?: number;
  /** Ближник: номер места вокруг цели (slotT — чья это цель); -1 — мест нет, ждёт */
  slot?: number;
  slotT?: number;
  /** Стоит и бьёт: почти не толкается и не дёргается (см. sim/engage.ts) */
  planted?: boolean;
}

export interface Projectile {
  id: number;
  /** 'attack' — самонаводящийся снаряд атаки; иначе id способности (летит по прямой) */
  kind: string;
  x: number;
  z: number;
  /** Высота вылета над землёй (для клиента) */
  y0: number;
  dx: number;
  dz: number;
  speed: number;
  dist: number;
  max: number;
  target: number;
  src: number;
  team: Side;
  dmg: number;
  color: number;
  size: number;
  /** Пробивает насквозь: в кого уже попал */
  pierce?: boolean;
  hits?: number[];
}

/** Область на земле: метеор, град стрел, купол… Поведение — в ABILITIES[kind].zone */
export interface Zone {
  id: number;
  kind: string;
  x: number;
  z: number;
  r: number;
  /** Сколько ещё действует, с */
  t: number;
  /** Задержка до срабатывания, с */
  delay: number;
  /** Период импульсов, с; 0 — каждый тик */
  period: number;
  next: number;
  src: number;
  team: Side;
  v: number;
}

/** Приказы игрока. Приходят между тиками и применяются в начале следующего */
export type Command =
  | { c: 'move'; x: number; z: number }
  | { c: 'attack'; id: number }
  | { c: 'amove'; x: number; z: number }
  | { c: 'stop' }
  | { c: 'cast'; slot: number; x?: number; z?: number; id?: number }
  | { c: 'buy'; item: string }
  | { c: 'sell'; slot: number }
  /** Поменять местами два слота (в том числе с рюкзаком) */
  | { c: 'swap'; a: number; b: number }
  | { c: 'use'; slot: number; x?: number; z?: number }
  | { c: 'ping'; x: number; z: number; kind?: 'look' | 'danger' | 'go' };

/** События тика — для эффектов, звуков, надписей. Клиент сам решает, как их показать */
export type SimEvent =
  | { e: 'fx'; k: string; x: number; z: number; h: number; color: number; size: number; life: number; grow: number }
  | { e: 'hit'; id: number; src: number; amt: number; shield: boolean }
  | { e: 'attack'; id: number; target: number; ranged: boolean }
  | { e: 'cast'; id: number; ability: string; x: number; z: number }
  /** Умение не сработало — игроку объясняем почему */
  | { e: 'castFail'; player: number; slot: number; reason: 'target' | 'cd' | 'stun' | 'silence' | 'level' }
  | { e: 'death'; id: number; kind: UnitKind; team: Side; killer: number; x: number; z: number }
  | { e: 'heroKill'; victim: number; killer: number; victimTeam: Team }
  | { e: 'gold'; player: number; amt: number; x: number; z: number }
  | { e: 'level'; id: number; player: number; level: number }
  | { e: 'respawn'; id: number; player: number }
  | { e: 'tower'; team: Team; tier: number; lane: number }
  | { e: 'buy'; player: number; item: string }
  | { e: 'rune'; x: number; z: number; rune: string; taker?: number }
  | { e: 'ping'; player: number; team: Team; x: number; z: number; kind: string }
  | { e: 'wave' }
  | { e: 'win'; team: Team };

export interface PlayerStats {
  kills: number;
  deaths: number;
  assists: number;
  lastHits: number;
  denies: number;
  gold: number;
  heroDamage: number;
}

export interface Player {
  slot: number;
  team: Team;
  name: string;
  heroDef: string;
  unit: number;
  /** null — человек; иначе сложность бота */
  bot: string | null;
  /** Мысль бота: режим, таймер раздумий, индекс закупки */
  ai: { mode: 'lane' | 'retreat' | 'jungle'; think: number; buyIdx: number; lane: number };
  stats: PlayerStats;
  /** Последний урон по этому герою от вражеских героев: player slot → тик (для помощи в убийстве) */
  hurtBy: Record<number, number>;
  /** Время последнего пинга (антиспам) */
  pingAt?: number;
}

export interface Rune {
  kind: string;
  x: number;
  z: number;
}

export interface Camp {
  id: number;
  x: number;
  z: number;
  /** Тип лагеря: 'small' | 'big' */
  type: string;
  respawnAt: number;
}
