// Баланс: прогоняет матчи бот против бота без графики и печатает длительность и счёт.
//   npm run balance -- [матчей=6] [режим=1v1|2v2|3v3] [сложность=normal] [лес=1]
import { createWorld, step, HEROES, TICK_RATE, type PlayerSetup, type Team } from '../src/index';

const [n = '6', mode = '1v1', diff = 'normal', jungle = '1'] = process.argv.slice(2);
const per = mode === '3v3' ? 3 : mode === '2v2' ? 2 : 1;
const ids = HEROES.map((h) => h.id);
const rows: string[] = [];
let total = 0;
const wins = [0, 0];
for (let i = 0; i < +n; i++) {
  const players: PlayerSetup[] = [];
  for (const team of [0, 1] as Team[])
    for (let k = 0; k < per; k++)
      players.push({
        name: `Бот ${team}${k}`,
        team,
        hero: ids[Math.floor(i / ids.length + team * 2 + i * (team + 1) + k) % ids.length],
        bot: diff,
      });
  const w = createWorld({ seed: 1000 + i, players, jungle: jungle === '1' });
  const limit = 40 * 60 * TICK_RATE;
  while (w.winner === -1 && w.tick < limit) step(w);
  const min = w.time / 60;
  total += min;
  if (w.winner !== -1) wins[w.winner]++;
  const heroes = players.map((p) => p.hero).join(',');
  rows.push(
    `#${i} ${heroes.padEnd(28)} ${min.toFixed(1)} мин, победа: ${w.winner === -1 ? 'нет' : w.winner}, счёт ${w.kills[0]}:${w.kills[1]}, ур. ${w.players.map((p) => w.units.find((u) => u.id === p.unit)!.hero!.level).join('/')}`,
  );
}
const mins = rows.map((r) => parseFloat(/ (\d+\.\d) мин/.exec(r)![1])).sort((a, b) => a - b);
console.log(rows.join('\n'));
console.log(
  `среднее: ${(total / +n).toFixed(1)} мин, медиана ${mins[Math.floor(mins.length / 2)]}, от ${mins[0]} до ${mins[mins.length - 1]}, в 12–18 мин: ${mins.filter((m) => m >= 12 && m <= 18).length}/${mins.length}, победы ${wins[0]}:${wins[1]}`,
);
