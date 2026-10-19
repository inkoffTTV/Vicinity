// Режим «Активность» в звонке Vicinity: игра открыта во фрейме /activities/pereprava/ мессенджера.
// Мост — тот же протокол, что web/public/activities/net.js: postMessage с мессенджером, а он
// пересылает наши сообщения остальным участникам звонка. Через мост ходит только код комнаты:
// сам матч идёт через обычный игровой сервер (WebSocket ./ws).

export interface ActivityPeer {
  peerId: number;
  userId: number;
  name: string;
}

type Msg = { pp?: string; code?: string };

const inFrame = (() => {
  try {
    return window.parent !== window && location.pathname.includes('/activities/');
  } catch {
    return false;
  }
})();

export class ActivityBridge {
  self: ActivityPeer | null = null;
  peers: ActivityPeer[] = [];
  onInit?: () => void;
  onJoin?: (p: ActivityPeer) => void;
  onRoomCode?: (code: string) => void;

  static readonly active = inFrame;

  constructor() {
    window.addEventListener('message', (e) => {
      if (e.source !== window.parent) return;
      const m = e.data as {
        type?: string;
        self?: ActivityPeer;
        peers?: ActivityPeer[];
        peer?: ActivityPeer;
        data?: Msg;
      } | null;
      if (!m || typeof m !== 'object') return;
      if (m.type === 'init' && m.self) {
        this.self = m.self;
        this.peers = Array.isArray(m.peers) ? m.peers : [];
        this.onInit?.();
      } else if (m.type === 'peer_join' && m.peer) {
        const peer = m.peer;
        this.peers = this.peers.filter((p) => p.peerId !== peer.peerId).concat(peer);
        this.onJoin?.(peer);
      } else if (m.type === 'peer_leave' && m.peer) {
        const peer = m.peer;
        this.peers = this.peers.filter((p) => p.peerId !== peer.peerId);
      } else if (m.type === 'msg' && m.data && m.data.pp === 'room' && typeof m.data.code === 'string') {
        this.onRoomCode?.(m.data.code.toUpperCase());
      }
    });
    window.parent.postMessage({ type: 'ready' }, '*');
  }

  /** Ведущий — тот, кто вошёл в игру раньше всех (меньший номер подключения) */
  isHost(): boolean {
    if (!this.self) return false;
    return this.peers.every((p) => p.peerId > this.self!.peerId);
  }

  /** Сколько человек сейчас в игре вместе со мной */
  count(): number {
    return (this.self ? 1 : 0) + this.peers.length;
  }

  shareRoom(code: string, to?: number) {
    window.parent.postMessage({ type: 'send', data: { pp: 'room', code }, to }, '*');
  }
}
