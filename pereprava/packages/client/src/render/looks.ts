// Внешность героев, крипов и нейтралов — данные для общего скелета (humanoid.ts).
// У каждого героя свой силуэт (рост, ширина, головной убор, оружие, плащ) и своя палитра;
// цвет команды — на поясе, наплечных камнях и плюмажах.
import type { Look } from './humanoid';

export const HERO_LOOKS: Record<string, Look> = {
  // Маг огня: высокий, мантия, остроконечная шляпа, посох с огненным камнем
  mage: {
    height: 1.05,
    bulk: 0.9,
    skin: 0xf0c9a0,
    cloth: 0x4b4fc8,
    armor: 0x3a3da8,
    trim: 0xf1c453,
    glow: 0xff9a2a,
    head: 'hat',
    torso: 'robe',
    shoulders: 'orbs',
    cape: 0x2c2f8a,
    weapon: 'staff',
    extra: ['scarf'],
  },
  // Громила: широкий, рогатый шлем, шипастые наплечники, топор
  brute: {
    height: 1.12,
    bulk: 1.45,
    skin: 0xa0503e,
    cloth: 0x5a3a2a,
    armor: 0x4d4f57,
    trim: 0xb08850,
    glow: 0xff4a2a,
    head: 'horns',
    torso: 'bare',
    shoulders: 'spikes',
    cape: null,
    weapon: 'axe',
    extra: ['belt'],
  },
  // Следопытка: лёгкая, капюшон, лук, колчан
  ranger: {
    height: 1.0,
    bulk: 0.85,
    skin: 0xe8c09a,
    cloth: 0x3f6b3a,
    armor: 0x5a4a32,
    trim: 0xa88a50,
    glow: 0xc8f08a,
    head: 'hood',
    torso: 'leather',
    shoulders: null,
    cape: 0x2f5230,
    weapon: 'bow',
    extra: ['quiver'],
  },
  // Хранительница: корона, светлая мантия, книга и фонарь, ореол
  keeper: {
    height: 1.02,
    bulk: 0.95,
    skin: 0xf2d2b0,
    cloth: 0xe8e0c8,
    armor: 0xc8b070,
    trim: 0xf1c453,
    glow: 0xfff0a0,
    hair: 0xf0e0b0,
    head: 'crown',
    torso: 'robe',
    shoulders: 'pads',
    cape: 0xd8c890,
    weapon: 'book',
    offhand: 'lantern',
    extra: ['halo'],
  },
  // Тень: худой, маска, два кинжала, тёмный плащ
  shade: {
    height: 0.98,
    bulk: 0.8,
    skin: 0x6a6070,
    cloth: 0x2a2433,
    armor: 0x3a3344,
    trim: 0x8a7aa0,
    glow: 0xb48aff,
    head: 'mask',
    torso: 'leather',
    shoulders: null,
    cape: 0x1a1622,
    weapon: 'daggers',
    extra: ['scarf'],
  },
};

/** Крипы: мечник со щитом и лучник; табард и плюмаж — в цвете команды */
export const CREEP_LOOKS: Record<'melee' | 'ranged', Look> = {
  melee: {
    height: 0.95,
    bulk: 1.05,
    skin: 0xd8b090,
    cloth: 0x5a5f6a,
    armor: 0x8a929e,
    trim: 0x6a6f78,
    glow: 0xfff0c0,
    head: 'plume',
    torso: 'plate',
    shoulders: null,
    weapon: 'sword',
    offhand: 'shield',
  },
  ranged: {
    height: 0.92,
    bulk: 0.9,
    skin: 0xd8b090,
    cloth: 0x6a5a44,
    armor: 0x5a4a32,
    trim: 0x8a7050,
    glow: 0xfff0c0,
    head: 'hood',
    torso: 'leather',
    shoulders: null,
    weapon: 'bow',
    extra: ['quiver'],
  },
};

/** Лесной великан — большой нейтрал */
export const GIANT_LOOK: Look = {
  height: 1.0,
  bulk: 1.6,
  skin: 0x7a8a5a,
  cloth: 0x5a4632,
  armor: 0x5a4a3a,
  trim: 0x8a7050,
  glow: 0xffd27a,
  head: 'antlers',
  torso: 'bare',
  shoulders: 'fur',
  weapon: 'club',
};
