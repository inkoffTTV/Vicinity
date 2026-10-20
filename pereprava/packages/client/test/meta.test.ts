import { describe, expect, it } from 'vitest';
import { applyMatch, buySkin, daily, hasSkin, questOf, type MetaProfile } from '../src/ui/meta';

const r = { win: true, hero: 'keeper', kills: 3, assists: 6, lastHits: 70, chaos: true, boss: true, online: true };

describe('задания дня и облики', () => {
  it('три разных задания на день, одни и те же весь день', () => {
    const p: MetaProfile = {};
    const d = daily(p);
    expect(new Set(d.ids).size).toBe(3);
    expect(daily(p)).toBe(d);
    for (const id of d.ids) expect(questOf(id)).toBeDefined();
  });

  it('матч даёт искры, выполненные задания — награду, второй раз не засчитываются', () => {
    const p: MetaProfile = {};
    const a = applyMatch(p, r);
    // Все задания из пула выполняются этим «идеальным» матчем
    expect(a.done.length).toBeGreaterThan(0);
    expect(p.sparks).toBe(a.sparks);
    const b = applyMatch(p, r);
    // Повторно засчитывается только «Сыграйте 2 матча» (если оно сегодня есть): ему нужен второй матч
    expect(b.done).toEqual(p.daily!.ids.includes('play2') ? ['Сыграйте 2 матча'] : []);
  });

  it('облик покупается за искры один раз', () => {
    const p: MetaProfile = { sparks: 200 };
    expect(hasSkin(p, 'mage', 1)).toBe(false);
    expect(buySkin(p, 'mage', 1)).toBe(true);
    expect(hasSkin(p, 'mage', 1)).toBe(true);
    expect(p.sparks).toBe(50);
    expect(buySkin(p, 'mage', 2)).toBe(false);
  });
});
