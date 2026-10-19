import { describe, expect, it } from 'vitest';
import { createWorld, queueCommand, step, type MatchSetup, type World } from '../src/index';

const setup: MatchSetup = {
  seed: 42,
  players: [
    { name: 'Игрок', team: 0, hero: 'mage', bot: null },
    { name: 'Бот', team: 1, hero: 'brute', bot: 'normal' },
  ],
};

/** Один и тот же сценарий: приказы игрока в одни и те же тики */
function run(ticks: number): World {
  const w = createWorld(setup);
  for (let t = 0; t < ticks; t++) {
    if (t === 30) queueCommand(w, 0, { c: 'move', x: -10, z: 10 });
    if (t === 400) queueCommand(w, 0, { c: 'cast', slot: 0, x: 0, z: 0 });
    if (t === 420) queueCommand(w, 0, { c: 'cast', slot: 2 });
    if (t === 900) queueCommand(w, 0, { c: 'cast', slot: 1, x: -30, z: 30 });
    step(w);
  }
  return w;
}

const strip = (w: World) => JSON.stringify({ ...w, events: [] });

describe('детерминизм', () => {
  it('два прогона с одинаковыми входами дают одинаковый мир', () => {
    const a = run(30 * 120);
    const b = run(30 * 120);
    expect(strip(a)).toBe(strip(b));
    expect(a.units.filter((u) => u.kind === 'creep').length).toBeGreaterThan(0);
  });

  it('другие входы дают другой мир', () => {
    const a = run(30 * 60);
    const w = createWorld(setup);
    for (let t = 0; t < 30 * 60; t++) step(w);
    expect(strip(a)).not.toBe(strip(w));
  });
});
