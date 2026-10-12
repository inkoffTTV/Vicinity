// Украшения профиля и подключённые аккаунты. id и требования подписки совпадают с сервером
// (backend/utils/ProfileExt.cc): украшение без подписки сервер не сохранит (403) и не покажет.

export interface Cosmetic {
  id: string;
  name: string;
  /** Минимальная подписка: 1 — Basic, 2 — Standard, 3 — Ultra */
  tier: number;
}

export const FRAMES: Cosmetic[] = [
  { id: 'neon', name: 'Неон', tier: 1 },
  { id: 'gold', name: 'Золото', tier: 1 },
  { id: 'ice', name: 'Лёд', tier: 1 },
  { id: 'fire', name: 'Пламя', tier: 2 },
  { id: 'rainbow', name: 'Радуга', tier: 3 },
];

export const EFFECTS: Cosmetic[] = [
  { id: 'stars', name: 'Звёзды', tier: 3 },
  { id: 'aurora', name: 'Сияние', tier: 3 },
  { id: 'snow', name: 'Снег', tier: 3 },
  { id: 'glint', name: 'Блик', tier: 3 },
];

export const NAME_STYLES: Cosmetic[] = [
  { id: 'gradient', name: 'Градиент', tier: 2 },
  { id: 'neon', name: 'Неон', tier: 2 },
  { id: 'metal', name: 'Металл', tier: 2 },
  { id: 'flame', name: 'Пламя', tier: 2 },
  { id: 'aurora', name: 'Сияние', tier: 3 },
];

export const TIER_NAME = ['', 'Basic', 'Standard', 'Ultra'];

export interface ConnectionType {
  id: string;
  name: string;
  /** Короткая метка на плитке */
  mark: string;
  color: string;
  /** Ссылка на профиль по имени, если её не указали */
  url?: (name: string) => string;
}

export const CONNECTIONS: ConnectionType[] = [
  { id: 'steam', name: 'Steam', mark: 'St', color: '#1b2838' },
  { id: 'spotify', name: 'Spotify', mark: 'Sp', color: '#1db954' },
  { id: 'epic', name: 'Epic Games', mark: 'Ep', color: '#2a2a2a' },
  { id: 'xbox', name: 'Xbox', mark: 'X', color: '#107c10' },
  { id: 'playstation', name: 'PlayStation', mark: 'PS', color: '#003791' },
  { id: 'battlenet', name: 'Battle.net', mark: 'B', color: '#148eff' },
  { id: 'twitch', name: 'Twitch', mark: 'Tw', color: '#9146ff', url: (n) => `https://www.twitch.tv/${encodeURIComponent(n)}` },
  { id: 'youtube', name: 'YouTube', mark: 'YT', color: '#e62117', url: (n) => `https://www.youtube.com/@${encodeURIComponent(n)}` },
  { id: 'github', name: 'GitHub', mark: 'GH', color: '#24292e', url: (n) => `https://github.com/${encodeURIComponent(n)}` },
  { id: 'telegram', name: 'Telegram', mark: 'Tg', color: '#229ed9', url: (n) => `https://t.me/${encodeURIComponent(n.replace(/^@/, ''))}` },
  { id: 'vk', name: 'ВКонтакте', mark: 'VK', color: '#0077ff', url: (n) => `https://vk.com/${encodeURIComponent(n)}` },
  { id: 'website', name: 'Сайт', mark: 'www', color: '#3a3f4b' },
];

export const connectionType = (id: string) => CONNECTIONS.find((c) => c.id === id) ?? CONNECTIONS[CONNECTIONS.length - 1];

export const GAME_TAGS = [
  'Опытный',
  'Новичок',
  'Не оторваться',
  'Рейджквит',
  'Люблю',
  'Ностальгия',
  'С друзьями',
  'Соревновательно',
  'Расслабляет',
  'Хардкор',
  'Сюжет',
  'Красиво',
];
