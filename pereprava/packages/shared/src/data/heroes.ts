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
    abilities: ['fireball', 'blink', 'shield'],
    build: ['boots', 'flame', 'cloak', 'staff', 'ring', 'cloak'],
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
    abilities: ['slam'],
    build: ['boots', 'staff', 'cloak', 'staff', 'ring', 'cloak'],
    color: '#ff8a6a',
  },
];

export const HERO: Record<string, HeroDef> = Object.fromEntries(HEROES.map((h) => [h.id, h]));
