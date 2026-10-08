import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError, BannedUser, Member } from '../lib/api';
import { copyText } from '../lib/clipboard';
import { inviteLink } from '../lib/routes';
import { useStore } from '../lib/store';
import { Avatar } from './Avatar';
import { ConfirmDialog } from './ConfirmDialog';
import { Modal } from './Modal';
import { RoleChips } from './RoleChips';
import { ServerIcon } from './ServerRail';

export type ServerTab = 'overview' | 'invites' | 'members' | 'bans' | 'danger';

const errText = (e: unknown) => (e instanceof ApiError ? e.message : 'Ошибка');

/** Настройки сервера: владельцу — всё, участнику — приглашения и выход */
export function ServerSettings({ serverId, tab: initial, onClose }: { serverId: number; tab: ServerTab; onClose: () => void }) {
  const server = useStore((s) => s.servers.find((x) => x.id === serverId));
  const amOwner = useStore((s) => !!server && s.me?.user_id === server.owner_id);
  const [tab, setTab] = useState<ServerTab>(initial);

  // Сервер удалили или нас с него убрали — окно закрывается само
  useEffect(() => {
    if (!server) onClose();
  }, [server, onClose]);
  if (!server) return null;

  const tabs: [ServerTab, string][] = amOwner
    ? [
        ['overview', 'Обзор'],
        ['invites', 'Приглашения'],
        ['members', 'Участники'],
        ['bans', 'Баны'],
        ['danger', 'Удаление сервера'],
      ]
    : [
        ['invites', 'Приглашения'],
        ['danger', 'Покинуть сервер'],
      ];
  const current = tabs.some(([t]) => t === tab) ? tab : tabs[0][0];

  return (
    <Modal title={`Сервер «${server.name}»`} onClose={onClose} className="settings-modal">
      <div className="settings-layout">
        <div className="settings-tabs" role="tablist" aria-label="Разделы настроек сервера">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              role="tab"
              id={`server-tab-${id}`}
              aria-selected={current === id}
              aria-controls="server-panel"
              className={`${current === id ? 'on' : ''}${id === 'danger' ? ' danger-tab' : ''}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="settings-panel" role="tabpanel" id="server-panel" aria-labelledby={`server-tab-${current}`}>
          {current === 'overview' && <Overview serverId={serverId} />}
          {current === 'invites' && <Invites serverId={serverId} owner={amOwner} />}
          {current === 'members' && <Members serverId={serverId} />}
          {current === 'bans' && <Bans serverId={serverId} />}
          {current === 'danger' && <Danger serverId={serverId} owner={amOwner} onDone={onClose} />}
        </div>
      </div>
    </Modal>
  );
}

// ── Обзор: название и иконка ──

function Overview({ serverId }: { serverId: number }) {
  const server = useStore((s) => s.servers.find((x) => x.id === serverId))!;
  const patchServer = useStore((s) => s.patchServer);
  const toast = useStore((s) => s.toast);
  const [name, setName] = useState(server.name);
  const [busy, setBusy] = useState(false);

  const rename = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !name.trim() || name.trim() === server.name) return;
    setBusy(true);
    try {
      const r = await api.renameServer(serverId, name.trim());
      patchServer(serverId, { name: r.name, icon: r.icon });
      setName(r.name);
      toast('Название сервера изменено');
    } catch (err) {
      toast(errText(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file?: File) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return toast('Только PNG, JPG, GIF или WebP', 'error');
    setBusy(true);
    try {
      const r = await api.uploadServerIcon(serverId, file);
      patchServer(serverId, { name: r.name, icon: r.icon });
      toast('Иконка сервера обновлена');
    } catch (err) {
      toast(errText(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings">
      <div className="server-overview">
        <span className="server-overview-icon">
          <ServerIcon name={server.name} icon={server.icon} />
        </span>
        <div className="stack">
          <label className="btn small">
            {server.icon ? 'Сменить иконку…' : 'Загрузить иконку…'}
            <input
              type="file"
              hidden
              accept="image/png,image/jpeg,image/gif,image/webp"
              disabled={busy}
              onChange={(e) => {
                void upload(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
          <span className="muted small">PNG, JPG, GIF или WebP; лучше квадратная, от 128×128</span>
        </div>
      </div>
      <form className="stack" onSubmit={rename}>
        <label>
          Название сервера
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} required />
        </label>
        <div className="row end">
          <div className="grow" />
          <button className="btn primary" disabled={busy || !name.trim() || name.trim() === server.name}>
            Сохранить
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Приглашения ──

function Invites({ serverId, owner }: { serverId: number; owner: boolean }) {
  const code = useStore((s) => s.servers.find((x) => x.id === serverId)?.invite_code ?? '');
  const patchServer = useStore((s) => s.patchServer);
  const toast = useStore((s) => s.toast);
  const [confirming, setConfirming] = useState(false);
  const link = code ? inviteLink(code) : '';

  const copy = async (text: string, ok: string) => {
    if (await copyText(text)) toast(ok);
    else toast('Не удалось скопировать', 'error');
  };

  const regenerate = async () => {
    try {
      const r = await api.regenerateInvite(serverId);
      patchServer(serverId, { invite_code: r.invite_code });
      toast(`Новый код приглашения: ${r.invite_code}`);
    } catch (err) {
      toast(errText(err), 'error');
    }
    setConfirming(false);
  };

  if (!code) return <div className="muted">У этого сервера нет кода приглашения.</div>;

  return (
    <div className="settings">
      <p className="muted small no-margin">
        Отправьте ссылку другу: она откроет Vicinity и предложит вступить. Код можно ввести и вручную — в окне «+» слева.
      </p>
      <div className="invite-code" aria-label="Код приглашения">
        {code}
      </div>
      <div className="invite-link">
        <input readOnly value={link} aria-label="Ссылка-приглашение" onFocus={(e) => e.target.select()} />
        <button type="button" className="btn primary" onClick={() => copy(link, 'Ссылка-приглашение скопирована')}>
          Копировать ссылку
        </button>
      </div>
      <div className="stack-row wrap">
        <button type="button" className="btn small" onClick={() => copy(code, `Код ${code} скопирован`)}>
          Копировать код
        </button>
        {owner && (
          <button type="button" className="btn small" onClick={() => setConfirming(true)}>
            Создать новый код
          </button>
        )}
      </div>
      {confirming && (
        <ConfirmDialog title="Новый код приглашения" action="Создать новый код" onConfirm={regenerate} onClose={() => setConfirming(false)}>
          Старый код и ссылки с ним перестанут работать. Уже вступившие участники останутся на сервере.
        </ConfirmDialog>
      )}
    </div>
  );
}

// ── Участники: поиск, исключение, бан ──

function Members({ serverId }: { serverId: number }) {
  const members = useStore((s) => s.membersByServer[serverId]);
  const meId = useStore((s) => s.me?.user_id);
  const refreshServer = useStore((s) => s.refreshServer);
  const kickMember = useStore((s) => s.kickMember);
  const banMember = useStore((s) => s.banMember);
  const toast = useStore((s) => s.toast);
  const [q, setQ] = useState('');
  const [action, setAction] = useState<{ kind: 'kick' | 'ban'; member: Member } | null>(null);

  useEffect(() => {
    if (!members) void refreshServer(serverId);
  }, [members, refreshServer, serverId]);

  const query = q.trim().toLowerCase();
  const list = (members ?? []).filter(
    (m) => !query || m.display_name.toLowerCase().includes(query) || m.username.toLowerCase().includes(query),
  );

  const run = async () => {
    if (!action) return;
    const { kind, member } = action;
    if (kind === 'kick') {
      await kickMember(serverId, member.id);
      toast(`${member.display_name} исключён(а) с сервера`);
    } else if (await banMember(serverId, member.id)) toast(`${member.display_name} забанен(а)`);
    setAction(null);
  };

  return (
    <div className="settings">
      <input
        type="search"
        placeholder="Поиск участников"
        aria-label="Поиск участников"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="muted small">
        {members ? `Участников: ${members.length}` : 'Загрузка…'}
      </div>
      <ul className="manage-list">
        {list.map((m) => (
          <li key={m.id} className="manage-row">
            <Avatar name={m.display_name} src={m.avatar_path} id={m.id} size={32} />
            <div className="grow">
              <div className="ellipsis">
                {m.display_name} {m.is_owner && <span title="Владелец">👑</span>}
              </div>
              <div className="muted small ellipsis">@{m.username}</div>
              <RoleChips roles={m.roles} />
            </div>
            {!m.is_owner && m.id !== meId && (
              <div className="stack-row">
                <button type="button" className="btn small" onClick={() => setAction({ kind: 'kick', member: m })}>
                  Исключить
                </button>
                <button type="button" className="btn small danger" onClick={() => setAction({ kind: 'ban', member: m })}>
                  Забанить
                </button>
              </div>
            )}
          </li>
        ))}
        {members && list.length === 0 && <li className="muted">Никого не найдено</li>}
      </ul>
      {action && (
        <ConfirmDialog
          title={action.kind === 'kick' ? 'Исключить участника' : 'Забанить участника'}
          action={action.kind === 'kick' ? 'Исключить' : 'Забанить'}
          danger
          onConfirm={run}
          onClose={() => setAction(null)}
        >
          {action.kind === 'kick'
            ? `${action.member.display_name} будет исключён(а) с сервера, но сможет вернуться по приглашению.`
            : `${action.member.display_name} будет исключён(а) и не сможет вернуться, пока бан не снят.`}
        </ConfirmDialog>
      )}
    </div>
  );
}

// ── Баны ──

function Bans({ serverId }: { serverId: number }) {
  const toast = useStore((s) => s.toast);
  const [bans, setBans] = useState<BannedUser[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(
    () =>
      api.bans(serverId).then(
        (b) => (setBans(b), setError('')),
        (e) => setError(errText(e)),
      ),
    [serverId],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const unban = async (u: BannedUser) => {
    try {
      await api.unban(serverId, u.id);
      toast(`${u.display_name} разбанен(а)`);
    } catch (e) {
      toast(errText(e), 'error');
    }
    await load();
  };

  return (
    <div className="settings">
      {error && <div className="form-error">{error}</div>}
      {bans === null && !error && <div className="muted small">Загрузка…</div>}
      {bans?.length === 0 && <div className="muted">Забаненных нет</div>}
      <ul className="manage-list">
        {(bans ?? []).map((u) => (
          <li key={u.id} className="manage-row">
            <Avatar name={u.display_name} src={u.avatar_path} id={u.id} size={32} />
            <div className="grow">
              <div className="ellipsis">{u.display_name}</div>
              <div className="muted small ellipsis">@{u.username}</div>
            </div>
            <button type="button" className="btn small" onClick={() => unban(u)}>
              Разбанить
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Удаление сервера (владелец) или выход (участник) ──

function Danger({ serverId, owner, onDone }: { serverId: number; owner: boolean; onDone: () => void }) {
  const server = useStore((s) => s.servers.find((x) => x.id === serverId))!;
  const leaveServer = useStore((s) => s.leaveServer);
  const deleteServer = useStore((s) => s.deleteServer);
  const toast = useStore((s) => s.toast);
  const [confirming, setConfirming] = useState(false);

  const run = async () => {
    const name = server.name;
    if (owner ? await deleteServer(serverId) : await leaveServer(serverId)) {
      toast(owner ? `Сервер «${name}» удалён` : `Вы покинули сервер «${name}»`);
      onDone();
    }
  };

  return (
    <div className="settings">
      <section className="settings-card danger-card stack">
        <h3>{owner ? 'Удалить сервер' : 'Покинуть сервер'}</h3>
        <p className="muted small no-margin">
          {owner
            ? 'Сервер будет удалён вместе со всеми каналами, сообщениями и файлами. Это действие нельзя отменить.'
            : 'Вы перестанете видеть каналы сервера. Вернуться можно по приглашению.'}
        </p>
        <div className="row end">
          <button type="button" className="btn danger" onClick={() => setConfirming(true)}>
            {owner ? 'Удалить сервер' : 'Покинуть сервер'}
          </button>
        </div>
      </section>
      {confirming && (
        <ConfirmDialog
          title={owner ? 'Удалить сервер' : 'Покинуть сервер'}
          action={owner ? 'Удалить навсегда' : 'Покинуть'}
          danger
          typeToConfirm={owner ? server.name : undefined}
          onConfirm={run}
          onClose={() => setConfirming(false)}
        >
          {owner ? `Сервер «${server.name}» и вся его история будут удалены у всех участников.` : `Покинуть сервер «${server.name}»?`}
        </ConfirmDialog>
      )}
    </div>
  );
}
