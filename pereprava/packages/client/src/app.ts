// Клиент целиком: меню → поиск → «Игра найдена» → загрузка → матч → итоги. Логика меню повторяет
// прототип 0.3; матч идёт через Session (одиночный — LocalSession на общей симуляции).
import { difficulty, DIFFICULTIES, HERO, type Command, type ServerMsg, type Snapshot, type Team } from '@pereprava/shared';
import { LocalSession } from './game/local';
import { NetSession } from './game/net';
import { Connection } from './net/connection';
import { Lobby } from './ui/lobby';
import { Sound, type Volumes } from './audio/sound';
import { renderHeroCards, renderPickGrid, scoreTable } from './ui/screens';
import type { Session } from './game/session';
import { attachInput } from './game/input';
import { applyQuality, createScene, type Quality } from './render/scene';
import { buildTerrain } from './render/terrain';
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
  quality: Quality;
  shadows: boolean;
  hero: string;
  vol: Volumes;
  /** Оформление: как в системе, день или ночь */
  theme: 'auto' | 'day' | 'night';
}

const TIPS = [
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
  private searchT = 0;
  private foundAt = 3;
  private acceptT = 0;
  private loadT = 0;
  private mmT = 0;
  private last = performance.now();

  constructor() {
    this.kit.scene.add(buildTerrain(this.kit.night).group);
    this.hud = new Hud(this.view, {
      send: (c) => this.send(c),
      cast: (slot) => this.cast(slot, null),
      useItem: (slot) => this.useItem(slot, null),
    });
    this.view.onFloat = (x, y, z, text, color) => this.floatText(x, y, z, text, color);
    this.preview = this.makeLocal();
    this.showPreview();
    attachInput(this.kit.renderer.domElement, this.view, {
      playing: () => this.state === 'play' && !!this.snap?.me?.alive,
      orderAt: (sx, sy) => this.orderAt(sx, sy),
      moveTo: (x, z) => this.send({ c: 'move', x, z }),
      cast: (slot, aim) => this.cast(slot, aim),
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
      if (e.button === 2 || e.altKey) return this.ping(p.x, p.z, e.shiftKey ? 'danger' : 'look');
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
    // Ссылка-приглашение ?room=КОД или сохранённый токен (вернуться в идущий матч после перезагрузки)
    const code = new URLSearchParams(location.search).get('room') ?? (/room=([A-Za-z0-9]+)/.exec(location.hash)?.[1] ?? '');
    if (code) {
      this.pendingJoin = code.toUpperCase();
      this.lobby.open();
    } else if (store.get<string | undefined>('token', undefined)) this.conn.connect();
    new ResizeObserver(() => this.resize()).observe(this.app);
    applyQuality(this.kit, this.settings.quality, this.settings.shadows);
    this.resize();
    this.setState('menu');
    if (/debug/.test(location.hash)) this.exposeDebug();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ── Сессии ──

  private makeLocal(seed = 20261019): LocalSession {
    const hero = HERO[this.settings.hero] ? this.settings.hero : 'mage';
    if (this.enemyHero === hero) this.enemyHero = hero === 'brute' ? 'mage' : 'brute';
    return new LocalSession({
      seed,
      jungle: true,
      players: [
        { name: this.playerName(), team: 0, hero, bot: null },
        { name: HERO[this.enemyHero].name, team: 1, hero: this.enemyHero, bot: this.settings.diff },
      ],
    });
  }

  /** Случайный противник для одиночной игры — не тот же герой */
  private rollEnemy() {
    const ids = Object.keys(HERO).filter((h) => h !== this.settings.hero);
    this.enemyHero = ids[Math.floor(Math.random() * ids.length)];
  }

  private showPreview() {
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

  private cast(slot: number, aim: { x: number; z: number } | null) {
    if (this.state !== 'play' || !this.snap?.me?.alive) return;
    if (!aim) return this.send({ c: 'cast', slot });
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

  private orderAt(sx: number, sy: number) {
    if (this.state !== 'play' || !this.snap?.me?.alive) return;
    const e = this.view.pickEnemy(sx, sy);
    if (e && !e.inv) {
      this.send({ c: 'attack', id: e.id });
      this.view.showMarker(e.x, e.z, true);
      return;
    }
    if (e?.inv) this.hud.toast('Сначала снесите вышку, кристалл под защитой');
    const p = this.view.groundAt(sx, sy);
    if (p) {
      this.send({ c: 'move', x: p.x, z: p.z });
      this.view.showMarker(p.x, p.z, false);
    }
  }

  // ── Сеть ──

  private onServer(m: ServerMsg) {
    if (m.t === 'room') {
      if (this.pendingJoin && !m.room) {
        this.conn.send({ t: 'join', code: this.pendingJoin });
        this.pendingJoin = '';
      } else if (m.room && (m.room.state === 'lobby' || m.room.state === 'over') && !this.lobby.visible && this.state === 'menu')
        this.lobby.open();
    } else if (m.t === 'start') this.startNet(m.slot, m.players[m.slot]?.team ?? 0);
  }

  private startNet(slot: number, team: Team) {
    if (this.session instanceof NetSession && this.session.slot === slot && this.state === 'play') return;
    this.session?.dispose();
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
    this.hud.toast(`Против вас ${HERO[this.enemyHero].name}, бот ${difficulty(this.settings.diff).name}. Крипы выходят на линию`);
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
    p.history.unshift({ w: win, t: Math.round(s.time), k: s.kills[this.view.myTeam], d: s.kills[1 - this.view.myTeam], diff: online ? 'net' : this.settings.diff, lh: mine.lastHits, hero: me.hero });
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
      renderPickGrid($('pickGrid'), this.settings.hero, (id) => {
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
    $('pickInfo').textContent = `Вы: ${HERO[this.settings.hero].name}. Противник: ${HERO[this.enemyHero].name}, бот ${difficulty(this.settings.diff).name}.`;
  }

  private renderHeroes() {
    renderHeroCards($('heroCards'), this.settings.hero, (id) => {
      this.pickHero(id);
      this.sound.play('ui');
    });
  }

  private toLoading() {
    if (this.state !== 'pick') return;
    this.setState('loading');
    this.loadT = 0;
    $('pick').hidden = true;
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
    $('statGrid').innerHTML = `<div><b>${m}</b><small>матчей</small></div><div><b>${w}</b><small>побед</small></div><div><b>${m - w}</b><small>поражений</small></div><div><b>${m ? Math.round((w / m) * 100) : 0}%</b><small>доля побед</small></div>`;
    const h = $('hist');
    if (!history.length) {
      h.innerHTML = '<p class="empty">Сыграйте первый матч, он появится здесь.</p>';
      return;
    }
    h.innerHTML = history
      .map((r) => `<div><b class="${r.w ? 'w' : 'l'}">${r.w ? 'Победа' : 'Поражение'}</b><span>${r.diff === 'net' ? 'по сети' : 'бот ' + (DIFFICULTIES[r.diff]?.name ?? '')}, ${r.k}:${r.d}, ${r.lh} крипов</span><span>${fmt(r.t)}</span></div>`)
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
          this.sound.events(s.events, s, { x: this.view.camT.x, z: this.view.camT.z }, this.view.myUnit, this.session.slot);
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
    this.view.updateBars();
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
      cast: (slot: number, x?: number, z?: number) => app.cast(slot, x !== undefined && z !== undefined ? { x, z } : null),
      order: (x: number, z: number) => app.send({ c: 'move', x, z }),
      reveal(on = true) {
        if (app.session instanceof LocalSession) app.session.revealAll = on;
      },
    };
  }
}

const spawnOf = (team: number) => (team ? { x: 51, z: -51 } : { x: -51, z: 51 });
