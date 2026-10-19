// Клиент целиком: меню → поиск → «Игра найдена» → загрузка → матч → итоги. Логика меню повторяет
// прототип 0.3; матч идёт через Session (одиночный — LocalSession на общей симуляции).
import { difficulty, DIFFICULTIES, HERO, type Command, type Snapshot } from '@pereprava/shared';
import { LocalSession } from './game/local';
import type { Session } from './game/session';
import { attachInput } from './game/input';
import { applyQuality, createScene, type Quality } from './render/scene';
import { buildTerrain } from './render/terrain';
import { GameView } from './render/view';
import { fmt, Hud } from './ui/hud';
import { store } from './ui/store';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

type State = 'menu' | 'search' | 'accept' | 'loading' | 'play' | 'over';

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
    ...store.get<Partial<Settings>>('settings', {}),
  };
  speed = /x4/.test(location.hash) ? 4 : 1;
  private menuFocusBot = false;
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
    });
    $('minimap').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.state !== 'play' || !this.snap?.me?.alive) return;
      const p = this.hud.minimapPoint(e);
      this.send({ c: 'move', x: p.x, z: p.z });
      this.view.showMarker(p.x, p.z, false);
    });
    this.initMenu();
    new ResizeObserver(() => this.resize()).observe(this.app);
    applyQuality(this.kit, this.settings.quality, this.settings.shadows);
    this.resize();
    this.setState('menu');
    if (/debug/.test(location.hash)) this.exposeDebug();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ── Сессии ──

  private makeLocal(): LocalSession {
    return new LocalSession({
      seed: 20261019,
      players: [
        { name: this.playerName(), team: 0, hero: 'mage', bot: null },
        { name: 'Громила', team: 1, hero: 'brute', bot: this.settings.diff },
      ],
    });
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
    this.send(aim ? { c: 'cast', slot, x: aim.x, z: aim.z } : { c: 'cast', slot });
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

  // ── Матч ──

  startGame() {
    const local = this.makeLocal();
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
    this.hud.toast('Бот: ' + difficulty(this.settings.diff).name + '. Крипы выходят на линию');
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
    p.history.unshift({ w: win, t: Math.round(s.time), k: s.kills[this.view.myTeam], d: s.kills[1 - this.view.myTeam], diff: this.settings.diff, lh: mine.lastHits, hero: me.hero });
    p.history = p.history.slice(0, 8);
    store.set('profile', p);
    $('card').innerHTML = `<h1>${win ? 'Победа' : 'Поражение'}</h1>
      <p>${win ? 'Кристалл врага разрушен.' : 'Наш кристалл пал.'} Бот: ${difficulty(this.settings.diff).name}.</p>
      <dl class="keys"><dt>${fmt(s.time)}</dt><dd>длительность матча</dd><dt>${s.kills[this.view.myTeam]} : ${s.kills[1 - this.view.myTeam]}</dt><dd>убийства героев</dd><dt>${mine.lastHits}</dt><dd>добито крипов</dd><dt>${mine.gold}</dt><dd>заработано золота</dd><dt>${me.level}</dt><dd>уровень героя</dd></dl>
      <div class="actions"><button class="go alt" id="toMenu">В меню</button><button class="go" id="again">Реванш</button></div>`;
    $('screen').hidden = false;
    $('again').addEventListener('click', () => this.startGame());
    $('toMenu').addEventListener('click', () => this.backToMenu(''));
    $('again').focus();
  }

  // ── Меню ──

  private setState(s: State) {
    this.state = s;
    this.app.classList.toggle('inmenu', s !== 'play' && s !== 'over');
    if (s === 'menu' || s === 'search' || s === 'accept' || s === 'loading') this.updateMenuFocus();
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
      this.setState('loading');
      this.loadT = 0;
      $('accept').hidden = true;
      $('loading').hidden = false;
      $('ldDiff').textContent = 'Бот, ' + difficulty(this.settings.diff).name;
      $('ldTip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
    });
    this.renderName();
    this.setFocus('hero');
  }

  private setFocus(k: 'hero' | 'bot') {
    this.menuFocusBot = k === 'bot';
    const def = HERO[k === 'bot' ? 'brute' : 'mage'];
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
      .map((r) => `<div><b class="${r.w ? 'w' : 'l'}">${r.w ? 'Победа' : 'Поражение'}</b><span>бот ${DIFFICULTIES[r.diff]?.name ?? ''}, ${r.k}:${r.d}, ${r.lh} крипов</span><span>${fmt(r.t)}</span></div>`)
      .join('');
  }

  backToMenu(msg: string) {
    this.session?.dispose();
    this.session = null;
    this.snap = null;
    $('screen').hidden = true;
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
      if (this.state === 'play')
        for (const s of this.session.update(dt)) {
          this.view.applySnapshot(s);
          this.view.handleEvents(s.events, this.session.slot);
          this.snap = s;
          this.hud.snap = s;
          this.hud.events(s.events);
          if (s.winner !== -1) this.endGame(s);
        }
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
