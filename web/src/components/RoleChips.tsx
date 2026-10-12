import { Crown } from 'lucide-react';
import { CSSProperties } from 'react';
import { Icon } from './Icon';

/** Корона владельца сервера или беседы рядом с именем */
export function OwnerCrown({ title = 'Владелец' }: { title?: string }) {
  return (
    <span className="owner-crown" title={title} role="img" aria-label={title}>
      <Icon icon={Crown} size={14} strokeWidth={2.25} />
    </span>
  );
}

/** Роли пользователя (как их отдаёт GET /servers/{id}/members) — цветные метки */
export function RoleChips({ roles }: { roles: { name: string; color: string }[] }) {
  if (!roles.length) return null;
  return (
    <span className="role-chips">
      {roles.map((r) => (
        <span key={r.name} className="role-chip" style={{ '--role': r.color || 'var(--text-3)' } as CSSProperties}>
          {r.name}
        </span>
      ))}
    </span>
  );
}
