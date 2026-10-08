// Что даёт подписка этого аккаунта (GET /subscription): качество демонстрации экрана и камеры,
// лимиты файлов и серверов. Сервер проверяет лимиты сам; клиент знает их, чтобы сразу подсказать.
import { create } from 'zustand';
import { Plan, api } from './api';

/** Бесплатный уровень — пока ответ не пришёл или сервер старый */
export const FREE_PLAN: Plan = {
  tier: 0,
  name: 'Бесплатно',
  files_mb: 15,
  screen: { height: 1080, fps: 30 },
  camera_height: 720,
  servers: 10,
  bio: 190,
  animated_banner: false,
  color_themes: false,
  custom_theme: false,
  name_color: false,
  gradient_name: false,
};

export const usePlan = create<{ current: Plan; plans: Plan[] }>(() => ({ current: FREE_PLAN, plans: [] }));

export async function loadPlan() {
  try {
    const r = await api.subscription();
    usePlan.setState({ current: r.current, plans: r.plans });
  } catch {
    usePlan.setState({ current: FREE_PLAN, plans: [] });
  }
}
