// Лобби сетевой игры: создать комнату или войти по коду/ссылке, выбрать героя и команду, «Готов».
// Пустые слоты занимают боты. Матч начинается, когда готовы все люди в комнате.
import { DIFFICULTIES, HERO, HEROES, type GameMode, type RoomInfo, type ServerMsg } from '@pereprava/shared';
import type { Connection } from '../net/connection';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Селектор, по которому элемент найдётся после перерисовки */
function focusKey(el: HTMLElement): string {
  if (el instanceof HTMLInputElement && el.name) return `input[name="${el.name}"]`;
  const act = el.dataset.act;
  if (!act) return el.tagName === 'INPUT' ? 'input' : '';
  const extra = el.dataset.v
    ? `[data-v="${el.dataset.v}"]`
    : el.dataset.hero
      ? `[data-hero="${el.dataset.hero}"]`
      : el.dataset.mode
        ? `[data-mode="${el.dataset.mode}"]`
        : el.dataset.team
          ? `[data-team="${el.dataset.team}"]`
          : '';
  return `[data-act="${act}"]${extra}`;
}

export class Lobby {
  room: RoomInfo | null = null;
  private el: HTMLElement;
  private msg = '';
  private msgTimer = 0;

  constructor(
    readonly conn: Connection,
    readonly host: HTMLElement,
    private onRoomChange: (room: RoomInfo | null) => void,
    /** Облик героя у этого игрока */
    private skinOf: (hero: string) => number = () => 0,
  ) {
    this.el = document.createElement('section');
    this.el.id = 'lobby';
    this.el.className = 'panel';
    this.el.hidden = true;
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Комната');
    host.appendChild(this.el);
    conn.on((m) => this.onMessage(m));
    conn.onStatus = () => this.render();
  }

  private onMessage(m: ServerMsg) {
    if (m.t === 'room') {
      const was = this.room;
      this.room = m.room;
      if (m.room && (!was || was.code !== m.room.code)) {
        try {
          history.replaceState(null, '', `${location.pathname}?room=${m.room.code}${location.hash}`);
        } catch {
          /* не важно */
        }
      }
      if (!m.room && was) {
        try {
          history.replaceState(null, '', location.pathname + location.hash);
        } catch {
          /* не важно */
        }
      }
      this.render();
      this.onRoomChange(this.room);
    } else if (m.t === 'error') this.flash(m.text);
  }

  flash(text: string) {
    this.msg = text;
    clearTimeout(this.msgTimer);
    this.msgTimer = window.setTimeout(() => {
      this.msg = '';
      this.render();
    }, 4000);
    this.render();
  }

  open() {
    this.conn.connect();
    this.el.hidden = false;
    this.render();
  }

  close() {
    this.el.hidden = true;
  }

  get visible() {
    return !this.el.hidden;
  }

  private mySlot() {
    return this.room?.slots.findIndex((s) => s.client === this.conn.id) ?? -1;
  }

  private link() {
    return `${location.origin}${location.pathname}?room=${this.room?.code ?? ''}`;
  }

  render() {
    if (this.el.hidden) return;
    // Перерисовка заменяет разметку — запоминаем, на какой кнопке был фокус, и возвращаем его
    const a = document.activeElement as HTMLElement | null;
    const key = a && this.el.contains(a) ? focusKey(a) : '';
    this.draw();
    if (key) (this.el.querySelector<HTMLElement>(key) ?? this.el.querySelector<HTMLElement>('[data-act]'))?.focus();
  }

  private draw() {
    const st = this.conn.status;
    const status =
      st === 'online'
        ? ''
        : st === 'connecting'
          ? 'Подключаемся к серверу…'
          : st === 'offline'
            ? 'Нет связи с сервером — пробуем снова…'
            : '';
    const r = this.room;
    if (!r) {
      this.el.innerHTML = `
        <header class="lb-head"><h2>Игра с другом</h2><button class="icon-x" data-act="close" aria-label="Закрыть">×</button></header>
        <p class="lb-note">Создайте комнату и отправьте другу ссылку или код. Пустые места займут боты.</p>
        <div class="lb-create">
          <button class="go" data-act="create" data-mode="1v1">Создать 1 на 1</button>
          <button class="go alt" data-act="create" data-mode="2v2">Создать 2 на 2</button>
          <button class="go alt" data-act="create" data-mode="3v3">Создать 3 на 3</button>
          <button class="go alt" data-act="create" data-mode="chaos">Создать «Хаос» 3 на 3</button>
        </div>
        <form class="lb-join" data-act="join">
          <label class="field">Код комнаты<input name="code" maxlength="5" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCDE"></label>
          <button class="go alt" type="submit">Войти</button>
        </form>
        <p class="lb-msg" role="status">${esc(status || this.msg)}</p>`;
      this.bind();
      return;
    }
    const me = this.mySlot();
    const mine = r.slots[me];
    const host = r.host === this.conn.id;
    const team = (t: number) =>
      r.slots
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => s.team === t)
        .map(({ s, i }) => {
          const who = s.client ? esc(s.name) : 'Бот';
          const state = !s.client
            ? `<span class="tag bot">${DIFFICULTIES[r.botDifficulty]?.name ?? ''}</span>`
            : !s.online
              ? '<span class="tag off">нет связи</span>'
              : s.ready
                ? '<span class="tag ok">готов</span>'
                : '<span class="tag">выбирает</span>';
          const hero = s.client
            ? esc(HERO[s.hero]?.name ?? '')
            : r.state === 'lobby'
              ? 'случайный герой'
              : esc(HERO[s.hero]?.name ?? '');
          return `<li class="${i === me ? 'me' : ''}"><b>${who}</b><span>${hero}</span>${state}</li>`;
        })
        .join('');
    const heroes = HEROES.map(
      (h) =>
        `<button class="hpick${mine?.hero === h.id ? ' on' : ''}" data-act="pick" data-hero="${h.id}" aria-pressed="${mine?.hero === h.id}" ${mine?.ready ? 'disabled' : ''} style="--hc:${h.color}">
          <b>${h.name}</b><small>${h.role}</small><span>${h.tagline}</span></button>`,
    ).join('');
    const seg = (act: string, cur: string, opts: [string, string][]) =>
      `<div class="seg" role="radiogroup" style="--n:${opts.length}">${opts
        .map(
          ([v, n]) =>
            `<button role="radio" aria-checked="${cur === v}" data-act="${act}" data-v="${v}" ${host && r.state === 'lobby' ? '' : 'disabled'}>${n}</button>`,
        )
        .join('')}</div>`;
    this.el.innerHTML = `
      <header class="lb-head"><h2>Комната <span class="code">${r.code}</span></h2><button class="icon-x" data-act="leave" aria-label="Выйти из комнаты">×</button></header>
      <div class="lb-share"><input readonly value="${esc(this.link())}" aria-label="Ссылка-приглашение"><button class="ghost" data-act="copy">Скопировать</button></div>
      <div class="lb-opts">
        <div><p class="lbl">Режим</p>${seg('mode', r.mode, [
          ['1v1', '1 на 1'],
          ['2v2', '2 на 2'],
          ['3v3', '3 на 3'],
          ['chaos', 'Хаос'],
        ])}</div>
        <div><p class="lbl">Боты</p>${seg(
          'diff',
          r.botDifficulty,
          Object.values(DIFFICULTIES).map((d) => [d.id, d.name[0].toUpperCase() + d.name.slice(1)] as [string, string]),
        )}</div>
      </div>
      <div class="lb-teams">
        <div class="lb-team a"><h3>Свет</h3><ul>${team(0)}</ul>${mine && mine.team !== 0 && r.state === 'lobby' ? '<button class="ghost" data-act="team" data-team="0">Перейти сюда</button>' : ''}</div>
        <div class="lb-team e"><h3>Тьма</h3><ul>${team(1)}</ul>${mine && mine.team !== 1 && r.state === 'lobby' ? '<button class="ghost" data-act="team" data-team="1">Перейти сюда</button>' : ''}</div>
      </div>
      <p class="lbl">Ваш герой</p>
      <div class="lb-heroes">${heroes}</div>
      ${r.tally?.length ? `<div class="lb-tally"><h3>Счёт комнаты</h3>${r.tally.map((t) => `<span><b>${esc(t.name)}</b> ${t.w} : ${t.l}</span>`).join('')}</div>` : ''}
      <p class="lb-msg" role="status">${esc(status || this.msg || (r.state === 'game' ? 'Матч идёт — подключаемся…' : r.state === 'over' ? 'Матч окончен' : ''))}</p>
      <div class="lb-actions">
        <button class="go alt" data-act="leave">Выйти</button>
        ${r.state === 'over' ? '<button class="go" data-act="again">Ещё раз</button>' : `<button class="go" data-act="ready" aria-pressed="${!!mine?.ready}">${mine?.ready ? 'Не готов' : 'Готов'}</button>`}
      </div>`;
    this.bind();
  }

  private bind() {
    this.el.querySelectorAll<HTMLElement>('[data-act]').forEach((b) => {
      const act = b.dataset.act!;
      if (b.tagName === 'FORM') {
        b.addEventListener('submit', (e) => {
          e.preventDefault();
          const code = (b.querySelector('input') as HTMLInputElement).value.trim().toUpperCase();
          if (code.length < 4) return this.flash('Введите код из 5 символов');
          this.conn.send({ t: 'join', code });
        });
        return;
      }
      b.addEventListener('click', () => {
        const r = this.room;
        const mine = r?.slots[this.mySlot()];
        switch (act) {
          case 'close':
            this.close();
            break;
          case 'create':
            this.conn.send({ t: 'create', mode: b.dataset.mode as GameMode });
            break;
          case 'leave':
            this.conn.send({ t: 'leave' });
            break;
          case 'copy':
            navigator.clipboard?.writeText(this.link()).then(
              () => this.flash('Ссылка скопирована — отправьте её другу'),
              () => this.flash('Не удалось скопировать — выделите ссылку вручную'),
            );
            break;
          case 'mode':
            this.conn.send({ t: 'mode', mode: b.dataset.v as GameMode });
            break;
          case 'diff':
            this.conn.send({ t: 'difficulty', difficulty: b.dataset.v! });
            break;
          case 'team':
            this.conn.send({ t: 'team', team: b.dataset.team === '1' ? 1 : 0 });
            break;
          case 'pick':
            this.conn.send({ t: 'pick', hero: b.dataset.hero!, skin: this.skinOf(b.dataset.hero!) });
            break;
          case 'ready':
            this.conn.send({ t: 'ready', ready: !mine?.ready });
            break;
          case 'again':
            this.conn.send({ t: 'start' });
            break;
        }
      });
    });
  }
}
