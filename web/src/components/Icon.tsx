// Единые иконки интерфейса (lucide, SVG) вместо эмодзи на кнопках управления.
// Анимации — в styles.css (блок «Иконки»): .ico реагирует на hover/active кнопки-родителя,
// модификаторы anim-* дают характерное движение (покачивание трубки, поворот шестерёнки и т.п.).
import type { LucideIcon, LucideProps } from 'lucide-react';

export type IconAnim = 'spin' | 'ring' | 'pulse' | 'pop' | 'wiggle' | 'bounce' | 'live';

interface Props extends Omit<LucideProps, 'ref'> {
  icon: LucideIcon;
  /** Характерная анимация (по наведению на кнопку или постоянная — см. styles.css) */
  anim?: IconAnim;
}

// Обводка по дизайн-системе — 1.75 (design/README.md, «Иконки»); совсем мелкие значки чуть жирнее, иначе тают
export function Icon({ icon: Glyph, anim, size = 20, strokeWidth, className, ...rest }: Props) {
  const n = typeof size === 'number' ? size : 20;
  return (
    <Glyph
      aria-hidden="true"
      focusable="false"
      size={size}
      strokeWidth={strokeWidth ?? (n <= 14 ? 2 : 1.75)}
      className={`ico${anim ? ` anim-${anim}` : ''}${className ? ` ${className}` : ''}`}
      {...rest}
    />
  );
}
