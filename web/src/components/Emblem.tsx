import { EMBLEM_ICONS } from '../lib/awards';
import { Icon } from './Icon';

/** Эмблема за активность рядом с ником (lib/awards.ts); неизвестный id — ничего */
export function Emblem({ id, size = 14, title }: { id: string; size?: number; title?: string }) {
  const ico = EMBLEM_ICONS[id];
  if (!ico) return null;
  return (
    <span className={`emblem e-${id}`} title={title ?? 'Эмблема за активность'} aria-label={title ? `Титул: ${title}` : 'Эмблема'} role="img">
      <Icon icon={ico} size={size} />
    </span>
  );
}
