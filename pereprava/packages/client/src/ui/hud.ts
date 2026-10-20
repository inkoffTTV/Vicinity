// Интерфейс матча: счёт и часы, золото, здоровье и опыт героя, способности, инвентарь, лавка,
// всплывающие сообщения и миникарта. Всё читается из снимка (me) — интерфейс ничего не решает сам.
import {
  ABILITIES,
  getMap,
  HERO,
  INVENTORY,
  ITEM,
  mapTrees,
  MAX_LEVEL,
  PHRASES,
  RUNE_NAMES,
  type Command,
  type MapDef,
  type SimEvent,
  type Snapshot,
} from '@pereprava/shared';
import type { GameView } from '../render/view';
import { ShopUI } from './shop';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
export const fmt = (t: number) => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
const KEYS = ['Q', 'W', 'E', 'R'];

export type AimPhase = 'start' | 'move' | 'over' | 'release' | 'cancel';

export interface HudActions {
  send(cmd: Command): void;
  /** Тап пальцем по кнопке умения или Enter: применить с автоприцелом */
  cast(slot: number): void;
  /** Клик мышью по кнопке — как клавиша (прицел или сразу по курсору) */
  skillKey(slot: number): void;
  /** Нужен ли умению прицел (для 'none' — применяется сразу при нажатии) */
  needsAim(slot: number): boolean;
  /** Прицел перетаскиванием от кнопки: смещение пальца от центра кнопки, px.
   *  'over' — палец вернулся на кнопку (отпустит — отмена). 'start' → false: прицел не нужен */
  aimDrag(slot: number, phase: AimPhase, dx: number, dy: number): boolean;
  useItem(slot: number): void;
  /** Свиток телепорта: выбрать, куда (клик по полю или миникарте) */
  tpAim(): void;
  /** Камера к герою (двойное нажатие по портрету) */
  centerCamera(): void;
}

/** Цвета союзных игроков в ленте фраз */
const FEED_COLORS = ['#7dd3fc', '#86efac', '#fcd34d', '#f9a8d4', '#c4b5fd', '#fdba74'];

export interface HoverInfo {
  name: string;
  hp: number;
  mhp: number;
  rel: 'ally' | 'enemy' | 'neutral';
}

export class Hud {
  /** Карта матча — от неё строится миникарта */
  map: MapDef = getMap('1v1');
  private last: Record<string, string> = {};
  private toastT = 0;
  private skillBtns: HTMLButtonElement[] = [];
  private skillHero = '';
  readonly shopUi: ShopUI;
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
    $('courierBtn').addEventListener('click', () => this.act.send({ c: 'courier' }));
    // Колесо фраз
    const wheel = $('sayWheel');
    wheel.innerHTML = PHRASES.map((p, i) => `<button type="button" role="menuitem" data-say="${i}">${p}</button>`).join(
      '',
    );
    wheel.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-say]');
      if (!b) return;
      this.act.send({ c: 'say', id: +b.dataset.say! });
      this.toggleSay(false);
    });
    $('sayBtn').addEventListener('click', () => this.toggleSay());
    $('talentBtn').addEventListener('click', () => this.toggleTalents());
    $('talentBox').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-pick]');
      if (!b) return;
      this.act.send({ c: 'talent', tier: +b.dataset.tier!, pick: +b.dataset.pick! });
      $('talentBox').hidden = true;
    });
    $('tpSlot').addEventListener('click', () => this.act.tpAim());
    $('portrait').addEventListener('dblclick', () => this.act.centerCamera());
    // На телефоне двойное касание
    let tapT = 0;
    $('portrait').addEventListener('pointerup', (e) => {
      if (e.pointerType === 'mouse') return;
      const now = performance.now();
      if (now - tapT < 350) this.act.centerCamera();
      tapT = now;
    });
    $('shopClose').addEventListener('click', () => this.toggleShop(false));
    this.shopUi = new ShopUI({
      send: (c) => this.act.send(c),
      toast: (t) => this.toast(t),
      me: () => this.snap?.me ?? null,
    });
  }

  private setText(key: string, el: HTMLElement, v: string) {
    if (this.last[key] !== v) {
      this.last[key] = v;
      el.textContent = v;
    }
  }

  /** Плашка сверху: кто под курсором и сколько у него здоровья */
  private hoverKey = '';
  hover(info: HoverInfo | null) {
    const el = $('hoverPlate');
    if (!info) {
      if (!el.hidden) el.hidden = true;
      this.hoverKey = '';
      return;
    }
    const key = `${info.name}|${Math.ceil(info.hp)}|${info.mhp}|${info.rel}`;
    if (key === this.hoverKey && !el.hidden) return;
    this.hoverKey = key;
    el.hidden = false;
    el.dataset.rel = info.rel;
    el.querySelector('b')!.textContent = info.name;
    (el.querySelector('i') as HTMLElement).style.width = `${Math.max(0, Math.min(1, info.hp / info.mhp)) * 100}%`;
    el.querySelector('span')!.textContent = `${Math.ceil(info.hp)} / ${Math.round(info.mhp)}`;
  }

  /** Таланты: два варианта для доступного яруса */
  private toggleTalents() {
    const box = $('talentBox');
    const me = this.snap?.me;
    if (!box.hidden || !me) {
      box.hidden = true;
      return;
    }
    const tier = me.talentReady.indexOf(true);
    if (tier < 0) return;
    const ab = HERO[me.hero].abilities.map((id) => ABILITIES[id]);
    const opts =
      tier === 0
        ? [`${ab[0].name}: перезарядка на 30% короче`, `${ab[1].name}: перезарядка на 30% короче`]
        : ['+15 к урону атаки и +150 к здоровью', '+20% к урону умений и +150 к мане'];
    box.innerHTML = `<p>Талант ${tier ? '15' : '10'} уровня — выберите один:</p>${opts
      .map((o, i) => `<button type="button" data-tier="${tier}" data-pick="${i}">${o}</button>`)
      .join('')}`;
    box.hidden = false;
    box.querySelector<HTMLElement>('button')?.focus();
  }

  /** Колесо фраз: открыть или закрыть */
  toggleSay(open?: boolean) {
    const w = $('sayWheel');
    w.hidden = open === undefined ? !w.hidden : !open;
    if (!w.hidden) w.querySelector<HTMLElement>('button')?.focus();
  }

  /** Строка в ленте фраз: исчезает через 6 с */
  private feed(who: string, color: string, text: string) {
    const el = document.createElement('p');
    el.innerHTML = `<b style="color:${color}"></b> <span></span>`;
    el.querySelector('b')!.textContent = who + ':';
    el.querySelector('span')!.textContent = text;
    const f = $('feed');
    f.appendChild(el);
    while (f.children.length > 5) f.firstElementChild!.remove();
    setTimeout(() => el.classList.add('out'), 5200);
    setTimeout(() => el.remove(), 6000);
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
    // Кнопки новые — забываем, что писали в старые
    for (const k of Object.keys(this.last)) if (k.startsWith('sk') || k.startsWith('chg')) delete this.last[k];
    HERO[hero].abilities.forEach((id, slot) => {
      const a = ABILITIES[id];
      const wrap = document.createElement('div');
      wrap.className = 'skw';
      wrap.dataset.slot = String(slot);
      const up = document.createElement('button');
      up.className = 'lvlup';
      up.type = 'button';
      up.hidden = true;
      up.textContent = '+';
      up.setAttribute('aria-label', `Изучить: ${a.name} (Ctrl+${KEYS[slot]})`);
      up.title = `Изучить: ${a.name} (Ctrl+${KEYS[slot]})`;
      up.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.act.send({ c: 'learn', slot });
      });
      wrap.appendChild(up);
      const pips = document.createElement('div');
      pips.className = 'pips';
      pips.innerHTML = '<i></i>'.repeat(a.ult ? 3 : 4);
      const b = document.createElement('button');
      b.className = 'sk' + (a.passive ? ' passive' : '');
      b.id = 'sk' + KEYS[slot];
      const [rim, c1, c2, c3] = a.colors;
      b.style.cssText = `--rim:${rim};--c1:${c1};--c2:${c2};--c3:${c3}`;
      b.setAttribute('aria-label', a.passive ? `${a.name}, пассивная` : `${a.name}, клавиша ${KEYS[slot]}`);
      b.title = `${a.name}${a.passive ? ' (пассивная)' : ` (${KEYS[slot]})`}: ${a.desc}`;
      b.innerHTML = `<span class="k">${KEYS[slot]}</span><b class="cdn"></b>${a.passive ? '' : '<small class="mc"></small>'}${a.charges ? '<em class="chg"></em>' : ''}`;
      wrap.append(b, pips);
      if (a.passive) {
        b.tabIndex = -1;
        box.appendChild(wrap);
        this.skillBtns.push(b);
        return;
      }
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.pointerType === 'mouse') return this.act.skillKey(slot);
        if (!this.act.needsAim(slot)) return this.act.cast(slot);
        // Палец: тап — автоприцел; повёл — прицел; отпустил — применить; вернул на кнопку — отмена
        const r = b.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        let aiming = false;
        try {
          b.setPointerCapture(e.pointerId);
        } catch {
          /* не важно */
        }
        const over = (ev: PointerEvent) => Math.hypot(ev.clientX - cx, ev.clientY - cy) < r.width * 0.6;
        const move = (ev: PointerEvent) => {
          if (ev.pointerId !== e.pointerId) return;
          const dx = ev.clientX - cx;
          const dy = ev.clientY - cy;
          if (!aiming && Math.hypot(dx, dy) > 18) aiming = this.act.aimDrag(slot, 'start', dx, dy);
          if (aiming) this.act.aimDrag(slot, over(ev) ? 'over' : 'move', dx, dy);
          b.classList.toggle('aiming', aiming && !over(ev));
        };
        const end = (ev: PointerEvent) => {
          if (ev.pointerId !== e.pointerId) return;
          b.removeEventListener('pointermove', move);
          b.removeEventListener('pointerup', end);
          b.removeEventListener('pointercancel', end);
          b.classList.remove('aiming');
          if (!aiming) {
            if (ev.type === 'pointerup') this.act.cast(slot);
          } else if (ev.type === 'pointercancel' || over(ev)) this.act.aimDrag(slot, 'cancel', 0, 0);
          else this.act.aimDrag(slot, 'release', ev.clientX - cx, ev.clientY - cy);
        };
        b.addEventListener('pointermove', move);
        b.addEventListener('pointerup', end);
        b.addEventListener('pointercancel', end);
      });
      b.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.act.cast(slot);
        }
      });
      box.appendChild(wrap);
      this.skillBtns.push(b);
    });
    this.skillHero = hero;
  }

  // ── Инвентарь и лавка ──

  private renderInv(items: (string | null)[]) {
    const el = $('inv');
    el.innerHTML = '';
    // 6 основных слотов 3×2 и рюкзак на 3 (в рюкзаке предметы не работают)
    items.forEach((id, i) => {
      const it = id ? ITEM[id] : null;
      const b = document.createElement('button');
      b.className = 'slot' + (it?.active && i < INVENTORY ? ' use' : '') + (i >= INVENTORY ? ' bp' : '');
      if (it) {
        b.style.setProperty('--ic', it.color);
        b.innerHTML = `<svg viewBox="0 0 24 24">${it.icon}</svg>${i < INVENTORY ? `<kbd>${i + 1}</kbd>` : ''}<i class="icd"></i>`;
        b.title =
          it.name + (i >= INVENTORY ? ' (в рюкзаке — не работает)' : it.active ? `: нажмите или клавиша ${i + 1}` : '');
        b.setAttribute('aria-label', b.title);
      } else {
        b.setAttribute('aria-label', 'Пустой слот');
        b.tabIndex = -1;
      }
      if (it?.active && i < INVENTORY)
        b.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.act.useItem(i);
        });
      el.appendChild(b);
    });
  }

  get shopOpen() {
    return !$('shop').hidden;
  }

  toggleShop(open?: boolean) {
    const el = $('shop');
    const had = el.contains(document.activeElement);
    el.hidden = open === undefined ? !el.hidden : !open;
    this.refreshShop();
    if (!el.hidden) {
      this.shopUi.render();
      // С клавиатуры сразу можно искать; на телефоне не открываем экранную клавиатуру
      if (matchMedia('(pointer: fine)').matches) $('shopSearch').focus();
      else $('shopClose').focus();
    } else if (had) $('shopBtn').focus();
  }

  private refreshShop() {
    this.shopUi.update(this.snap?.me ?? null);
  }

  // ── Кадр ──

  update(dt: number) {
    const s = this.snap;
    const me = s?.me;
    if (!s || !me) return;
    if (this.skillHero !== me.hero) this.buildSkills(me.hero);
    this.setText('clock', $('clock'), (s.night ? '☾ ' : '☀ ') + fmt(s.time));
    $('clock').title = `${s.night ? 'Ночь' : 'День'}: ещё ${Math.ceil(s.dayT)} с. Ночью герои видят ближе`;
    $('talentBtn').hidden = !me.talentReady.some(Boolean);
    this.setText('kA', $('kA'), String(s.kills[this.view.myTeam]));
    this.setText('kE', $('kE'), String(s.kills[1 - this.view.myTeam]));
    this.setText('gold', $('gold'), String(me.gold));
    this.setText('lvl', $('lvl'), String(me.level));
    const u = s.units.find((x) => x.id === me.unit);
    const hp = me.alive ? me.hp : 0;
    const mhp = me.maxHp || 1;
    const sh = u?.sh ?? 0;
    this.setText('hp', $('hpText'), `${hp} / ${mhp}${sh ? '  +' + sh : ''}`);
    this.setText('hpr', $('hpRegen'), `+${me.hpRegen.toFixed(1)}`);
    $('hpFill').style.transform = `scaleX(${hp / mhp})`;
    $('shFill').style.width = (sh ? Math.min(100, (sh / mhp) * 100) : 0) + '%';
    this.setText('mp', $('mpText'), `${me.mana} / ${me.maxMana}`);
    this.setText('mpr', $('mpRegen'), `+${me.manaRegen.toFixed(1)}`);
    $('mpFill').style.transform = `scaleX(${me.maxMana ? me.mana / me.maxMana : 0})`;
    $('xpFill').style.width = (me.level >= MAX_LEVEL ? 100 : (me.xp / me.need) * 100) + '%';
    // Атрибуты и характеристики
    this.setText('aStr', $('aStr'), String(me.attrs.str));
    this.setText('aAgi', $('aAgi'), String(me.attrs.agi));
    this.setText('aInt', $('aInt'), String(me.attrs.int));
    if (this.last.prim !== me.primary) {
      this.last.prim = me.primary;
      document
        .querySelectorAll<HTMLElement>('#attrs span')
        .forEach((el) => el.classList.toggle('prim', el.dataset.a === me.primary));
    }
    this.setText('stDmg', $('stDmg'), String(me.dmg));
    this.setText('stArm', $('stArm'), me.armor.toFixed(1));
    this.setText('stSpd', $('stSpd'), me.speed.toFixed(1));
    this.setText('stAs', $('stAs'), me.atkSpeed.toFixed(2));
    // Телепорт, нейтральный предмет, курьер
    this.setText('tpc', $('tpCount'), String(me.tp));
    ($('tpSlot').querySelector('.icd') as HTMLElement).style.setProperty('--cd', me.tpCd > 0 || !me.tp ? '1' : '0');
    if (this.last.neutral !== String(me.neutral)) {
      this.last.neutral = String(me.neutral);
      const it = me.neutral ? ITEM[me.neutral] : null;
      const nb = $('neutralSlot');
      nb.style.setProperty('--ic', it?.color ?? 'transparent');
      nb.innerHTML = it ? `<svg viewBox="0 0 24 24">${it.icon}</svg>` : '';
      nb.title = it ? `${it.name}: ${it.desc}` : 'Нейтральный предмет: выпадает из лесных зверей';
      nb.setAttribute('aria-label', it ? `Нейтральный предмет: ${it.name}` : 'Нейтральный предмет: пусто');
    }
    const cb = $('courierBtn');
    const cs =
      me.courier === 'dead'
        ? `Курьер · ${Math.ceil(me.courierAt)} с`
        : me.courier === 'go'
          ? 'Курьер везёт'
          : me.courier === 'back'
            ? 'Курьер летит назад'
            : me.stash.length
              ? `Курьер · ${me.stash.length}`
              : 'Курьер';
    this.setText('cour', cb, cs);
    cb.className = me.courier === 'go' ? 'go' : me.courier === 'dead' ? 'dead' : '';
    const dead = !me.alive;
    $('respawn').style.display = dead ? 'block' : 'none';
    if (dead) this.setText('rs', $('respawn'), 'Возрождение через ' + Math.ceil(me.respawn) + ' с');
    this.skillBtns.forEach((b, i) => {
      const ab = ABILITIES[HERO[me.hero].abilities[i]];
      const wrap = b.parentElement!;
      const L = me.skill[i] ?? 0;
      // Кнопка «+» и деления уровня
      (wrap.querySelector('.lvlup') as HTMLElement).hidden = !(me.points > 0 && me.canLearn[i]);
      if (this.last['pip' + i] !== String(L)) {
        this.last['pip' + i] = String(L);
        wrap.querySelectorAll('.pips i').forEach((p, k) => p.classList.toggle('on', k < L));
      }
      b.classList.toggle('unlearned', L === 0);
      if (ab?.passive) return;
      const locked = L === 0;
      b.classList.toggle('locked', false);
      b.classList.toggle('nomana', !locked && me.mana < me.manaCost[i]);
      const chg = me.charges[i] ?? -1;
      if (chg >= 0) this.setText('chg' + i, b.querySelector('.chg') as HTMLElement, String(chg));
      this.setText('mc' + i, b.querySelector('.mc') as HTMLElement, me.manaCost[i] ? String(me.manaCost[i]) : '');
      b.style.setProperty('--cd', (me.cdMax[i] > 0 && !locked ? me.cd[i] / me.cdMax[i] : 0).toFixed(3));
      this.setText(
        'sk' + i,
        b.querySelector('.cdn') as HTMLElement,
        me.cd[i] > 0 && !locked ? String(Math.ceil(me.cd[i])) : '',
      );
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
          this.toast(
            killer
              ? `${killer.name} ${killer.fem ? 'убила' : 'убил'} вашего ${victim.acc}`
              : `Ваш ${victim.name.toLowerCase()} погиб`,
          );
        else if (e.victimTeam !== myTeam) this.toast(`${victim.name} ${victim.fem ? 'повержена' : 'повержен'}`);
        else this.toast(`Союзник погиб: ${victim.name}`);
      } else if (e.e === 'tower') {
        const last = e.tier >= 2;
        if (e.team !== myTeam)
          this.toast(
            last
              ? 'Внутренняя вышка врага пала. Их кристалл уязвим'
              : 'Вражеская вышка разрушена. Следующая — внутренняя',
          );
        else
          this.toast(
            last ? 'Наша внутренняя вышка пала. Защищайте кристалл' : 'Наша вышка разрушена. Держите внутреннюю',
          );
      } else if (e.e === 'rune') {
        if (!e.taker) this.toast('В реке появилась ' + (RUNE_NAMES[e.rune] ?? 'руна').toLowerCase());
        else if (e.taker === me.unit) this.toast('Вы взяли: ' + (RUNE_NAMES[e.rune] ?? 'руна').toLowerCase());
      } else if (e.e === 'ping' && e.team === myTeam) this.addPing(e.x, e.z, e.kind);
      else if (e.e === 'castFail' && e.player === me.slot) this.castFailed(e.slot, e.reason);
      else if (e.e === 'level' && e.player === me.slot) this.toast('Новый уровень: ' + e.level);
      else if (e.e === 'respawn' && e.player === me.slot) {
        const h = HERO[me.hero];
        this.toast(`${h.name} ${h.fem ? 'вернулась' : 'вернулся'} в бой`);
      } else if (e.e === 'buy' && e.player === me.slot && e.item) this.toast('Куплено: ' + ITEM[e.item].name);
      else if (e.e === 'bossUp') this.toast('Страж реки пробудился в своём логове у реки');
      else if (e.e === 'boss')
        this.toast(
          e.team === myTeam
            ? `Страж реки повержен! Команде — золото и благословение, у ${s.players[e.killer]?.name ?? 'союзника'} — Сердце стража (вторая жизнь)`
            : 'Враги одолели Стража реки — осторожно, у одного из них вторая жизнь',
        );
      else if (e.e === 'aegis' && e.id === me.unit) this.toast('Сердце стража вернуло вас к жизни!');
      else if (e.e === 'say' && e.team === myTeam) {
        const p = s.players[e.player];
        this.feed(
          `${p?.name ?? 'Игрок'} (${HERO[p?.hero ?? '']?.name ?? ''})`,
          FEED_COLORS[e.player % FEED_COLORS.length],
          PHRASES[e.id] ?? '',
        );
      } else if (e.e === 'neutral' && e.player === me.slot)
        this.toast('Найден нейтральный предмет: ' + ITEM[e.item].name);
      else if (e.e === 'courier' && e.player === me.slot)
        this.toast(
          e.state === 'go'
            ? 'Курьер полетел к вам'
            : e.state === 'done'
              ? 'Курьер доставил вещи'
              : e.state === 'dead'
                ? 'Курьер погиб — вещи вернулись в тайник'
                : '',
        );
    }
  }

  /** Умение не сработало: тряхнуть кнопку и сказать почему */
  private castFailed(slot: number, reason: string) {
    const b = this.skillBtns[slot];
    if (b) {
      b.classList.remove('deny');
      void b.offsetWidth; // перезапуск анимации
      b.classList.add('deny');
      b.addEventListener('animationend', () => b.classList.remove('deny'), { once: true });
    }
    const text: Record<string, string> = {
      target: 'Нет цели рядом',
      cd: 'Умение перезаряжается',
      stun: 'Герой оглушён',
      silence: 'Умения заблокированы',
      level: 'Умение не изучено — нажмите «+» над ним (Ctrl+клавиша)',
      mana: 'Не хватает маны',
    };
    this.toast(text[reason] ?? 'Не получилось');
  }

  // ── Миникарта ──

  private pings: { x: number; z: number; kind: string; t: number }[] = [];

  addPing(x: number, z: number, kind: string) {
    this.pings.push({ x, z, kind, t: performance.now() / 1000 });
    if (this.pings.length > 8) this.pings.shift();
    this.view.ping(x, z, kind);
  }

  /** Сменить карту: миникарта перерисовывается */
  setMap(m: MapDef) {
    this.map = m;
    if (this.mmStatic) this.initMinimap();
  }

  /** Половина стороны миникарты в метрах (на карте прототипа — 64) */
  private get mmHalf() {
    return this.map.half + 4;
  }

  initMinimap() {
    const mm = this.mm;
    const m = this.map;
    const H = this.mmHalf;
    this.MMS = Math.max(64, Math.round(mm.clientWidth * Math.min(2, window.devicePixelRatio || 1)));
    mm.width = mm.height = this.MMS;
    const st = document.createElement('canvas');
    st.width = st.height = this.MMS;
    const c = st.getContext('2d')!;
    const k = this.MMS / (H * 2);
    // Размеры значков — как на миникарте прототипа (128 м), иначе на большой карте всё мелкое
    const ik = this.MMS / 128;
    const X = (v: number) => (v + H) * k;
    c.fillStyle = '#4f7a3a';
    c.fillRect(0, 0, this.MMS, this.MMS);
    c.fillStyle = 'rgba(70,72,45,.55)';
    c.beginPath();
    c.moveTo(X(-H), X(-H));
    c.lineTo(X(H), X(-H));
    c.lineTo(X(H), X(H));
    c.fill();
    c.fillStyle = 'rgba(20,48,24,.6)';
    for (const t of mapTrees(m)) {
      c.beginPath();
      c.arc(X(t.x), X(t.z), 1.1 * k, 0, 7);
      c.fill();
    }
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.strokeStyle = '#3a8fc7';
    c.lineWidth = 6 * k;
    c.beginPath();
    c.moveTo(X(-H), X(-H));
    c.lineTo(X(H), X(H));
    c.stroke();
    c.strokeStyle = '#c4a46a';
    c.lineWidth = 3.5 * k;
    for (const ln of m.lanes) {
      c.beginPath();
      ln.points.forEach((pt, i) => (i ? c.lineTo(X(pt.x), X(pt.z)) : c.moveTo(X(pt.x), X(pt.z))));
      c.stroke();
    }
    c.fillStyle = '#b7b29f';
    c.beginPath();
    c.arc(X(m.ancients[0].x), X(m.ancients[0].z), 10 * k, 0, 7);
    c.fill();
    c.fillStyle = '#6e5a55';
    c.beginPath();
    c.arc(X(m.ancients[1].x), X(m.ancients[1].z), 10 * k, 0, 7);
    c.fill();
    // Логово Стража реки
    c.fillStyle = '#ffd86a';
    c.strokeStyle = '#3a2a10';
    c.lineWidth = 2 * k;
    c.beginPath();
    c.arc(X(m.boss.x), X(m.boss.z), 6 * k, 0, 7);
    c.fill();
    c.stroke();
    void ik;
    this.mmStatic = st;
  }

  drawMinimap() {
    if (!this.mmStatic) return;
    const ctx = this.mctx;
    const H = this.mmHalf;
    const k = this.MMS / 128;
    const X = (v: number) => (v + H) * (this.MMS / (H * 2));
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
    const mk = this.MMS / (H * 2);
    ctx.strokeRect(X(this.view.camT.x) - (vw * mk) / 2, X(this.view.camT.z) - vw * mk * 0.35, vw * mk, vw * mk * 0.7);
  }

  /** Точка на карте по нажатию на миникарту */
  minimapPoint(e: PointerEvent): { x: number; z: number } {
    const r = this.mm.getBoundingClientRect();
    const H = this.mmHalf;
    const x = ((e.clientX - r.left) / r.width) * H * 2 - H;
    const z = ((e.clientY - r.top) / r.height) * H * 2 - H;
    const L = this.map.limit - 1;
    return { x: Math.max(-L, Math.min(L, x)), z: Math.max(-L, Math.min(L, z)) };
  }
}
