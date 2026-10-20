// Обучение: матч 1 на 1 против лёгкого бота с подсказками по шагам. Шаг засчитывается сам, когда
// в снимке видно нужное (герой пошёл, умение изучено, крип добит…). Подсвечивается нужная кнопка.
import type { Snapshot, World } from '@pereprava/shared';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

interface Step {
  text: string;
  /** Что подсветить */
  hl?: string;
  /** Подготовка шага (например, дать золота) */
  enter?(w: World): void;
  done(s: Snapshot, start: { x: number; z: number }): boolean;
}

const touch = () => matchMedia('(pointer: coarse)').matches;

const STEPS: Step[] = [
  {
    text: touch()
      ? 'Коснитесь земли — герой пойдёт туда. Можно вести пальцем.'
      : 'Нажмите правой (или левой) кнопкой по земле — герой пойдёт туда.',
    done: (s, st) => {
      const u = s.units.find((x) => x.id === s.me?.unit);
      return !!u && Math.hypot(u.x - st.x, u.z - st.z) > 6;
    },
  },
  {
    text: touch() ? 'Изучите первое умение: нажмите «+» над кнопкой.' : 'Изучите первое умение: «+» над Q или Ctrl+Q.',
    hl: '.skw[data-slot="0"] .lvlup',
    done: (s) => (s.me?.skill[0] ?? 0) > 0,
  },
  {
    text: 'Добейте вражеского крипа: бейте его, и последний удар — ваш. Золото получает только добивший.',
    done: (s) => (s.players[s.me?.slot ?? 0]?.lastHits ?? 0) >= 1,
  },
  {
    text: touch()
      ? 'Примените умение: коснитесь кнопки (автоприцел) или потяните от неё, чтобы навести.'
      : 'Примените умение: Q, затем клик по врагам. Умение тратит синюю ману.',
    hl: '.skw[data-slot="0"] .sk',
    done: (s) => (s.me?.cd[0] ?? 0) > 0,
  },
  {
    text: 'Купите Сапоги скорохода: откройте «Лавку», найдите их в «Скорости». Вдали от фонтана покупка ждёт курьера — нажмите «Курьер».',
    hl: '#shopBtn',
    enter: (w) => {
      const h = w.units.find((u) => u.id === w.players[0].unit)?.hero;
      if (h) h.gold = Math.max(h.gold, 450);
    },
    done: (s) => !!s.me && (s.me.items.includes('boots') || s.me.stash.includes('boots')),
  },
  {
    text: 'Последнее: вместе с крипами сломайте вражескую вышку. Вышка бьёт больно — пусть первыми идут крипы.',
    done: (s) => s.units.some((u) => u.k === 'tower' && u.tm !== s.players[s.me?.slot ?? 0]?.team && u.dead),
  },
];

export class Tutorial {
  private i = 0;
  private start: { x: number; z: number } | null = null;
  done = false;

  constructor(
    private readonly world: World,
    private readonly onFinish: () => void,
  ) {
    $('coach').hidden = false;
    $('coachSkip').onclick = () => this.finish(false);
    this.show();
  }

  private show() {
    const st = STEPS[this.i];
    $('coachStep').textContent = `Шаг ${this.i + 1} из ${STEPS.length}`;
    $('coachText').textContent = st.text;
    document.querySelectorAll('.hl').forEach((el) => el.classList.remove('hl'));
    st.enter?.(this.world);
  }

  tick(s: Snapshot) {
    if (this.done || !s.me) return;
    const u = s.units.find((x) => x.id === s.me!.unit);
    if (!this.start && u) this.start = { x: u.x, z: u.z };
    // Подсветка — каждый кадр: кнопки могут перестраиваться
    const hl = STEPS[this.i].hl;
    if (hl) document.querySelector(hl)?.classList.add('hl');
    if (this.start && STEPS[this.i].done(s, this.start)) {
      this.i++;
      if (this.i >= STEPS.length) return this.finish(true);
      this.show();
    }
  }

  finish(complete: boolean) {
    if (this.done) return;
    this.done = true;
    $('coach').hidden = true;
    document.querySelectorAll('.hl').forEach((el) => el.classList.remove('hl'));
    if (complete) this.onFinish();
  }
}
