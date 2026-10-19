// Экраны меню: карточки героев, выбор героя перед матчем, таблица счёта.
import { ABILITIES, HERO, HEROES, ITEM, type PlayerSnap, type Snapshot } from '@pereprava/shared';

const KEYS = ['Q', 'W', 'E', 'R'];
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Вкладка «Герои»: все герои со способностями */
export function renderHeroCards(el: HTMLElement, chosen: string, onPick: (id: string) => void) {
  el.innerHTML = HEROES.map((h) => {
    const skills = h.abilities
      .map((id, i) => {
        const a = ABILITIES[id];
        const tag = a.passive ? 'пассивная' : a.ult ? 'ультимейт, с 6 уровня' : `перезарядка ${a.cd} с`;
        return `<div class="skill"><kbd style="--k:${a.colors[2]}">${KEYS[i]}</kbd><div><b>${a.name}.</b> <span>${a.desc} <i>(${tag})</i></span></div></div>`;
      })
      .join('');
    return `<article class="card2 panel" style="--hc:${h.color}">
      <span class="role">${h.role}</span><h3 style="color:${h.color}">${h.name}</h3>
      <dl class="stats"><dt>Здоровье</dt><dd>${h.baseHp}, +${h.hpLvl} за уровень</dd><dt>Урон</dt><dd>${h.baseDmg}, +${h.dmgLvl} за уровень</dd><dt>Атака</dt><dd>${h.ranged ? `дальняя, ${String(h.range).replace('.', ',')} м` : 'ближняя'}</dd><dt>Скорость</dt><dd>${String(h.baseSpeed).replace('.', ',')}</dd></dl>
      ${skills}
      <button class="ghost" data-hero="${h.id}" aria-pressed="${h.id === chosen}">${h.id === chosen ? 'Выбран' : 'Играть за этого героя'}</button>
    </article>`;
  }).join('');
  el.querySelectorAll<HTMLButtonElement>('[data-hero]').forEach((b) => b.addEventListener('click', () => onPick(b.dataset.hero!)));
}

/** Сетка карточек для экрана выбора */
export function renderPickGrid(el: HTMLElement, chosen: string, onPick: (id: string) => void) {
  el.innerHTML = HEROES.map(
    (h) => `<button class="hcard" data-hero="${h.id}" aria-pressed="${h.id === chosen}" style="--hc:${h.color}">
      <b>${h.name}</b><small>${h.role}</small><span>${h.tagline}</span>
      <span class="keys4">${h.abilities.map((id, i) => `<i style="--k:${ABILITIES[id].colors[2]}" title="${esc(ABILITIES[id].name)}">${KEYS[i]}</i>`).join('')}</span>
    </button>`,
  ).join('');
  el.querySelectorAll<HTMLButtonElement>('.hcard').forEach((b) =>
    b.addEventListener('click', () => {
      el.querySelectorAll('.hcard').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      onPick(b.dataset.hero!);
    }),
  );
}

function items(p: PlayerSnap) {
  return p.items
    .filter((x): x is string => !!x)
    .map((id) => `<i style="--ic:${ITEM[id].color}" title="${esc(ITEM[id].name)}"><svg viewBox="0 0 24 24">${ITEM[id].icon}</svg></i>`)
    .join('');
}

/** Таблица счёта: команды, герои, У/С/П, добито, золото, урон по героям, предметы */
export function scoreTable(s: Snapshot, myTeam: number, mySlot: number): string {
  const teams = [myTeam, 1 - myTeam];
  const rows = teams
    .flatMap((t) => s.players.filter((p) => p.team === t))
    .map((p) => {
      const h = HERO[p.hero];
      const cls = `t${p.team === myTeam ? 0 : 1}${p.slot === mySlot ? ' mine' : ''}`;
      return `<tr class="${cls}"><td class="who"><b>${esc(p.name)}</b><small>${h.name}, ур. ${p.level}${p.alive ? '' : ' · ' + Math.ceil(p.respawn) + ' с'}</small></td>
        <td>${p.kills} / ${p.deaths} / ${p.assists}</td><td>${p.lastHits}${p.denies ? ' / ' + p.denies : ''}</td><td>${p.gold}</td><td>${p.heroDamage}</td><td><span class="its">${items(p)}</span></td></tr>`;
    })
    .join('');
  return `<table class="score"><thead><tr><th>Игрок</th><th title="Убийства / смерти / помощь">У / С / П</th><th title="Добито крипов / не отдано врагу">Добито</th><th>Золото</th><th>Урон героям</th><th>Предметы</th></tr></thead><tbody>${rows}</tbody></table>`;
}
