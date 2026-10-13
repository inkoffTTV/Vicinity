import { Ban, Clock, Copy, Link2, Loader2, MessageCircle, MoreHorizontal, Pencil, Phone, UserCheck, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { ApiError, api, Profile } from '../../lib/api';
import { useCall } from '../../lib/call';
import { copyText } from '../../lib/clipboard';
import { useStore } from '../../lib/store';
import { ConfirmDialog } from '../ConfirmDialog';
import { Icon } from '../Icon';
import { Popover } from '../Popover';

const errText = (e: unknown) => (e instanceof ApiError ? e.message : 'Ошибка');

/** Кнопки карточки профиля и меню «⋯» (макет «7 · Кнопки карточки профиля»):
 *  не в друзьях / заявка отправлена / входящая заявка / друзья / это я */
export function ProfileActions({ p, link, onChanged, onClose, onEdit }: { p: Profile; link?: string | null; onChanged: () => Promise<unknown>; onClose: () => void; onEdit: () => void }) {
  const toast = useStore((s) => s.toast);
  const openDmWith = useStore((s) => s.openDmWith);
  const refreshFriends = useStore((s) => s.refreshFriends);
  const callIdle = useCall((s) => s.phase === 'idle');
  const startCall = useCall((s) => s.start);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | 'unfriend' | 'block'>(null);
  const self = p.friendship_status === 'self';
  const status = p.friendship_status;

  const act = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      if (ok) toast(ok);
      await Promise.all([onChanged(), refreshFriends()]);
    } catch (e) {
      toast(errText(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  // Ссылка /u/<код> откроет профиль любому, кому её дали. Свою — берём с сервера; чужой профиль
  // можно переслать, только если он сам открыт по ссылке (по номеру профиль видят лишь знакомые)
  const canShare = self || !!link;
  const share = async () => {
    setMenu(null);
    try {
      const code = self ? await api.profileLink() : link!;
      const ok = await copyText(`${location.origin}/u/${code}`);
      toast(ok ? 'Ссылка на профиль скопирована' : 'Не удалось скопировать', ok ? 'info' : 'error');
    } catch (e) {
      toast(errText(e), 'error');
    }
  };
  const via = link ? { link } : undefined;
  const copyId = async () => {
    setMenu(null);
    toast((await copyText(String(p.id))) ? 'ID скопирован' : 'Не удалось скопировать');
  };

  const friendBtn = () => {
    if (self || p.blocked) return null;
    if (status === 'none' || status === 'declined')
      return (
        <button type="button" className="icon-btn pa-square" aria-label="Добавить в друзья" title="Добавить в друзья" disabled={!!busy} onClick={() => act('friend', () => api.friendRequest(p.id, via), 'Заявка отправлена')}>
          <Icon icon={busy === 'friend' ? Loader2 : UserPlus} size={18} className={busy === 'friend' ? 'spin-now' : ''} />
        </button>
      );
    if (status === 'pending_out')
      return (
        <button type="button" className="icon-btn pa-square pending" aria-label="Заявка отправлена — нажмите, чтобы отменить" title="Заявка отправлена — нажмите, чтобы отменить" disabled={!!busy} onClick={() => act('friend', () => api.friendRemove(p.id), 'Заявка отменена')}>
          <Icon icon={Clock} size={18} />
        </button>
      );
    if (status === 'friends')
      return (
        <button type="button" className="icon-btn pa-square friends" aria-label="Вы друзья — нажмите, чтобы удалить из друзей" title="Вы друзья" onClick={() => setConfirm('unfriend')}>
          <Icon icon={UserCheck} size={18} />
        </button>
      );
    return null;
  };

  return (
    <div className="pa">
      {status === 'pending_in' && !p.blocked && (
        <div className="pa-request">
          <span>Хочет добавить вас в друзья</span>
          <div className="pa-request-btns">
            <button type="button" className="btn primary small" disabled={!!busy} onClick={() => act('accept', () => api.friendRespond(p.id, true), 'Теперь вы друзья')}>
              Принять
            </button>
            <button type="button" className="btn small" disabled={!!busy} onClick={() => act('decline', () => api.friendRespond(p.id, false))}>
              Отклонить
            </button>
          </div>
        </div>
      )}
      <div className="pa-row">
        {self ? (
          <button type="button" className="btn primary pa-main" onClick={onEdit}>
            <Icon icon={Pencil} size={16} /> Редактировать
          </button>
        ) : p.blocked ? (
          <button type="button" className="btn pa-main" disabled={!!busy} onClick={() => act('unblock', () => api.unblock(p.id), 'Пользователь разблокирован')}>
            Разблокировать
          </button>
        ) : (
          <button type="button" className="btn primary pa-main" onClick={() => openDmWith(p.id, via)}>
            <Icon icon={MessageCircle} size={16} /> Сообщение
          </button>
        )}
        {friendBtn()}
        <button type="button" className={`icon-btn pa-square${menu ? ' open' : ''}`} aria-label="Ещё" aria-haspopup="menu" aria-expanded={!!menu} onClick={(e) => setMenu(menu ? null : e.currentTarget)}>
          <Icon icon={MoreHorizontal} size={18} />
        </button>
      </div>

      {menu && (
        <Popover anchor={menu} onClose={() => setMenu(null)} className="menu pa-menu" role="menu" label="Действия с профилем">
          {canShare && (
            <button role="menuitem" onClick={share}>
              <Icon icon={Link2} size={16} /> Поделиться профилем
            </button>
          )}
          {!self && status === 'friends' && !p.blocked && (
            <button
              role="menuitem"
              disabled={!callIdle}
              onClick={() => {
                setMenu(null);
                onClose();
                void startCall(p.id, p.display_name);
              }}
            >
              <Icon icon={Phone} size={16} /> Позвонить
            </button>
          )}
          <button role="menuitem" onClick={copyId}>
            <Icon icon={Copy} size={16} /> Копировать ID
          </button>
          {!self && (
            <>
              <div className="menu-sep" role="separator" />
              {p.blocked ? (
                <button role="menuitem" onClick={() => { setMenu(null); void act('unblock', () => api.unblock(p.id), 'Пользователь разблокирован'); }}>
                  <Icon icon={Ban} size={16} /> Разблокировать
                </button>
              ) : (
                <button role="menuitem" className="danger" onClick={() => { setMenu(null); setConfirm('block'); }}>
                  <Icon icon={Ban} size={16} /> Заблокировать
                </button>
              )}
            </>
          )}
        </Popover>
      )}

      {confirm === 'unfriend' && (
        <ConfirmDialog title={`Удалить ${p.display_name} из друзей?`} action="Удалить" danger onClose={() => setConfirm(null)} onConfirm={async () => { await act('unfriend', () => api.friendRemove(p.id), 'Удалён из друзей'); setConfirm(null); }}>
          Переписка останется, но звонить друг другу без лички вы не сможете.
        </ConfirmDialog>
      )}
      {confirm === 'block' && (
        <ConfirmDialog title={`Заблокировать ${p.display_name}?`} action="Заблокировать" danger onClose={() => setConfirm(null)} onConfirm={async () => { await act('block', () => api.block(p.id), 'Пользователь заблокирован'); setConfirm(null); }}>
          Вы не сможете писать друг другу в личку и звонить, заявки в друзья не придут. Дружба будет удалена. Разблокировать можно здесь же.
        </ConfirmDialog>
      )}
    </div>
  );
}
