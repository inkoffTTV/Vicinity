// Хук-дуэль: двое мясников на берегах ледяной речки. WASD — ходить, курсор — прицел, Q/ЛКМ — хук,
// E — фаза (как Phase Shift у Пака): на секунду исчезаешь, хук пролетает насквозь.
// Три заряда хука, каждый перезаряжается. Попадание тянет соперника через речку и снимает половину
// здоровья; два попадания — очко. До 5 очков.
// Сеть (../net.js): каждый ведёт своего мясника и свой хук и 20 раз в секунду рассылает состояние;
// попадание определяет бросивший («hit»), а пойманный сам себя тянет и сообщает о смерти («died»).
(() => {
  'use strict';
  const W = 1000, H = 600, RIVER_X = W / 2, RIVER_W = 84;
  const MIN_Y = 70, MAX_Y = H - 56;
  const SIDES = {
    left: { minX: 46, maxX: RIVER_X - RIVER_W / 2 - 30, spawnX: 180 },
    right: { minX: RIVER_X + RIVER_W / 2 + 30, maxX: W - 46, spawnX: W - 180 },
  };
  const R = 28, SPEED = 235, HOOK_SPEED = 1180, HOOK_RANGE = 620, HOOK_R = 15, PULL_SPEED = 980;
  const CHARGES = 3, RECHARGE = 2.6, DMG = 50, CAST = 0.12, WIN = 5, SEND_EVERY = 0.05, INTERP = 0.1;
  const PHASE = 1.0, PHASE_CD = 6;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const other = (s) => (s === 'left' ? 'right' : 'left');

  /* ───────── холст ───────── */
  const cv = document.getElementById('c');
  const ctx = cv.getContext('2d');
  let scale = 1, dpr = 1;
  function fit() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    scale = Math.min((innerWidth - 24) / W, (innerHeight - 44) / H);
    scale = Math.max(0.3, scale);
    cv.style.width = Math.round(W * scale) + 'px';
    cv.style.height = Math.round(H * scale) + 'px';
    cv.width = Math.round(W * scale * dpr);
    cv.height = Math.round(H * scale * dpr);
  }
  addEventListener('resize', fit);
  fit();

  /* ───────── звук ───────── */
  let AC = null, muted = false;
  function actx() {
    if (!AC) {
      try {
        AC = new (window.AudioContext || window.webkitAudioContext)();
      } catch {
        AC = null;
      }
    }
    if (AC && AC.state === 'suspended') AC.resume().catch(() => {});
    return AC;
  }
  function tone(f, d, type, vol, slide, delay) {
    const a = actx();
    if (!a || muted) return;
    const t0 = a.currentTime + (delay || 0), o = a.createOscillator(), g = a.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(f, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t0 + d);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.04, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    o.connect(g);
    g.connect(a.destination);
    o.start(t0);
    o.stop(t0 + d + 0.05);
  }
  function noise(d, vol, freq) {
    const a = actx();
    if (!a || muted) return;
    const n = Math.max(1, Math.floor(a.sampleRate * d)), b = a.createBuffer(1, n, a.sampleRate), ch = b.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    s.buffer = b;
    f.type = 'lowpass';
    f.frequency.value = freq || 1200;
    g.gain.value = vol || 0.08;
    s.connect(f);
    f.connect(g);
    g.connect(a.destination);
    s.start();
  }
  const sfx = {
    throw: () => {
      noise(0.18, 0.06, 2400);
      tone(380, 0.16, 'sawtooth', 0.02, 260);
    },
    chain: () => tone(1500 + Math.random() * 400, 0.03, 'square', 0.008),
    hit: () => {
      noise(0.16, 0.14, 700);
      tone(120, 0.22, 'square', 0.05, -60);
    },
    clash: () => {
      tone(1900, 0.12, 'triangle', 0.05, -400);
      tone(2600, 0.08, 'square', 0.02, -900, 0.02);
    },
    land: () => noise(0.25, 0.12, 400),
    die: () => {
      noise(0.5, 0.14, 500);
      tone(160, 0.5, 'sawtooth', 0.05, -110);
    },
    point: () => [523, 659, 784].forEach((f, i) => tone(f, 0.12, 'square', 0.03, 0, i * 0.08)),
    win: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.14, 'square', 0.035, 0, i * 0.09)),
    lose: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.18, 'triangle', 0.05, 0, i * 0.1)),
    charge: () => tone(880, 0.06, 'triangle', 0.02, 220),
    phase: () => {
      tone(620, 0.35, 'sine', 0.05, 900);
      tone(1240, 0.3, 'triangle', 0.02, 1400, 0.05);
    },
    unphase: () => tone(1500, 0.18, 'sine', 0.03, -900),
  };

  /* ───────── фон: снег, ёлки, лёд ───────── */
  function mk(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  const BG = (() => {
    const c = mk(W * 2, H * 2), g = c.getContext('2d');
    g.scale(2, 2);
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, '#dfe8f3');
    grd.addColorStop(1, '#c9d6e8');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    // искры снега и вмятины
    for (let i = 0; i < 1600; i++) {
      g.fillStyle = Math.random() < 0.55 ? 'rgba(255,255,255,0.8)' : 'rgba(160,180,210,0.35)';
      g.fillRect(Math.random() * W, Math.random() * H, rnd(1, 2.5), rnd(1, 2));
    }
    for (let i = 0; i < 40; i++) {
      const x = Math.random() * W, y = rnd(70, H - 50);
      if (Math.abs(x - RIVER_X) < RIVER_W) continue;
      g.fillStyle = 'rgba(120,145,185,0.12)';
      g.beginPath();
      g.ellipse(x, y, rnd(18, 50), rnd(6, 14), rnd(-0.3, 0.3), 0, TAU);
      g.fill();
    }
    // сугробы у реки
    for (const s of [-1, 1]) {
      const bx = RIVER_X + s * (RIVER_W / 2 + 6);
      g.fillStyle = '#f4f8fd';
      g.beginPath();
      g.moveTo(bx, 0);
      for (let y = 0; y <= H; y += 20) g.lineTo(bx + s * (8 + Math.sin(y * 0.05) * 5 + Math.sin(y * 0.13) * 3), y);
      g.lineTo(bx - s * 12, H);
      g.lineTo(bx - s * 12, 0);
      g.fill();
      g.strokeStyle = 'rgba(110,140,185,0.35)';
      g.lineWidth = 2;
      g.beginPath();
      for (let y = 0; y <= H; y += 20) g.lineTo(bx + s * (8 + Math.sin(y * 0.05) * 5 + Math.sin(y * 0.13) * 3), y);
      g.stroke();
    }
    // ёлки по краям
    const tree = (x, y, s) => {
      g.fillStyle = 'rgba(40,60,90,0.25)';
      g.beginPath();
      g.ellipse(x + 6 * s, y + 4 * s, 22 * s, 9 * s, 0, 0, TAU);
      g.fill();
      for (let i = 0; i < 3; i++) {
        const r = (22 - i * 6) * s, yy = y - i * 12 * s;
        g.fillStyle = ['#2f5d50', '#38705f', '#43836f'][i];
        g.beginPath();
        g.moveTo(x, yy - r * 1.2);
        g.lineTo(x + r, yy + r * 0.5);
        g.lineTo(x - r, yy + r * 0.5);
        g.fill();
        g.fillStyle = '#f4f8fd';
        g.beginPath();
        g.moveTo(x, yy - r * 1.2);
        g.lineTo(x + r * 0.45, yy - r * 0.35);
        g.lineTo(x - r * 0.45, yy - r * 0.35);
        g.fill();
      }
    };
    for (let x = 30; x < W; x += rnd(52, 80)) {
      if (Math.abs(x - RIVER_X) < RIVER_W) continue;
      tree(x, rnd(20, 40), rnd(0.8, 1.1));
      tree(x + rnd(-15, 15), H - rnd(4, 18), rnd(0.8, 1.15));
    }
    return c;
  })();
  const floes = Array.from({ length: 9 }, () => ({ x: rnd(-RIVER_W / 2 + 10, RIVER_W / 2 - 10), y: rnd(0, H), r: rnd(6, 14), v: rnd(26, 46), rot: rnd(0, TAU) }));
  const streaks = Array.from({ length: 26 }, () => ({ x: rnd(-RIVER_W / 2 + 4, RIVER_W / 2 - 4), y: rnd(0, H), l: rnd(14, 40), v: rnd(60, 110) }));
  function drawRiver(t, dt) {
    const x0 = RIVER_X - RIVER_W / 2;
    const g = ctx.createLinearGradient(x0, 0, x0 + RIVER_W, 0);
    g.addColorStop(0, '#2b6c8c');
    g.addColorStop(0.5, '#1b4f72');
    g.addColorStop(1, '#2b6c8c');
    ctx.fillStyle = g;
    ctx.fillRect(x0, 0, RIVER_W, H);
    ctx.strokeStyle = 'rgba(190,230,255,0.28)';
    ctx.lineWidth = 2;
    for (const s of streaks) {
      s.y += s.v * dt;
      if (s.y > H + s.l) s.y = -s.l;
      ctx.beginPath();
      ctx.moveTo(RIVER_X + s.x + Math.sin((s.y + t * 40) * 0.03) * 2, s.y);
      ctx.lineTo(RIVER_X + s.x + Math.sin((s.y + s.l + t * 40) * 0.03) * 2, s.y + s.l);
      ctx.stroke();
    }
    for (const f of floes) {
      f.y += f.v * dt;
      f.rot += dt * 0.3;
      if (f.y > H + 20) {
        f.y = -20;
        f.x = rnd(-RIVER_W / 2 + 12, RIVER_W / 2 - 12);
      }
      ctx.save();
      ctx.translate(RIVER_X + f.x, f.y);
      ctx.rotate(f.rot);
      ctx.fillStyle = 'rgba(232,244,255,0.9)';
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU, r = f.r * (0.75 + ((i * 37) % 10) / 30);
        i ? ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  /* ───────── мясник (вид сверху, вперёд — по оси x) ───────── */
  function drawPudge(p, x, y, a, o) {
    ctx.save();
    ctx.translate(x, y);
    // тень и кольцо стороны
    ctx.fillStyle = 'rgba(30,45,80,0.25)';
    ctx.beginPath();
    ctx.ellipse(5, 10, 38, 28, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = o.mine ? 'rgba(43,198,164,0.85)' : 'rgba(229,72,77,0.8)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(0, 8, 36, 26, 0, 0, TAU);
    ctx.stroke();
    if (o.alpha < 1) ctx.globalAlpha = o.alpha;
    const bob = 1 + Math.sin(o.walk * 9) * 0.025;
    ctx.rotate(a);
    ctx.scale(bob, 1 / bob);
    // рука с крюком (левая, -y) и рука с ледяным тесаком (правая, +y)
    const hookOut = o.hookOut;
    ctx.fillStyle = '#7d2328';
    ctx.beginPath();
    ctx.ellipse(hookOut ? 18 : 6, -27, hookOut ? 16 : 11, 8, hookOut ? -0.25 : 0.5, 0, TAU);
    ctx.fill();
    if (!hookOut) {
      ctx.strokeStyle = '#4a1418';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(16, -33, 7, Math.PI * 0.2, Math.PI * 1.4);
      ctx.stroke();
    }
    ctx.fillStyle = '#c99274';
    ctx.beginPath();
    ctx.ellipse(8, 27, 11, 8, -0.4, 0, TAU);
    ctx.fill();
    // ледяной тесак
    ctx.fillStyle = '#a9e3ff';
    ctx.strokeStyle = '#4e9fd6';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(14, 30);
    ctx.lineTo(38, 26);
    ctx.lineTo(44, 34);
    ctx.lineTo(36, 42);
    ctx.lineTo(16, 38);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#e7b04a';
    ctx.fillRect(10, 31, 7, 6);
    // туловище — фиолетовая роба
    const rg = ctx.createRadialGradient(-6, -6, 4, 0, 0, R + 2);
    rg.addColorStop(0, '#8a6ce0');
    rg.addColorStop(1, '#3f2b8a');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, TAU);
    ctx.fill();
    // голое пузо со шрамом
    const bg = ctx.createRadialGradient(10, -2, 3, 8, 0, 20);
    bg.addColorStop(0, '#e6b597');
    bg.addColorStop(1, '#b67d60');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.ellipse(9, 0, 15, 18, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#8c2f2f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(4, -9);
    ctx.lineTo(14, 6);
    ctx.stroke();
    for (let i = 0; i < 4; i++) {
      const t = i / 3, sx = lerp(4, 14, t), sy = lerp(-9, 6, t);
      ctx.beginPath();
      ctx.moveTo(sx - 2, sy + 2);
      ctx.lineTo(sx + 2, sy - 2);
      ctx.stroke();
    }
    // золотая цепь через грудь
    ctx.strokeStyle = '#e7b04a';
    ctx.lineWidth = 3.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(-4, 0, 21, -1.1, 1.1);
    ctx.stroke();
    ctx.setLineDash([]);
    // пряжка с синим камнем
    ctx.fillStyle = '#e7b04a';
    ctx.beginPath();
    ctx.arc(16, 13, 5.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#2f7be0';
    ctx.beginPath();
    ctx.arc(16, 13, 3.4, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillRect(15, 11, 1.5, 1.5);
    // наплечники: бирюза, белый мех, камень
    for (const s of [-1, 1]) {
      ctx.fillStyle = '#f2f6ff';
      ctx.beginPath();
      ctx.ellipse(-4, s * 19, 12, 10, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#38bfd6';
      ctx.beginPath();
      ctx.ellipse(-5, s * 19, 8.5, 7, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#e7b04a';
      ctx.beginPath();
      ctx.arc(-5, s * 19, 3.4, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#2f7be0';
      ctx.beginPath();
      ctx.arc(-5, s * 19, 2, 0, TAU);
      ctx.fill();
    }
    // меховой воротник и голова
    ctx.fillStyle = '#f2f6ff';
    ctx.beginPath();
    ctx.arc(10, 0, 13, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#d2a084';
    ctx.beginPath();
    ctx.arc(14, 0, 9.5, 0, TAU);
    ctx.fill();
    // светлые волосы — сзади и по бокам головы
    ctx.fillStyle = '#e3c27a';
    ctx.beginPath();
    ctx.arc(11, 0, 9.5, Math.PI * 0.55, Math.PI * 1.45);
    ctx.fill();
    ctx.strokeStyle = '#c9a259';
    ctx.lineWidth = 1.5;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(8, s * 6);
      ctx.quadraticCurveTo(2, s * 12, -2, s * 9);
      ctx.stroke();
    }
    // камень на лбу
    ctx.fillStyle = '#5fb8ff';
    ctx.beginPath();
    ctx.moveTo(22, 0);
    ctx.lineTo(19, -2.5);
    ctx.lineTo(16, 0);
    ctx.lineTo(19, 2.5);
    ctx.closePath();
    ctx.fill();
    if (o.flash > 0) {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.85, o.flash * 4)})`;
      ctx.fillRect(-50, -50, 100, 100);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }

  /* ───────── хук и цепь ───────── */
  function drawHook(ox, oy, hx, hy) {
    const dx = hx - ox, dy = hy - oy, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
    const n = Math.max(1, Math.floor(d / 9));
    for (let i = 1; i < n; i++) {
      const x = ox + ux * i * 9, y = oy + uy * i * 9;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(uy, ux) + (i % 2 ? Math.PI / 2 : 0));
      ctx.strokeStyle = i % 2 ? '#b8862f' : '#e7b04a';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.ellipse(0, 0, 5, 2.8, 0, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(Math.atan2(uy, ux));
    ctx.strokeStyle = '#5a1a1d';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(2, 0, 11, -Math.PI * 0.55, Math.PI * 0.75);
    ctx.stroke();
    ctx.strokeStyle = '#b3343b';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(2, 0, 11, -Math.PI * 0.55, Math.PI * 0.75);
    ctx.stroke();
    ctx.fillStyle = '#d8dde6';
    ctx.beginPath();
    ctx.moveTo(-2, 12);
    ctx.lineTo(-10, 8);
    ctx.lineTo(-3, 6);
    ctx.fill();
    ctx.restore();
  }

  /* ───────── частицы ───────── */
  const parts = [];
  function burst(x, y, col, n, sp, life) {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, TAU), s = rnd(sp * 0.3, sp);
      parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(0.4, life || 0.9), max: life || 0.9, col, r: rnd(1.5, 4) });
    }
  }
  function updParts(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
      if ((p.life -= dt) <= 0) parts.splice(i, 1);
    }
  }
  function drawParts() {
    for (const p of parts) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.col;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ───────── игроки ───────── */
  function newPudge(side) {
    return { side, x: SIDES[side].spawnX, y: H / 2, a: side === 'left' ? 0 : Math.PI, hp: 100, charges: CHARGES, rech: 0, hook: null, pulled: null, inv: 0, dead: 0, walk: 0, cast: 0, flash: 0, phase: 0, phaseCd: 0 };
  }

  let role = 'left'; // моя сторона: left | right | spec
  let me = newPudge('left');
  /** Соперник: по сети (буфер состояний) или манекен, пока никого нет */
  const remote = { left: null, right: null }; // { peerId, buf: [{t, s}], view: pudge, lastP }
  let dummy = newPudge('right');
  dummy.tx = dummy.x;
  dummy.ty = dummy.y;
  const score = { left: 0, right: 0 };
  let over = null; // { winner: side }
  let againMine = false;
  let hookSeq = 0;
  let sendT = 0;
  const now = () => performance.now() / 1000;

  function assignRoles() {
    const all = Net.self ? Net.all() : [];
    const idx = Net.self ? all.findIndex((p) => p.peerId === Net.self.peerId) : 0;
    const prev = role;
    role = idx === 0 ? 'left' : idx === 1 ? 'right' : Net.self ? 'spec' : 'left';
    for (const side of ['left', 'right']) {
      const p = all[side === 'left' ? 0 : 1];
      if (!p || (Net.self && p.peerId === Net.self.peerId)) {
        remote[side] = null;
        continue;
      }
      if (!remote[side] || remote[side].peerId !== p.peerId) remote[side] = { peerId: p.peerId, name: p.name, buf: [], view: newPudge(side), lastP: false };
    }
    if (role !== prev && role !== 'spec') {
      me = newPudge(role);
    }
  }
  function oppSide() {
    return role === 'spec' ? null : other(role);
  }
  /** Тот, в кого я целюсь: живой соперник по сети или манекен */
  function target() {
    const side = oppSide();
    if (!side) return null;
    if (remote[side]) return { kind: 'net', p: remote[side].view, peerId: remote[side].peerId };
    return { kind: 'dummy', p: dummy };
  }

  /* ───────── ввод ───────── */
  const keys = {};
  let mouse = { x: W / 2, y: H / 2 }, wantHook = false, wantPhase = false;
  addEventListener('keydown', (e) => {
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    actx();
    keys[e.code] = true;
    if (e.code === 'KeyQ' && !e.repeat) wantHook = true;
    if (e.code === 'KeyE' && !e.repeat) wantPhase = true;
    if (e.code === 'KeyM' && !e.repeat) muted = !muted;
  });
  addEventListener('keyup', (e) => (keys[e.code] = false));
  addEventListener('blur', () => {
    for (const k in keys) keys[k] = false;
  });
  const toWorld = (e) => {
    const r = cv.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  cv.addEventListener('mousemove', (e) => (mouse = toWorld(e)));
  cv.addEventListener('mousedown', (e) => {
    cv.focus();
    actx();
    mouse = toWorld(e);
    if (over && hitButton(mouse)) return onAgain();
    if (e.button === 0) wantHook = true;
  });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());

  /* ───────── сеть ───────── */
  Net.on('init', () => {
    assignRoles();
    sendScore();
    if (role !== 'left') Net.send({ t: 'hello' });
  });
  Net.on('join', () => {
    assignRoles();
    sendScore();
  });
  Net.on('leave', () => {
    assignRoles();
    if (!remote.left && !remote.right) over = null;
  });
  function sendScore() {
    if (role === 'left') Net.send({ t: 'score', l: score.left, r: score.right, o: over ? over.winner : '' });
  }
  Net.on('msg', (d, from) => {
    if (!d || typeof d !== 'object') return;
    const side = remote.left && remote.left.peerId === from ? 'left' : remote.right && remote.right.peerId === from ? 'right' : null;
    switch (d.t) {
      case 's': {
        if (!side) return;
        const r = remote[side];
        r.buf.push({ t: now(), s: d });
        if (r.buf.length > 30) r.buf.shift();
        break;
      }
      case 'hit': {
        // меня поймали: тянемся к бросившему (если можно поймать)
        if (role === 'spec' || !side || side !== oppSide()) return;
        if (me.dead > 0 || me.inv > 0 || me.pulled || me.phase > 0) return Net.send({ t: 'miss', id: d.id }, from);
        me.pulled = { phase: 'drag', by: side, t: 0, hookId: d.id };
        me.hook = null;
        me.flash = 0.25;
        sfx.hit();
        burst(me.x, me.y, '#8e1f26', 18, 260);
        break;
      }
      case 'miss':
        if (me.hook && me.hook.id === d.id) me.hook.state = 'back';
        break;
      case 'died': {
        if (!side) return;
        addPoint(other(side));
        const v = remote[side].view;
        burst(v.x, v.y, '#8e1f26', 30, 320, 1.2);
        sfx.die();
        if (me.hook && me.hook.state === 'pull') me.hook = null;
        break;
      }
      case 'score':
        if (typeof d.l === 'number' && typeof d.r === 'number' && role !== 'left') {
          score.left = d.l;
          score.right = d.r;
          over = d.o === 'left' || d.o === 'right' ? { winner: d.o } : null;
        }
        break;
      case 'hello':
        sendScore();
        break;
      case 'again':
        if (over) {
          if (againMine) resetMatch();
          else over.againFrom = (over.againFrom || 0) + 1;
        }
        break;
      case 'reset':
        resetMatch();
        break;
    }
  });
  function sendState() {
    if (role === 'spec') return;
    const h = me.hook;
    Net.send({
      t: 's',
      x: Math.round(me.x),
      y: Math.round(me.y),
      a: Math.round(me.a * 100) / 100,
      hp: me.hp,
      c: me.charges,
      d: me.dead > 0 ? 1 : 0,
      i: me.inv > 0 ? 1 : 0,
      f: me.phase > 0 ? 1 : 0,
      fc: Math.round(me.phaseCd * 10) / 10,
      p: me.pulled ? 1 : 0,
      h: h ? { x: Math.round(h.x), y: Math.round(h.y), st: h.state } : null,
    });
  }
  /** Вид соперника: состояние на INTERP секунд назад, плавно между пакетами */
  function updRemote(r) {
    const buf = r.buf, t = now() - INTERP, v = r.view;
    if (!buf.length) return;
    let a = buf[0], b = buf[buf.length - 1];
    for (let i = 0; i < buf.length - 1; i++)
      if (buf[i].t <= t && buf[i + 1].t >= t) {
        a = buf[i];
        b = buf[i + 1];
        break;
      }
    const k = b.t === a.t ? 1 : clamp((t - a.t) / (b.t - a.t), 0, 1);
    const sa = a.s, sb = b.s;
    const px = v.x, py = v.y;
    v.x = lerp(sa.x, sb.x, k);
    v.y = lerp(sa.y, sb.y, k);
    let da = sb.a - sa.a;
    while (da > Math.PI) da -= TAU;
    while (da < -Math.PI) da += TAU;
    v.a = sa.a + da * k;
    if (v.hp > sb.hp && !sb.d) {
      v.flash = 0.25;
      burst(v.x, v.y, '#8e1f26', 14, 240);
      sfx.land();
    }
    v.hp = sb.hp;
    v.charges = sb.c;
    v.dead = sb.d ? 1 : 0;
    v.inv = sb.i ? 1 : 0;
    if (sb.f && !(v.phase > 0)) sfx.phase();
    v.phase = sb.f ? 1 : 0;
    v.phaseCd = sb.fc || 0;
    v.pulled = sb.p ? {} : null;
    v.walk += Math.hypot(v.x - px, v.y - py) / 120;
    if (sb.h) {
      if (!v.hook) sfx.throw();
      v.hook = { x: lerp(sa.h ? sa.h.x : sb.h.x, sb.h.x, k), y: lerp(sa.h ? sa.h.y : sb.h.y, sb.h.y, k), state: sb.h.st };
    } else v.hook = null;
    if (v.flash > 0) v.flash -= 1 / 60;
  }

  /* ───────── счёт ───────── */
  function addPoint(side) {
    score[side]++;
    if (score[side] >= WIN && !over) {
      over = { winner: side };
      againMine = false;
      if (role === side) sfx.win();
      else if (role !== 'spec') sfx.lose();
    } else if (role === side) sfx.point();
  }
  function resetMatch() {
    score.left = score.right = 0;
    over = null;
    againMine = false;
    if (role !== 'spec') {
      me = newPudge(role);
    }
    dummy = Object.assign(newPudge('right'), { tx: SIDES.right.spawnX, ty: H / 2 });
  }
  function onAgain() {
    if (!over) return;
    if (!remote[oppSide() || 'right']) {
      resetMatch();
      return;
    }
    againMine = true;
    Net.send({ t: 'again' });
    if (over.againFrom) {
      Net.send({ t: 'reset' });
      resetMatch();
    }
  }
  const BTN = { x: W / 2 - 110, y: H / 2 + 50, w: 220, h: 50 };
  const hitButton = (m) => m.x >= BTN.x && m.x <= BTN.x + BTN.w && m.y >= BTN.y && m.y <= BTN.y + BTN.h;

  /* ───────── логика ───────── */
  function updMe(dt) {
    if (role === 'spec') return;
    const p = me, side = SIDES[p.side];
    if (p.flash > 0) p.flash -= dt;
    if (p.inv > 0) p.inv -= dt;
    if (p.dead > 0) {
      p.dead -= dt;
      if (p.dead <= 0) Object.assign(p, newPudge(p.side), { inv: 1.2 });
      return;
    }
    // перезарядка хука
    if (p.charges < CHARGES) {
      p.rech += dt;
      if (p.rech >= RECHARGE) {
        p.charges++;
        p.rech = 0;
        sfx.charge();
      }
    }
    if (p.phaseCd > 0) p.phaseCd -= dt;
    if (p.phase > 0) {
      p.phase -= dt;
      if (p.phase <= 0) {
        p.phase = 0;
        sfx.unphase();
        burst(p.x, p.y, '#c9a6ff', 14, 200, 0.6);
      }
    }
    // меня тянут
    if (p.pulled) {
      const pl = p.pulled, hk = target();
      pl.t += dt;
      if (pl.phase === 'drag') {
        const hx = hk ? hk.p.x : p.x, hy = hk ? hk.p.y : p.y, dx = hx - p.x, dy = hy - p.y, d = Math.hypot(dx, dy);
        if (d < R * 2 + 6 || pl.t > 2.2) {
          pl.phase = 'stun';
          pl.t = 0;
          p.hp -= DMG;
          p.flash = 0.3;
          sfx.land();
          burst(p.x, p.y, '#8e1f26', 26, 300, 1.1);
          burst(p.x, p.y, '#ffffff', 10, 200);
          if (p.hp <= 0) {
            p.hp = 0;
            p.dead = 1.6;
            p.pulled = null;
            sfx.die();
            addPoint(other(p.side));
            Net.send({ t: 'died' });
            burst(p.x, p.y, '#8e1f26', 40, 360, 1.3);
          }
        } else {
          const s = Math.min(d, PULL_SPEED * dt);
          p.x += (dx / d) * s;
          p.y += (dy / d) * s;
          if (Math.random() < 0.4) burst(p.x, p.y + 10, Math.abs(p.x - RIVER_X) < RIVER_W / 2 ? '#bfe6ff' : '#ffffff', 2, 80, 0.5);
        }
      } else if (pl.t > 0.35) {
        // обратно на свой берег
        burst(p.x, p.y, '#cfe9ff', 16, 220);
        p.x = side.spawnX;
        p.y = clamp(p.y, MIN_Y, MAX_Y);
        p.pulled = null;
        p.inv = 1.0;
        burst(p.x, p.y, '#cfe9ff', 16, 220);
      }
      return;
    }
    // фаза: на секунду пропадаем, хук пролетает насквозь
    if (wantPhase && p.phaseCd <= 0 && p.phase <= 0) {
      p.phase = PHASE;
      p.phaseCd = PHASE_CD;
      sfx.phase();
      burst(p.x, p.y, '#c9a6ff', 18, 240, 0.7);
      sendState();
    }
    wantPhase = false;
    if (p.phase > 0) {
      p.a = Math.atan2(mouse.y - p.y, mouse.x - p.x);
      wantHook = false;
      updHook(dt);
      return;
    }
    // ходьба
    let mx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    let my = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
    const ml = Math.hypot(mx, my);
    if (ml > 0 && p.cast <= 0) {
      p.x += (mx / ml) * SPEED * dt;
      p.y += (my / ml) * SPEED * dt;
      p.walk += dt;
    }
    if (p.cast > 0) p.cast -= dt;
    p.x = clamp(p.x, side.minX, side.maxX);
    p.y = clamp(p.y, MIN_Y, MAX_Y);
    p.a = Math.atan2(mouse.y - p.y, mouse.x - p.x);
    // бросок
    if (wantHook && !p.hook && p.charges > 0) {
      p.charges--;
      p.cast = CAST;
      p.hook = { id: ++hookSeq, a: p.a, dist: R, x: p.x, y: p.y, state: 'out', link: 0 };
      sfx.throw();
      sendState();
    }
    wantHook = false;
    updHook(dt);
  }
  function updHook(dt) {
    const h = me.hook;
    if (!h) return;
    const tg = target();
    if (h.state === 'out') {
      h.dist += HOOK_SPEED * dt;
      h.x = me.x + Math.cos(h.a) * h.dist;
      h.y = me.y + Math.sin(h.a) * h.dist;
      if ((h.link += dt) > 0.05) {
        h.link = 0;
        sfx.chain();
      }
      if (h.dist >= HOOK_RANGE || h.x < 0 || h.x > W || h.y < 30 || h.y > H - 10) h.state = 'back';
      else if (tg) {
        const v = tg.p;
        // хуки столкнулись в воздухе — оба назад
        if (v.hook && v.hook.state === 'out' && Math.hypot(v.hook.x - h.x, v.hook.y - h.y) < HOOK_R * 2.2) {
          h.state = 'back';
          sfx.clash();
          burst(h.x, h.y, '#ffd36b', 22, 320, 0.6);
        } else if (!v.dead && !v.inv && !v.pulled && !(v.phase > 0) && Math.hypot(v.x - h.x, v.y - h.y) < R + HOOK_R) {
          h.state = 'pull';
          h.t = 0;
          sfx.hit();
          burst(h.x, h.y, '#8e1f26', 16, 260);
          if (tg.kind === 'net') Net.send({ t: 'hit', id: h.id }, tg.peerId);
          else {
            dummy.pulled = { phase: 'drag', t: 0 };
            dummy.flash = 0.25;
          }
        }
      }
    } else if (h.state === 'back') {
      h.dist -= HOOK_SPEED * 1.25 * dt;
      h.x = me.x + Math.cos(h.a) * h.dist;
      h.y = me.y + Math.sin(h.a) * h.dist;
      if (h.dist <= R) me.hook = null;
    } else if (h.state === 'pull') {
      h.t += dt;
      const v = tg ? tg.p : null;
      if (!v || h.t > 2.6 || v.dead) {
        me.hook = null;
        return;
      }
      h.x = v.x;
      h.y = v.y;
      if (tg.kind === 'net') {
        // по сети: пойманный сообщил, что долетел (p снова 0)
        const r = remote[oppSide()];
        if (r && r.lastP && !v.pulled && h.t > 0.15) me.hook = null;
        if (r) r.lastP = !!v.pulled;
      } else if (!v.pulled) me.hook = null;
    }
  }
  function updDummy(dt) {
    const d = dummy, side = SIDES.right;
    if (role !== 'left' || remote.right) return;
    if (d.flash > 0) d.flash -= dt;
    if (d.inv > 0) d.inv -= dt;
    if (d.dead > 0) {
      d.dead -= dt;
      if (d.dead <= 0) Object.assign(d, newPudge('right'), { inv: 1, tx: side.spawnX, ty: H / 2 });
      return;
    }
    if (d.pulled) {
      const pl = d.pulled;
      pl.t += dt;
      if (pl.phase === 'drag') {
        const dx = me.x - d.x, dy = me.y - d.y, dist = Math.hypot(dx, dy);
        if (dist < R * 2 + 6 || pl.t > 2.2) {
          pl.phase = 'stun';
          pl.t = 0;
          d.hp -= DMG;
          d.flash = 0.3;
          sfx.land();
          burst(d.x, d.y, '#8e1f26', 26, 300, 1.1);
          if (d.hp <= 0) {
            d.dead = 1.4;
            d.pulled = null;
            sfx.die();
            addPoint('left');
            burst(d.x, d.y, '#8e1f26', 40, 360, 1.3);
          }
        } else {
          const s = Math.min(dist, PULL_SPEED * dt);
          d.x += (dx / dist) * s;
          d.y += (dy / dist) * s;
        }
      } else if (pl.t > 0.35) {
        d.x = side.spawnX;
        d.pulled = null;
        d.inv = 1;
        burst(d.x, d.y, '#cfe9ff', 16, 220);
      }
      return;
    }
    if (Math.hypot(d.tx - d.x, d.ty - d.y) < 8) {
      d.tx = rnd(side.minX, side.maxX);
      d.ty = rnd(MIN_Y, MAX_Y);
    }
    const dx = d.tx - d.x, dy = d.ty - d.y, dist = Math.hypot(dx, dy) || 1;
    d.x += (dx / dist) * SPEED * 0.55 * dt;
    d.y += (dy / dist) * SPEED * 0.55 * dt;
    d.walk += dt * 0.55;
    d.a = Math.atan2(me.y - d.y, me.x - d.x);
  }

  /* ───────── отрисовка ───────── */
  function drawBars(p, x, y, mine) {
    if (p.dead > 0) return;
    const w = 64, bx = x - w / 2, by = y - R - 26;
    // фаза: фиолетовый ромб справа от зарядов, по кругу — перезарядка
    {
      const cx = x + 30, cy = by + 16, ready = !(p.phaseCd > 0);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = ready ? '#a77bff' : 'rgba(10,14,26,0.45)';
      ctx.fillRect(-4, -4, 8, 8);
      ctx.restore();
      if (mine && !ready) {
        ctx.strokeStyle = '#a77bff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, 7, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - p.phaseCd / PHASE_CD));
        ctx.stroke();
      }
    }
    ctx.fillStyle = 'rgba(10,14,26,0.7)';
    roundRect(bx - 2, by - 2, w + 4, 10, 4);
    ctx.fill();
    ctx.fillStyle = mine ? '#2bc6a4' : '#e5484d';
    roundRect(bx, by, (w * Math.max(0, p.hp)) / 100, 6, 3);
    ctx.fill();
    for (let i = 0; i < CHARGES; i++) {
      const cx = x - 14 + i * 14, cy = by + 16;
      ctx.fillStyle = i < p.charges ? '#e7b04a' : 'rgba(10,14,26,0.45)';
      ctx.beginPath();
      ctx.arc(cx, cy, 4.2, 0, TAU);
      ctx.fill();
      if (mine && i === p.charges && p.charges < CHARGES) {
        ctx.strokeStyle = '#e7b04a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, 5.5, -Math.PI / 2, -Math.PI / 2 + TAU * (p.rech / RECHARGE));
        ctx.stroke();
      }
    }
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function text(s, x, y, size, col, align, weight) {
    ctx.font = `${weight || 700} ${size}px 'Segoe UI', system-ui, sans-serif`;
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(8,12,22,0.55)';
    ctx.fillText(s, x + 1.5, y + 2);
    ctx.fillStyle = col;
    ctx.fillText(s, x, y);
  }
  function banner(s) {
    ctx.font = "600 14px 'Segoe UI', system-ui, sans-serif";
    const w = ctx.measureText(s).width + 36;
    ctx.fillStyle = 'rgba(10,14,26,0.72)';
    roundRect(W / 2 - w / 2, H - 46, w, 30, 15);
    ctx.fill();
    text(s, W / 2, H - 31, 14, '#dbe4f3', 'center', 600);
  }
  function nameOf(side) {
    if (role === side) return (Net.self && Net.self.name) || 'Вы';
    if (remote[side]) return remote[side].name || 'Соперник';
    return side === 'right' && role === 'left' ? 'Манекен' : '—';
  }
  function drawPhase(p, t) {
    ctx.save();
    ctx.translate(p.x, p.y);
    for (let i = 0; i < 3; i++) {
      const r = 34 + i * 7 + Math.sin(t * 9 + i) * 3;
      ctx.strokeStyle = `rgba(${i === 1 ? '120,210,255' : '183,140,255'},${0.55 - i * 0.14})`;
      ctx.lineWidth = 3 - i * 0.7;
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * 0.82, t * (i % 2 ? -2 : 2), 0, TAU);
      ctx.stroke();
    }
    for (let i = 0; i < 8; i++) {
      const a = t * 3 + (i / 8) * TAU, r = 30 + Math.sin(t * 7 + i * 2) * 8;
      ctx.fillStyle = i % 2 ? '#d8c4ff' : '#9fe3ff';
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r, Math.sin(a) * r * 0.8, 2.2, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
  function drawPlayer(p, mine) {
    const phased = p.phase > 0 && p.dead <= 0;
    const alpha = p.dead > 0 ? 0 : phased ? 0.28 : p.inv > 0 ? (Math.floor(p.inv * 12) % 2 ? 0.45 : 0.9) : 1;
    if (phased) drawPhase(p, performance.now() / 1000);
    if (p.hook) drawHook(p.x + Math.cos(p.a - 0.6) * 22, p.y + Math.sin(p.a - 0.6) * 22, p.hook.x, p.hook.y);
    if (alpha > 0) drawPudge(p, p.x, p.y, p.a, { mine, alpha, walk: p.walk, hookOut: !!p.hook, flash: p.flash || 0 });
    drawBars(p, p.x, p.y, mine);
  }
  function draw(t, dt) {
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    ctx.drawImage(BG, 0, 0, W, H);
    drawRiver(t, dt);
    // игроки: по y, чтобы нижний перекрывал верхнего
    const list = [];
    if (role !== 'spec') list.push({ p: me, mine: true });
    for (const side of ['left', 'right']) if (remote[side]) list.push({ p: remote[side].view, mine: false });
    if (role === 'left' && !remote.right) list.push({ p: dummy, mine: false });
    list.sort((a, b) => a.p.y - b.p.y);
    for (const o of list) drawPlayer(o.p, o.mine);
    drawParts();
    // прицел
    if (role !== 'spec' && me.dead <= 0 && !over) {
      ctx.strokeStyle = 'rgba(20,30,55,0.35)';
      ctx.setLineDash([6, 8]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(me.x, me.y);
      const d = Math.min(HOOK_RANGE, Math.hypot(mouse.x - me.x, mouse.y - me.y));
      ctx.lineTo(me.x + Math.cos(me.a) * d, me.y + Math.sin(me.a) * d);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // счёт
    ctx.fillStyle = 'rgba(10,14,26,0.72)';
    roundRect(W / 2 - 190, 10, 380, 46, 14);
    ctx.fill();
    text(nameOf('left').slice(0, 14), W / 2 - 60, 33, 15, role === 'left' ? '#7fe3cc' : '#ff9a9e', 'right', 600);
    text(`${score.left} : ${score.right}`, W / 2, 33, 22, '#ffffff');
    text(nameOf('right').slice(0, 14), W / 2 + 60, 33, 15, role === 'right' ? '#7fe3cc' : '#ff9a9e', 'left', 600);
    // подсказки
    if (role === 'left' && !remote.right) banner('Тренировка на манекене — ждём соперника. Он увидит приглашение в звонке');
    if (role === 'spec') banner('Вы смотрите: играют двое первых вошедших');
    if (me.dead > 0 && role !== 'spec' && !over) text(`Возрождение через ${Math.ceil(me.dead)}…`, W / 2, H / 2, 26, '#ffffff');
    if (over) drawOver();
  }
  function drawOver() {
    ctx.fillStyle = 'rgba(8,12,22,0.62)';
    ctx.fillRect(0, 0, W, H);
    const win = role === over.winner;
    text(role === 'spec' ? `Победил(а) ${nameOf(over.winner)}` : win ? 'Победа!' : 'Поражение', W / 2, H / 2 - 40, 48, win ? '#7fe3cc' : '#ffffff');
    text(`${score.left} : ${score.right}`, W / 2, H / 2 + 8, 22, '#c9d3e6');
    if (role === 'spec') return;
    ctx.fillStyle = againMine ? '#3a4560' : '#2bc6a4';
    roundRect(BTN.x, BTN.y, BTN.w, BTN.h, 14);
    ctx.fill();
    text(againMine ? 'Ждём соперника…' : over.againFrom ? 'Соперник готов — ещё раз!' : 'Ещё раз', W / 2, BTN.y + BTN.h / 2, 18, againMine ? '#c9d3e6' : '#06231c');
  }

  /* ───────── цикл ───────── */
  let last = performance.now();
  function loop(t) {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    if (!over) {
      updMe(dt);
      updDummy(dt);
    }
    for (const side of ['left', 'right']) if (remote[side]) updRemote(remote[side]);
    updParts(dt);
    if ((sendT += dt) >= SEND_EVERY) {
      sendT = 0;
      sendState();
    }
    try {
      draw(t / 1000, dt);
    } catch (e) {
      console.error(e);
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  cv.focus();
})();
