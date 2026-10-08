import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useChannelMembers } from '../lib/channelMembers';
import { useStore } from '../lib/store';
import { userMenuProps } from '../lib/userMenu';
import { AddMemberDialog } from './AddMemberDialog';
import { Avatar } from './Avatar';
import { ConfirmDialog } from './ConfirmDialog';
import { Modal } from './Modal';

/** Панель беседы справа: участники, добавить, переименовать, покинуть, удалить (владелец) */
export function GroupPanel({ channelId }: { channelId: number }) {
  const group = useStore((s) => s.groups.find((g) => g.id === channelId));
  const meId = useStore((s) => s.me?.user_id);
  const presence = useStore((s) => s.presence);
  const showProfile = useStore((s) => s.showProfile);
  const leaveGroup = useStore((s) => s.leaveGroup);
  const deleteChannel = useStore((s) => s.deleteChannel);
  const toast = useStore((s) => s.toast);
  const members = useChannelMembers((s) => s.byChannel[channelId]);
  const [dialog, setDialog] = useState<'add' | 'rename' | 'leave' | 'delete' | null>(null);
  const close = useCallback(() => setDialog(null), []);

  useEffect(() => {
    void useChannelMembers.getState().load(channelId);
  }, [channelId]);

  if (!group) return null;
  // Владелец — из состава (он меняется, когда владелец уходит), пока состав грузится — из списка бесед
  const ownerId = members?.find((m) => m.is_owner)?.id ?? group.owner_id;
  const amOwner = ownerId !== undefined && ownerId === meId;
  const isOnline = (id: number, fallback?: string) => {
    const p = presence[id] ?? fallback;
    return !!p && p !== 'offline' && p !== 'invisible';
  };

  return (
    <aside className="members group-panel" aria-label="Участники беседы">
      <div className="group-panel-head">
        <strong className="ellipsis grow" title={group.name}>
          {group.name}
        </strong>
        <button className="icon-btn small" title="Переименовать беседу" aria-label="Переименовать беседу" onClick={() => setDialog('rename')}>
          ✏️
        </button>
      </div>
      <button className="btn small block" onClick={() => setDialog('add')}>
        ➕ Пригласить в беседу
      </button>
      <div className="side-section">Участники{members ? ` — ${members.length}` : ''}</div>
      {!members && <div className="side-empty">Загрузка…</div>}
      {members?.map((m) => {
        const online = isOnline(m.id, m.presence);
        return (
          <div key={m.id} className={`member${online ? '' : ' dim'}`}>
            <button className="plain member-main" onClick={() => showProfile(m.id)} {...userMenuProps(m.id)}>
              <Avatar name={m.display_name} src={m.avatar_path} id={m.id} size={32} presence={presence[m.id] ?? m.presence ?? 'offline'} />
              <span className="ellipsis">{m.display_name}</span>
              {m.is_owner && <span title="Владелец беседы">👑</span>}
            </button>
          </div>
        );
      })}
      <div className="group-panel-actions">
        <button className="btn small block" onClick={() => setDialog('leave')}>
          🚪 Покинуть беседу
        </button>
        {amOwner && (
          <button className="btn small block danger" onClick={() => setDialog('delete')}>
            Удалить беседу
          </button>
        )}
      </div>

      {dialog === 'add' && <AddMemberDialog target={{ kind: 'group', channelId }} onClose={close} />}
      {dialog === 'rename' && <RenameGroup channelId={channelId} name={group.name} onClose={close} />}
      {dialog === 'leave' && (
        <ConfirmDialog
          title="Покинуть беседу"
          action="Покинуть"
          danger
          onClose={close}
          onConfirm={async () => {
            const name = group.name;
            if (await leaveGroup(channelId)) toast(`Вы покинули беседу «${name}»`);
          }}
        >
          {amOwner && (members?.length ?? 0) > 1
            ? `Владельцем беседы «${group.name}» станет участник, который в ней дольше всех.`
            : `Покинуть беседу «${group.name}»? Вернуться можно, только если вас добавят снова.`}
        </ConfirmDialog>
      )}
      {dialog === 'delete' && (
        <ConfirmDialog
          title="Удалить беседу"
          action="Удалить"
          danger
          onClose={close}
          onConfirm={async () => {
            const name = group.name;
            if (await deleteChannel(channelId)) toast(`Беседа «${name}» удалена`);
          }}
        >
          Беседа «{group.name}» и вся её история будут удалены у всех участников. Это нельзя отменить.
        </ConfirmDialog>
      )}
    </aside>
  );
}

function RenameGroup({ channelId, name: initial, onClose }: { channelId: number; name: string; onClose: () => void }) {
  const renameChannel = useStore((s) => s.renameChannel);
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !name.trim()) return;
    if (name.trim() === initial) return onClose();
    setBusy(true);
    if (await renameChannel(channelId, name.trim())) onClose();
    else setBusy(false);
  };
  return (
    <Modal title="Переименовать беседу" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label>
          Название
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={64} />
        </label>
        <button className="btn primary" disabled={busy || !name.trim()}>
          Сохранить
        </button>
      </form>
    </Modal>
  );
}
