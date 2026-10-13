// Клякса: вторая партия — новые враги (точилка, двойка, циркуль, скрепки, корректор, линейка, жвачка, мел)
// и особые комнаты (тёмная, секретная, химия, испытание, проклятая, столовая).
// Подключается к логике (game.js) через несколько точек: aiExt, onKillExt, drawEnemyExt, worldWire и т. п.
'use strict';

/* ================= спрайты ================= */
const D3 = {
  sharp: ['.kkkkkkkkkk.', 'kllllllllllk', 'klaaaaaaaaAk', 'klaakkkkaaAk', 'klakKKKKkaAk', 'klakKwKKkaAk', 'klakKKKKkaAk', 'klaakkkkaaAk', 'klaaaaaaaaAk', 'kAAAAAAAAAAk', '.kkkkkkkkkk.'],
  deuce: ['..kkkkkk..', '.krrrrrrk.', 'krrkkkkrrk', 'kkk....krk', '......krrk', '.....krrk.', '....krrk..', '...krrk...', '..krrk....', '.krrk.....', 'krrkkkkkkk', 'krrrrrrrrk', 'kkkkkkkkkk'],
  one: ['..kkk.', '.krrk.', 'krrrk.', 'kkrrk.', '.krrk.', '.krrk.', '.krrk.', '.krrk.', '.krrk.', '.krrk.', 'kkrrkk', 'krrrrk', 'kkkkkk'],
  compass: ['.....kk.....', '....kYYk....', '....kaak....', '...kalaak...', '...kak.kak..', '..kak...kak.', '..kak...kak.', '.kak.....kak', '.kak.....kak', 'kak.......kNk', 'kk........kNk', 'k..........k'],
  clip: ['.kkk.', 'kl.lk', 'kl.lk', 'kla.k', 'kla.k', 'kla.k', 'k.kkk', 'kl..k', '.kkk.'],
  corr: ['..kkkk..', '..kffk..', '..kffk..', '.kkkkkk.', 'kwwwwwwk', 'kwwwwwWk', 'kwwffwWk', 'kwwffwWk', 'kwwwwwWk', 'kwwwwwWk', 'kWWWWWWk', '.kkkkkk.'],
  gum: ['...kkkk...', '.kkPPPPkk.', 'kPPmmmmPPk', 'kPmmmmmmPk', 'kmmmmmmmmk', 'kEmmmmmmEk', '.kEEEEEEk.', '..kkkkkk..'],
  chalk: ['kkkk', 'kwwk', 'kwwk', 'kwwk', 'kwWk', 'kwWk', 'kwWk', 'kwWk', 'kWWk', 'kWWk', 'kkkk'],
  flask: ['..kkk..', '..kwk..', '..kwk..', '.kwwwk.', 'kwwwwwk', 'kXXXXXk', 'kXXXXXk', 'kXXXXXk', '.kXXXk.', '..kkk..'],
  bun: ['..kkkk..', '.knnnnk.', 'knttttnk', 'knttttnk', 'kNNNNNNk', '.kkkkkk.'],
};
SP.sharp = spr(D3.sharp);
SP.deuce = spr(D3.deuce);
SP.one = spr(D3.one);
SP.compass = spr(D3.compass);
SP.clipE = spr(D3.clip);
SP.corr = spr(D3.corr);
SP.gum = spr(D3.gum);
SP.chalk = spr(D3.chalk);
SP.bun = spr(D3.bun);
const FLASK_FX = { fire: '#f77622', ice: '#2ce8f5', boom: '#63c74d', heal: '#ff8e8e' };
SP.flask = {};
for (const k in FLASK_FX) SP.flask[k] = sprPal(D3.flask, { X: FLASK_FX[k] });

/* ================= враги ================= */
Object.assign(DEF, {
  sharpener: { r: 6, hp: 10, spd: 0, blood: '#8b9bb4', heavy: 1 },
  deuce: { r: 6, hp: 12, spd: 0.55, blood: '#e43b44' },
  one: { r: 4, hp: 5, spd: 0.75, blood: '#e43b44' },
  compass: { r: 6, hp: 14, spd: 0.35, blood: '#8b9bb4' },
  clip: { r: 3, hp: 3, spd: 0.95, fly: 1, blood: '#c0cbdc' },
  corrector: { r: 6, hp: 12, spd: 0.32, blood: '#fff8ec' },
  ruler: { r: 7, hp: 18, spd: 0, blood: '#feae34', heavy: 1 },
  gum: { r: 5, hp: 8, spd: 0.5, blood: '#ff8e8e', harmless: 1 },
  chalk: { r: 5, hp: 9, spd: 0.4, blood: '#fff8ec' },
});

/** Кто встречается на этаже: с первого — попроще, дальше — все; в темноте — мел */
function enemyPool() {
  const p = level < 2 ? ['fly', 'fly', 'walker', 'walker', 'turret', 'sharpener', 'gum'] : ['fly', 'walker', 'walker', 'turret', 'dasher', 'splitter', 'dasher', 'sharpener', 'gum', 'deuce', 'compass', 'corrector', 'ruler', 'clipswarm'];
  if (room && room.dark) p.push('chalk', 'chalk', 'chalk');
  return p;
}

let zones = [], slick = [], dust = [];
/** Отладка (#debug): все особые комнаты на каждом этаже */
const DBG_ALL = location.hash === '#debug';
function resetWorld() {
  resetBoss();
  zones = [];
  slick = [];
  dust = [];
}

/** Движение новых врагов: [vx, vy] */
function aiExt(e, P, dx, dy, d) {
  let vx = 0, vy = 0;
  switch (e.type) {
    case 'sharpener':
      if (--e.cd <= 0) {
        e.cd = ri(100, 140) - level * 3;
        e.mouth = 12;
        S('eshot');
        const base = Math.atan2(dy, dx);
        for (let i = 0; i < 5; i++) {
          shootE(e, base + (i * TAU) / 5, 1.05);
          ebul[ebul.length - 1].cv = 0.032;
        }
      }
      break;
    case 'deuce':
    case 'one':
      if (e.state === 0) {
        if (--e.cd <= 0) {
          e.state = 1;
          e.ct = 22;
          e.ax = dx / d;
          e.ay = dy / d;
        }
      } else {
        vx = e.ax * e.spd * 3.2;
        vy = e.ay * e.spd * 3.2;
        e.hop = Math.sin(((22 - e.ct) / 22) * Math.PI) * 6;
        if (--e.ct <= 0) {
          e.state = 0;
          e.cd = ri(18, 40);
          e.hop = 0;
        }
      }
      break;
    case 'compass':
      if (e.state === 0) {
        vx = (dx / d) * e.spd;
        vy = (dy / d) * e.spd;
        if (--e.cd <= 0 && d < 120) {
          e.state = 1;
          e.ct = 150;
          zones.push({ x: e.x, y: e.y, r: 34, t: 0, max: 150 });
          S('charge');
        }
      } else if (--e.ct <= 0) {
        e.state = 0;
        e.cd = ri(80, 140);
      }
      break;
    case 'clip': {
      // кружат строем вокруг игрока и время от времени разом бросаются
      const a = e.t * 0.035 + ((e.slot || 0) * TAU) / 5, tx = P.x + Math.cos(a) * 26, ty = P.y + Math.sin(a) * 18;
      const ex = tx - e.x, ey = ty - e.y, l = Math.hypot(ex, ey) || 1;
      if (e.t % 220 > 185) {
        vx = (dx / d) * e.spd * 2.2;
        vy = (dy / d) * e.spd * 2.2;
      } else {
        vx = (ex / l) * e.spd;
        vy = (ey / l) * e.spd;
      }
      break;
    }
    case 'corrector':
      vx = (dx / d) * e.spd;
      vy = (dy / d) * e.spd;
      if (e.t % 12 === 0) {
        slick.push({ x: e.x, y: e.y + 3, r: 7, life: 600 });
        if (slick.length > 140) slick.shift();
      }
      break;
    case 'ruler':
      // ждёт → полоса-предупреждение → удар ребром → переезжает к игроку
      if (e.state === 0) {
        if (--e.cd <= 0) {
          e.state = 1;
          e.ct = 42;
          e.ax = Math.abs(dx) > Math.abs(dy) ? 1 : 0;
          S('charge');
        }
      } else if (e.state === 1) {
        if (--e.ct <= 0) {
          e.state = 2;
          e.ct = 10;
          shakeTo(5);
          S('slam');
        }
      } else if (e.state === 2) {
        if (--e.ct <= 0) {
          e.state = 3;
          e.ct = 40;
        }
      } else {
        const tx = clamp(P.x, RX0 + 30, RX1 - 30), ty = clamp(P.y, RY0 + 12, RY1 - 12), ex = tx - e.x, ey = ty - e.y, l = Math.hypot(ex, ey) || 1;
        vx = (ex / l) * 1.5;
        vy = (ey / l) * 1.5;
        if (--e.ct <= 0) {
          e.state = 0;
          e.cd = ri(40, 70);
        }
      }
      break;
    case 'gum':
      if (e.stuck) {
        const Q = PL.find((q) => q.peer === e.stuck);
        if (!Q || Q.dead) e.stuck = 0;
        else {
          e.x = Q.x;
          e.y = Q.y - 2;
          return [0, 0];
        }
      }
      vx = (dx / d) * e.spd;
      vy = (dy / d) * e.spd;
      break;
    default:
      return bossAI(e, P, dx, dy, d);
    case 'chalk': {
      const want = d < 60 ? -1 : d > 100 ? 1 : 0;
      vx = (dx / d) * e.spd * want;
      vy = (dy / d) * e.spd * want;
      if (--e.cd <= 0) {
        e.cd = ri(90, 130);
        shootE(e, Math.atan2(dy, dx), 1.2);
        ebul[ebul.length - 1].dust = 1;
        S('eshot');
      }
      break;
    }
  }
  return [vx, vy];
}

function onKillExt(e) {
  if (e.type === 'deuce')
    for (let i = 0; i < 2; i++) {
      const m = mkEnemy('one', e.x + (i ? 6 : -6), e.y);
      m.spawn = 0;
      m.kx = i ? 1.8 : -1.8;
      m.cd = 20;
      enemies.push(m);
    }
}

/** Пуля мела оставляет облако пыли */
function ebulGone(b) {
  if (b.dust) dust.push({ x: b.x, y: b.y, r: 16, life: 220 });
}

/** Мир за кадр (у ведущего): круги циркуля, корректор, жвачка, удар линейки, пыль */
function updWorld() {
  for (let i = zones.length - 1; i >= 0; i--) {
    const z = zones[i];
    if (++z.t >= z.max) {
      zones.splice(i, 1);
      continue;
    }
    if (z.t > 60) for (const P of PL) if (!P.dead && !P.merged && Math.hypot(P.x - z.x, P.y - z.y) < z.r) hurt(P, 1);
  }
  for (let i = slick.length - 1; i >= 0; i--) if (--slick[i].life <= 0) slick.splice(i, 1);
  for (let i = dust.length - 1; i >= 0; i--) if (--dust[i].life <= 0) dust.splice(i, 1);
  for (const P of PL) if (P.sellLock && !(room.items || []).some((it) => it.kind === 'sell' && Math.hypot(it.x - P.x, it.y - P.y) < 16)) P.sellLock = false;
  for (const P of PL) P.gummed = false;
  updBossWorld();
  for (const e of enemies) {
    if (e.dead || e.spawn > 0) continue;
    if (e.type === 'gum') {
      if (!e.stuck) {
        const Q = PL.find((q) => !q.dead && !q.merged && Math.hypot(q.x - e.x, q.y - e.y) < e.r + q.r);
        if (Q) {
          e.stuck = Q.peer;
          S('slam');
          showHint('Прилипла жвачка! Друг отдерёт её выстрелом', Q.peer);
        }
      }
      if (e.stuck) {
        const Q = PL.find((q) => q.peer === e.stuck);
        if (Q) Q.gummed = true;
      }
    }
    if (e.type === 'ruler' && e.state === 2)
      for (const P of PL) {
        if (P.dead || P.merged) continue;
        const hit = e.ax === 1 ? Math.abs(P.y - e.y) < 5 && Math.abs(P.x - e.x) < 72 : Math.abs(P.x - e.x) < 5 && Math.abs(P.y - e.y) < 72;
        if (hit) hurt(P, 1);
      }
  }
}
const onSlick = (P) => slick.some((s) => Math.hypot(s.x - P.x, s.y - (P.y + 2)) < s.r);

/* ================= особые комнаты ================= */
const STRONG = ['triple', 'magnet', 'awl', 'tracer', 'baby', 'barcode', 'crayons', 'pen', 'eshield', 'battery'];
const CURSED = () => ITEMS.filter((i) => i.cursed);

/** Особые комнаты этажа: тупики — испытание / проклятая / столовая, обычные — темнота и химия */
function assignSpecial(list, start) {
  const ends = list.filter((r) => r.type === 'normal' && Object.values(r.doors).filter(Boolean).length === 1);
  const kinds = ['trial', 'curse', 'canteen'].filter(() => DBG_ALL || Math.random() < 0.6);
  for (const k of kinds) {
    const r = ends.splice(Math.floor(Math.random() * ends.length), 1)[0];
    if (!r) break;
    r.type = k;
    r.rocks = [];
    if (k === 'trial') {
      r.cleared = false;
      r.wave = 0;
    } else if (k === 'curse') {
      r.cleared = true;
      r.items = [{ x: CX, y: CY, kind: 'item', it: pick(CURSED()), price: 0 }];
    } else {
      r.cleared = true;
      r.items = [
        { x: CX - 44, y: CY, kind: 'sell', price: 0 },
        { x: CX + 44, y: CY, kind: 'bun', price: 2 },
      ];
    }
  }
  for (const r of list) {
    if (r.type !== 'normal') continue;
    if ((DBG_ALL && !list.some((x) => x.dark)) || (level >= 2 && Math.random() < 0.2)) r.dark = true;
    else if ((DBG_ALL && !list.some((x) => x.chem)) || Math.random() < 0.16) {
      r.chem = true;
      r.props = [];
      const n = ri(4, 6);
      for (let i = 0; i < n; i++) {
        let x, y, tr = 0;
        do {
          x = rnd(RX0 + 20, RX1 - 20);
          y = rnd(RY0 + 16, RY1 - 16);
          tr++;
        } while (Math.hypot(x - CX, y - CY) < 30 && tr < 40);
        r.props.push({ id: eid++, x, y, fx: pick(['fire', 'ice', 'boom', 'heal']) });
      }
    }
  }
}

/** Секретная комната: пустая клетка рядом с двумя и более комнатами, вход вскрывается бомбой */
function addSecret(list) {
  const map = new Set(list.map((r) => key(r.gx, r.gy)));
  const cand = [];
  for (let gx = 0; gx <= 8; gx++)
    for (let gy = 0; gy <= 8; gy++) {
      if (map.has(key(gx, gy))) continue;
      const nb = list.filter((r) => Math.abs(r.gx - gx) + Math.abs(r.gy - gy) === 1 && r.type !== 'boss');
      if (nb.length >= 2) cand.push({ gx, gy, n: nb.length });
    }
  if (!cand.length) return;
  cand.sort((a, b) => b.n - a.n);
  const c = cand[Math.floor(Math.random() * Math.min(3, cand.length))];
  const r = { gx: c.gx, gy: c.gy, type: 'secret', cleared: true, visited: false, found: false, seed: (Math.random() * 1e9) | 0, rocks: [], items: [], pickups: [], trap: null, trapT: 0, floorC: null, doorT: 1 };
  if (Math.random() < 0.5) r.items.push({ x: CX, y: CY, kind: 'item', it: drawItemFromPool(), price: 0 });
  for (let i = 0; i < 4; i++) {
    const a = rnd(0, TAU);
    r.pickups.push({ id: eid++, x: CX + Math.cos(a) * 30, y: CY + 20 + Math.sin(a) * 12, r: 3, z: 0, vz: 0, vx: 0, vy: 0, kind: pick(['coin', 'coin', 'bomb', 'heart']), t: ri(0, 100) });
  }
  list.push(r);
}
/** Дверь в ещё не найденную секретную комнату — это стена с трещиной */
const hiddenDoor = (nb) => !!nb && nb.type === 'secret' && !nb.found;
function doorPos(dir) {
  return dir === 'up' ? [CX, RY0] : dir === 'down' ? [CX, RY1] : dir === 'left' ? [RX0, CY] : [RX1, CY];
}
/** Взрыв у стены с трещиной открывает секретную комнату */
function revealSecret(x, y) {
  for (const [dir, nb] of Object.entries(room.doors)) {
    if (!hiddenDoor(nb)) continue;
    const [dx, dy] = doorPos(dir);
    if (Math.hypot(dx - x, dy - y) < 34) {
      nb.found = true;
      S('door');
      burst(dx, dy, '#8b9bb4', 16, 2);
      popup('Секретная комната!', 'Бомба вскрыла стену', null, 120);
    }
  }
}

/** Колбы в кабинете химии: капля разбивает — огонь, лёд, взрыв или сердечко */
function breakProp(p) {
  room.props = room.props.filter((q) => q !== p);
  S('hit');
  burst(p.x, p.y - 3, FLASK_FX[p.fx], 12, 1.6);
  if (p.fx === 'fire') for (let i = 0; i < 6; i++) fires.push({ x: p.x + rnd(-12, 12), y: p.y + rnd(-8, 8), life: 120 });
  else if (p.fx === 'ice') {
    for (const e of enemies) if (Math.hypot(e.x - p.x, e.y - p.y) < 44) e.slow = 200;
    addFx({ type: 'splash', x: p.x, y: p.y, t: 0, col: '#2ce8f5' });
  } else if (p.fx === 'boom') explode(p.x, p.y);
  else dropPickup(p.x, p.y, 'half');
}
function hitProp(t) {
  if (!room.props) return false;
  for (const p of room.props) if (Math.hypot(p.x - t.x, p.y - 3 - t.y) < 5) {
    breakProp(p);
    return true;
  }
  return false;
}
function propsInBlast(x, y) {
  if (room.props) for (const p of room.props.slice()) if (Math.hypot(p.x - x, p.y - y) < 30) breakProp(p);
}

/** Столовая: «Сдать» последний предмет за 10 монет — пересчитываем силу без него */
function rebuildStats(P, without) {
  const items = P.items.slice();
  items.splice(without, 1);
  const ratio = P.hp / P.maxHp;
  const keep = ['x', 'y', 'vx', 'vy', 'look', 'hist', 'walkT', 'blinkT', 'took', 'bombSeen', 'pingSeen', 'inv', 'cls', 'merged', 'mergeWith', 'mergeT', 'mergeCd', 'reviveT', 'dead', 'deathT', 'sellLock'];
  const saved = {};
  keep.forEach((k) => (saved[k] = P[k]));
  Object.assign(P, newPlayer(P.peer, P.idx, P.name), saved);
  if (mode === 'classes') CLASSES[P.cls].apply(P);
  for (const id of items) if (ITEMm[id]) {
    ITEMm[id].apply(P);
    P.items.push(id);
  }
  P.hp = Math.max(1, Math.round(P.maxHp * ratio));
}
/** Пьедесталы столовой; true — пьедестал остаётся */
function canteenPick(it, P) {
  if (it.kind === 'sell') {
    if (P.sellLock) return true;
    P.sellLock = true;
    if (!P.items.length) {
      showHint('Сдавать нечего', P.peer);
      return true;
    }
    const id = P.items[P.items.length - 1];
    rebuildStats(P, P.items.length - 1);
    team.coins = Math.min(99, team.coins + 10);
    S('buy');
    popup('Сдано: ' + ITEMm[id].name, '+10 монет', SP.items[id][0], 110);
    return true;
  }
  if (it.kind === 'bun') {
    if (P.hp >= P.maxHp) {
      showHint('Ты и так сыт', P.peer);
      return true;
    }
    if (team.coins < 2) {
      showHint('Нужно монет: 2', P.peer);
      return true;
    }
    team.coins -= 2;
    P.hp = Math.min(P.maxHp, P.hp + 1);
    S('heart');
    return true;
  }
  return false;
}

/* ================= сеть: мир в снимке ================= */
function worldWire() {
  return {
    z: zones.map((z) => [r1(z.x), r1(z.y), z.r, z.t, z.max]),
    sl: slick.map((s) => [r1(s.x), r1(s.y), s.r, s.life]),
    du: dust.map((d) => [r1(d.x), r1(d.y), d.r, d.life]),
    pr: (room.props || []).map((p) => [p.id, r1(p.x), r1(p.y), p.fx]),
    sf: floor.list.map((r) => (r.found ? 1 : 0)).join(''),
    dk: room.dark ? 1 : 0,
    wv: room.wave || 0,
    bw: bossWire(),
  };
}
function applyWorld(w) {
  if (!w) return;
  zones = w.z.map((a) => ({ x: a[0], y: a[1], r: a[2], t: a[3], max: a[4] }));
  slick = w.sl.map((a) => ({ x: a[0], y: a[1], r: a[2], life: a[3] }));
  dust = w.du.map((a) => ({ x: a[0], y: a[1], r: a[2], life: a[3] }));
  room.props = w.pr.map((a) => ({ id: a[0], x: a[1], y: a[2], fx: a[3] }));
  if (w.sf) floor.list.forEach((r, i) => (r.found = w.sf[i] === '1'));
  room.dark = !!w.dk;
  room.wave = w.wv;
  applyBoss(w.bw);
}

/* ================= отрисовка ================= */
function drawWorldFloor() {
  for (const s of slick) {
    ctx.globalAlpha = Math.min(1, s.life / 60) * 0.85;
    pcirc(s.x, s.y, s.r, '#fff8ec');
    pcirc(s.x - 1, s.y - 1, s.r - 3, '#ffffff');
  }
  ctx.globalAlpha = 1;
  for (const z of zones) {
    const k = Math.min(1, z.t / 60), n = Math.round(48 * k);
    for (let i = 0; i < n; i++) {
      const a = (i / 48) * TAU;
      px(z.x + Math.cos(a) * z.r, z.y + Math.sin(a) * z.r * 0.75, 1, 1, z.t > 60 ? PAL.r : PAL.a);
    }
    if (z.t > 60 && (frame % 8) < 5) {
      ctx.globalAlpha = 0.18;
      pell(z.x, z.y, z.r, z.r * 0.75, PAL.r);
      ctx.globalAlpha = 1;
    }
  }
  if (room.props)
    for (const p of room.props) {
      shad(p.x, p.y + 1, 3);
      ctx.drawImage(SP.flask[p.fx], Math.round(p.x - 3), Math.round(p.y - 9));
    }
  drawBossFloor();
}
function drawWorldTop() {
  for (const d of dust) {
    ctx.globalAlpha = Math.min(1, d.life / 50) * 0.92;
    for (let i = 0; i < 5; i++) {
      const a = i * 1.3 + d.x, ox = Math.cos(a) * 6, oy = Math.sin(a) * 4;
      pcirc(d.x + ox, d.y + oy, d.r * 0.6, i % 2 ? '#c0cbdc' : '#8b9bb4');
    }
  }
  ctx.globalAlpha = 1;
  drawBossTop();
}
/** Темнота: светло только вокруг клякс, у огня, бомб, пуль и мела */
const DARKC = mk(BW, BH);
function drawDark() {
  if (!room || !room.dark) return;
  const g = DARKC.getContext('2d');
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, BW, BH);
  g.fillStyle = 'rgba(8,6,12,0.95)';
  g.fillRect(RX0, RY0, RX1 - RX0, RY1 - RY0);
  g.globalCompositeOperation = 'destination-out';
  const hole = (x, y, r) => {
    const gr = g.createRadialGradient(x, y, r * 0.35, x, y, r);
    gr.addColorStop(0, 'rgba(0,0,0,1)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
  };
  for (const P of PL) if (!P.dead) hole(P.x, P.y - 4, P.mergeWith ? 58 : 44);
  for (const e of enemies) if (e.type === 'chalk') hole(e.x, e.y, 16);
  for (const b of ebul) hole(b.x, b.y, 7);
  for (const f of fires) hole(f.x, f.y, 9);
  for (const b of bombs) hole(b.x, b.y, 12);
  for (const t of tears) hole(t.x, t.y, 6);
  ctx.drawImage(DARKC, 0, 0);
}
function drawEnemyExt(e) {
  const lk = look(e), fl = e.flash > 0;
  switch (e.type) {
    case 'sharpener': {
      const r = drawSpr(SP.sharp, e.x, e.y + e.r + 1, e);
      if (!r.partial && !fl) eyes(r.x, r.y, 3, 7, 1, lk, true, false);
      break;
    }
    case 'deuce':
    case 'one': {
      const img = e.type === 'deuce' ? SP.deuce : SP.one;
      drawSpr(img, e.x, e.y + e.r + 2 - (e.hop || 0), e);
      break;
    }
    case 'compass':
      drawSpr(SP.compass, e.x, e.y + e.r + 2, e);
      break;
    case 'clip':
      drawSpr(SP.clipE, e.x, e.y + 4, e);
      break;
    case 'corrector': {
      const r = drawSpr(SP.corr, e.x, e.y + e.r + 1, e);
      if (!r.partial && !fl) eyes(r.x, r.y, 1, 5, 5, lk, true, false);
      break;
    }
    case 'ruler': {
      const horiz = e.ax !== 0;
      if (e.state === 1 && (frame % 6) < 4) {
        for (let i = -70; i <= 70; i += 4) horiz ? px(e.x + i, e.y, 2, 1, PAL.r) : px(e.x, e.y + i, 1, 2, PAL.r);
      }
      if (e.state === 2) {
        horiz ? px(e.x - 72, e.y - 2, 144, 5, PAL.Y) : px(e.x - 2, e.y - 72, 5, 144, PAL.Y);
        horiz ? px(e.x - 72, e.y - 2, 144, 1, PAL.w) : px(e.x - 2, e.y - 72, 1, 144, PAL.w);
      }
      if (e.spawn > 0) {
        pell(e.x, e.y + 4, 12, 2, '#120e17');
        break;
      }
      const c = fl ? PAL.w : PAL.y;
      px(e.x - 12, e.y - 4, 24, 8, PAL.k);
      px(e.x - 11, e.y - 3, 22, 6, c);
      for (let i = 0; i < 10; i++) px(e.x - 10 + i * 2, e.y - 3, 1, i % 5 === 0 ? 3 : 2, PAL.k);
      if (!fl) eyes(Math.round(e.x - 6), Math.round(e.y - 3), 2, 8, 1, lk, true, false);
      break;
    }
    case 'gum':
      drawSpr(SP.gum, e.x, e.y + e.r + (e.stuck ? -2 : 1), e);
      break;
    case 'chalk': {
      if (room.dark) {
        ctx.globalAlpha = 0.4;
        pcirc(e.x, e.y - 3, 7, '#fff8ec');
        ctx.globalAlpha = 1;
      }
      const r = drawSpr(SP.chalk, e.x, e.y + e.r + 2, e);
      if (!r.partial && !fl) eyes(r.x - 2, r.y, 1, 5, 2, lk, true, false);
      break;
    }
    default:
      drawBoss(e);
  }
}
/** Дверь особой комнаты: цвет и значок; ещё не найденная секретная — трещина в стене */
function doorStyle(nb) {
  const t = nb.type === 'boss' || room.type === 'boss' ? 'boss' : nb.type;
  return (
    {
      trial: ['#5d3a28', '#f77622', '#feae34'],
      curse: ['#3d1c25', '#68386c', '#9e2835'],
      canteen: ['#265c42', '#3e8948', '#b6f0a0'],
      secret: ['#2a2433', '#5a6988', '#8b9bb4'],
    }[t] || null
  );
}
function drawCrack(dir) {
  const [x, y] = doorPos(dir), horiz = dir === 'up' || dir === 'down';
  const pts = horiz ? [[-6, 0], [-3, -3], [0, 1], [3, -2], [6, 1]] : [[0, -6], [-3, -3], [1, 0], [-2, 3], [1, 6]];
  const oy = dir === 'up' ? -6 : dir === 'down' ? 6 : 0, ox = dir === 'left' ? -6 : dir === 'right' ? 6 : 0;
  for (const [a, b] of pts) px(x + ox + a, y + oy + b, 2, 1, '#120e17');
}
function doorIcon(dir, nb, fxp, fyp) {
  const t = nb.type;
  const at = (w, h) => (dir === 'up' || dir === 'down' ? [fxp - w - 2, fyp + 5] : [fxp + Math.round((16 - w) / 2), fyp - h - 2]);
  if (t === 'trial') {
    const [x, y] = at(5, 5);
    for (let i = 0; i < 5; i++) {
      px(x + i, y + i, 1, 1, PAL.Y);
      px(x + 4 - i, y + i, 1, 1, PAL.Y);
    }
  } else if (t === 'curse') {
    const [x, y] = at(5, 3);
    for (let i = 0; i < 3; i++) {
      px(x + i * 2, y, 1, 2, PAL.r);
      px(x, y + 2, 5, 1, PAL.r);
    }
  } else if (t === 'canteen') {
    const [x, y] = at(8, 6);
    ctx.drawImage(SP.bun, x, y);
  }
}
