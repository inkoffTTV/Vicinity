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
  /** Сокращение перезарядки способностей, доля */
  cdr?: number;
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
  {
    id: 'gloves',
    name: 'Перчатки ловкости',
    desc: '+25% к скорости атаки',
    price: 350,
    atkSpeed: 0.25,
    color: '#ffb0d8',
    icon: '<path d="M7 21v-8l-2-4 2-1 2 3V4a1.5 1.5 0 0 1 3 0v6-7a1.5 1.5 0 0 1 3 0v7-5a1.5 1.5 0 0 1 3 0v10l-2 6z"/>',
  },
  {
    id: 'mail',
    name: 'Кольчуга',
    desc: '+5 к броне (меньше физического урона)',
    price: 400,
    armor: 5,
    color: '#b8c4d4',
    icon: '<path d="M6 4h12l2 5-3 2v9H7v-9L4 9z"/><path d="M9 12h6M9 15h6"/>',
  },
  {
    id: 'fang',
    name: 'Клык вампира',
    desc: 'Удары лечат на 12% урона',
    price: 450,
    lifesteal: 0.12,
    color: '#ff6a7a',
    icon: '<path d="M6 4c4 1 8 1 12 0-1 6-3 12-6 16-3-4-5-10-6-16z"/>',
  },
  {
    id: 'stone',
    name: 'Камень странника',
    desc: 'Мгновенный перенос на 9 м к прицелу. Перезарядка 14 с',
    price: 750,
    active: true,
    cooldown: 14,
    unique: true,
    color: '#b89aff',
    icon: '<path d="M12 3l6 6-6 12L6 9z"/><path d="M6 9h12"/>',
  },
  {
    id: 'recall',
    name: 'Свиток возвращения',
    desc: 'Через 3 с переносит к фонтану. Урон или приказ «идти» прерывают',
    price: 60,
    active: true,
    consumable: true,
    color: '#f1c453',
    icon: '<path d="M6 4h10a3 3 0 0 1 0 6H8a3 3 0 0 0 0 6h10"/><path d="M15 13l3 3-3 3"/>',
  },
  {
    id: 'warblade',
    name: 'Боевой клинок',
    desc: 'Собирается из посоха силы и перчаток: +30 к урону, +35% к скорости атаки, удары лечат на 8%',
    price: 1250,
    parts: ['staff', 'gloves'],
    dmg: 30,
    atkSpeed: 0.35,
    lifesteal: 0.08,
    color: '#ffcf5a',
    icon: '<path d="M14 4l6 0 0 6-9 9-3-3z"/><path d="M5 16l3 3M4 20l2-2"/>',
  },
  {
    id: 'archstaff',
    name: 'Посох архимага',
    desc: 'Собирается из сердца пламени и кольца жизни: +60% к урону способностей, +6 здоровья в секунду, перезарядка способностей на 15% короче',
    price: 1500,
    parts: ['flame', 'ring'],
    spellAmp: 0.6,
    regen: 6,
    cdr: 0.15,
    color: '#ff8a5a',
    icon: '<path d="M7 21L16 8"/><path d="M16 3l2 3 3 1-2 3-3 1-1-3-3-2 3-1z"/>',
  },
  {
    id: 'bulwark',
    name: 'Оплот',
    desc: 'Собирается из плаща стража и кольчуги: +260 к здоровью, +8 к броне. Применение: снимает замедления и корни, 3 с на 40% меньше урона. Перезарядка 30 с',
    price: 1350,
    parts: ['cloak', 'mail'],
    hp: 260,
    armor: 8,
    active: true,
    cooldown: 30,
    color: '#7fc8ff',
    icon: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M12 8v8M8 12h8"/>',
  },
];

export const ITEM: Record<string, ItemDef> = Object.fromEntries(ITEMS.map((i) => [i.id, i]));
