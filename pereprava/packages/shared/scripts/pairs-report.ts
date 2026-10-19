// Сводка по результатам pairs.ts (несколько файлов частей): доля побед героев и длительность.
import { readFileSync } from 'node:fs';

const res: Record<string, [number, number]> = {};
const mins: number[] = [];
for (const f of process.argv.slice(2)) {
  const d = JSON.parse(readFileSync(f, 'utf8'));
  for (const [id, [wn, n]] of Object.entries(d.res as Record<string, [number, number]>)) {
    res[id] ??= [0, 0];
    res[id][0] += wn;
    res[id][1] += n;
  }
  mins.push(...d.mins);
}
const rows = Object.entries(res)
  .map(([id, [wn, n]]) => ({ id, p: n ? wn / n : 0, n }))
  .sort((a, b) => b.p - a.p);
for (const r of rows)
  console.log(
    `${r.id.padEnd(10)} ${(r.p * 100).toFixed(1).padStart(5)}%  (${r.n})${r.p > 0.6 || r.p < 0.4 ? '  ← вне 40–60%' : ''}`,
  );
mins.sort((a, b) => a - b);
console.log(
  `матчей ${mins.length}, медиана ${mins[mins.length >> 1].toFixed(1)} мин, от ${mins[0].toFixed(1)} до ${mins[mins.length - 1].toFixed(1)}`,
);
