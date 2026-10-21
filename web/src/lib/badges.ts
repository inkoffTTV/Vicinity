import {
  Camera,
  Code2,
  Coffee,
  Flame,
  Gamepad2,
  Heart,
  Leaf,
  LucideIcon,
  Moon,
  Music,
  Palette,
  Rocket,
  Star,
} from 'lucide-react';

/** Значок профиля: пользователь выбирает из этого набора, свои загружать нельзя.
 *  Набор пополняет разработчик; id хранится в profile_ext.badge_pick и проверяется сервером
 *  (backend/utils/ProfileExt.cc, badgePicks). Цвета — данные значков, не токены темы. */
export interface Badge {
  id: string;
  label: string;
  icon: LucideIcon;
  color: string;
}

export const BADGES: Badge[] = [
  { id: 'star', label: 'Звезда', icon: Star, color: '#f2b33d' },
  { id: 'flame', label: 'Огонь', icon: Flame, color: '#ff6b3d' },
  { id: 'heart', label: 'Сердце', icon: Heart, color: '#f0616d' },
  { id: 'gamepad', label: 'Геймер', icon: Gamepad2, color: '#7c5cff' },
  { id: 'code', label: 'Разработчик', icon: Code2, color: '#2bc6a4' },
  { id: 'music', label: 'Меломан', icon: Music, color: '#e879a6' },
  { id: 'camera', label: 'Фотограф', icon: Camera, color: '#5ec8ff' },
  { id: 'palette', label: 'Художник', icon: Palette, color: '#c05bd6' },
  { id: 'rocket', label: 'Ракета', icon: Rocket, color: '#3e8ed0' },
  { id: 'coffee', label: 'Кофе', icon: Coffee, color: '#b08850' },
  { id: 'moon', label: 'Сова', icon: Moon, color: '#9b9bd6' },
  { id: 'leaf', label: 'Лист', icon: Leaf, color: '#3dd68c' },
];

export const badgeById = (id: string | null | undefined): Badge | null => (id ? BADGES.find((b) => b.id === id) ?? null : null);
