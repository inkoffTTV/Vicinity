// Связь игры с Vicinity (web/src/components/Activities.tsx → ActivityFrame).
// Игра открыта в изолированном фрейме: аккаунта она не видит, говорит с мессенджером через postMessage,
// а мессенджер пересылает её сообщения остальным игрокам через сервер.
//   Net.on('init')            — известны я (Net.self) и остальные (Net.peers)
//   Net.on('join'|'leave', p) — игрок пришёл или ушёл
//   Net.on('msg', data, from) — сообщение от игрока с номером from
//   Net.send(data, to?)       — отправить всем остальным (или одному)
(function () {
  'use strict';
  const listeners = {};
  const emit = (type, ...args) =>
    (listeners[type] || []).forEach((fn) => {
      try {
        fn(...args);
      } catch (e) {
        console.error(e);
      }
    });
  const Net = {
    self: null,
    peers: [],
    inFrame: window.parent !== window,
    on(type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    send(data, to) {
      if (Net.inFrame && Net.self) window.parent.postMessage({ type: 'send', data, to }, '*');
    },
    exit() {
      if (Net.inFrame) window.parent.postMessage({ type: 'exit' }, '*');
    },
    /** Все игроки по порядку входа (номер подключения растёт) */
    all() {
      return [Net.self, ...Net.peers].filter(Boolean).sort((a, b) => a.peerId - b.peerId);
    },
    /** Ведущий — тот, кто вошёл раньше всех */
    isHost() {
      const all = Net.all();
      return !!Net.self && all.length > 0 && all[0].peerId === Net.self.peerId;
    },
    peer(id) {
      return Net.all().find((p) => p.peerId === id) || null;
    },
  };
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent) return;
    const m = e.data;
    if (!m || typeof m !== 'object') return;
    if (m.type === 'init') {
      const same = Net.self && m.self && Net.self.peerId === m.self.peerId;
      Net.self = m.self;
      Net.peers = Array.isArray(m.peers) ? m.peers : [];
      if (!same) emit('init');
    } else if (m.type === 'peer_join' && m.peer) {
      Net.peers = Net.peers.filter((p) => p.peerId !== m.peer.peerId).concat(m.peer);
      emit('join', m.peer);
    } else if (m.type === 'peer_leave' && m.peer) {
      Net.peers = Net.peers.filter((p) => p.peerId !== m.peer.peerId);
      emit('leave', m.peer);
    } else if (m.type === 'msg') {
      emit('msg', m.data, m.from);
    }
  });
  window.Net = Net;
  if (Net.inFrame) window.parent.postMessage({ type: 'ready' }, '*');
})();
