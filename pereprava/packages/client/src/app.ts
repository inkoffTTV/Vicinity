// Клиент целиком: меню → поиск → «Игра найдена» → загрузка → матч → итоги. Логика меню повторяет
// прототип 0.3; матч идёт через Session (одиночный — LocalSession на общей симуляции).
import {
  ABILITIES,
  difficulty,
  DIFFICULTIES,
  getMap,
  HERO,
  HEROES,
  mapOfMode,
  MODE_SIZE,
  type Command,
  type GameMode,
  type MapId,
  type MatchSetup,
  type ServerMsg,
  type UnitSnap,
  type Snapshot,
  type Team,
} from '@pereprava/shared';
import { LocalSession } from './game/local';
import { NetSession } from './game/net';
import { ActivityBridge } from './net/activity';
import { Connection } from './net/connection';
import { Lobby } from './ui/lobby';
import { Sound, type Volumes } from './audio/sound';
import { renderHeroCards, scoreTable } from './ui/screens';
import { PickScreen } from './ui/pick';
import { Portrait } from './render/portrait';
import type { Session } from './game/session';
import { attachInput } from './game/input';
import { AutoScale } from './render/autoscale';
import { applyQuality, basePixelRatio, createScene, type Quality } from './render/scene';
import { buildTerrain, disposeTerrain, type Terrain } from './render/terrain';
import { GameView } from './render/view';
import { fmt, Hud } from './ui/hud';
import { store } from './ui/store';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

type State = 'menu' | 'search' | 'accept' | 'pick' | 'loading' | 'play' | 'over';

interface Profile {
  name: string;
  matches: number;
  wins: number;
  history: { w: boolean; t: number; k: number; d: number; diff: string; lh: number; hero?: string }[];
}
interface Settings {
  diff: string;
  /** Карта одиночной игры: 1 на 1 / 2 на 2 / 3 на 3 */
  mode?: GameMode;
  quality: Quality;
  shadows: boolean;
  hero: string;
  vol: Volumes;
  /** Оформление: как в системе, день или ночь */
  theme: 'auto' | 'day' | 'night';
  /** Умения с клавиатуры — сразу по курсору, без режима прицела */
  quickCast?: boolean;
}

/** Имя юнита для плашки наведения */
const CREEP_NAMES: Record<string, string> = {
  melee: 'Мечник',
  ranged: 'Лучник',
  tower: 'Вышка',
  ancient: 'Кристалл',
  n_small: 'Лесной волк',
  n_big: 'Лесной великан',
};

const TIPS = [
  'A и клик — атака с передвижением: герой идёт и бьёт всех врагов по пути.',
  'На телефоне умение можно навести: потяните от кнопки и отпустите. Вернули палец на кнопку — отмена.',
  'Вышка бьёт героя, который атакует вражеского героя рядом с ней.',
  'Щит перед дракой с Громилой съедает почти весь его удар по земле.',
  'Добивайте крипов последним ударом: золото получает только добивший.',
  'Красный круг под Громилой — время для скачка.',
  'Покупать можно только у своего фонтана.',
];

export class App {
  readonly app = $('game');
  readonly kit = createScene(this.app);
  readonly view = new GameView(this.kit, $('bars'), $('floats'));
  readonly hud: Hud;
  state: State = 'menu';
  session: Session | null = null;
  /** Сцена в меню: стоящие на старте герои (мир не тикает) */
  private preview: LocalSession;
  snap: Snapshot | null = null;
  profile: Profile = { name: 'Игрок', matches: 0, wins: 0, history: [], ...store.get<Partial<Profile>>('profile', {}) };
  settings: Settings = {
    diff: 'normal',
    quality: matchMedia('(pointer: coarse)').matches ? 'mid' : 'high',
    shadows: true,
    hero: 'mage',
    vol: { master: 0.8, sfx: 0.9, ambient: 0.5 },
    theme: 'auto',
    ...store.get<Partial<Settings>>('settings', {}),
  };
  readonly sound = new Sound(this.settings.vol);
  /** Герой бота в одиночной игре (случайный другой) */
  private enemyHero = 'brute';
  private pickT = 0;
  speed = /x4/.test(location.hash) ? 4 : 1;
  readonly conn = new Connection(() => this.playerName());
  readonly lobby: Lobby;
  private menuFocusBot = false;
  private pendingJoin = '';
  /** Активность в звонке Vicinity: мост к мессенджеру и создана ли уже комната ведущим */
  private activity: ActivityBridge | null = null;
  private activityCreated = false;
  private searchT = 0;
  private foundAt = 3;
  private acceptT = 0;
  private loadT = 0;
  private mmT = 0;
  private last = performance.now();
  /** #fps: счётчик кадров и вызовов отрисовки для профилирования на телефоне */
  private fpsEl: HTMLElement | null = null;
  private fpsAcc = { t: 0, n: 0 };
  /** Динамическое разрешение в матче */
  private readonly autoscale = new AutoScale((k) => {
    // setPixelRatio сам пересчитывает размер буфера
    this.kit.renderer.setPixelRatio(basePixelRatio(this.settings.quality) * k);
  });

  /** Земля текущей карты и её id (меняется, когда матч идёт на другой карте) */
  private terrain: Terrain | null = null;
  private mapId: MapId | null = null;

  /** Поставить карту: пересобрать землю, сообщить виду и миникарте */
  private applyMap(id: MapId) {
    if (this.mapId === id) return;
    if (this.terrain) disposeTerrain(this.terrain);
    const m = getMap(id);
    this.terrain = buildTerrain(m, this.kit.night);
    this.kit.scene.add(this.terrain.group);
    this.mapId = id;
    this.view.map = m;
    if (this.hud) this.hud.setMap(m);
  }

  /** Герой, выпавший в «Хаосе» (для сообщения в начале матча) */
  private chaosHero = '';

  /** Карта одиночной игры из настроек */
  private localMode(): GameMode {
    const m = this.settings.mode;
    return m && MODE_SIZE[m] ? m : '1v1';
  }

  constructor() {
    this.applyMap(mapOfMode(this.localMode()));
    this.hud = new Hud(this.view, {
      send: (c) => this.send(c),
      cast: (slot) => this.cast(slot, null),
      skillKey: (slot) => this.skillKey(slot),
      needsAim: (slot) => {
        const a = this.abilityOf(slot);
        return !!a && a.target !== 'none';
      },
      aimDrag: (slot, phase, dx, dy) => this.aimDrag(slot, phase, dx, dy),
      useItem: (slot) => this.useItem(slot, null),
      tpAim: () => this.tpAim(),
      centerCamera: () => this.centerCamera(),
    });
    this.hud.setMap(this.view.map);
    this.view.onFloat = (x, y, z, text, color) => this.floatText(x, y, z, text, color);
    this.preview = this.makeLocal();
    this.showPreview();
    attachInput(this.kit.renderer.domElement, this.view, {
      playing: () => this.state === 'play' && !!this.snap?.me?.alive,
      orderAt: (sx, sy, button, touch) => this.orderAt(sx, sy, button, touch),
      hover: (sx, sy) => this.hover(sx, sy),
      moveTo: (x, z) => this.send({ c: 'move', x, z }),
      skillKey: (slot) => this.skillKey(slot),
      learn: (slot) => this.send({ c: 'learn', slot }),
      tpAim: () => this.tpAim(),
      courier: () => this.send({ c: 'courier' }),
      sayWheel: () => this.hud.toggleSay(),
      armAttackMove: () => this.armAttackMove(),
      cancelAim: () => this.cancelAim(),
      useItem: (slot, aim) => this.useItem(slot, aim),
      toggleShop: (open) => this.hud.toggleShop(open),
      stop: () => this.send({ c: 'stop' }),
      ping: (x, z, kind) => this.ping(x, z, kind),
      heroPos: () => {
        const v = this.view.units.get(this.view.myUnit);
        return v ? { x: v.x, z: v.z } : null;
      },
    });
    // Миникарта: нажатие — идти; правая кнопка, Alt или долгое нажатие пальцем — пинг союзникам
    let holdT = 0;
    const mm = $('minimap');
    mm.addEventListener('contextmenu', (e) => e.preventDefault());
    mm.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.state !== 'play') return;
      const p = this.hud.minimapPoint(e);
      if (this.tpPicking) {
        this.tpPicking = false;
        this.refreshCursor();
        return this.send({ c: 'tp', x: p.x, z: p.z });
      }
      if (e.altKey) return this.ping(p.x, p.z, e.shiftKey ? 'danger' : 'look');
      if (e.pointerType !== 'mouse') {
        clearTimeout(holdT);
        holdT = window.setTimeout(() => this.ping(p.x, p.z, 'look'), 550);
      }
      if (!this.snap?.me?.alive) return;
      this.send({ c: 'move', x: p.x, z: p.z });
      this.view.showMarker(p.x, p.z, false);
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) mm.addEventListener(ev, () => clearTimeout(holdT));
    this.initMenu();
    this.lobby = new Lobby(this.conn, $('game'), (room) => {
      // Матч кончился, а мы ещё на экране итогов — остаёмся; комнаты нет — в меню
      if (!room && this.session instanceof NetSession) this.backToMenu('Вы вышли из комнаты');
      if (room && room.state === 'lobby' && this.state === 'over' && this.session instanceof NetSession) {
        this.backToMenu('');
        this.lobby.open();
      }
    });
    this.conn.on((m) => this.onServer(m));
    this.conn.onStatus = (st) => {
      $('netBanner').hidden = !(this.session instanceof NetSession && st !== 'online');
      this.lobby.render();
    };
    $('modeFriend').addEventListener('click', () => this.lobby.open());
    $('modeBot').addEventListener('click', () => this.lobby.close());
    // Сборка без сервера (VITE_OFFLINE=1, например демо-страница): только игра против бота
    const offline = import.meta.env.VITE_OFFLINE === '1';
    if (offline) {
      const f = $<HTMLButtonElement>('modeFriend');
      f.disabled = true;
      f.innerHTML = 'С другом<small>нужен игровой сервер</small>';
    }
    // Ссылка-приглашение ?room=КОД или сохранённый токен (вернуться в идущий матч после перезагрузки)
    const code = offline
      ? ''
      : (new URLSearchParams(location.search).get('room') ?? /room=([A-Za-z0-9]+)/.exec(location.hash)?.[1] ?? '');
    if (offline) {
      /* без сервера не подключаемся */
    } else if (ActivityBridge.active) this.startActivity();
    else if (code) {
      this.pendingJoin = code.toUpperCase();
      this.lobby.open();
    } else if (store.get<string | undefined>('token', undefined)) this.conn.connect();
    new ResizeObserver(() => this.resize()).observe(this.app);
    applyQuality(this.kit, this.settings.quality, this.settings.shadows);
    this.resize();
    this.setState('menu');
    if (/debug/.test(location.hash)) this.exposeDebug();
    if (/fps/.test(location.hash)) {
      this.fpsEl = document.createElement('div');
      this.fpsEl.id = 'fps';
      this.app.appendChild(this.fpsEl);
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  // ── Сессии ──

  private makeLocal(seed = 20261019): LocalSession {
    const mode0 = this.localMode();
    // «Хаос»: в настоящем матче герой выпадает случайно (в меню — выбранный)
    const rnd = (k: number) => HEROES[Math.floor((((seed * 9301 + k * 49297) % 233280) / 233280) * HEROES.length)].id;
    let hero = HERO[this.settings.hero] ? this.settings.hero : 'mage';
    if (mode0 === 'chaos' && seed !== 20261019) {
      hero = rnd(1);
      this.enemyHero = rnd(2);
    }
    this.chaosHero = mode0 === 'chaos' && seed !== 20261019 ? hero : '';
    if (this.enemyHero === hero) this.enemyHero = hero === 'brute' ? 'mage' : 'brute';
    const mode = this.localMode();
    const n = MODE_SIZE[mode];
    // Остальные герои — по кругу из списка, без повторов, пока героев хватает
    const used = new Set([hero, this.enemyHero]);
    const pool = HEROES.map((h) => h.id).filter((id) => !used.has(id));
    let pi = Math.floor((seed % 997) % Math.max(1, pool.length));
    const nextHero = () => {
      if (!pool.length) return HEROES[Math.floor(Math.random() * HEROES.length)].id;
      const id = pool[pi++ % pool.length];
      return id;
    };
    const players: MatchSetup['players'] = [{ name: this.playerName(), team: 0, hero, bot: null }];
    for (let i = 1; i < n; i++) {
      const h = nextHero();
      players.push({ name: `${HERO[h].name} (союзник)`, team: 0, hero: h, bot: this.settings.diff });
    }
    players.push({ name: HERO[this.enemyHero].name, team: 1, hero: this.enemyHero, bot: this.settings.diff });
    for (let i = 1; i < n; i++) {
      const h = nextHero();
      players.push({ name: HERO[h].name, team: 1, hero: h, bot: this.settings.diff });
    }
    return new LocalSession({ seed, jungle: true, mode: mapOfMode(mode), chaos: mode === 'chaos', players });
  }

  /** Случайный противник для одиночной игры — не тот же герой */
  private rollEnemy() {
    const ids = Object.keys(HERO).filter((h) => h !== this.settings.hero);
    this.enemyHero = ids[Math.floor(Math.random() * ids.length)];
  }

  private showPreview() {
    this.applyMap(this.preview.world.mapId);
    this.view.clear();
    const s = this.preview.snapshot();
    this.view.myTeam = 0;
    this.view.myUnit = s.me?.unit ?? 0;
    this.view.renderTick = s.tick;
    this.view.applySnapshot(s);
    this.view.applySnapshot(s);
  }

  send(cmd: Command) {
    if (this.state === 'play') this.session?.send(cmd);
  }

  private cast(slot: number, aim: { x: number; z: number } | null, unit = 0) {
    if (this.state !== 'play' || !this.snap?.me?.alive) return;
    if (!aim) return this.send({ c: 'cast', slot });
    if (unit) return this.send({ c: 'cast', slot, x: aim.x, z: aim.z, id: unit });
    // Способности «в цель»: враг рядом с прицелом
    let id = 0;
    let bd = 2.5;
    for (const v of this.view.units.values())
      if (!v.snap.dead && v.snap.tm !== this.view.myTeam && Math.hypot(v.x - aim.x, v.z - aim.z) < bd) {
        bd = Math.hypot(v.x - aim.x, v.z - aim.z);
        id = v.id;
      }
    this.send({ c: 'cast', slot, x: aim.x, z: aim.z, id: id || undefined });
  }

  /** Пинг на карте: союзники видят метку и слышат сигнал */
  private pingAt = 0;
  ping(x: number, z: number, kind: 'look' | 'danger' | 'go' = 'look') {
    if (this.state !== 'play' || performance.now() - this.pingAt < 600) return;
    this.pingAt = performance.now();
    this.send({ c: 'ping', x, z, kind });
  }

  private useItem(slot: number, aim: { x: number; z: number } | null) {
    if (this.state !== 'play' || !this.snap?.me?.alive) return;
    this.send(aim ? { c: 'use', slot, x: aim.x, z: aim.z } : { c: 'use', slot });
  }

  /** Нажатие по полю. true — можно вести героя за пальцем/мышью дальше */
  private orderAt(sx: number, sy: number, button = 0, touch = false): boolean {
    if (this.state !== 'play' || !this.snap?.me?.alive) return false;
    // Выбор точки телепорта: левая — сюда, правая — отмена
    if (this.tpPicking) {
      this.tpPicking = false;
      this.refreshCursor();
      const g = this.view.groundAt(sx, sy);
      if (button !== 2 && g) this.send({ c: 'tp', x: g.x, z: g.z });
      return false;
    }
    // Идёт прицел умения: левая — применить, правая — отмена
    if (this.aiming) {
      if (button === 2) this.cancelAim();
      else this.castAimed(sx, sy);
      return false;
    }
    if (this.amoveArmed) {
      this.amoveArmed = false;
      this.refreshCursor();
      if (button === 2) return false;
      const e = this.view.pickEnemy(sx, sy, touch);
      if (e && !e.inv) {
        this.send({ c: 'attack', id: e.id });
        this.view.showMarker(e.x, e.z, true);
        return false;
      }
      const p = this.view.groundAt(sx, sy);
      if (p) {
        this.send({ c: 'amove', x: p.x, z: p.z });
        this.view.showMarker(p.x, p.z, true);
      }
      return false;
    }
    const e = this.view.pickEnemy(sx, sy, touch);
    if (e && !e.inv) {
      this.send({ c: 'attack', id: e.id });
      this.view.showMarker(e.x, e.z, true);
      return false;
    }
    if (e?.inv) this.hud.toast('Сначала снесите вышку, кристалл под защитой');
    const p = this.view.groundAt(sx, sy);
    if (p) {
      this.send({ c: 'move', x: p.x, z: p.z });
      this.view.showMarker(p.x, p.z, false);
    }
    return true;
  }

  // ── Наведение и прицел ──

  /** Прицел умения: слот; touch — ведётся пальцем от кнопки (точка задаётся смещением) */
  private aiming: { slot: number; touch: boolean } | null = null;
  /** A нажата: следующий клик — атака с передвижением */
  private amoveArmed = false;
  /** Курсор мыши над полем (null — мышь ушла) */
  private mouse: { x: number; y: number } | null = null;

  private abilityOf(slot: number) {
    const me = this.snap?.me;
    const id = me ? HERO[me.hero]?.abilities[slot] : undefined;
    const a = id ? ABILITIES[id] : undefined;
    return a && !a.passive ? a : null;
  }

  /** Клавиша Q/W/E/R или клик мышью по кнопке */
  private skillKey(slot: number) {
    if (this.state !== 'play' || !this.snap?.me?.alive) return;
    const a = this.abilityOf(slot);
    if (!a) return;
    const me = this.snap.me;
    const ready = me.cd[slot] <= 0;
    const g = this.mouse ? this.view.groundAt(this.mouse.x, this.mouse.y) : null;
    // Без цели, на перезарядке или «сразу по курсору» — применяем сразу (отказ покажет кнопка)
    if (a.target === 'none' || !ready || this.settings.quickCast) {
      this.cancelAim();
      const u = g && this.mouse ? this.hoverTarget(this.mouse.x, this.mouse.y) : null;
      return this.cast(slot, a.target === 'none' ? null : g, u?.id ?? 0);
    }
    // Та же клавиша второй раз — применить туда, куда смотрит курсор (или с автоприцелом)
    if (this.aiming?.slot === slot && !this.aiming.touch) {
      if (this.mouse) this.castAimed(this.mouse.x, this.mouse.y);
      else {
        this.cancelAim();
        this.cast(slot, null);
      }
      return;
    }
    this.amoveArmed = false;
    this.aiming = { slot, touch: false };
    this.updateAim();
    this.refreshCursor();
  }

  /** Цель умения под курсором: любой юнит, кроме своего героя */
  private hoverTarget(sx: number, sy: number): UnitSnap | null {
    return this.view.pickUnit(sx, sy, (s) => s.id !== this.view.myUnit && s.k !== 'tower' && s.k !== 'ancient');
  }

  private castAimed(sx: number, sy: number) {
    const aim = this.aiming;
    if (!aim) return;
    const g = this.view.groundAt(sx, sy);
    const u = this.hoverTarget(sx, sy);
    this.cancelAim();
    if (g) this.cast(aim.slot, u ? { x: u.x, z: u.z } : g, u?.id ?? 0);
  }

  /** Обновить круг дальности и точку прицела под курсором */
  private updateAim() {
    const aim = this.aiming;
    const a = aim ? this.abilityOf(aim.slot) : null;
    if (!aim || !a || aim.touch) {
      if (!aim) this.view.aim = null;
      return;
    }
    const me = this.view.units.get(this.view.myUnit);
    const g = this.mouse ? this.view.groundAt(this.mouse.x, this.mouse.y) : null;
    if (!me || !g) {
      this.view.aim = null;
      return;
    }
    const d = Math.hypot(g.x - me.x, g.z - me.z);
    this.view.aim = {
      range: a.range,
      x: g.x,
      z: g.z,
      r: a.ai?.radius ?? (a.target === 'unit' ? 0.9 : 1.2),
      line: a.target === 'point',
      ok: a.target === 'point' || d <= a.range + 0.5,
    };
  }

  /** Перетаскивание пальцем от кнопки умения */
  private aimDrag(slot: number, phase: 'start' | 'move' | 'over' | 'release' | 'cancel', dx: number, dy: number) {
    if (this.state !== 'play' || !this.snap?.me?.alive) {
      this.cancelAim();
      return false;
    }
    const a = this.abilityOf(slot);
    if (!a || a.target === 'none') return false;
    if (phase === 'cancel') {
      this.cancelAim();
      return false;
    }
    const me = this.view.units.get(this.view.myUnit);
    if (!me) return false;
    // Направление на экране → на земле: от экранной точки героя в сторону пальца
    const hs = this.view.toScreen(me.x, me.y, me.z);
    const len = Math.hypot(dx, dy);
    let p = { x: me.x, z: me.z };
    if (hs && len > 1) {
      const far = this.view.groundAt(hs.x + (dx / len) * 200, hs.y + (dy / len) * 200);
      if (far) {
        const fl = Math.hypot(far.x - me.x, far.z - me.z) || 1;
        const k = Math.max(1, Math.min(1, len / 110) * a.range);
        p = { x: me.x + ((far.x - me.x) / fl) * k, z: me.z + ((far.z - me.z) / fl) * k };
      }
    }
    if (phase === 'release') {
      this.cancelAim();
      // Враг рядом с точкой прицела — по нему (как и раньше в cast)
      this.cast(slot, p);
      return true;
    }
    this.aiming = { slot, touch: true };
    this.amoveArmed = false;
    this.view.aim = {
      range: a.range,
      x: p.x,
      z: p.z,
      r: a.ai?.radius ?? (a.target === 'unit' ? 0.9 : 1.2),
      line: a.target === 'point',
      ok: phase !== 'over',
    };
    return true;
  }

  /** Свиток телепорта: следующий клик по полю или миникарте — куда */
  private tpPicking = false;
  private tpAim() {
    const me = this.snap?.me;
    if (this.state !== 'play' || !me?.alive) return;
    if (!me.tp) return this.hud.toast('Нет свитков телепорта — купите в лавке');
    if (me.tpCd > 0) return this.hud.toast(`Телепорт перезаряжается: ${Math.ceil(me.tpCd)} с`);
    this.cancelAim();
    this.tpPicking = true;
    this.hud.toast('Телепорт: выберите свою вышку на поле или на миникарте');
    this.refreshCursor();
  }

  /** Камера сразу к герою */
  private centerCamera() {
    const v = this.view.units.get(this.view.myUnit);
    if (v) this.view.camT.set(v.x, this.view.camT.y, v.z);
  }

  /** Отменить прицел и «атаку с передвижением»; true — было что отменять */
  private cancelAim(): boolean {
    const had = !!this.aiming || this.amoveArmed || this.tpPicking;
    this.aiming = null;
    this.amoveArmed = false;
    this.tpPicking = false;
    this.view.aim = null;
    this.refreshCursor();
    return had;
  }

  private armAttackMove() {
    if (this.state !== 'play' || !this.snap?.me?.alive) return;
    this.aiming = null;
    this.view.aim = null;
    this.amoveArmed = true;
    this.refreshCursor();
  }

  /** Мышь над полем: подсветка юнита, плашка, курсор */
  private hover(sx: number, sy: number) {
    this.mouse = sx < 0 ? null : { x: sx, y: sy };
    this.refreshHover();
    this.updateAim();
  }

  private refreshHover() {
    const s =
      this.state === 'play' && this.mouse
        ? this.view.pickUnit(this.mouse.x, this.mouse.y, (u) => u.id !== this.view.myUnit)
        : null;
    this.view.hoverId = s?.id ?? 0;
    if (!s) {
      this.hud.hover(null);
      this.refreshCursor(false);
      return;
    }
    const rel = s.tm === this.view.myTeam ? 'ally' : s.tm === 2 ? 'neutral' : 'enemy';
    this.view.hoverColor = rel === 'ally' ? 0x4fd17a : rel === 'neutral' ? 0xf1c453 : 0xe2504a;
    const pl = s.pl !== undefined ? this.snap?.players[s.pl] : undefined;
    const name =
      s.k === 'hero'
        ? `${pl?.name ?? ''}${pl ? ' · ' : ''}${HERO[s.m]?.name ?? 'Герой'}${s.lv ? `, ур. ${s.lv}` : ''}`
        : (CREEP_NAMES[s.m] ?? CREEP_NAMES[s.k] ?? 'Существо');
    this.hud.hover({ name, hp: s.hp, mhp: s.mhp, rel });
    this.refreshCursor(rel === 'enemy' && !s.inv);
  }

  private hoverEnemy = false;
  private refreshCursor(enemy = this.hoverEnemy) {
    this.hoverEnemy = enemy;
    const g = $('game');
    const aim = (!!this.aiming && !this.aiming.touch) || this.tpPicking;
    g.classList.toggle('cur-aim', aim);
    g.classList.toggle('cur-attack', !aim && (this.amoveArmed || enemy));
  }

  // ── Сеть ──

  // ── Активность в звонке Vicinity ──
  // Ведущий (первым открыл игру в звонке) сам создаёт комнату и рассылает код остальным участникам
  // звонка — они заходят в неё автоматически. Дальше всё как в обычной игре с другом.

  private startActivity() {
    const act = new ActivityBridge();
    this.activity = act;
    let opened = false;
    const open = () => {
      if (opened) return;
      opened = true;
      this.lobby.open();
      this.activityMaybeCreate();
    };
    act.onInit = open;
    // Мессенджер не ответил (старая версия) — просто открываем обычное лобби
    window.setTimeout(open, 3000);
    act.onJoin = (peer) => {
      const code = this.lobby.room?.code;
      if (code && act.isHost()) act.shareRoom(code, peer.peerId);
    };
    act.onRoomCode = (code) => {
      if (this.lobby.room) return;
      if (this.conn.status === 'online') this.conn.send({ t: 'join', code });
      else {
        this.pendingJoin = code;
        this.lobby.open();
      }
    };
  }

  private activityMaybeCreate() {
    const act = this.activity;
    if (!act || !act.self || this.activityCreated || this.pendingJoin || this.lobby.room) return;
    if (this.conn.status !== 'online' || !act.isHost()) return;
    this.activityCreated = true;
    // До 2 человек — 1 на 1, до 4 — 2 на 2, больше — 3 на 3 (до 6 участников звонка)
    const n = act.count();
    this.conn.send({ t: 'create', mode: n > 4 ? '3v3' : n > 2 ? '2v2' : '1v1' });
  }

  private onServer(m: ServerMsg) {
    if (m.t === 'room' && this.activity) {
      if (m.room && this.activity.isHost()) this.activity.shareRoom(m.room.code);
      if (!m.room) window.setTimeout(() => this.activityMaybeCreate(), 0);
    }
    if (m.t === 'room') {
      if (this.pendingJoin && !m.room) {
        this.conn.send({ t: 'join', code: this.pendingJoin });
        this.pendingJoin = '';
      } else if (
        m.room &&
        (m.room.state === 'lobby' || m.room.state === 'over') &&
        !this.lobby.visible &&
        this.state === 'menu'
      )
        this.lobby.open();
    } else if (m.t === 'start') this.startNet(m.slot, m.players[m.slot]?.team ?? 0, m.mode ?? '1v1');
  }

  private startNet(slot: number, team: Team, mode: GameMode) {
    if (this.session instanceof NetSession && this.session.slot === slot && this.state === 'play') return;
    this.session?.dispose();
    this.applyMap(mapOfMode(mode));
    const net = new NetSession(this.conn, slot, team);
    this.session = net;
    this.view.clear();
    this.view.myTeam = team;
    this.view.myUnit = 0;
    this.view.menuFocus = null;
    this.snap = null;
    this.lobby.close();
    this.sound.night = this.kit.night;
    this.sound.startAmbient();
    for (const id of ['menu', 'loading', 'accept', 'screen', 'pick']) $(id).hidden = true;
    this.setState('play');
    this.hud.toast('Матч начался. Крипы выходят на линию');
  }

  // ── Матч ──

  startGame() {
    const local = this.makeLocal((Date.now() % 2147483646) + 1);
    this.applyMap(local.world.mapId);
    this.sound.night = this.kit.night;
    this.sound.startAmbient();
    local.speed = this.speed;
    this.session = local;
    this.view.clear();
    const s = local.snapshot();
    this.view.myTeam = local.team;
    this.view.myUnit = s.me?.unit ?? 0;
    this.view.menuFocus = null;
    this.view.applySnapshot(s);
    this.view.applySnapshot(s);
    this.snap = s;
    this.hud.snap = s;
    const u = s.units.find((x) => x.id === s.me?.unit);
    if (u) this.view.camT.set(u.x, 0.5, u.z);
    $('menu').hidden = true;
    $('loading').hidden = true;
    $('accept').hidden = true;
    $('screen').hidden = true;
    this.setState('play');
    const n = MODE_SIZE[this.localMode()];
    this.hud.toast(
      this.chaosHero
        ? `Хаос: вам выпал ${HERO[this.chaosHero].name}. Золото и опыт вдвое быстрее — матч минут на десять`
        : n > 1
          ? `${n} на ${n}: ваша команда — вы и боты, против — ${n} бота (${difficulty(this.settings.diff).name}). Крипы выходят на линии`
          : `Против вас ${HERO[this.enemyHero].name}, бот ${difficulty(this.settings.diff).name}. Крипы выходят на линию`,
    );
  }

  private endGame(s: Snapshot) {
    if (this.state === 'over') return;
    const me = s.me!;
    const win = s.winner === this.view.myTeam;
    this.setState('over');
    this.hud.toggleShop(false);
    const mine = s.players[me.slot];
    const p = this.profile;
    p.matches++;
    if (win) p.wins++;
    const online = this.session instanceof NetSession;
    p.history.unshift({
      w: win,
      t: Math.round(s.time),
      k: s.kills[this.view.myTeam],
      d: s.kills[1 - this.view.myTeam],
      diff: online ? 'net' : this.settings.diff,
      lh: mine.lastHits,
      hero: me.hero,
    });
    p.history = p.history.slice(0, 8);
    store.set('profile', p);
    this.sound.play(win ? 'win' : 'lose');
    $('board').hidden = true;
    $('card').classList.add('wide');
    $('card').innerHTML = `<h1 class="${win ? 'win' : 'lose'}">${win ? 'Победа' : 'Поражение'}</h1>
      <p>${win ? 'Кристалл врага разрушен.' : 'Наш кристалл пал.'} ${online ? 'Сетевой матч.' : 'Бот: ' + difficulty(this.settings.diff).name + '.'}</p>
      <div class="res"><div><b>${fmt(s.time)}</b><small>длительность</small></div><div><b>${s.kills[this.view.myTeam]} : ${s.kills[1 - this.view.myTeam]}</b><small>убийства героев</small></div><div><b>${mine.lastHits}</b><small>добито крипов</small></div><div><b>${mine.gold}</b><small>золото</small></div><div><b>${me.level}</b><small>уровень</small></div></div>
      <div class="tablewrap">${scoreTable(s, this.view.myTeam, me.slot)}</div>
      <div class="actions"><button class="go alt" id="toMenu">В меню</button><button class="go" id="again">${online ? 'В лобби' : 'Реванш'}</button></div>`;
    $('screen').hidden = false;
    $('again').addEventListener('click', () => (online ? this.conn.send({ t: 'start' }) : this.startGame()));
    $('toMenu').addEventListener('click', () => {
      if (online) this.conn.send({ t: 'leave' });
      this.backToMenu('');
    });
    $('again').focus();
  }

  // ── Меню ──

  private setState(s: State) {
    this.state = s;
    this.app.classList.toggle('inmenu', s !== 'play' && s !== 'over');
    if (s === 'menu' || s === 'search' || s === 'accept' || s === 'pick' || s === 'loading') this.updateMenuFocus();
  }

  private playerName() {
    const fromCall = this.activity?.self?.name?.trim();
    if (fromCall) return fromCall.slice(0, 24);
    return (this.profile.name || '').trim() || 'Игрок';
  }

  private updateMenuFocus() {
    const s = this.preview.snapshot();
    const hero = s.units.find((u) => u.k === 'hero' && u.pl === (this.menuFocusBot ? 1 : 0));
    if (hero) this.view.menuFocus = { x: hero.x, z: hero.z, far: this.menuFocusBot };
  }

  private segInit(id: string, val: string, onPick: (v: string) => void) {
    const btns = [...$(id).querySelectorAll('button')];
    const paint = (v: string) => btns.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === v)));
    btns.forEach((b) => {
      b.setAttribute('role', 'radio');
      b.addEventListener('click', () => {
        paint(b.dataset.v!);
        onPick(b.dataset.v!);
      });
    });
    paint(val);
  }

  private initMenu() {
    this.segInit('diffSeg', this.settings.diff, (v) => {
      this.settings.diff = v;
      store.set('settings', this.settings);
    });
    this.segInit('castSeg', this.settings.quickCast ? 'quick' : 'aim', (v) => {
      this.settings.quickCast = v === 'quick';
      store.set('settings', this.settings);
    });
    this.segInit('mapSeg', this.localMode(), (v) => {
      this.settings.mode = v as GameMode;
      store.set('settings', this.settings);
      if (this.state === 'menu') {
        this.preview = this.makeLocal();
        this.showPreview();
      }
    });
    this.segInit('qSeg', this.settings.quality, (v) => {
      this.settings.quality = v as Quality;
      store.set('settings', this.settings);
      applyQuality(this.kit, this.settings.quality, this.settings.shadows);
      this.resize();
    });
    this.segInit('themeSeg', this.settings.theme, (v) => {
      this.settings.theme = v as Settings['theme'];
      store.set('settings', this.settings);
      // Свет и небо сцены задаются при создании — перезапускаем страницу (мы в меню, матч не идёт)
      location.reload();
    });
    this.segInit('shSeg', this.settings.shadows ? 'on' : 'off', (v) => {
      this.settings.shadows = v === 'on';
      store.set('settings', this.settings);
      applyQuality(this.kit, this.settings.quality, this.settings.shadows);
    });
    const tabs = [...document.querySelectorAll<HTMLButtonElement>('.tabs button')];
    const showTab = (name: string) => {
      tabs.forEach((x) => x.setAttribute('aria-selected', String(x.dataset.tab === name)));
      document.querySelectorAll<HTMLElement>('.pane').forEach((p) => (p.hidden = p.dataset.pane !== name));
      if (name === 'profile') this.renderProfile();
    };
    tabs.forEach((t) =>
      t.addEventListener('click', () => {
        showTab(t.dataset.tab!);
        if (t.dataset.tab === 'home') this.setFocus('hero');
      }),
    );
    document.querySelectorAll<HTMLElement>('[data-focus]').forEach((b) =>
      b.addEventListener('click', () => {
        this.setFocus(b.dataset.focus as 'hero' | 'bot');
        showTab('home');
      }),
    );
    const nameIn = $<HTMLInputElement>('nameIn');
    nameIn.value = this.profile.name;
    nameIn.addEventListener('input', () => {
      this.profile.name = nameIn.value.slice(0, 16);
      store.set('profile', this.profile);
      this.renderName();
    });
    let resetArmed = false;
    $('resetStats').addEventListener('click', (e) => {
      const b = e.target as HTMLButtonElement;
      if (!resetArmed) {
        resetArmed = true;
        b.textContent = 'Нажмите ещё раз, чтобы сбросить';
        return;
      }
      Object.assign(this.profile, { matches: 0, wins: 0, history: [] });
      store.set('profile', this.profile);
      resetArmed = false;
      b.textContent = 'Статистика сброшена';
    });
    $('findBtn').addEventListener('click', () => {
      if (this.state !== 'menu') return;
      this.setState('search');
      this.searchT = 0;
      this.foundAt = 2 + Math.random() * 2;
      $('findBtn').hidden = true;
      $('search').hidden = false;
      $('playMsg').textContent = '';
    });
    $('cancelSearch').addEventListener('click', () => this.backToMenu(''));
    $('declineBtn').addEventListener('click', () => this.backToMenu('Вы отклонили игру'));
    $('acceptBtn').addEventListener('click', () => {
      if (this.state !== 'accept') return;
      this.sound.play('ui');
      this.setState('pick');
      this.pickT = 20;
      $('accept').hidden = true;
      $('pick').hidden = false;
      this.rollEnemy();
      this.pickScreen.open(this.settings.hero, (id) => {
        this.pickHero(id);
        this.sound.play('ui');
      });
      this.updatePickInfo();
      $('pickGo').focus();
    });
    $('pickGo').addEventListener('click', () => this.toLoading());
    // Звук
    const vol = (id: string, key: keyof Volumes) => {
      const el = $<HTMLInputElement>(id);
      el.value = String(this.settings.vol[key]);
      el.addEventListener('input', () => {
        this.settings.vol = { ...this.settings.vol, [key]: +el.value };
        store.set('settings', this.settings);
        this.sound.setVolumes(this.settings.vol);
      });
      el.addEventListener('change', () => this.sound.play('ui'));
    };
    vol('volMaster', 'master');
    vol('volSfx', 'sfx');
    vol('volAmb', 'ambient');
    this.renderHeroes();
    // Таблица счёта: Tab на компьютере, касание счёта на телефоне
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab' && this.state === 'play') {
        e.preventDefault();
        this.showBoard(true);
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Tab') this.showBoard(false);
    });
    $('score').style.pointerEvents = 'auto';
    $('score').addEventListener('click', () => this.showBoard($('board').hidden));
    $('score').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.showBoard($('board').hidden);
      }
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('board').hidden) this.showBoard(false);
    });
    $('board').addEventListener('click', () => this.showBoard(false));
    this.renderName();
    this.setFocus('hero');
  }

  private pickHero(id: string) {
    if (!HERO[id]) return;
    this.settings.hero = id;
    store.set('settings', this.settings);
    if (this.enemyHero === id) this.rollEnemy();
    this.updatePickInfo();
    this.renderHeroes();
    if (this.state === 'menu' || this.state === 'pick') {
      this.preview = this.makeLocal();
      this.showPreview();
      this.setFocus('hero');
    }
  }

  private updatePickInfo() {
    $('pickInfo').textContent =
      `Вы: ${HERO[this.settings.hero].name}. Противник: ${HERO[this.enemyHero].name}, бот ${difficulty(this.settings.diff).name}.`;
  }

  private renderHeroes() {
    renderHeroCards($('heroCards'), this.settings.hero, (id) => {
      this.pickHero(id);
      this.sound.play('ui');
    });
  }

  private readonly portrait = new Portrait();

  /** Экран выбора героя (создаётся при первом показе) */
  private _pick: PickScreen | null = null;
  private get pickScreen() {
    return (this._pick ??= new PickScreen());
  }

  private toLoading() {
    if (this.state !== 'pick') return;
    this.setState('loading');
    this.loadT = 0;
    $('pick').hidden = true;
    this._pick?.close();
    $('loading').hidden = false;
    const ld = document.querySelectorAll('#loading .side b');
    ld[0].textContent = HERO[this.settings.hero].name;
    ld[1].textContent = HERO[this.enemyHero].name;
    $('ldDiff').textContent = 'Бот, ' + difficulty(this.settings.diff).name;
    $('ldTip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
  }

  showBoard(on: boolean) {
    const s = this.hud.snap;
    if (!on || !s?.me || this.state !== 'play') {
      $('board').hidden = true;
      return;
    }
    $('board').innerHTML = scoreTable(s, this.view.myTeam, s.me.slot);
    $('board').hidden = false;
  }

  private setFocus(k: 'hero' | 'bot') {
    this.menuFocusBot = k === 'bot';
    const def = HERO[k === 'bot' ? this.enemyHero : this.settings.hero];
    const tag = $('heroTag');
    tag.children[0].textContent = k === 'bot' ? 'Противник' : 'Ваш герой';
    tag.children[1].textContent = def.name;
    tag.children[2].textContent = (def.ranged ? 'Дальний бой. ' : 'Ближний бой. ') + def.tagline;
    this.updateMenuFocus();
  }

  private renderName() {
    const n = this.playerName();
    $('meName').textContent = n;
    $('ava').textContent = n[0].toUpperCase();
    $('ldName').textContent = n;
  }

  private renderProfile() {
    const { matches: m, wins: w, history } = this.profile;
    $('statGrid').innerHTML =
      `<div><b>${m}</b><small>матчей</small></div><div><b>${w}</b><small>побед</small></div><div><b>${m - w}</b><small>поражений</small></div><div><b>${m ? Math.round((w / m) * 100) : 0}%</b><small>доля побед</small></div>`;
    const h = $('hist');
    if (!history.length) {
      h.innerHTML = '<p class="empty">Сыграйте первый матч, он появится здесь.</p>';
      return;
    }
    h.innerHTML = history
      .map(
        (r) =>
          `<div><b class="${r.w ? 'w' : 'l'}">${r.w ? 'Победа' : 'Поражение'}</b><span>${r.diff === 'net' ? 'по сети' : 'бот ' + (DIFFICULTIES[r.diff]?.name ?? '')}, ${r.k}:${r.d}, ${r.lh} крипов</span><span>${fmt(r.t)}</span></div>`,
      )
      .join('');
  }

  backToMenu(msg: string) {
    $('netBanner').hidden = true;
    this.view.ownPos = null;
    this.session?.dispose();
    this.session = null;
    this.snap = null;
    $('screen').hidden = true;
    $('pick').hidden = true;
    this._pick?.close();
    $('board').hidden = true;
    $('menu').hidden = false;
    this.preview = this.makeLocal();
    this.showPreview();
    this.setState('menu');
    $('accept').hidden = true;
    $('search').hidden = true;
    $('findBtn').hidden = false;
    $('playMsg').textContent = msg;
    $('findBtn').focus();
  }

  private menuTick(dt: number) {
    if (this.state === 'search') {
      this.searchT += dt;
      $('searchT').textContent = fmt(this.searchT);
      if (this.searchT >= this.foundAt) {
        this.setState('accept');
        this.acceptT = 10;
        $('accInfo').textContent = 'Против бота, сложность: ' + difficulty(this.settings.diff).name;
        $('accept').hidden = false;
        $('acceptBtn').focus();
      }
    } else if (this.state === 'accept') {
      this.acceptT -= dt;
      $('accRing').style.setProperty('--p', Math.max(0, this.acceptT / 10).toFixed(3));
      $('accT').textContent = String(Math.max(0, Math.ceil(this.acceptT)));
      if (this.acceptT <= 0) this.backToMenu('Время на принятие вышло');
    } else if (this.state === 'pick') {
      this.pickT -= dt;
      $('pickT').textContent = String(Math.max(0, Math.ceil(this.pickT)));
      if (this.pickT <= 0) this.toLoading();
    } else if (this.state === 'loading') {
      this.loadT += dt;
      $('ldBar').style.width = Math.min(100, (this.loadT / 1.8) * 100) + '%';
      if (this.loadT >= 1.8) this.startGame();
    }
  }

  // ── Кадр ──

  private floatText(x: number, y: number, z: number, text: string, color?: string) {
    const p = this.view.toScreen(x, y, z);
    if (!p) return;
    const d = document.createElement('div');
    d.className = 'float';
    d.textContent = text;
    if (color) d.style.color = color;
    d.style.transform = `translate(${p.x}px,${p.y}px)`;
    $('floats').appendChild(d);
    setTimeout(() => d.remove(), 950);
  }

  private frame(now: number) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const time = now / 1000;
    if ((this.state === 'play' || this.state === 'over') && this.session) {
      const net = this.session instanceof NetSession ? this.session : null;
      if (this.state === 'play' || net)
        for (const s of this.session.update(dt)) {
          if (!this.view.myUnit && s.me) {
            this.view.myUnit = s.me.unit;
            const u = s.units.find((x) => x.id === s.me!.unit);
            if (u) this.view.camT.set(u.x, 0.5, u.z);
          }
          this.view.applySnapshot(s);
          this.view.handleEvents(s.events, this.session.slot);
          this.snap = s;
          this.hud.events(s.events);
          this.sound.events(
            s.events,
            s,
            { x: this.view.camT.x, z: this.view.camT.z },
            this.view.myUnit,
            this.session.slot,
          );
          if (s.winner !== -1) this.endGame(s);
        }
      // Интерфейс в сети — по самому свежему снимку (золото, перезарядки без задержки интерполяции)
      this.hud.snap = net?.latest ?? this.snap;
      if (net) {
        const mine = this.view.units.get(this.view.myUnit);
        this.view.ownPos = net.predictOwn(dt, mine ? { x: mine.x, z: mine.z } : null);
      } else this.view.ownPos = null;
      this.view.renderTick = this.session.renderTick;
      this.view.frame(dt, time, this.session.alpha);
    } else {
      this.menuTick(dt);
      this.view.frame(dt, time, 1);
    }
    const me = this.snap?.me;
    const mine = me ? this.view.units.get(me.unit) : undefined;
    const follow = mine && me?.alive ? { x: mine.x, z: mine.z } : me ? spawnOf(this.view.myTeam) : null;
    const face = this.view.updateCamera(dt, follow);
    if (this.view.menuFocus) {
      // В меню герой поворачивается к камере
      const s = this.preview.snapshot();
      const id = s.units.find((u) => u.k === 'hero' && u.pl === (this.menuFocusBot ? 1 : 0))?.id;
      const v = id ? this.view.units.get(id) : undefined;
      if (v) v.rig.root.rotation.y = face;
    }
    this.kit.renderer.render(this.kit.scene, this.kit.camera);
    // Живой портрет героя в нижней панели
    if ((this.state === 'play' || this.state === 'over') && this.snap?.me) {
      const me = this.snap.me;
      const us = this.snap.units.find((x) => x.id === me.unit);
      const since = (t: number) => (us ? Math.max(0, (this.view.renderTick - t) / 30) : 9);
      this.portrait.render(
        this.kit.renderer,
        $('portrait'),
        me.hero,
        this.view.myTeam,
        us,
        { atk: us ? since(us.at) : 9, cast: us ? since(us.ct) : 9, hurt: us ? since(us.ht) : 9 },
        time,
        dt,
      );
    }
    if (this.state === 'play') this.autoscale.tick(dt);
    if (this.fpsEl) this.fpsTick(dt);
    this.view.updateBars();
    if (this.state === 'play') {
      // Здоровье под курсором меняется, герой двигается — плашку и прицел обновляем каждый кадр
      if (this.view.hoverId) this.refreshHover();
      if (this.aiming && !this.aiming.touch) this.updateAim();
    } else if (this.aiming || this.amoveArmed || this.view.hoverId) {
      this.cancelAim();
      this.view.hoverId = 0;
      this.hud.hover(null);
      this.refreshCursor(false);
    }
    if (this.state === 'play' || this.state === 'over') this.hud.update(dt);
    if (!$('board').hidden) this.showBoard(true);
    this.sound.tick(dt);
    this.mmT -= dt;
    if (this.mmT <= 0) {
      this.mmT = 0.1;
      this.hud.drawMinimap();
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  private fpsTick(dt: number) {
    const a = this.fpsAcc;
    a.t += dt;
    a.n++;
    if (a.t < 0.5) return;
    const info = this.kit.renderer.info.render;
    this.fpsEl!.textContent = `${Math.round(a.n / a.t)} к/с · ${info.calls} вызовов · ${Math.round(info.triangles / 1000)}k треуг. · ×${this.kit.renderer.getPixelRatio().toFixed(2)}`;
    a.t = a.n = 0;
  }

  resize() {
    const vw = this.app.clientWidth;
    const vh = this.app.clientHeight;
    this.view.vw = vw;
    this.view.vh = vh;
    this.kit.renderer.setSize(vw, vh, false);
    this.kit.camera.aspect = vw / vh;
    this.kit.camera.updateProjectionMatrix();
    this.hud.initMinimap();
  }

  /** #debug: хуки для отладки и автотестов (аналог window.__g прототипа) */
  private exposeDebug() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- геттеры объекта ниже читают состояние приложения
    const app = this;
    (window as unknown as { __g: unknown }).__g = {
      app,
      get state() {
        return app.state;
      },
      get snap() {
        return app.snap;
      },
      get mapId() {
        return app.mapId;
      },
      get world() {
        return app.session instanceof LocalSession ? app.session.world : null;
      },
      start: () => app.startGame(),
      step(n: number) {
        if (!(app.session instanceof LocalSession)) return;
        for (const s of app.session.advance(n)) {
          app.view.applySnapshot(s);
          app.view.handleEvents(s.events, app.session.slot);
          app.snap = app.hud.snap = s;
          app.hud.events(s.events);
          if (s.winner !== -1) app.endGame(s);
        }
      },
      cast: (slot: number, x?: number, z?: number) =>
        app.cast(slot, x !== undefined && z !== undefined ? { x, z } : null),
      order: (x: number, z: number) => app.send({ c: 'move', x, z }),
      reveal(on = true) {
        if (app.session instanceof LocalSession) app.session.revealAll = on;
      },
    };
  }
}

const spawnOf = (team: number) => (team ? { x: 51, z: -51 } : { x: -51, z: 51 });
