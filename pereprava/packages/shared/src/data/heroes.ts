// Герои: числа в данных, поведение способностей — в sim/abilities.ts.

export interface HeroDef {
  id: string;
  name: string;
  /** Роль для экрана выбора */
  role: string;
  /** Одна строка о стиле игры */
  tagline: string;
  /** Винительный падеж для сообщений («убил вашего мага») */
  acc: string;
  /** Женский род («повержена», «вернулась») */
  fem?: boolean;
  ranged: boolean;
  baseHp: number;
  hpLvl: number;
  baseDmg: number;
  dmgLvl: number;
  baseSpeed: number;
  range: number;
  /** Секунд между атаками */
  atkInt: number;
  radius: number;
  barH: number;
  armor: number;
  /** Способности по слотам Q W E R (R — ультимейт, открывается на 6 уровне) */
  abilities: string[];
  /** Закупка бота по порядку */
  build: string[];
  /** Цвет героя в интерфейсе */
  color: string;
}

export const HEROES: HeroDef[] = [
  {
    id: 'mage',
    name: 'Маг',
    role: 'Дальний бой · урон способностями',
    tagline: 'Огненный шар, скачок и щит.',
    acc: 'мага',
    ranged: true,
    baseHp: 600,
    hpLvl: 70,
    baseDmg: 42,
    dmgLvl: 6,
    baseSpeed: 9,
    range: 6.5,
    atkInt: 0.9,
    radius: 0.8,
    barH: 3.6,
    armor: 0,
    abilities: ['fireball', 'blink', 'shield', 'meteor'],
    build: ['boots', 'flame', 'ring', 'archstaff', 'cloak', 'mail', 'bulwark'],
    color: '#8f95ff',
  },
  {
    id: 'brute',
    name: 'Громила',
    role: 'Ближний бой · стойкость',
    tagline: 'Удар по земле и охота на ослабших.',
    acc: 'громилу',
    ranged: false,
    baseHp: 700,
    hpLvl: 80,
    baseDmg: 36,
    dmgLvl: 6,
    baseSpeed: 8.6,
    range: 1.4,
    atkInt: 1,
    radius: 0.9,
    barH: 3.9,
    armor: 0,
    abilities: ['slam', 'charge', 'stoneskin', 'quake'],
    build: ['boots', 'staff', 'cloak', 'gloves', 'warblade', 'mail', 'bulwark'],
    color: '#ff8a6a',
  },
  {
    id: 'ranger',
    name: 'Следопытка',
    role: 'Дальний бой · урон атакой',
    tagline: 'Пронзающие стрелы и град с неба.',
    acc: 'следопытку',
    fem: true,
    ranged: true,
    baseHp: 540,
    hpLvl: 64,
    baseDmg: 40,
    dmgLvl: 7,
    baseSpeed: 9.4,
    range: 7.5,
    atkInt: 0.8,
    radius: 0.75,
    barH: 3.3,
    armor: 1,
    abilities: ['pierce', 'sprint', 'sharpeye', 'volley'],
    build: ['boots', 'gloves', 'staff', 'warblade', 'fang', 'cloak'],
    color: '#9be06a',
  },
  {
    id: 'keeper',
    name: 'Хранительница',
    role: 'Дальний бой · поддержка',
    tagline: 'Лечит, сковывает и закрывает куполом.',
    acc: 'хранительницу',
    fem: true,
    ranged: true,
    baseHp: 560,
    hpLvl: 66,
    baseDmg: 34,
    dmgLvl: 5,
    baseSpeed: 9,
    range: 6.5,
    atkInt: 1,
    radius: 0.8,
    barH: 3.5,
    armor: 1,
    abilities: ['mend', 'bind', 'keeper', 'dome'],
    build: ['boots', 'ring', 'cloak', 'mail', 'archstaff', 'bulwark'],
    color: '#ffe08a',
  },
  {
    id: 'shade',
    name: 'Тень',
    role: 'Ближний бой · убийца',
    tagline: 'Кинжалы из невидимости и казнь ослабших.',
    acc: 'тень',
    fem: true,
    ranged: false,
    baseHp: 580,
    hpLvl: 66,
    baseDmg: 44,
    dmgLvl: 7,
    baseSpeed: 9.6,
    range: 1.4,
    atkInt: 0.85,
    radius: 0.8,
    barH: 3.4,
    armor: 2,
    abilities: ['dagger', 'veil', 'thirst', 'execute'],
    build: ['boots', 'staff', 'fang', 'gloves', 'warblade', 'cloak'],
    color: '#a99ae0',
  },
];

export const HERO: Record<string, HeroDef> = Object.fromEntries(HEROES.map((h) => [h.id, h]));
