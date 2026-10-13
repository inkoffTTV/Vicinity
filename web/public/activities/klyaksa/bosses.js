// Клякса: третья партия — боссы (Пенал-Мимик, Учительница-Ручка, Дырокол, Архивариус),
// выключатели для двоих (щит босса снимается, только если оба стоят на кнопках), победа после 5-го этажа.
'use strict';

Object.assign(DEF, {
  mimic: { r: 16, hp: 150, spd: 0.5, blood: '#29447e', heavy: 1, boss: 1 },
  teacher: { r: 10, hp: 170, spd: 0.7, blood: '#e43b44', heavy: 1, boss: 1 },
  punch: { r: 14, hp: 140, spd: 0.45, blood: '#5a6988', heavy: 1, boss: 1 },
  archive: { r: 18, hp: 260, spd: 0.2, blood: '#8f563b', heavy: 1, boss: 1 },
  pencil: { r: 3, hp: 3, spd: 0, fly: 1, blood: '#feae34' },
});
Object.assign(BOSS_NAMES, { mimic: ['Пенал-Мимик'], teacher: ['Учительница-Ручка'], punch: ['Дырокол'], archive: ['Архивариус'] });

/** Кто ждёт на этаже: 1 — Клякса, 2 — Ластик или Дырокол, 3 — Пенал, 4 — Ручка, 5 — Архивариус; дальше — любой */
function bossFor(lv) {
  if (lv === 1) return 'blot';
  if (lv === 2) return Math.random() < 0.5 ? 'eraser' : 'punch';
  if (lv === 3) return 'mimic';
  if (lv === 4) return 'teacher';
  if (lv === 5) return 'archive';
  return pick(['blot', 'eraser', 'punch', 'mimic', 'teacher', 'archive']);
}
let runLen = 'short'; // short — 5 этажей и победа, endless — без конца

let plates = [], waveLine = null, holes = [];
function resetBoss() {
  plates = [];
  waveLine = null;
  holes = [];
}
/** Выключатели для двоих: у Пенала, Ручки и Архивариуса щит, пока двое не встанут на кнопки разом */
function bossSetup(e) {
  resetBoss();
  if (PL.filter((p) => !p.dead).length >= 2 && ['mimic', 'teacher', 'archive'].includes(e.type)) {
    e.shield = true;
    plates = [
      { x: RX0 + 26, y: RY1 - 22, on: false },
      { x: RX1 - 26, y: RY1 - 22, on: false },
    ];
  }
}
/** Множитель урона по боссу: щит — 0, закрытый пенал — мало, открытый — больше, в прыжке — 0 */
function bossDmgK(e) {
  if (e.shield) return 0;
  if (e.type === 'mimic') return e.state === 2 ? 1.5 : 0.25;
  if (e.type === 'punch' && e.state === 1) return 0;
  return 1;
}

const WORDS = ['НЕТ!', 'ДВА', 'ПЛОХО', 'ОШИБКА', 'ПЕРЕПИШИ'];

function bossAI(e, P, dx, dy, d) {
  let vx = 0, vy = 0;
  const enr = e.hp < e.maxhp * 0.5;
  switch (e.type) {
    case 'pencil': {
      if (!e.ax && !e.ay) {
        e.ax = dx / d;
        e.ay = dy / d;
      }
      vx = e.ax * 2.6;
      vy = e.ay * 2.6;
      const nx = e.x + vx, ny = e.y + vy;
      if (nx < RX0 + 3 || nx > RX1 - 3 || ny < RY0 + 3 || ny > RY1 - 3) {
        e.hp = 0;
        kill(e);
      }
      break;
    }
    case 'mimic':
      // закрыт и ползёт → открывается → плюётся карандашами → закрывается
      if (e.state === 0) {
        vx = (dx / d) * e.spd * (enr ? 1.5 : 1);
        vy = (dy / d) * e.spd * (enr ? 1.5 : 1);
        if (e.t % 60 === 0) for (let i = -1; i <= 1; i++) shootE(e, Math.atan2(dy, dx) + i * 0.25, 1.4);
        if (--e.cd <= 0) {
          e.state = 1;
          e.ct = 20;
        }
      } else if (e.state === 1) {
        if (--e.ct <= 0) {
          e.state = 2;
          e.ct = enr ? 120 : 100;
          e.mouth = 20;
        }
      } else if (e.state === 2) {
        if (e.ct % (enr ? 25 : 35) === 0) {
          S('eshot');
          for (let i = 0; i < (enr ? 3 : 2); i++) {
            const p = mkEnemy('pencil', e.x + rnd(-8, 8), e.y + 4);
            p.spawn = 0;
            enemies.push(p);
          }
        }
        if (--e.ct <= 0) {
          e.state = 3;
          e.ct = 20;
        }
      } else if (--e.ct <= 0) {
        e.state = 0;
        e.cd = enr ? 90 : 140;
      }
      break;
    case 'teacher': {
      // ходит поверху, пишет слова — буквы зависают и летят; на второй фазе подчёркивает «НЕВЕРНО»
      const ty = RY0 + 26, tx = clamp(P.x, RX0 + 30, RX1 - 30);
      vx = clamp((tx - e.x) * 0.02, -e.spd, e.spd);
      vy = clamp((ty - e.y) * 0.05, -1, 1);
      if (--e.cd <= 0) {
        e.cd = enr ? 95 : 130;
        e.mouth = 20;
        S('eshot');
        const w = pick(WORDS.filter((x) => x.length <= (enr ? 8 : 5)));
        for (let i = 0; i < w.length; i++) {
          shootE(e, Math.PI / 2, 0);
          const b = ebul[ebul.length - 1];
          b.x = clamp(e.x + (i - (w.length - 1) / 2) * 11, RX0 + 6, RX1 - 6);
          b.y = e.y + 28;
          b.vx = b.vy = 0;
          b.ch = w[i];
          b.wait = 40 + i * 6;
          b.r = 3;
        }
      }
      if (enr && !waveLine && e.t % 240 === 120) {
        waveLine = { y: RY0 + 2, gap: rnd(RX0 + 34, RX1 - 34), w: 36 };
        S('charge');
      }
      break;
    }
    case 'punch':
      // ходит → прыгает к игроку (тень) → приземляется: дыры в полу и кольцо пуль
      if (e.state === 0) {
        vx = (dx / d) * e.spd;
        vy = (dy / d) * e.spd;
        e.harmless = false;
        if (--e.cd <= 0) {
          e.state = 1;
          e.ct = 50;
          e.ax = P.x;
          e.ay = P.y;
          e.harmless = true;
          S('charge');
        }
      } else if (e.state === 1) {
        vx = (e.ax - e.x) / Math.max(1, e.ct);
        vy = (e.ay - e.y) / Math.max(1, e.ct);
        if (--e.ct <= 0) {
          e.state = 0;
          e.cd = enr ? 80 : 120;
          e.harmless = false;
          shakeTo(10);
          S('boom');
          burst(e.x, e.y, '#5a6988', 18, 2.2);
          const a = rnd(0, Math.PI);
          for (let i = -1; i <= 1; i++) if (holes.length < 14) holes.push({ x: clamp(e.x + Math.cos(a) * i * 22, RX0 + 12, RX1 - 12), y: clamp(e.y + Math.sin(a) * i * 22, RY0 + 12, RY1 - 12), r: 9 });
          for (let i = 0; i < (enr ? 12 : 8); i++) shootE(e, (i / (enr ? 12 : 8)) * TAU, 1.3);
        }
      }
      break;
    case 'archive': {
      // стопка тетрадей: каждые 25 % здоровья роняет тетрадь — из неё лезут враги прошлых этажей
      vx = Math.sin(e.t * 0.01) * 0.3;
      vy = clamp((RY0 + 40 - e.y) * 0.03, -0.5, 0.5);
      const stage = Math.min(3, Math.floor((1 - e.hp / e.maxhp) * 4));
      e.drops = e.drops || 0;
      if (e.drops < stage) {
        e.drops++;
        S('slam');
        shakeTo(8);
        popup('Тетрадь упала!', 'Из неё лезут старые знакомые', null, 90);
        const pool = ['walker', 'deuce', 'compass', 'sharpener', 'fly', 'gum'];
        for (let i = 0; i < 4; i++) {
          const m = mkEnemy(pick(pool), clamp(e.x + rnd(-50, 50), RX0 + 16, RX1 - 16), clamp(e.y + rnd(20, 60), RY0 + 16, RY1 - 16));
          m.spawn = 30;
          m.spawnMax = 30;
          enemies.push(m);
        }
      }
      if (e.t % 70 === 0) {
        S('eshot');
        e.mouth = 14;
        for (let i = -2; i <= 2; i++) {
          shootE(e, Math.atan2(dy, dx) + i * 0.2, 1.3);
          ebul[ebul.length - 1].r = 3;
        }
      }
      if (e.t % 200 === 100) for (let i = 0; i < 12; i++) shootE(e, (i / 12) * TAU, 1.05);
      if (e.t % 150 === 75) {
        shootE(e, Math.atan2(dy, dx), 1.1);
        ebul[ebul.length - 1].dust = 1;
      }
      break;
    }
  }
  return [vx, vy];
}

/** За кадр у ведущего: кнопки для двоих, линия «НЕВЕРНО», падение в дыры */
function updBossWorld() {
  const boss = enemies.find((e) => e.boss && !e.dead);
  if (plates.length && boss) {
    for (const pl of plates) pl.on = PL.some((p) => !p.dead && !p.merged && Math.hypot(p.x - pl.x, p.y - pl.y) < 10);
    if (boss.shield && plates.every((p) => p.on)) {
      boss.shield = false;
      boss.shieldT = 360;
      S('door');
      popup('Щит снят!', '6 секунд — бейте!', null, 80);
    } else if (!boss.shield && --boss.shieldT <= 0) {
      boss.shield = true;
      S('shield');
    }
  }
  if (waveLine) {
    waveLine.y += 1.1;
    for (const P of PL) {
      if (P.dead || P.merged) continue;
      if (Math.abs(P.y - waveLine.y) < 4 && Math.abs(P.x - waveLine.gap) > waveLine.w / 2) hurt(P, 1);
    }
    if (waveLine.y > RY1) waveLine = null;
  }
  for (const P of PL) {
    if (P.dead || P.merged || P.inv > 0) continue;
    if (holes.some((h) => Math.hypot(h.x - P.x, h.y - (P.y + 2)) < h.r - 3)) {
      hurt(P, 2);
      burst(P.x, P.y, '#120e17', 14, 1.6);
      P.x = CX;
      P.y = CY + 30;
      showHint('Упал в дыру — минус сердце', P.peer);
    }
  }
}

/* ================= сеть ================= */
function bossWire() {
  return { pl: plates.map((p) => [p.x, p.y, p.on ? 1 : 0]), wl: waveLine ? [r1(waveLine.y), r1(waveLine.gap), waveLine.w] : null, ho: holes.map((h) => [r1(h.x), r1(h.y), h.r]) };
}
function applyBoss(w) {
  if (!w) return;
  plates = w.pl.map((a) => ({ x: a[0], y: a[1], on: !!a[2] }));
  waveLine = w.wl ? { y: w.wl[0], gap: w.wl[1], w: w.wl[2] } : null;
  holes = w.ho.map((a) => ({ x: a[0], y: a[1], r: a[2] }));
}

/* ================= отрисовка ================= */
const R = (g, x, y, w, h, c) => {
  g.fillStyle = c;
  g.fillRect(Math.round(x), Math.round(y), w, h);
};
function drawMimicTo(g, x, y, open, fl) {
  const w = 36, h = 20, x0 = Math.round(x - w / 2), y0 = Math.round(y - h / 2);
  const c1 = fl ? PAL.w : PAL.B, c2 = fl ? PAL.w : PAL.b;
  if (open) {
    R(g, x0, y0 - 10, w, 10, PAL.k);
    R(g, x0 + 1, y0 - 9, w - 2, 8, c1);
    R(g, x0 + 2, y0 - 1, w - 4, 8, PAL.R);
    R(g, x0 + 4, y0 + 1, w - 8, 4, PAL.r);
    for (let i = 0; i < 5; i++) R(g, x0 + 6 + i * 6, y0 + 1, 2, 3, PAL.Y);
  }
  R(g, x0, y0 + (open ? 6 : 0), w, h - (open ? 6 : 0), PAL.k);
  R(g, x0 + 1, y0 + 1 + (open ? 6 : 0), w - 2, h - 2 - (open ? 6 : 0), c1);
  R(g, x0 + 1, y0 + h - 5, w - 2, 4, c2);
  if (!open) {
    for (let i = 0; i < 16; i++) R(g, x0 + 2 + i * 2, y0 + 7, 1, 2, i % 2 ? PAL.l : PAL.a);
    R(g, x0 + w - 6, y0 + 5, 3, 6, PAL.Y);
  }
}
function drawTeacherTo(g, x, y, fl) {
  const x0 = Math.round(x - 5), y0 = Math.round(y - 16);
  R(g, x0, y0, 10, 26, PAL.k);
  R(g, x0 + 1, y0 + 1, 8, 10, fl ? PAL.w : PAL.Y);
  R(g, x0 + 1, y0 + 11, 8, 13, fl ? PAL.w : PAL.r);
  R(g, x0 + 2, y0 + 12, 2, 11, PAL.P);
  R(g, x0 + 8, y0 + 2, 1, 9, PAL.y);
  R(g, x0 + 3, y0 + 25, 4, 3, PAL.k);
  R(g, x0 + 4, y0 + 28, 2, 3, PAL.A);
}
function drawPunchTo(g, x, y, fl) {
  const x0 = Math.round(x - 14), y0 = Math.round(y - 12);
  R(g, x0, y0 + 8, 28, 16, PAL.k);
  R(g, x0 + 1, y0 + 9, 26, 14, fl ? PAL.w : PAL.A);
  R(g, x0 + 1, y0 + 9, 26, 3, PAL.a);
  R(g, x0 + 6, y0 + 15, 5, 5, PAL.k);
  R(g, x0 + 17, y0 + 15, 5, 5, PAL.k);
  R(g, x0 + 3, y0, 22, 9, PAL.k);
  R(g, x0 + 4, y0 + 1, 20, 6, fl ? PAL.w : PAL.r);
  R(g, x0 + 4, y0 + 1, 20, 2, PAL.P);
}
function drawArchiveTo(g, x, y, n, fl) {
  const cols = [PAL.B, PAL.G, PAL.V, PAL.R];
  for (let i = 0; i < n; i++) {
    const yy = Math.round(y + 10 - i * 8), xx = Math.round(x - 18 + (i % 2 ? 2 : -1));
    R(g, xx, yy, 36, 8, PAL.k);
    R(g, xx + 1, yy + 1, 34, 6, fl ? PAL.w : cols[i % 4]);
    R(g, xx + 2, yy + 1, 30, 1, PAL.w);
    R(g, xx + 14, yy + 3, 6, 3, PAL.w);
  }
}
const PORTRAITS = {};
function bossPortrait(type) {
  if (type === 'blot') return SP.blot[Math.floor(frame / 6) % 8];
  if (type === 'eraser') return SP.rocks.eraser;
  if (!PORTRAITS[type]) {
    const c = mk(40, 40), g = c.getContext('2d');
    if (type === 'mimic') drawMimicTo(g, 20, 24, true, false);
    if (type === 'teacher') drawTeacherTo(g, 20, 20, false);
    if (type === 'punch') drawPunchTo(g, 20, 24, false);
    if (type === 'archive') drawArchiveTo(g, 20, 22, 4, false);
    PORTRAITS[type] = c;
  }
  return PORTRAITS[type];
}
function drawBoss(e) {
  const fl = e.flash > 0, lk = look(e);
  if (e.spawn > 0) {
    pell(e.x, e.y + e.r - 2, e.r + 4, 3, '#120e17');
    return;
  }
  if (e.shield) {
    const r = e.r + 8 + Math.sin(frame * 0.15) * 1.5;
    pring(e.x, e.y - 2, r, frame % 20 < 10 ? PAL.c : PAL.C);
    pring(e.x, e.y - 2, r - 2, 'rgba(44,232,245,0.5)');
  }
  switch (e.type) {
    case 'pencil': {
      const a = Math.atan2(e.ay || 0, e.ax || 1), ux = Math.cos(a), uy = Math.sin(a);
      for (let i = -5; i <= 5; i++) px(e.x + ux * i, e.y + uy * i, 2, 2, i > 3 ? PAL.A : i < -3 ? PAL.P : PAL.Y);
      break;
    }
    case 'mimic':
      pell(e.x, e.y + 12, 18, 3, SH);
      drawMimicTo(ctx, e.x, e.y, e.state === 2 || e.state === 1, fl);
      if (!fl) eyes(Math.round(e.x - 8), Math.round(e.y - (e.state >= 1 && e.state <= 2 ? 16 : 6)), 2, 12, 1, lk, true, false);
      break;
    case 'teacher':
      pell(e.x, e.y + 16, 8, 2, SH);
      drawTeacherTo(ctx, e.x, e.y, fl);
      if (!fl) eyes(Math.round(e.x - 5), Math.round(e.y - 6), 1, 6, 1, lk, true, false);
      break;
    case 'punch': {
      const air = e.state === 1, lift = air ? Math.sin((1 - e.ct / 50) * Math.PI) * 24 : 0;
      if (air) {
        pell(e.ax, e.ay + 8, 16 - lift / 4, 4, 'rgba(18,14,23,0.45)');
        if (frame % 6 < 3) pring(e.ax, e.ay + 8, 14, PAL.r);
      } else pell(e.x, e.y + 12, 16, 3, SH);
      drawPunchTo(ctx, e.x, e.y - lift, fl);
      if (!fl) eyes(Math.round(e.x - 7), Math.round(e.y - lift + 2), 2, 10, 1, lk, true, false);
      break;
    }
    case 'archive': {
      const n = 4 - (e.drops || 0);
      pell(e.x, e.y + 20, 20, 3, SH);
      drawArchiveTo(ctx, e.x, e.y, Math.max(1, n), fl);
      if (!fl) eyes(Math.round(e.x - 8), Math.round(e.y + 10 - (Math.max(1, n) - 1) * 8 + 1), 2, 12, 1, lk, true, false);
      break;
    }
  }
}
function drawBossFloor() {
  for (const h of holes) {
    pell(h.x, h.y, h.r, h.r * 0.6, PAL.k);
    pell(h.x, h.y + 1, h.r - 2, h.r * 0.6 - 2, '#05030a');
  }
  for (const p of plates) {
    px(p.x - 8, p.y - 4, 16, 9, PAL.k);
    px(p.x - 7, p.y - 3 + (p.on ? 2 : 0), 14, p.on ? 5 : 7, p.on ? PAL.Y : PAL.a);
    if (!p.on) px(p.x - 7, p.y - 3, 14, 2, PAL.l);
  }
  const boss = enemies.find((e) => e.boss);
  if (plates.length && boss && boss.shield) text('Встаньте на кнопки вдвоём', CX, RY1 - 26, '#2ce8f5', 'center', '#120e17');
}
function drawBossTop() {
  if (!waveLine) return;
  const y = Math.round(waveLine.y);
  for (let x = RX0; x < RX1; x += 2) if (Math.abs(x - waveLine.gap) > waveLine.w / 2) px(x, y - 1, 2, 3, (x + frame) % 6 < 3 ? PAL.r : PAL.R);
  text('НЕВЕРНО', waveLine.gap < CX ? RX1 - 40 : RX0 + 40, y - 12, '#e43b44', 'center', '#120e17');
}
function drawWin() {
  drawOverlay(1);
  px(CX - 124, 36, 248, 150, 'rgba(18,14,23,0.86)');
  px(CX - 124, 36, 248, 1, '#4a405e');
  text('ПОБЕДА!', CX, 48, '#63c74d', 'center', '#120e17', 2);
  text('Архив двоек закрыт', CX, 74, '#e8e0d0', 'center', '#120e17');
  const P = meP();
  [['Этажей', level], ['Врагов стёрто', kills], ['Предметов', P ? P.items.length : 0]].forEach(([a, b], i) => text(a + ' ' + b, CX, 98 + i * 13, '#e8e0d0', 'center', '#120e17'));
  if (Math.floor(frame / 30) % 2 === 0) text(isTouch ? 'Коснись, чтобы начать заново' : 'R или Enter — новый забег', CX, 170, '#fee761', 'center', '#120e17');
}
