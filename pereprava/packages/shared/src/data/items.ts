// Предметы лавки. Числа — данные; активное действие (use) описано в sim/items.ts по id предмета.
// Три уровня: базовые (1), промежуточные (2) и итоговые (3). Составной предмет собирается из 2–3 частей
// и «рецепта» — доплаты: price = сумма цен частей + рецепт (recipeCost). Части, лежащие в инвентаре
// (и в рюкзаке), засчитываются в цену — на любой глубине дерева.

export type ItemSection = 'consum' | 'attack' | 'defense' | 'magic' | 'speed' | 'final';

export const SECTIONS: { id: ItemSection; name: string }[] = [
  { id: 'consum', name: 'Расходники' },
  { id: 'attack', name: 'Атака' },
  { id: 'defense', name: 'Защита' },
  { id: 'magic', name: 'Магия' },
  { id: 'speed', name: 'Скорость' },
  { id: 'final', name: 'Итоговые' },
];

export interface ItemDef {
  id: string;
  name: string;
  desc: string;
  /** Полная цена (с частями) */
  price: number;
  tier: 1 | 2 | 3;
  section: ItemSection;
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
  /** Атрибуты: сила, ловкость, интеллект */
  str?: number;
  agi?: number;
  int?: number;
  /** Мана и её восстановление в секунду */
  mana?: number;
  manaRegen?: number;
  /** Нейтральный предмет: не продаётся в лавке, выпадает в лесу, лежит в отдельном слоте */
  neutral?: boolean;
  /** Одна штука на героя */
  unique?: boolean;
  /** Расходуется при использовании */
  consumable?: boolean;
  /** Есть активное действие (слот с горячей клавишей) */
  active?: boolean;
  /** Перезарядка активного действия, с */
  cooldown?: number;
  /** Составной предмет: из чего собирается */
  parts?: string[];
}

export const ITEMS: ItemDef[] = [
  // ── Расходники ──
  {
    id: 'potion',
    name: 'Зелье лечения',
    desc: '+300 здоровья за 6 с. Нажмите на слот, чтобы выпить',
    price: 90,
    tier: 1,
    section: 'consum',
    active: true,
    consumable: true,
    color: '#ff7a8a',
    icon: '<path d="M9 3h6M10 3v5l-4 8a3 3 0 0 0 3 4h6a3 3 0 0 0 3-4l-4-8V3"/>',
  },
  {
    id: 'salve',
    name: 'Травяной бальзам',
    desc: '+20 здоровья и +8 маны в секунду 10 с. Дешевле зелья, но медленнее',
    price: 50,
    tier: 1,
    section: 'consum',
    active: true,
    consumable: true,
    color: '#9be38a',
    icon: '<path d="M6 10h12v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z"/><path d="M8 10V6h8v4M12 13v5M9.5 15.5h5"/>',
  },
  {
    id: 'recall',
    name: 'Свиток возвращения',
    desc: 'Ложится в отдельный слот телепорта (до 3 штук). Клавиша T: через 3 с перенос к своей постройке у точки или к фонтану. Урон прерывает',
    price: 60,
    tier: 1,
    section: 'consum',
    active: true,
    consumable: true,
    color: '#f1c453',
    icon: '<path d="M6 4h10a3 3 0 0 1 0 6H8a3 3 0 0 0 0 6h10"/><path d="M15 13l3 3-3 3"/>',
  },
  // ── Базовые ──
  {
    id: 'blade',
    name: 'Железный нож',
    desc: '+8 к урону атаки',
    price: 200,
    tier: 1,
    section: 'attack',
    dmg: 8,
    agi: 2,
    color: '#d6dbe4',
    icon: '<path d="M5 19l9-9 4-6 1 1-6 4-9 9z"/><path d="M4 16l4 4"/>',
  },
  {
    id: 'staff',
    name: 'Посох силы',
    desc: '+16 к урону атаки',
    price: 450,
    tier: 1,
    section: 'attack',
    dmg: 16,
    color: '#ffd27a',
    icon: '<path d="M6 20L15 11"/><circle cx="17" cy="7" r="3.5"/>',
  },
  {
    id: 'gloves',
    name: 'Перчатки ловкости',
    desc: '+25% к скорости атаки',
    price: 350,
    tier: 1,
    section: 'attack',
    atkSpeed: 0.25,
    agi: 5,
    color: '#ffb0d8',
    icon: '<path d="M7 21v-8l-2-4 2-1 2 3V4a1.5 1.5 0 0 1 3 0v6-7a1.5 1.5 0 0 1 3 0v7-5a1.5 1.5 0 0 1 3 0v10l-2 6z"/>',
  },
  {
    id: 'fang',
    name: 'Клык вампира',
    desc: 'Удары лечат на 12% урона',
    price: 450,
    tier: 1,
    section: 'attack',
    lifesteal: 0.12,
    color: '#ff6a7a',
    icon: '<path d="M6 4c4 1 8 1 12 0-1 6-3 12-6 16-3-4-5-10-6-16z"/>',
  },
  {
    id: 'mail',
    name: 'Кольчуга',
    desc: '+5 к броне (меньше физического урона)',
    price: 400,
    tier: 1,
    section: 'defense',
    armor: 5,
    color: '#b8c4d4',
    icon: '<path d="M6 4h12l2 5-3 2v9H7v-9L4 9z"/><path d="M9 12h6M9 15h6"/>',
  },
  {
    id: 'cloak',
    name: 'Плащ стража',
    desc: '+180 к здоровью',
    price: 500,
    tier: 1,
    section: 'defense',
    hp: 180,
    str: 4,
    color: '#8ec5ff',
    icon: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/>',
  },
  {
    id: 'ring',
    name: 'Кольцо жизни',
    desc: '+4 здоровья в секунду',
    price: 300,
    tier: 1,
    section: 'defense',
    regen: 4,
    color: '#7dffa0',
    icon: '<circle cx="12" cy="14" r="6"/><path d="M9 6l3-3 3 3-3 2z"/>',
  },
  {
    id: 'leaf',
    name: 'Живой лист',
    desc: '+2 здоровья в секунду',
    price: 150,
    tier: 1,
    section: 'defense',
    regen: 2,
    color: '#5fd38a',
    icon: '<path d="M5 19C5 10 10 5 20 4c-1 10-6 15-15 15z"/><path d="M5 19l9-9"/>',
  },
  {
    id: 'gem',
    name: 'Самоцвет здоровья',
    desc: '+120 к здоровью, +1 здоровья в секунду',
    price: 380,
    tier: 1,
    section: 'defense',
    hp: 120,
    regen: 1,
    str: 3,
    color: '#ff9ab0',
    icon: '<path d="M7 4h10l4 5-9 11L3 9z"/><path d="M3 9h18M9 4l3 16 3-16"/>',
  },
  {
    id: 'ember',
    name: 'Уголёк',
    desc: '+15% к урону способностей',
    price: 280,
    tier: 1,
    section: 'magic',
    spellAmp: 0.15,
    int: 5,
    color: '#ff9a3d',
    icon: '<path d="M12 4c1 3 4 4 4 8a4 4 0 0 1-8 0c0-2 1-3 2-4 .5 1.5 1 2 2 2 0-2-1-4 0-6z"/><path d="M6 20h12"/>',
  },
  {
    id: 'hourglass',
    name: 'Песочные часы',
    desc: 'Перезарядка способностей на 8% короче',
    price: 300,
    tier: 1,
    section: 'magic',
    cdr: 0.08,
    int: 3,
    manaRegen: 1,
    color: '#e8d28a',
    icon: '<path d="M7 3h10M7 21h10M8 3c0 6 8 6 8 9s-8 3-8 9M16 3c0 6-8 6-8 9s8 3 8 9"/>',
  },
  {
    id: 'boots',
    name: 'Сапоги скорохода',
    desc: '+2 к скорости, одни на героя',
    price: 400,
    tier: 1,
    section: 'speed',
    speed: 2,
    unique: true,
    color: '#e0c08a',
    icon: '<path d="M7 3h5v9l6 3a2 2 0 0 1 2 2v3H6z"/>',
  },
  {
    id: 'stone',
    name: 'Камень странника',
    desc: 'Мгновенный перенос на 9 м к прицелу. Перезарядка 14 с',
    price: 750,
    tier: 1,
    section: 'speed',
    active: true,
    cooldown: 14,
    unique: true,
    color: '#b89aff',
    icon: '<path d="M12 3l6 6-6 12L6 9z"/><path d="M6 9h12"/>',
  },
  // ── Промежуточные ──
  {
    id: 'warblade',
    name: 'Боевой клинок',
    desc: '+30 к урону, +35% к скорости атаки, удары лечат на 8%',
    price: 1250,
    tier: 2,
    section: 'attack',
    parts: ['staff', 'gloves'],
    dmg: 30,
    atkSpeed: 0.35,
    lifesteal: 0.08,
    agi: 6,
    color: '#ffcf5a',
    icon: '<path d="M14 4l6 0 0 6-9 9-3-3z"/><path d="M5 16l3 3M4 20l2-2"/>',
  },
  {
    id: 'vampblade',
    name: 'Кровавый серп',
    desc: '+16 к урону, удары лечат на 18%',
    price: 850,
    tier: 2,
    section: 'attack',
    parts: ['fang', 'blade'],
    dmg: 16,
    lifesteal: 0.18,
    color: '#e0405a',
    icon: '<path d="M5 20L13 12"/><path d="M13 12c0-5 3-8 8-8-1 4-3 7-8 8z"/>',
  },
  {
    id: 'bulwark',
    name: 'Оплот',
    desc: '+260 к здоровью, +8 к броне. Применение: снимает замедления и корни, 3 с на 40% меньше урона. Перезарядка 30 с',
    price: 1350,
    tier: 2,
    section: 'defense',
    parts: ['cloak', 'mail'],
    hp: 260,
    armor: 8,
    active: true,
    cooldown: 30,
    color: '#7fc8ff',
    icon: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M12 8v8M8 12h8"/>',
  },
  {
    id: 'lifegem',
    name: 'Камень жизни',
    desc: '+260 к здоровью, +7 здоровья в секунду',
    price: 1050,
    tier: 2,
    section: 'defense',
    parts: ['cloak', 'ring'],
    hp: 260,
    regen: 7,
    str: 6,
    color: '#6ff0b0',
    icon: '<circle cx="12" cy="12" r="7"/><path d="M12 8v8M8 12h8"/>',
  },
  {
    id: 'spikemail',
    name: 'Шипастая броня',
    desc: '+7 к броне, +3 здоровья в секунду',
    price: 800,
    tier: 2,
    section: 'defense',
    parts: ['mail', 'leaf'],
    armor: 7,
    regen: 3,
    color: '#a0b0c8',
    icon: '<path d="M6 5h12l2 5-3 2v8H7v-8L4 10z"/><path d="M3 6l3 1M21 6l-3 1M12 2v3"/>',
  },
  {
    id: 'flame',
    name: 'Сердце пламени',
    desc: '+40% к урону способностей, перезарядка на 10% короче',
    price: 800,
    tier: 2,
    section: 'magic',
    parts: ['ember', 'hourglass'],
    spellAmp: 0.4,
    cdr: 0.1,
    int: 6,
    manaRegen: 1.5,
    color: '#ff7a2d',
    icon: '<path d="M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-5 .5 2 1.5 3 2.5 3 0-3-1-5 0-8z"/>',
  },
  {
    id: 'swiftboots',
    name: 'Сапоги ветра',
    desc: '+3 к скорости, +25% к скорости атаки',
    price: 950,
    tier: 2,
    section: 'speed',
    parts: ['boots', 'gloves'],
    speed: 3,
    atkSpeed: 0.25,
    unique: true,
    agi: 4,
    color: '#bfe8ff',
    icon: '<path d="M7 3h5v9l6 3a2 2 0 0 1 2 2v3H6z"/><path d="M2 9h4M1 13h5M3 17h3"/>',
  },
  {
    id: 'pathboots',
    name: 'Сапоги путника',
    desc: '+3 к скорости, +5 здоровья в секунду',
    price: 850,
    tier: 2,
    section: 'speed',
    parts: ['boots', 'ring'],
    speed: 3,
    regen: 5,
    unique: true,
    str: 3,
    manaRegen: 0.5,
    color: '#c8e08a',
    icon: '<path d="M7 3h5v9l6 3a2 2 0 0 1 2 2v3H6z"/><circle cx="17" cy="6" r="2.5"/>',
  },
  // ── Итоговые ──
  {
    id: 'stormblade',
    name: 'Клинок бури',
    desc: '+50 к урону, +45% к скорости атаки, удары лечат на 16%',
    price: 2500,
    tier: 3,
    section: 'final',
    parts: ['warblade', 'vampblade'],
    dmg: 50,
    atkSpeed: 0.45,
    lifesteal: 0.16,
    agi: 12,
    color: '#ffe066',
    icon: '<path d="M14 3l7 0 0 7-10 10-4-4z"/><path d="M13 7l-3 4h3l-3 4"/>',
  },
  {
    id: 'reaper',
    name: 'Коса жнеца',
    desc: '+42 к урону, +160 к здоровью, удары лечат на 22%',
    price: 2000,
    tier: 3,
    section: 'final',
    parts: ['vampblade', 'staff', 'blade'],
    dmg: 42,
    hp: 160,
    lifesteal: 0.22,
    str: 8,
    color: '#c03050',
    icon: '<path d="M6 21L15 8"/><path d="M15 8c-2-3-6-4-10-3 3 2 6 3 10 3z"/>',
  },
  {
    id: 'archstaff',
    name: 'Посох архимага',
    desc: '+60% к урону способностей, +150 к здоровью, +3 здоровья в секунду, перезарядка на 15% короче',
    price: 1580,
    tier: 3,
    section: 'final',
    parts: ['flame', 'gem'],
    spellAmp: 0.6,
    hp: 150,
    regen: 3,
    cdr: 0.15,
    int: 10,
    mana: 150,
    manaRegen: 2.5,
    color: '#ff8a5a',
    icon: '<path d="M7 21L16 8"/><path d="M16 3l2 3 3 1-2 3-3 1-1-3-3-2 3-1z"/>',
  },
  {
    id: 'sage',
    name: 'Мантия мудреца',
    desc: '+55% к урону способностей, +200 к здоровью, перезарядка на 25% короче',
    price: 2000,
    tier: 3,
    section: 'final',
    parts: ['flame', 'hourglass', 'cloak'],
    spellAmp: 0.55,
    hp: 200,
    cdr: 0.25,
    int: 14,
    mana: 200,
    manaRegen: 3,
    color: '#b98aff',
    icon: '<path d="M8 3h8l3 18H5z"/><path d="M12 7v6M9 10h6"/>',
  },
  {
    id: 'citadel',
    name: 'Цитадель',
    desc: '+500 к здоровью, +9 к броне, +7 здоровья в секунду. Применение как у Оплота. Перезарядка 25 с',
    price: 2800,
    tier: 3,
    section: 'final',
    parts: ['bulwark', 'lifegem'],
    hp: 500,
    armor: 9,
    regen: 7,
    active: true,
    cooldown: 25,
    str: 12,
    color: '#5fb0ff',
    icon: '<path d="M4 21V8l3-2 3 2V5l2-2 2 2v3l3-2 3 2v13z"/><path d="M10 21v-5h4v5"/>',
  },
  {
    id: 'windwalker',
    name: 'Поступь ветра',
    desc: '+4 к скорости, +30% к скорости атаки. Применение: перенос на 12 м к прицелу. Перезарядка 11 с',
    price: 2000,
    tier: 3,
    section: 'final',
    parts: ['swiftboots', 'stone'],
    speed: 4,
    atkSpeed: 0.3,
    active: true,
    cooldown: 11,
    unique: true,
    agi: 8,
    color: '#9fd8ff',
    icon: '<path d="M7 3h5v9l6 3a2 2 0 0 1 2 2v3H6z"/><path d="M14 4l3 3-3 3"/>',
  },
];

/** Нейтральные предметы: выпадают из лесных зверей, в лавке их нет */
export const NEUTRAL_ITEMS: ItemDef[] = [
  { id: 'n_claw', name: 'Коготь зверя', desc: '+8 к урону, +3 к ловкости', price: 0, tier: 1, section: 'attack', neutral: true, dmg: 8, agi: 3, color: '#d8a070', icon: '<path d="M6 20c2-6 5-11 12-15-2 6-5 11-12 15z"/><path d="M9 17c1-3 3-6 7-8"/>' },
  { id: 'n_amulet', name: 'Лесной оберег', desc: '+3 здоровья в секунду, +1 к броне', price: 0, tier: 1, section: 'defense', neutral: true, regen: 3, armor: 1, color: '#8ad08a', icon: '<circle cx="12" cy="14" r="5"/><path d="M12 3v6M8 5l4 4 4-4"/>' },
  { id: 'n_heartwood', name: 'Сердцевина', desc: '+140 к здоровью, +3 к силе', price: 0, tier: 1, section: 'defense', neutral: true, hp: 140, str: 3, color: '#c09060', icon: '<path d="M12 21C6 16 4 12 4 9a4 4 0 0 1 8-1 4 4 0 0 1 8 1c0 3-2 7-8 12z"/>' },
  { id: 'n_feather', name: 'Перо ветра', desc: '+1 к скорости, +10% к скорости атаки', price: 0, tier: 1, section: 'speed', neutral: true, speed: 1, atkSpeed: 0.1, color: '#c0e0ff', icon: '<path d="M5 19C9 9 14 5 20 4c-1 6-5 11-15 15z"/><path d="M5 19l8-8"/>' },
  { id: 'n_spark', name: 'Искра леса', desc: '+12% к урону способностей, +1 маны в секунду, +3 к интеллекту', price: 0, tier: 1, section: 'magic', neutral: true, spellAmp: 0.12, manaRegen: 1, int: 3, color: '#f0e080', icon: '<path d="M12 3l2 6 6 1-5 4 2 7-5-4-5 4 2-7-5-4 6-1z"/>' },
];

export const ITEM: Record<string, ItemDef> = Object.fromEntries([...ITEMS, ...NEUTRAL_ITEMS].map((i) => [i.id, i]));

/** Доплата за рецепт (цена минус части) */
export const recipeCost = (id: string) => {
  const it = ITEM[id];
  return it.price - (it.parts ?? []).reduce((s, p) => s + ITEM[p].price, 0);
};

/** Во что входит предмет (обратное дерево рецептов) */
export const ITEM_INTO: Record<string, string[]> = Object.fromEntries(
  ITEMS.map((i) => [i.id, ITEMS.filter((x) => x.parts?.includes(i.id)).map((x) => x.id)]),
);

/** Есть ли a где-то внутри дерева рецепта b (или это он сам) */
export function itemContains(b: string, a: string): boolean {
  if (a === b) return true;
  return (ITEM[b]?.parts ?? []).some((p) => itemContains(p, a));
}

/** Описание прибавок предмета одной строкой — для карточки и подсказок */
export function itemStats(it: ItemDef): string[] {
  const out: string[] = [];
  if (it.dmg) out.push(`+${it.dmg} к урону`);
  if (it.atkSpeed) out.push(`+${Math.round(it.atkSpeed * 100)}% к скорости атаки`);
  if (it.lifesteal) out.push(`вампиризм ${Math.round(it.lifesteal * 100)}%`);
  if (it.hp) out.push(`+${it.hp} к здоровью`);
  if (it.regen) out.push(`+${it.regen} здоровья в секунду`);
  if (it.armor) out.push(`+${it.armor} к броне`);
  if (it.spellAmp) out.push(`+${Math.round(it.spellAmp * 100)}% к урону способностей`);
  if (it.cdr) out.push(`перезарядка −${Math.round(it.cdr * 100)}%`);
  if (it.speed) out.push(`+${it.speed} к скорости`);
  return out;
}
