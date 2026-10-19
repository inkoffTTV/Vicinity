// Экран выбора героя: поиск, фильтр по ролям, сетка из 24 героев и карточка выбранного —
// умения и крутящаяся 3D-модель. Для модели — свой маленький рендерер, только пока экран открыт
// (закрыли — контекст WebGL освобождаем, на телефоне это важно).
import * as THREE from 'three';
import { ABILITIES, HERO, HEROES, ROLES, type RoleId, type UnitSnap } from '@pereprava/shared';
import { animateRig } from '../render/anim';
import { makeModel, type Rig } from '../render/models';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const KEYS = ['Q', 'W', 'E', 'R'];
const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export class PickScreen {
  private role: RoleId | 'all' = 'all';
  private query = '';
  private chosen = '';
  private onPick: (id: string) => void = () => {};
  // Превью
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  private rig: Rig | null = null;
  private raf = 0;
  private t0 = 0;

  constructor() {
    const roles = $('pickRoles');
    for (const r of [{ id: 'all' as const, name: 'Все' }, ...ROLES]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.role = 'tab';
      b.dataset.role = r.id;
      b.textContent = r.name;
      b.addEventListener('click', () => {
        this.role = r.id;
        this.renderGrid();
      });
      roles.appendChild(b);
    }
    $<HTMLInputElement>('pickSearch').addEventListener('input', (e) => {
      this.query = (e.target as HTMLInputElement).value.trim();
      this.renderGrid();
    });
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x404858, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(3, 6, 5);
    this.scene.add(sun);
    this.camera.position.set(0, 2.1, 7.2);
    this.camera.lookAt(0, 1.35, 0);
  }

  open(chosen: string, onPick: (id: string) => void) {
    this.chosen = chosen;
    this.onPick = onPick;
    this.renderGrid();
    this.renderCard();
    this.startPreview();
  }

  close() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.rig) this.scene.remove(this.rig.root);
    this.rig = null;
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      this.renderer = null;
    }
  }

  private list() {
    const q = norm(this.query);
    return HEROES.filter(
      (h) =>
        (this.role === 'all' || h.roleId === this.role) && (!q || norm(h.name).includes(q) || norm(h.role).includes(q)),
    );
  }

  private renderGrid() {
    $('pickRoles')
      .querySelectorAll<HTMLElement>('button')
      .forEach((b) => b.setAttribute('aria-selected', String(b.dataset.role === this.role)));
    const el = $('pickGrid');
    const list = this.list();
    el.innerHTML = list.length
      ? list
          .map(
            (
              h,
            ) => `<button class="hcard" data-hero="${h.id}" aria-pressed="${h.id === this.chosen}" style="--hc:${h.color}">
      <b>${esc(h.name)}</b><small>${esc(ROLES.find((r) => r.id === h.roleId)!.name)}</small>
      <span class="keys4">${h.abilities.map((id, i) => `<i style="--k:${ABILITIES[id].colors[2]}" title="${esc(ABILITIES[id].name)}">${KEYS[i]}</i>`).join('')}</span>
    </button>`,
          )
          .join('')
      : '<p class="empty">Никого не нашлось</p>';
    el.querySelectorAll<HTMLButtonElement>('.hcard').forEach((b) =>
      b.addEventListener('click', () => {
        this.chosen = b.dataset.hero!;
        el.querySelectorAll('.hcard').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        this.onPick(this.chosen);
        this.renderCard();
        this.showModel();
      }),
    );
  }

  private renderCard() {
    const h = HERO[this.chosen];
    if (!h) return;
    const skills = h.abilities
      .map((id, i) => {
        const a = ABILITIES[id];
        const tag = a.passive
          ? 'пассивная'
          : a.ult
            ? 'ультимейт, с 6 уровня'
            : a.charges
              ? `${a.charges} заряда, ${a.cd} с`
              : `${a.cd} с`;
        return `<li><kbd style="--k:${a.colors[2]}">${KEYS[i]}</kbd><div><b>${esc(a.name)}</b> <small>${tag}</small><p>${esc(a.desc)}</p></div></li>`;
      })
      .join('');
    $('pickDetail').innerHTML =
      `<h3 style="color:${h.color}">${esc(h.name)}</h3><small class="role">${esc(h.role)}</small>
      <p class="slogan">${esc(h.tagline)}</p><ul class="pskills">${skills}</ul>`;
  }

  // ── 3D-превью ──

  private startPreview() {
    const canvas = $<HTMLCanvasElement>('pickPreview');
    if (!this.renderer) {
      try {
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      } catch {
        // Нет второго контекста WebGL — обходимся карточкой без модели
        canvas.hidden = true;
        return;
      }
      this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    }
    this.showModel();
    this.t0 = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      this.frame(now);
    };
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(loop);
  }

  private showModel() {
    if (!this.renderer) return;
    if (this.rig) this.scene.remove(this.rig.root);
    this.rig = makeModel(this.chosen, 0);
    this.scene.add(this.rig.root);
  }

  private last = 0;
  private frame(now: number) {
    const r = this.renderer;
    const canvas = $<HTMLCanvasElement>('pickPreview');
    if (!r || !this.rig || !canvas.isConnected) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * r.getPixelRatio()) || canvas.height !== Math.round(h * r.getPixelRatio())) {
      r.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    const time = (now - this.t0) / 1000;
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000);
    this.last = now;
    this.rig.root.rotation.y = time * 0.6;
    // Раз в 3 с — показательная атака
    const cyc = time % 3;
    const snap = { id: 1, k: 'hero', mv: undefined, at: 0, ct: 0, ht: 0 } as unknown as UnitSnap;
    animateRig(this.rig, snap, time, dt, { atk: cyc > 2 ? cyc - 2 : 9, cast: 9, hurt: 9 }, true);
    r.render(this.scene, this.camera);
  }
}
