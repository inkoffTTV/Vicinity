// Предметы лавки. Числа — данные; активное действие (use) описано в sim/items.ts по id предмета.

export interface ItemDef {
  id: string;
  name: string;
  desc: string;
  price: number;
  color: string;
  /** SVG-контур иконки (viewBox 0 0 24 24) */
  icon: string;
  hp?: number;
  dmg?: number;
  speed?: number;
  regen?: number;
  /** Усиление урона способностей, доля (0.4 = +40%) */
  spellAmp?: number;
  armor?: number;
  /** Скорость атаки, доля */
  atkSpeed?: number;
  lifesteal?: number;
  /** Одна штука на героя */
  unique?: boolean;
  /** Расходуется при использовании */
  consumable?: boolean;
  /** Есть активное действие (слот с горячей клавишей) */
  active?: boolean;
  /** Перезарядка активного действия, с */
  cooldown?: number;
  /** Составной предмет: из чего собирается (компоненты в инвентаре засчитываются в цену) */
  parts?: string[];
}

export const ITEMS: ItemDef[] = [
  {
    id: 'potion',
    name: 'Зелье лечения',
    desc: '+300 здоровья за 6 с. Нажмите на слот, чтобы выпить',
    price: 90,
    active: true,
    consumable: true,
    color: '#ff7a8a',
    icon: '<path d="M9 3h6M10 3v5l-4 8a3 3 0 0 0 3 4h6a3 3 0 0 0 3-4l-4-8V3"/>',
  },
  {
    id: 'ring',
    name: 'Кольцо жизни',
    desc: '+4 здоровья в секунду',
    price: 300,
    regen: 4,
    color: '#7dffa0',
    icon: '<circle cx="12" cy="14" r="6"/><path d="M9 6l3-3 3 3-3 2z"/>',
  },
  {
    id: 'boots',
    name: 'Сапоги скорохода',
    desc: '+2 к скорости, одни на героя',
    price: 400,
    speed: 2,
    unique: true,
    color: '#e0c08a',
    icon: '<path d="M7 3h5v9l6 3a2 2 0 0 1 2 2v3H6z"/>',
  },
  {
    id: 'staff',
    name: 'Посох силы',
    desc: '+16 к урону атаки',
    price: 450,
    dmg: 16,
    color: '#ffd27a',
    icon: '<path d="M6 20L15 11"/><circle cx="17" cy="7" r="3.5"/>',
  },
  {
    id: 'cloak',
    name: 'Плащ стража',
    desc: '+180 к здоровью',
    price: 500,
    hp: 180,
    color: '#8ec5ff',
    icon: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/>',
  },
  {
    id: 'flame',
    name: 'Сердце пламени',
    desc: '+40% к урону способностей',
    price: 700,
    spellAmp: 0.4,
    color: '#ff9a3d',
    icon: '<path d="M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-5 .5 2 1.5 3 2.5 3 0-3-1-5 0-8z"/>',
  },
];

export const ITEM: Record<string, ItemDef> = Object.fromEntries(ITEMS.map((i) => [i.id, i]));
