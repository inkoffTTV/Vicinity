// Данные карточки профиля из ответа сервера. Статус и цвет баннера — из profile_json (общие с десктопом:
// statusText, showStatus, banner.color), украшения — из profile_ext.
import { Profile, ProfileExt, parseTs } from '../../lib/api';
import { CardData } from './ProfileCard';

export interface DesktopProfileJson {
  statusText?: string;
  showStatus?: boolean;
  banner?: { type?: string; color?: string; gradient?: unknown };
  [key: string]: unknown;
}

export function parseProfileJson(raw: string | undefined | null): DesktopProfileJson {
  try {
    const v = JSON.parse(raw || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

const HEX = /^#[0-9a-f]{6}$/i;

export function bannerColorOf(pj: DesktopProfileJson, accent: string): string {
  const c = pj.banner?.color;
  if (typeof c === 'string' && HEX.test(c)) return c;
  return HEX.test(accent) ? accent : 'var(--accent)';
}

export function statusOf(pj: DesktopProfileJson): string {
  return pj.showStatus !== false && typeof pj.statusText === 'string' ? pj.statusText.slice(0, 128) : '';
}

export function cardFromProfile(p: Profile, ext: ProfileExt, presence: Profile['presence']): CardData {
  const pj = parseProfileJson(p.profile_json);
  return {
    id: p.id,
    display_name: p.display_name,
    username: p.username,
    avatar_path: p.avatar_path,
    banner_path: p.banner_path,
    banner_color: bannerColorOf(pj, p.accent_color),
    pronouns: p.pronouns,
    status_text: statusOf(pj),
    presence,
    bio: p.bio,
    created_at: parseTs(p.created_at),
    badges: p.badges,
    badge: p.badge ?? null,
    connections: ext.connections,
    frame: ext.frame,
    effect: ext.effect,
    name_style: ext.name_style,
  };
}
