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

export function Icon({ icon: Glyph, anim, size = 20, strokeWidth = 2, className, ...rest }: Props) {
  return (
    <Glyph
      aria-hidden="true"
      focusable="false"
      size={size}
      strokeWidth={strokeWidth}
      className={`ico${anim ? ` anim-${anim}` : ''}${className ? ` ${className}` : ''}`}
      {...rest}
    />
  );
}
