// Баланс героев: бот против бота по всем парам, каждая пара — с обеих сторон карты.
//   npx tsx packages/shared/scripts/pairs.ts [повторов=1] [часть=0] [частей=1] > out.json
// Печатает JSON: { id: [побед, матчей] } и длительности; сводка — scripts/pairs-report.ts.
import { createWorld, step, HEROES, TICK_RATE } from '../src/index';

const [rep = '1', part = '0', parts = '1'] = process.argv.slice(2);
const ids = HEROES.map((h) => h.id);
const res: Record<string, [number, number]> = Object.fromEntries(ids.map((id) => [id, [0, 0]]));
const pairs: Record<string, number> = {};
const mins: number[] = [];
let k = 0;
for (let i = 0; i < ids.length; i++)
  for (let j = i + 1; j < ids.length; j++) {
    if (k++ % +parts !== +part) continue;
    for (let r = 0; r < +rep; r++)
      for (const flip of [false, true]) {
        const a = flip ? ids[j] : ids[i];
        const b = flip ? ids[i] : ids[j];
        const w = createWorld({
          seed: 500 + k * 7 + r * 101 + (flip ? 1 : 0),
          jungle: true,
          players: [
            { name: 'A', team: 0, hero: a, bot: 'normal' },
            { name: 'B', team: 1, hero: b, bot: 'normal' },
          ],
        });
        while (w.winner === -1 && w.tick < 40 * 60 * TICK_RATE) step(w);
        mins.push(w.time / 60);
        res[a][1]++;
        res[b][1]++;
        if (w.winner === 0) res[a][0]++;
        else if (w.winner === 1) res[b][0]++;
        const key = `${ids[i]}|${ids[j]}`;
        pairs[key] = (pairs[key] ?? 0) + (w.winner === -1 ? 0.5 : (w.winner === 0) === !flip ? 1 : 0);
      }
  }
console.log(JSON.stringify({ res, pairs, mins }));
