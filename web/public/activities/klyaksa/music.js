// Клякса: музыка этажей — короткие петли из Web Audio (как остальные звуки игры), без файлов.
// У каждого этажа свой лад и мотив, в комнате босса — быстрее и тревожнее. M выключает всё.
'use strict';
const MUSIC = (() => {
  // ноты: полутоны от ля первой октавы (220 Гц)
  const hz = (n) => 220 * Math.pow(2, n / 12);
  const SONGS = [
    // Подвал тетрадки — спокойный минор
    { bpm: 96, bass: [0, -1, 0, -1, -4, -1, -5, -1, 0, -1, 0, -1, 3, -1, -2, -1], lead: [12, -1, 15, -1, 19, 17, 15, -1, 12, -1, 10, 12, 15, -1, -1, -1] },
    // Глубины пенала — пружинистый
    { bpm: 108, bass: [-3, -1, -3, 4, -1, -3, 2, -1, -5, -1, -5, 2, -1, -5, 0, -1], lead: [9, 12, -1, 16, 14, -1, 12, 9, 7, -1, 9, -1, 12, -1, 14, -1] },
    // Дно портфеля — тянущийся
    { bpm: 88, bass: [-7, -1, -1, -1, -5, -1, -1, -1, -3, -1, -1, -1, -5, -1, -2, -1], lead: [5, -1, 8, -1, 12, -1, 10, 8, 7, -1, -1, 5, 3, -1, -1, -1] },
    // Учительская — строгий марш
    { bpm: 116, bass: [0, -1, 7, -1, 0, -1, 7, -1, -2, -1, 5, -1, -2, -1, 5, -1], lead: [12, 12, -1, 15, -1, 14, 12, -1, 10, 10, -1, 14, -1, 12, 10, -1] },
    // Архив двоек — пыльный вальс
    { bpm: 100, bass: [-5, -1, -1, 2, -1, -1, -3, -1, -1, 4, -1, -1, -5, -1, -1, -1], lead: [7, -1, 10, 14, -1, 12, 10, -1, 9, 7, -1, -1, 5, -1, 7, -1] },
  ];
  const BOSS = { bpm: 138, bass: [-12, -12, -1, -12, -11, -1, -12, -1, -12, -12, -1, -9, -10, -1, -11, -1], lead: [0, -1, 3, -1, 6, -1, 3, 2, 0, -1, 3, -1, 7, 6, 3, -1] };
  let step = 0, nextAt = 0, cur = null, timer = 0;

  function note(a, f, t, d, type, vol) {
    const o = a.createOscillator(), g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g);
    g.connect(a.destination);
    o.start(t);
    o.stop(t + d + 0.05);
  }

  /** Вызывается каждый кадр: подкладывает ноты на 0,2 с вперёд */
  function tick(song) {
    if (!AC || muted || !song) {
      cur = null;
      return;
    }
    const a = AC;
    if (a.state !== 'running') return;
    if (cur !== song) {
      cur = song;
      step = 0;
      nextAt = a.currentTime + 0.05;
    }
    const dt = 60 / song.bpm / 2; // восьмые
    while (nextAt < a.currentTime + 0.2) {
      const b = song.bass[step % 16], l = song.lead[step % 16];
      if (b !== -1) note(a, hz(b - 12), nextAt, dt * 0.9, 'triangle', 0.035);
      if (l !== -1) note(a, hz(l), nextAt, dt * 0.8, 'square', 0.011);
      step++;
      nextAt += dt;
    }
  }
  return {
    /** Песня для этажа; в комнате босса — тревожная */
    song: (level, boss) => (boss ? BOSS : SONGS[(level - 1) % SONGS.length]),
    tick,
  };
})();
