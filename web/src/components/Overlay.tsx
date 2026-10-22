import { Mic, PhoneIncoming } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Message } from '../lib/api';
import { useCall } from '../lib/call';
import { mentionsUser, plainText } from '../lib/markdown';
import { useStore } from '../lib/store';
import { knownUser } from '../lib/users';
import { socket, WsEvent } from '../lib/ws';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { usePeerAvatar } from './CallOverlay';
import '../overlay.css';

// Оверлей для игр (маршрут /overlay): ПК-приложение открывает его прозрачным окном поверх всего
// и пропускает сквозь него клики. Показывает участников голосового канала с индикатором речи,
// входящий звонок и свежие сообщения. Это второе подключение того же аккаунта — свой голос здесь
// не захватывается, только состояние с сервера.

const TOAST_MS = 6000;

interface Note {
  id: number;
  msg: Message;
}

export function OverlayView() {
  const me = useStore((s) => s.me);
  // Канал, где мы сидим в голосе, виден по состоянию с сервера: в голос входит основное окно
  const users = useStore((s) => {
    if (!s.me) return undefined;
    for (const list of Object.values(s.voice)) if (list.some((u) => u.user_id === s.me!.user_id)) return list;
    return undefined;
  });
  const speaking = useStore((s) => s.speaking);
  const phase = useCall((s) => s.phase);
  const peerName = useCall((s) => s.peerName);
  const peerId = useCall((s) => s.peerId);
  const peerAvatar = usePeerAvatar(peerId);
  const [notes, setNotes] = useState<Note[]>([]);
  const connected = useStore((s) => s.connected);

  // Своё подключение открылось позже, чем основное окно вошло в голос, — спросить состояние канала
  useEffect(() => {
    if (connected) socket.send({ type: 'voice_query' });
  }, [connected]);

  useEffect(() => {
    document.documentElement.setAttribute('data-overlay', '');
    return () => document.documentElement.removeAttribute('data-overlay');
  }, []);

  // Чужие сообщения из личек и бесед — короткой плашкой
  useEffect(() => {
    let seq = 0;
    const off = socket.on((ev: WsEvent) => {
      if (ev.type !== 'new_message' || ev.author_id === me?.user_id) return;
      const s = useStore.getState();
      // Лички и беседы — всегда (новая личка может ещё не попасть в список), каналы серверов — только с @упоминанием
      const inServer = Object.values(s.channelsByServer).some((list) => list.some((c) => c.id === ev.channel_id));
      if (inServer && !(s.me && mentionsUser(String(ev.text ?? ''), s.me.username))) return;
      const id = ++seq;
      const msg: Message = {
        id: ev.id,
        channel_id: ev.channel_id,
        author_id: ev.author_id,
        author_name: ev.author_name,
        author_avatar: ev.author_avatar ?? '',
        text: ev.text ?? '',
        created_at: ev.created_at,
        edited: false,
        attachment: ev.attachment_url || ev.attachment || '',
        reactions: [],
        kind: ev.kind,
      };
      setNotes((list) => [...list.slice(-3), { id, msg }]);
      window.setTimeout(() => setNotes((list) => list.filter((n) => n.id !== id)), TOAST_MS);
    });
    return () => {
      off();
    };
  }, [me?.user_id]);

  const list = users ?? [];

  return (
    <div className="ov" aria-label="Оверлей Vicinity">
      {phase === 'incoming' && (
        <div className="ov-card ov-call" role="status">
          <Avatar name={peerName} src={peerAvatar} id={peerId} size={36} />
          <div className="grow ellipsis">
            <strong className="ellipsis">{peerName}</strong>
            <div className="ov-sub">
              <Icon icon={PhoneIncoming} size={13} anim="ring" className="always" /> Входящий звонок — ответьте в Vicinity
            </div>
          </div>
        </div>
      )}
      {list.length > 0 && (
        <div className="ov-card ov-voice" role="list" aria-label="В голосовом канале">
          {list.map((u) => (
            <div key={u.user_id} className={`ov-user${speaking[u.user_id] ? ' speaking' : ''}`} role="listitem">
              <Avatar name={u.name} src={knownUser(u.user_id)?.avatar_path} id={u.user_id} size={28} speaking={!!speaking[u.user_id]} />
              <span className="ellipsis">{u.name}</span>
              {speaking[u.user_id] && <Icon icon={Mic} size={13} className="ov-flag on" />}
            </div>
          ))}
        </div>
      )}
      {notes.map((n) => (
        <div key={n.id} className="ov-card ov-note" role="status">
          <Avatar name={n.msg.author_name} src={n.msg.author_avatar} id={n.msg.author_id} size={28} />
          <div className="grow ellipsis">
            <strong className="ellipsis">{n.msg.author_name}</strong>
            <div className="ov-sub ellipsis">
              {n.msg.kind === 'voice' ? 'Голосовое сообщение' : plainText(n.msg.text) || (n.msg.attachment ? 'Вложение' : '')}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
