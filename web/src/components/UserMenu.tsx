import { api, ApiError } from '../lib/api';
import { useCall } from '../lib/call';
import { copyText } from '../lib/clipboard';
import { userName, useStore } from '../lib/store';
import { useUserMenu } from '../lib/userMenu';
import { useUserDirectory } from '../lib/users';
import { Popover } from './Popover';

/** Меню пользователя по правой кнопке / долгому нажатию: профиль, написать, позвонить, в друзья, id */
export function UserMenu() {
  const at = useUserMenu((s) => s.at);
  const close = useUserMenu((s) => s.close);
  const meId = useStore((s) => s.me?.user_id);
  const friend = useStore((s) => (at ? s.friends.some((f) => f.id === at.userId) : false));
  const incoming = useStore((s) => (at ? s.incoming.some((f) => f.id === at.userId) : false));
  const outgoing = useStore((s) => (at ? s.outgoing.some((f) => f.id === at.userId) : false));
  const callIdle = useCall((s) => s.phase === 'idle');
  const directory = useUserDirectory();
  if (!at) return null;
  const { userId } = at;
  const self = userId === meId;

  const run = (fn: () => unknown) => () => {
    close();
    void fn();
  };
  const store = useStore.getState();
  const friendAction = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      store.toast(ok);
      await store.refreshFriends();
    } catch (e) {
      store.toast(e instanceof ApiError ? e.message : 'Ошибка', 'error');
    }
  };

  return (
    <Popover point={at.point} onClose={close} className="menu" role="menu" label="Действия с пользователем">
      <button role="menuitem" onClick={run(() => store.showProfile(userId))}>
        👤 Профиль
      </button>
      {!self && (
        <>
          <button role="menuitem" onClick={run(() => store.openDmWith(userId))}>
            💬 Написать
          </button>
          <button
            role="menuitem"
            disabled={!callIdle}
            onClick={run(() => useCall.getState().start(userId, directory.byId.get(userId)?.display_name ?? userName(userId)))}
          >
            📞 Позвонить
          </button>
          {!friend && !outgoing && (
            <button
              role="menuitem"
              onClick={run(() =>
                incoming
                  ? friendAction(() => api.friendRespond(userId, true), 'Заявка в друзья принята')
                  : friendAction(() => api.friendRequest(userId), 'Заявка в друзья отправлена'),
              )}
            >
              ➕ {incoming ? 'Принять заявку в друзья' : 'Добавить в друзья'}
            </button>
          )}
        </>
      )}
      <button
        role="menuitem"
        onClick={run(async () => store.toast((await copyText(String(userId))) ? `ID ${userId} скопирован` : 'Не удалось скопировать'))}
      >
        📋 Копировать ID
      </button>
    </Popover>
  );
}
