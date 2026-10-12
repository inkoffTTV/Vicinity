import { Copy, MessageCircle, Phone, UserPlus, UserRound } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useCall } from '../lib/call';
import { copyText } from '../lib/clipboard';
import { userName, useStore } from '../lib/store';
import { useUserMenu } from '../lib/userMenu';
import { useUserDirectory } from '../lib/users';
import { Icon } from './Icon';
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
        <Icon icon={UserRound} size={16} />
        Профиль
      </button>
      {!self && (
        <>
          <button role="menuitem" onClick={run(() => store.openDmWith(userId))}>
            <Icon icon={MessageCircle} size={16} />
            Написать
          </button>
          <button
            role="menuitem"
            disabled={!callIdle}
            onClick={run(() => useCall.getState().start(userId, directory.byId.get(userId)?.display_name ?? userName(userId)))}
          >
            <Icon icon={Phone} size={16} anim="ring" />
            Позвонить
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
              <Icon icon={UserPlus} size={16} />
              {incoming ? 'Принять заявку в друзья' : 'Добавить в друзья'}
            </button>
          )}
        </>
      )}
      <button
        role="menuitem"
        onClick={run(async () => store.toast((await copyText(String(userId))) ? `ID ${userId} скопирован` : 'Не удалось скопировать'))}
      >
        <Icon icon={Copy} size={16} />
        Копировать ID
      </button>
    </Popover>
  );
}
