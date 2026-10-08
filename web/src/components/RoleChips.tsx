import { CSSProperties } from 'react';

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
