// «Написать администратору»: личка с владельцем инстанса.
// Логин администратора задаётся при сборке: VITE_ADMIN_USERNAME (по умолчанию inkoff).
import { api, ApiError } from './api';
import { useStore } from './store';

export const ADMIN_USERNAME = (import.meta.env.VITE_ADMIN_USERNAME ?? '').trim().replace(/^@/, '') || 'inkoff';

const same = (a: string | undefined, b: string) => !!a && a.toLowerCase() === b.toLowerCase();

/** Текущий пользователь сам администратор — кнопка ему не нужна */
export const isAdminUsername = (username: string | undefined) => same(username, ADMIN_USERNAME);

let pending = false;

/** Открыть личку с администратором: уже открытая — сразу, иначе поиск по точному логину и обычное открытие лички */
export async function openAdminDm(): Promise<boolean> {
  const st = useStore.getState();
  const existing = st.dms.find((d) => same(d.username, ADMIN_USERNAME));
  if (existing) {
    st.open({ kind: 'dm', channelId: existing.channel_id });
    return true;
  }
  if (pending) return false;
  pending = true;
  try {
    const users = await api.searchUsers(ADMIN_USERNAME);
    const admin = users.find((u) => same(u.username, ADMIN_USERNAME));
    if (!admin) {
      st.toast(`Аккаунт администратора @${ADMIN_USERNAME} не найден`, 'error');
      return false;
    }
    await useStore.getState().openDmWith(admin.id, { username: ADMIN_USERNAME });
    return true;
  } catch (e) {
    st.toast(`Не удалось связаться с администратором: ${e instanceof ApiError ? e.message : 'нет связи с сервером'}`, 'error');
    return false;
  } finally {
    pending = false;
  }
}
