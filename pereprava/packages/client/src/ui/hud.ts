// Интерфейс матча: счёт и часы, золото, здоровье и опыт героя, способности, инвентарь, лавка,
// всплывающие сообщения и миникарта. Всё читается из снимка (me) — интерфейс ничего не решает сам.
import {
  ABILITIES,
  ANCIENTS,
  canAfford,
  HERO,
  ITEM,
  ITEMS,
  mapTrees,
  RUNE_NAMES,
  ULT_LEVEL,
  type Command,
  type SimEvent,
  type Snapshot,
} from '@pereprava/shared';
import type { GameView } from '../render/view';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
export const fmt = (t: number) => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
const KEYS = ['Q', 'W', 'E', 'R'];

export interface HudActions {
  send(cmd: Command): void;
  cast(slot: number): void;
  useItem(slot: number): void;
}

export class Hud {
  private last: Record<string, string> = {};
  private toastT = 0;
  private skillBtns: HTMLButtonElement[] = [];
  private skillHero = '';
  private invKey = '';
  private shopRefresh = 0;
  private mm = $<HTMLCanvasElement>('minimap');
  private mctx = this.mm.getContext('2d')!;
  private mmStatic: HTMLCanvasElement | null = null;
  private MMS = 1;
  snap: Snapshot | null = null;

  constructor(
    readonly view: GameView,
    readonly act: HudActions,
  ) {
    $('shopBtn').addEventListener('click', () => this.toggleShop());
    $('shopClose').addEventListener('click', () => this.toggleShop(false));
    this.buildShop();
  }

  private setText(key: string, el: HTMLElement, v: string) {
    if (this.last[key] !== v) {
      this.last[key] = v;
      el.textContent = v;
    }
  }

  toast(text: string) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    this.toastT = 2.8;
  }

  // ── Способности ──

  private buildSkills(hero: string) {
    const box = $('skills');
    box.innerHTML = '';
    this.skillBtns = [];
    HERO[hero].abilities.forEach((id, slot) => {
      const a = ABILITIES[id];
      const b = document.createElement('button');
      b.className = 'sk' + (a.passive ? ' passive' : '');
      b.id = 'sk' + KEYS[slot];
      const [rim, c1, c2, c3] = a.colors;
      b.style.cssText = `--rim:${rim};--c1:${c1};--c2:${c2};--c3:${c3}`;
      b.setAttribute('aria-label', a.passive ? `${a.name}, пассивная` : `${a.name}, клавиша ${KEYS[slot]}`);
      b.title = `${a.name}${a.passive ? ' (пассивная)' : ` (${KEYS[slot]})`}: ${a.desc}`;
      b.innerHTML = `<span>${a.passive ? '∞' : KEYS[slot]}</span>`;
      if (a.passive) {
        b.tabIndex = -1;
        box.appendChild(b);
        this.skillBtns.push(b);
        return;
      }
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.act.cast(slot);
      });
      b.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.act.cast(slot);
        }
      });
      box.appendChild(b);
      this.skillBtns.push(b);
    });
    this.skillHero = hero;
  }

  // ── Инвентарь и лавка ──

  private renderInv(items: (string | null)[]) {
    const el = $('inv');
    el.innerHTML = '';
    items.forEach((id, i) => {
      const it = id ? ITEM[id] : null;
      const b = document.createElement('button');
      b.className = 'slot' + (it?.active ? ' use' : '');
      if (it) {
        b.style.setProperty('--ic', it.color);
        b.innerHTML = `<svg viewBox="0 0 24 24">${it.icon}</svg><kbd>${i + 1}</kbd><i class="icd"></i>`;
        b.title = it.name + (it.active ? `: нажмите или клавиша ${i + 1}` : '');
        b.setAttribute('aria-label', b.title);
      } else {
        b.setAttribute('aria-label', 'Пустой слот');
        b.tabIndex = -1;
      }
      if (it?.active)
        b.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.act.useItem(i);
        });
      el.appendChild(b);
    });
  }

  private buildShop() {
    const list = $('shopList');
    list.innerHTML = '';
    for (const it of ITEMS) {
      const row = document.createElement('div');
      row.className = 'item';
      const parts = it.parts ? `<small class="parts">Из: ${it.parts.map((p) => ITEM[p].name).join(' + ')}</small>` : '';
      row.innerHTML = `<span class="ic" style="--ic:${it.color}"><svg viewBox="0 0 24 24">${it.icon}</svg></span><div><b>${it.name}</b><small>${it.desc}</small>${parts}</div><button class="buy" data-id="${it.id}">${it.price}</button>`;
      row.querySelector('.buy')!.addEventListener('click', () => this.act.send({ c: 'buy', item: it.id }));
      list.appendChild(row);
    }
  }

  get shopOpen() {
    return !$('shop').hidden;
  }

  toggleShop(open?: boolean) {
    const el = $('shop');
    const had = el.contains(document.activeElement);
    el.hidden = open === undefined ? !el.hidden : !open;
    this.refreshShop();
    if (!el.hidden) $('shopClose').focus();
    else if (had) $('shopBtn').focus();
  }

  private refreshShop() {
    const me = this.snap?.me;
    if (this.shopOpen === false || !me) return;
    const n = $('shopNote');
    const here = me.nearShop && me.alive;
    const full = me.items.every((x) => x);
    n.className = here ? 'ok' : '';
    n.textContent = here ? (full ? 'Инвентарь полон' : 'Вы у фонтана, можно покупать') : 'Покупать можно только у своего фонтана';
    $('shopList')
      .querySelectorAll<HTMLButtonElement>('.buy')
      .forEach((b) => (b.disabled = !here || !canAfford(me.items, me.gold, b.dataset.id!)));
  }

  // ── Кадр ──

  update(dt: number) {
    const s = this.snap;
    const me = s?.me;
    if (!s || !me) return;
    if (this.skillHero !== me.hero) this.buildSkills(me.hero);
    this.setText('clock', $('clock'), fmt(s.time));
    this.setText('kA', $('kA'), String(s.kills[this.view.myTeam]));
    this.setText('kE', $('kE'), String(s.kills[1 - this.view.myTeam]));
    this.setText('gold', $('gold'), String(me.gold));
    this.setText('lvl', $('lvl'), String(me.level));
    const u = s.units.find((x) => x.id === me.unit);
    const hp = u ? u.hp : 0;
    const mhp = u ? u.mhp : 1;
    const sh = u?.sh ?? 0;
    this.setText('hp', $('hpText'), `${hp} / ${mhp}${sh ? '  +' + sh : ''}`);
    $('hpFill').style.transform = `scaleX(${hp / mhp})`;
    $('shFill').style.width = (sh ? Math.min(100, (sh / mhp) * 100) : 0) + '%';
    $('xpFill').style.width = (me.level >= 10 ? 100 : (me.xp / me.need) * 100) + '%';
    const dead = !me.alive;
    $('respawn').style.display = dead ? 'block' : 'none';
    if (dead) this.setText('rs', $('respawn'), 'Возрождение через ' + Math.ceil(me.respawn) + ' с');
    this.skillBtns.forEach((b, i) => {
      const ab = ABILITIES[HERO[me.hero].abilities[i]];
      if (ab?.passive) return;
      const locked = !!ab?.ult && me.level < ULT_LEVEL;
      b.classList.toggle('locked', locked);
      b.style.setProperty('--cd', (locked ? 1 : me.cdMax[i] > 0 ? me.cd[i] / me.cdMax[i] : 0).toFixed(3));
      this.setText('sk' + i, b.firstChild as HTMLElement, locked ? String(ULT_LEVEL) : me.cd[i] > 0 ? String(Math.ceil(me.cd[i])) : KEYS[i]);
    });
    const key = me.items.join('|');
    if (key !== this.invKey) {
      this.invKey = key;
      this.renderInv(me.items);
    }
    $('inv')
      .querySelectorAll<HTMLElement>('.slot .icd')
      .forEach((el) => {
        const i = [...el.parentElement!.parentElement!.children].indexOf(el.parentElement!);
        const cd = me.itemCd[i] ?? 0;
        el.style.setProperty('--cd', cd > 0 ? '1' : '0');
      });
    $('shopBtn').classList.toggle('here', me.nearShop);
    this.shopRefresh -= dt;
    if (this.shopRefresh <= 0) {
      this.shopRefresh = 0.25;
      this.refreshShop();
    }
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) $('toast').classList.remove('show');
    }
  }

  /** Сообщения о событиях матча — с точки зрения игрока */
  events(events: SimEvent[]) {
    const s = this.snap;
    const me = s?.me;
    if (!s || !me) return;
    const myTeam = this.view.myTeam;
    const heroOfUnit = (id: number) => {
      const p = s.players.find((q) => s.units.some((u) => u.id === id && u.pl === q.slot));
      return p ? HERO[p.hero] : null;
    };
    for (const e of events) {
      if (e.e === 'heroKill') {
        const victim = heroOfUnit(e.victim);
        const killer = heroOfUnit(e.killer);
        if (!victim) continue;
        if (e.victim === me.unit)
          this.toast(killer ? `${killer.name} ${killer.fem ? 'убила' : 'убил'} вашего ${victim.acc}` : `Ваш ${victim.name.toLowerCase()} погиб`);
        else if (e.victimTeam !== myTeam) this.toast(`${victim.name} ${victim.fem ? 'повержена' : 'повержен'}`);
        else this.toast(`Союзник погиб: ${victim.name}`);
      } else if (e.e === 'tower') {
        const last = e.tier >= 2;
        if (e.team !== myTeam) this.toast(last ? 'Внутренняя вышка врага пала. Их кристалл уязвим' : 'Вражеская вышка разрушена. Следующая — внутренняя');
        else this.toast(last ? 'Наша внутренняя вышка пала. Защищайте кристалл' : 'Наша вышка разрушена. Держите внутреннюю');
      } else if (e.e === 'rune') {
        if (!e.taker) this.toast('В реке появилась ' + (RUNE_NAMES[e.rune] ?? 'руна').toLowerCase());
        else if (e.taker === me.unit) this.toast('Вы взяли: ' + (RUNE_NAMES[e.rune] ?? 'руна').toLowerCase());
      } else if (e.e === 'ping' && e.team === myTeam) this.addPing(e.x, e.z, e.kind);
      else if (e.e === 'level' && e.player === me.slot) this.toast('Новый уровень: ' + e.level);
      else if (e.e === 'respawn' && e.player === me.slot) {
        const h = HERO[me.hero];
        this.toast(`${h.name} ${h.fem ? 'вернулась' : 'вернулся'} в бой`);
      } else if (e.e === 'buy' && e.player === me.slot && e.item) this.toast('Куплено: ' + ITEM[e.item].name);
    }
  }

  // ── Миникарта ──

  private pings: { x: number; z: number; kind: string; t: number }[] = [];

  addPing(x: number, z: number, kind: string) {
    this.pings.push({ x, z, kind, t: performance.now() / 1000 });
    if (this.pings.length > 8) this.pings.shift();
    this.view.ping(x, z, kind);
  }

  initMinimap() {
    const mm = this.mm;
    this.MMS = Math.max(64, Math.round(mm.clientWidth * Math.min(2, window.devicePixelRatio || 1)));
    mm.width = mm.height = this.MMS;
    const st = document.createElement('canvas');
    st.width = st.height = this.MMS;
    const c = st.getContext('2d')!;
    const k = this.MMS / 128;
    const X = (v: number) => (v + 64) * k;
    c.fillStyle = '#4f7a3a';
    c.fillRect(0, 0, this.MMS, this.MMS);
    c.fillStyle = 'rgba(70,72,45,.55)';
    c.beginPath();
    c.moveTo(X(-64), X(-64));
    c.lineTo(X(64), X(-64));
    c.lineTo(X(64), X(64));
    c.fill();
    c.fillStyle = 'rgba(20,48,24,.6)';
    for (const t of mapTrees()) {
      c.beginPath();
      c.arc(X(t.x), X(t.z), 1.1 * k, 0, 7);
      c.fill();
    }
    c.lineCap = 'round';
    c.strokeStyle = '#3a8fc7';
    c.lineWidth = 6 * k;
    c.beginPath();
    c.moveTo(X(-64), X(-64));
    c.lineTo(X(64), X(64));
    c.stroke();
    c.strokeStyle = '#c4a46a';
    c.lineWidth = 3.5 * k;
    c.beginPath();
    c.moveTo(X(ANCIENTS[0].x), X(ANCIENTS[0].z));
    c.lineTo(X(ANCIENTS[1].x), X(ANCIENTS[1].z));
    c.stroke();
    c.fillStyle = '#b7b29f';
    c.beginPath();
    c.arc(X(ANCIENTS[0].x), X(ANCIENTS[0].z), 10 * k, 0, 7);
    c.fill();
    c.fillStyle = '#6e5a55';
    c.beginPath();
    c.arc(X(ANCIENTS[1].x), X(ANCIENTS[1].z), 10 * k, 0, 7);
    c.fill();
    this.mmStatic = st;
  }

  drawMinimap() {
    if (!this.mmStatic) return;
    const ctx = this.mctx;
    const k = this.MMS / 128;
    const X = (v: number) => (v + 64) * k;
    ctx.drawImage(this.mmStatic, 0, 0);
    const myTeam = this.view.myTeam;
    for (const v of this.view.units.values()) {
      const s = v.snap;
      if (s.k === 'hero' || (s.dead && s.k !== 'tower' && s.k !== 'ancient') || v.dying) continue;
      ctx.fillStyle = s.dead ? '#777' : s.tm === 2 ? '#c8b48a' : s.tm === myTeam ? '#3ec7a1' : '#e2504a';
      const sz = s.k === 'creep' || s.k === 'neutral' ? 2.4 : s.k === 'tower' ? 4.5 : 7;
      ctx.fillRect(X(v.x) - (sz * k) / 2, X(v.z) - (sz * k) / 2, sz * k, sz * k);
    }
    for (const v of this.view.units.values()) {
      const s = v.snap;
      if (s.k !== 'hero' || s.dead) continue;
      const mine = s.id === this.view.myUnit;
      ctx.fillStyle = mine ? '#fff' : s.tm === myTeam ? '#3ec7a1' : '#ff5a4a';
      ctx.strokeStyle = mine ? '#f1c453' : '#fff';
      ctx.lineWidth = 1.5 * k;
      ctx.beginPath();
      ctx.arc(X(v.x), X(v.z), 3.2 * k, 0, 7);
      ctx.fill();
      ctx.stroke();
    }
    // Пинги: расходящиеся кольца, 3 секунды
    const now = performance.now() / 1000;
    this.pings = this.pings.filter((p) => p.t > now - 3);
    for (const p of this.pings) {
      const age = now - p.t;
      ctx.strokeStyle = p.kind === 'danger' ? '#ff5a4a' : p.kind === 'go' ? '#7dff9a' : '#f1c453';
      ctx.lineWidth = 2 * k;
      for (let r = 0; r < 2; r++) {
        const f = (age * 1.4 + r * 0.5) % 1;
        ctx.globalAlpha = 1 - f;
        ctx.beginPath();
        ctx.arc(X(p.x), X(p.z), (3 + f * 9) * k, 0, 7);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    const vw = 34 * this.view.viewK();
    ctx.strokeStyle = 'rgba(255,255,255,.55)';
    ctx.lineWidth = 1 * k;
    ctx.strokeRect(X(this.view.camT.x) - (vw * k) / 2, X(this.view.camT.z) - vw * k * 0.35, vw * k, vw * k * 0.7);
  }

  /** Точка на карте по нажатию на миникарту */
  minimapPoint(e: PointerEvent): { x: number; z: number } {
    const r = this.mm.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 128 - 64;
    const z = ((e.clientY - r.top) / r.height) * 128 - 64;
    return { x: Math.max(-58, Math.min(58, x)), z: Math.max(-58, Math.min(58, z)) };
  }
}
