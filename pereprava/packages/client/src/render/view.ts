// Отображение мира по снимкам. Клиент ничего не решает: позиции берёт из двух последних снимков
// (интерполяция), анимации — из тиков атаки/урона/каста, эффекты — из событий.
import * as THREE from 'three';
import { ABILITIES, DT, groundH, unitY, type ProjSnap, type SimEvent, type Snapshot, type UnitSnap, type ZoneSnap } from '@pereprava/shared';
import { makeModel, setGhost, type Rig } from './models';
import type { SceneKit } from './scene';
import { animateRig } from './anim';

interface VUnit {
  id: number;
  rig: Rig;
  snap: UnitSnap;
  prev: UnitSnap | null;
  bar: HTMLDivElement;
  fill: HTMLElement;
  barVis: boolean;
  lastFill: number;
  /** Доигрывание смерти, с; 0 — жив или убран */
  dying: number;
  dyingMax: number;
  x: number;
  z: number;
  y: number;
  seen: number;
  ring?: THREE.Mesh;
  stun?: THREE.Mesh;
  root?: THREE.Mesh;
}

interface VZone {
  snap: ZoneSnap;
  group: THREE.Group;
  disc: THREE.Mesh;
  edge: THREE.Mesh;
  dome?: THREE.Mesh;
}

const ZONE_COLORS: Record<string, number> = { meteor: 0xff6a1f, volley: 0xc8f08a, dome: 0xffe08a };
const RUNE_COLORS: Record<string, number> = { haste: 0xff4a4a, damage: 0x4a8aff, regen: 0x4aff8a, shield: 0xf1c453 };

interface VProj {
  mesh: THREE.Mesh;
  snap: ProjSnap;
  prev: ProjSnap | null;
  y: number;
  trail: number;
}

interface Puff {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  life: number;
  max: number;
  size: number;
  grow: number;
}

const hitY = (k: string) => (k === 'creep' || k === 'neutral' ? 0.8 : k === 'hero' ? 1.4 : 4);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const angLerp = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

const G = {
  proj: new THREE.IcosahedronGeometry(0.22, 0),
  fire: new THREE.IcosahedronGeometry(0.55, 0),
  puff: new THREE.IcosahedronGeometry(1, 0),
};

export class GameView {
  readonly units = new Map<number, VUnit>();
  readonly projs = new Map<number, VProj>();
  private puffs: Puff[] = [];
  private freePuffs: Puff[] = [];
  private projMats = new Map<number, THREE.MeshBasicMaterial>();
  private marker: THREE.Mesh;
  private zones = new Map<number, VZone>();
  private rune: THREE.Mesh;
  private runeKind = '';
  private markerT = 0;
  /** Пинги в мире: столб света и расходящееся кольцо, пул из 4 штук */
  private pingFx: { group: THREE.Group; t: number }[] = [];
  /** Тик, на котором сейчас отрисовка (дробный) */
  renderTick = 0;
  myTeam = 0;
  myUnit = 0;
  vw = 1;
  vh = 1;
  zoom = 1;
  readonly camT = new THREE.Vector3(-40, 0.5, 40);
  /** Предсказанная позиция своего героя (сетевая игра) */
  ownPos: { x: number; z: number } | null = null;
  /** Меню: на кого смотрит камера */
  menuFocus: { x: number; z: number; far: boolean } | null = null;
  private pv = new THREE.Vector3();
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private gplane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.3);
  private gp = new THREE.Vector3();
  onFloat?: (x: number, y: number, z: number, text: string, color?: string) => void;

  constructor(
    readonly kit: SceneKit,
    readonly barsEl: HTMLElement,
    readonly floatsEl: HTMLElement,
  ) {
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.8, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x7dff9a, transparent: true, opacity: 0, depthWrite: false }),
    );
    kit.scene.add(this.marker);
    this.rune = new THREE.Mesh(new THREE.OctahedronGeometry(0.6, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.7, flatShading: true }));
    this.rune.visible = false;
    kit.scene.add(this.rune);
  }

  get scene() {
    return this.kit.scene;
  }

  // ── Снимки ──

  /** Новый снимок: создать/обновить юнитов и снаряды. Позиции дорисует frame() */
  applySnapshot(s: Snapshot) {
    for (const us of s.units) {
      let v = this.units.get(us.id);
      if (!v) v = this.addUnit(us);
      else if (v.dying) continue;
      v.prev = v.snap;
      v.snap = us;
      v.seen = s.tick;
    }
    for (const [id, v] of this.units)
      if (v.seen !== s.tick && !v.dying) {
        // Ушёл в туман или исчез без события смерти — просто убираем
        this.removeUnit(id);
      }
    const seenP = new Set<number>();
    for (const ps of s.projs) {
      seenP.add(ps.id);
      let p = this.projs.get(ps.id);
      if (!p) p = this.addProj(ps);
      p.prev = p.snap;
      p.snap = ps;
    }
    for (const [id, p] of this.projs)
      if (!seenP.has(id)) {
        this.scene.remove(p.mesh);
        this.projs.delete(id);
      }
    const seenZ = new Set<number>();
    for (const z of s.zones ?? []) {
      seenZ.add(z.id);
      const v = this.zones.get(z.id) ?? this.addZone(z);
      v.snap = z;
    }
    for (const [id, v] of this.zones)
      if (!seenZ.has(id)) {
        this.scene.remove(v.group);
        this.zones.delete(id);
      }
    if (s.rune) {
      this.rune.visible = true;
      this.rune.position.set(s.rune.x, unitY(s.rune.x, s.rune.z) + 1, s.rune.z);
      if (this.runeKind !== s.rune.kind) {
        this.runeKind = s.rune.kind;
        const m = this.rune.material as THREE.MeshStandardMaterial;
        m.color.setHex(RUNE_COLORS[s.rune.kind] ?? 0xffffff);
        m.emissive.setHex(RUNE_COLORS[s.rune.kind] ?? 0xffffff);
      }
    } else this.rune.visible = false;
  }

  private addZone(z: ZoneSnap): VZone {
    const color = ZONE_COLORS[z.k] ?? 0xffffff;
    const group = new THREE.Group();
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, depthWrite: false }),
    );
    const edge = new THREE.Mesh(
      new THREE.RingGeometry(0.94, 1, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false }),
    );
    group.add(disc, edge);
    let dome: THREE.Mesh | undefined;
    if (z.k === 'dome') {
      dome = new THREE.Mesh(
        new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }),
      );
      group.add(dome);
    }
    group.scale.setScalar(z.r);
    group.position.set(z.x, Math.max(groundH(z.x, z.z), -0.4) + 0.1, z.z);
    this.scene.add(group);
    const v: VZone = { snap: z, group, disc, edge, dome };
    this.zones.set(z.id, v);
    return v;
  }

  private addUnit(us: UnitSnap): VUnit {
    const rig = makeModel(us.m, us.tm);
    rig.root.position.set(us.x, unitY(us.x, us.z), us.z);
    rig.root.rotation.y = us.r;
    this.scene.add(rig.root);
    const bar = document.createElement('div');
    bar.className = `bar ${us.k === 'neutral' ? 'creep' : us.k} ${us.tm === this.myTeam ? 'ally' : 'enemy'}`;
    bar.innerHTML = us.k === 'hero' ? '<i></i><b></b>' : '<i></i>';
    if (us.id === this.myUnit) bar.classList.add('me');
    this.barsEl.appendChild(bar);
    const v: VUnit = {
      id: us.id,
      rig,
      snap: us,
      prev: null,
      bar,
      fill: bar.firstChild as HTMLElement,
      barVis: true,
      lastFill: -1,
      dying: 0,
      dyingMax: 0,
      x: us.x,
      z: us.z,
      y: unitY(us.x, us.z),
      seen: 0,
    };
    this.units.set(us.id, v);
    return v;
  }

  private removeUnit(id: number) {
    const v = this.units.get(id);
    if (!v) return;
    this.scene.remove(v.rig.root);
    if (v.ring) this.scene.remove(v.ring);
    v.bar.remove();
    this.units.delete(id);
  }

  private addProj(ps: ProjSnap): VProj {
    let mesh: THREE.Mesh;
    if (ps.k === 'attack') {
      let m = this.projMats.get(ps.c);
      if (!m) this.projMats.set(ps.c, (m = new THREE.MeshBasicMaterial({ color: ps.c })));
      mesh = new THREE.Mesh(G.proj, m);
    } else {
      mesh = new THREE.Mesh(G.fire, new THREE.MeshBasicMaterial({ color: ps.c }));
    }
    mesh.scale.setScalar(ps.s);
    const y = groundH(ps.x, ps.z) + ps.y0;
    mesh.position.set(ps.x, y, ps.z);
    this.scene.add(mesh);
    const p: VProj = { mesh, snap: ps, prev: null, y, trail: 0 };
    this.projs.set(ps.id, p);
    return p;
  }

  /** События тика: эффекты, смерти, всплывающие числа */
  handleEvents(events: SimEvent[], mySlot: number) {
    for (const e of events) {
      if (e.e === 'fx') this.puff(e.x, unitY(e.x, e.z) + e.h, e.z, e.color, e.size, e.life, e.grow);
      else if (e.e === 'death') {
        const v = this.units.get(e.id);
        if (!v) continue;
        v.snap = { ...v.snap, dead: 1 };
        if (e.kind === 'creep' || e.kind === 'neutral') {
          v.dying = v.dyingMax = 0.7;
          v.bar.remove();
        } else if (e.kind === 'tower') {
          v.dying = v.dyingMax = 1.3;
          if (v.rig.gem) v.rig.gem.visible = false;
        } else if (e.kind === 'ancient') v.dying = v.dyingMax = 1.5;
        else if (e.kind === 'hero') v.dying = v.dyingMax = 1.1;
      } else if (e.e === 'gold' && e.player === mySlot) {
        this.onFloat?.(e.x, unitY(e.x, e.z) + 2.6, e.z, '+' + e.amt);
      }
    }
  }

  // ── Кадр ──

  /** alpha — доля пути от предыдущего снимка к текущему */
  frame(dt: number, time: number, alpha: number) {
    const a = Math.max(0, Math.min(1, alpha));
    for (const [id, v] of this.units) {
      const s = v.snap;
      const p = v.prev ?? s;
      const root = v.rig.root;
      const mobile = s.k === 'hero' || s.k === 'creep' || s.k === 'neutral';
      if (v.dying > 0) {
        v.dying -= dt;
        if (mobile) {
          root.position.y -= dt * 1.6;
          root.rotation.z += dt * 2.2;
          root.scale.multiplyScalar(1 - dt * 0.8);
        } else {
          root.position.y -= dt * (s.k === 'tower' ? 2.4 : 2);
          root.rotation.z += dt * 0.25;
        }
        if (v.dying <= 0) {
          if (mobile && s.k !== 'hero') this.removeUnit(id);
          else {
            v.dying = 0;
            if (s.k === 'hero') root.visible = false;
          }
        }
        continue;
      }
      if (s.dead) {
        if (s.k === 'hero') {
          root.visible = false;
          v.bar.style.display = 'none';
          v.barVis = false;
        }
        continue;
      }
      if (s.k === 'hero' && !root.visible) {
        // Возродился: без интерполяции из места смерти
        root.visible = true;
        root.rotation.z = 0;
        root.scale.setScalar(v.rig.scale);
        v.prev = s;
      }
      // Телепорт (скачок) — без «полёта» между снимками
      const jump = Math.hypot(s.x - p.x, s.z - p.z) > 6;
      v.x = jump ? s.x : lerp(p.x, s.x, a);
      v.z = jump ? s.z : lerp(p.z, s.z, a);
      if (id === this.myUnit && this.ownPos) {
        v.x = this.ownPos.x;
        v.z = this.ownPos.z;
      }
      v.y = mobile ? unitY(v.x, v.z) : groundH(v.x, v.z);
      root.position.set(v.x, v.y, v.z);
      if (mobile) root.rotation.y = angLerp(root.rotation.y, s.r, Math.min(1, dt * 14));
      const since = (t: number) => Math.max(0, (this.renderTick - t) * DT);
      animateRig(v.rig, s, time, dt, { atk: since(s.at), cast: since(s.ct), hurt: since(s.ht) }, mobile);
      if (v.rig.shield) {
        v.rig.shield.visible = !!s.sh;
        v.rig.shield.rotation.y += dt * 1.5;
      }
      if (v.rig.gem) {
        v.rig.gem.rotation.y += dt * (s.k === 'ancient' ? 0.8 : 1.6);
        if (s.k === 'ancient') v.rig.gem.position.y = 5 + Math.sin(time * 1.5) * 0.25;
      }
      this.updateCastRing(v, s);
      this.updateStatus(v, s, time);
    }
    for (const p of this.projs.values()) this.frameProj(p, a, dt);
    for (const z of this.zones.values()) {
      const pending = z.snap.d > 0;
      const dm = z.disc.material as THREE.MeshBasicMaterial;
      const em = z.edge.material as THREE.MeshBasicMaterial;
      // Метеор до падения: красный круг-предупреждение, мигает
      dm.opacity = pending ? 0.12 + 0.1 * Math.abs(Math.sin(time * 10)) : z.snap.k === 'dome' ? 0.08 : 0.2 + 0.08 * Math.sin(time * 6);
      em.opacity = pending ? 0.9 : 0.55;
      if (z.dome) z.dome.rotation.y += dt * 0.6;
    }
    if (this.rune.visible) {
      this.rune.rotation.y += dt * 2;
      this.rune.position.y += Math.sin(time * 3) * 0.004;
    }
    this.updatePuffs(dt);
    this.markerT = Math.max(0, this.markerT - dt);
    const mm = this.marker.material as THREE.MeshBasicMaterial;
    mm.opacity = this.markerT * 2;
    this.marker.scale.setScalar(1 + (0.45 - this.markerT) * 1.5);
    for (const p of this.pingFx) {
      if (p.t <= 0) continue;
      p.t -= dt;
      p.group.visible = p.t > 0;
      const [ring, beam] = p.group.children as THREE.Mesh[];
      const f = (3 - p.t) % 1;
      ring.scale.setScalar(1 + f * 2.5);
      (ring.material as THREE.MeshBasicMaterial).opacity = (1 - f) * 0.9;
      (beam.material as THREE.MeshBasicMaterial).opacity = Math.min(1, p.t) * 0.45;
    }
  }

  ping(x: number, z: number, kind: string) {
    let p = this.pingFx.find((q) => q.t <= 0);
    if (!p) {
      if (this.pingFx.length >= 4) p = this.pingFx[0];
      else {
        const group = new THREE.Group();
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.7, 1, 32).rotateX(-Math.PI / 2),
          new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide }),
        );
        const beam = new THREE.Mesh(
          new THREE.CylinderGeometry(0.18, 0.35, 9, 8, 1, true).translate(0, 4.5, 0),
          new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
        );
        group.add(ring, beam);
        this.scene.add(group);
        p = { group, t: 0 };
        this.pingFx.push(p);
      }
    }
    const color = kind === 'danger' ? 0xff5a4a : kind === 'go' ? 0x7dff9a : 0xf1c453;
    for (const m of p.group.children as THREE.Mesh[]) (m.material as THREE.MeshBasicMaterial).color.setHex(color);
    p.group.position.set(x, groundH(x, z) + 0.15, z);
    p.group.visible = true;
    p.t = 3;
  }

  private updateCastRing(v: VUnit, s: UnitSnap) {
    const c = s.cast;
    const r = c ? ABILITIES[c.a]?.range : 0;
    if (!c || !r) {
      if (v.ring) v.ring.visible = false;
      return;
    }
    if (!v.ring) {
      v.ring = new THREE.Mesh(
        new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xff4a3a, transparent: true, opacity: 0.15, depthWrite: false }),
      );
      this.scene.add(v.ring);
    }
    const k = 1 - c.t / c.T;
    v.ring.visible = true;
    v.ring.position.set(v.x, unitY(v.x, v.z) + 0.12, v.z);
    v.ring.scale.setScalar(r * (0.2 + 0.8 * k));
    (v.ring.material as THREE.MeshBasicMaterial).opacity = 0.15 + 0.35 * k;
  }

  /** Значки состояний: оглушение (кольцо над головой), корни (у ног), невидимость (полупрозрачность) */
  private updateStatus(v: VUnit, s: UnitSnap, time: number) {
    const fxs = s.fx ?? [];
    const stun = fxs.includes('stun');
    const root = fxs.includes('root');
    if (stun && !v.stun) {
      v.stun = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.07, 4, 12), new THREE.MeshBasicMaterial({ color: 0xffe066 }));
      v.stun.rotation.x = Math.PI / 2;
      v.rig.root.add(v.stun);
    }
    if (v.stun) {
      v.stun.visible = stun;
      v.stun.position.y = s.bh - 0.2;
      v.stun.rotation.z = time * 6;
    }
    if (root && !v.root) {
      v.root = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.85, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x8a5ce0, transparent: true, opacity: 0.7, depthWrite: false }));
      v.rig.root.add(v.root);
      v.root.position.y = 0.08;
    }
    if (v.root) v.root.visible = root;
    if (s.k === 'hero') setGhost(v.rig, fxs.includes('invisible'));
  }

  private frameProj(p: VProj, a: number, dt: number) {
    const s = p.snap;
    const q = p.prev ?? s;
    const x = lerp(q.x, s.x, a);
    const z = lerp(q.z, s.z, a);
    if (s.k === 'attack') {
      const t = this.units.get(s.tid);
      if (t) {
        const ty = t.y + hitY(t.snap.k);
        const prevRemain = Math.hypot(p.mesh.position.x - t.x, p.mesh.position.z - t.z);
        const remain = Math.hypot(x - t.x, z - t.z);
        if (prevRemain > 0.01) p.y = ty + (p.y - ty) * Math.min(1, remain / prevRemain);
      }
      p.mesh.position.set(x, p.y, z);
    } else {
      if (s.tid) {
        const t = this.units.get(s.tid);
        if (t) p.y += (t.y + hitY(t.snap.k) - p.y) * Math.min(1, dt * 6);
      }
      p.mesh.position.set(x, p.y, z);
      p.mesh.rotation.x += dt * 8;
      p.mesh.rotation.y += dt * 6;
      p.trail -= dt;
      if (p.trail <= 0) {
        p.trail = 0.035;
        this.puff(x, p.y, z, s.k === 'fireball' ? 0xff7a1f : s.c, 0.35 * Math.max(0.6, s.s), 0.35, 1.2);
      }
    }
  }

  // ── Эффекты ──

  puff(x: number, y: number, z: number, color: number, size: number, life: number, grow = 1.6) {
    let f = this.freePuffs.pop();
    if (!f) {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false });
      f = { mesh: new THREE.Mesh(G.puff, mat), mat, life: 0, max: 0, size: 0, grow: 0 };
    }
    // Пул ограничен: на слабом телефоне сотни облачков не нужны
    if (this.puffs.length > 140) {
      this.freePuffs.push(f);
      return;
    }
    f.mat.color.setHex(color);
    f.mat.opacity = 0.9;
    f.mesh.position.set(x, y, z);
    f.mesh.scale.setScalar(size);
    f.life = f.max = life;
    f.size = size;
    f.grow = grow;
    this.scene.add(f.mesh);
    this.puffs.push(f);
  }

  private updatePuffs(dt: number) {
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const f = this.puffs[i];
      f.life -= dt;
      const k = 1 - f.life / f.max;
      f.mesh.scale.setScalar(f.size * (1 + k * f.grow));
      f.mat.opacity = 0.9 * (1 - k);
      if (f.life <= 0) {
        this.scene.remove(f.mesh);
        this.puffs.splice(i, 1);
        this.freePuffs.push(f);
      }
    }
  }

  showMarker(x: number, z: number, enemy: boolean) {
    this.marker.position.set(x, unitY(x, z) + 0.1, z);
    (this.marker.material as THREE.MeshBasicMaterial).color.setHex(enemy ? 0xff5a4a : 0x7dff9a);
    this.markerT = 0.45;
  }

  // ── Камера ──

  viewK() {
    return this.zoom * Math.max(1, 1.25 / (this.vw / this.vh));
  }

  updateCamera(dt: number, follow: { x: number; z: number } | null) {
    const { camera, sun, fog } = this.kit;
    if (this.menuFocus) {
      const f = this.menuFocus;
      const wide = this.vw > this.vh * 1.15;
      const a = (f.far ? -0.8 : 0.8) + Math.sin((performance.now() / 1000) * 0.15) * 0.4;
      const r = wide ? (f.far ? 13 : 12) : f.far ? 20 : 14;
      const ty = unitY(f.x, f.z) + 1.7;
      const cx = f.x + Math.sin(a) * r;
      const cz = f.z + Math.cos(a) * r;
      camera.position.set(cx, ty + (wide ? 2.8 : 3.6), cz);
      camera.lookAt(f.x, ty - (wide ? 1 : 3), f.z);
      fog.near = 28;
      fog.far = 95;
      this.camT.set(f.x, 0.5, f.z);
      sun.position.set(f.x + 25, 45, f.z + 15);
      sun.target.position.copy(this.camT);
      return Math.atan2(cx - f.x, cz - f.z);
    }
    if (follow) {
      const k = Math.min(1, dt * 5);
      this.camT.x += (follow.x - this.camT.x) * k;
      this.camT.z += (follow.z - this.camT.z) * k;
    }
    const z = this.viewK();
    fog.near = 36 * z + 18;
    fog.far = 36 * z + 85;
    camera.position.set(this.camT.x + 1.5, this.camT.y + 30 * z, this.camT.z + 20 * z - 1.5);
    camera.lookAt(this.camT.x + 1.5, this.camT.y, this.camT.z - 1.5);
    sun.position.set(this.camT.x + 25, 45, this.camT.z + 15);
    sun.target.position.copy(this.camT);
    return 0;
  }

  // ── Экранные координаты, выбор целей ──

  toScreen(x: number, y: number, z: number): { x: number; y: number } | null {
    this.pv.set(x, y, z).project(this.kit.camera);
    if (this.pv.z > 1) return null;
    return { x: ((this.pv.x + 1) / 2) * this.vw, y: ((1 - this.pv.y) / 2) * this.vh };
  }

  groundAt(sx: number, sy: number): { x: number; z: number } | null {
    this.ndc.set((sx / this.vw) * 2 - 1, -(sy / this.vh) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.kit.camera);
    if (!this.ray.ray.intersectPlane(this.gplane, this.gp)) return null;
    return { x: Math.max(-58, Math.min(58, this.gp.x)), z: Math.max(-58, Math.min(58, this.gp.z)) };
  }

  /** Враг под пальцем/курсором (радиус попадания зависит от размера цели) */
  pickEnemy(sx: number, sy: number): UnitSnap | null {
    let best: UnitSnap | null = null;
    let bd = 1e9;
    for (const v of this.units.values()) {
      const s = v.snap;
      if (s.dead || v.dying || s.tm === this.myTeam) continue;
      const p = this.toScreen(v.x, v.y + hitY(s.k), v.z);
      if (!p) continue;
      const r = s.k === 'creep' || s.k === 'neutral' ? 30 : s.k === 'hero' ? 42 : s.k === 'tower' ? 50 : 66;
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d < r && d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  /** Полоски здоровья над юнитами (DOM поверх канваса) */
  updateBars() {
    for (const v of this.units.values()) {
      const s = v.snap;
      if (s.dead || v.dying) continue;
      const p = this.toScreen(v.x, v.y + s.bh, v.z);
      if (!p || p.x < -60 || p.x > this.vw + 60 || p.y < -30 || p.y > this.vh + 30) {
        if (v.barVis) {
          v.bar.style.display = 'none';
          v.barVis = false;
        }
        continue;
      }
      if (!v.barVis) {
        v.bar.style.display = '';
        v.barVis = true;
      }
      v.bar.style.transform = `translate(${p.x}px,${p.y}px) translate(-50%,-50%)`;
      const f = s.hp / s.mhp;
      if (v.lastFill !== f) {
        v.lastFill = f;
        v.fill.style.width = f * 100 + '%';
      }
      if (s.k === 'ancient') v.bar.classList.toggle('locked', !!s.inv);
      if (s.k === 'hero') {
        v.bar.classList.toggle('sh', !!s.sh);
        if (v.bar.dataset.l !== String(s.lv)) v.bar.dataset.l = String(s.lv);
      }
    }
  }

  /** Убрать всё (выход в меню) */
  clear() {
    for (const id of [...this.units.keys()]) this.removeUnit(id);
    for (const z of this.zones.values()) this.scene.remove(z.group);
    this.zones.clear();
    this.rune.visible = false;
    for (const p of this.pingFx) {
      p.t = 0;
      p.group.visible = false;
    }
    for (const p of this.projs.values()) this.scene.remove(p.mesh);
    this.projs.clear();
    for (const f of this.puffs) this.scene.remove(f.mesh);
    this.freePuffs.push(...this.puffs);
    this.puffs = [];
  }
}
