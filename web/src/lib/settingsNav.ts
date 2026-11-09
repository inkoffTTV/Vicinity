// Открыть настройки сразу на нужном разделе (например, «Боты» из каталога ботов)
import { useStore } from './store';

let pending: string | null = null;

export function openSettingsAt(tab: string) {
  pending = tab;
  useStore.getState().setSettingsOpen(true);
}

/** Раздел, с которого открыть настройки (один раз); null — как обычно */
export function takeSettingsTab(): string | null {
  const t = pending;
  pending = null;
  return t;
}
