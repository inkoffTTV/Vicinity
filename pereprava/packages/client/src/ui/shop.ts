// Лавка: разделы, поиск, карточка предмета с деревом рецепта, цель для быстрой покупки,
// инвентарь с рюкзаком, продажа и перекладывание. На телефоне карточка открывается вместо списка.
import {
  canAfford,
  HERO,
  INVENTORY,
  ITEM,
  ITEM_INTO,
  itemContains,
  itemCostFor,
  ITEMS,
  itemStats,
  nextPart,
  recipeCost,
  SECTIONS,
  type Command,
  type ItemSection,
  type MeSnap,
} from '@pereprava/shared';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const TIER = ['', 'Базовый', 'Промежуточный', 'Итоговый'];
const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');
const icon = (id: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ITEM[id].icon}</svg>`;

type Tab = 'rec' | ItemSection;

export interface ShopActions {
  send(cmd: Command): void;
  toast(text: string): void;
  /** Самый свежий снимок своего героя (лавка перерисовывается реже) */
  me(): MeSnap | null;
}

export class ShopUI {
  private tab: Tab = 'rec';
  private query = '';
  /** Открытая карточка */
  private sel: string | null = null;
  /** Выбранный слот инвентаря */
  private selSlot = -1;
  /** Цель быстрой покупки */
  target: string | null = null;
  private me: MeSnap | null = null;
  private gridKey = '';

  constructor(private readonly act: ShopActions) {
    const tabs = $('shopTabs');
    const all: { id: Tab; name: string }[] = [{ id: 'rec', name: 'Рекомендуемое' }, ...SECTIONS];
    for (const t of all) {
      const b = document.createElement('button');
      b.role = 'tab';
      b.dataset.tab = t.id;
      b.textContent = t.name;
      b.addEventListener('click', () => {
        this.tab = t.id;
        this.query = '';
        $<HTMLInputElement>('shopSearch').value = '';
        this.render();
      });
      tabs.appendChild(b);
    }
    $<HTMLInputElement>('shopSearch').addEventListener('input', (e) => {
      this.query = (e.target as HTMLInputElement).value.trim();
      this.render();
    });
    // Клик по карточке в списке, по части рецепта, по «входит в» — открыть предмет
    $('shop').addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-open]');
      if (el) this.open(el.dataset.open!);
    });
    $('quickBuy').addEventListener('click', () => this.quickBuy());
    $('shopQuick').addEventListener('click', () => this.quickBuy());
  }

  /** Список предметов текущего раздела или поиска */
  private list(): string[] {
    if (this.query) {
      const q = norm(this.query);
      return ITEMS.filter((i) => norm(i.name).includes(q)).map((i) => i.id);
    }
    if (this.tab === 'rec') {
      const build = this.me ? HERO[this.me.hero].build : [];
      return [...new Set([...build, 'potion', 'salve', 'recall'])];
    }
    return ITEMS.filter((i) => i.section === this.tab || (this.tab === 'final' && i.tier === 3)).map((i) => i.id);
  }

  open(id: string) {
    if (!ITEM[id]) return;
    this.sel = id;
    this.selSlot = -1;
    $('shop').classList.add('detail');
    this.render();
    $('shopCard').querySelector<HTMLElement>('.back, .buy')?.focus({ preventScroll: true });
  }

  /** Назад к списку (на телефоне) */
  back() {
    this.sel = null;
    $('shop').classList.remove('detail');
    this.render();
  }

  update(me: MeSnap | null) {
    this.me = me;
    if (this.target && me && me.items.some((x) => x && itemContains(x, this.target!))) {
      this.act.toast(`Цель собрана: ${ITEM[this.target].name}`);
      this.target = null;
    }
    this.renderQuick();
    if (!$('shop').hidden) this.render();
  }

  private here() {
    return !!this.me?.nearShop && !!this.me.alive;
  }

  render() {
    const me = this.me;
    if (!me) return;
    const gold = me.gold;
    $('shopGold').textContent = String(gold);
    const n = $('shopNote');
    const here = this.here();
    n.className = here ? 'ok' : '';
    n.textContent = here
      ? me.items.every((x) => x)
        ? 'Все слоты и рюкзак заняты — продайте или соберите предмет'
        : 'Вы у фонтана: можно покупать и продавать'
      : 'Покупать и продавать можно только у своего фонтана';
    // Вкладки
    $('shopTabs')
      .querySelectorAll<HTMLElement>('button')
      .forEach((b) => b.setAttribute('aria-selected', String(!this.query && b.dataset.tab === this.tab)));
    // Сетка: перестраиваем, только если поменялся состав
    const ids = this.list();
    const grid = $('shopGrid');
    const key = ids.join(',');
    if (key !== this.gridKey) {
      this.gridKey = key;
      grid.innerHTML = ids.length
        ? ids
            .map(
              (id) =>
                `<button class="sitem" data-open="${id}" data-id="${id}" style="--ic:${ITEM[id].color}"><span class="ic">${icon(id)}</span><b>${ITEM[id].name}</b><span class="pr coin"></span></button>`,
            )
            .join('')
        : '<p class="empty">Ничего не нашлось</p>';
    }
    grid.querySelectorAll<HTMLElement>('.sitem').forEach((b) => {
      const id = b.dataset.id!;
      const { cost } = itemCostFor(me.items, id);
      const pr = b.querySelector('.pr')!;
      pr.textContent = String(cost);
      pr.classList.toggle('cut', cost < ITEM[id].price);
      b.classList.toggle('can', canAfford(me.items, gold, id));
      b.classList.toggle('own', me.items.includes(id));
      b.classList.toggle('tgt', this.target === id);
      b.classList.toggle('on', this.sel === id);
      b.setAttribute('aria-label', `${ITEM[id].name}, ${cost} золота${me.items.includes(id) ? ', есть' : ''}`);
    });
    this.renderCard();
    this.renderInv();
  }

  private renderCard() {
    const me = this.me!;
    const card = $('shopCard');
    const id = this.sel;
    if (!id) {
      card.innerHTML = '<p class="hint">Выберите предмет — здесь будет, что он даёт и из чего собирается.</p>';
      return;
    }
    const it = ITEM[id];
    const { cost } = itemCostFor(me.items, id);
    const stats = itemStats(it);
    const can = canAfford(me.items, me.gold, id);
    const reason = !this.here()
      ? 'Нужно быть у фонтана'
      : it.unique && me.items.includes(id)
        ? 'Уже есть — один на героя'
        : me.gold < cost
          ? `Не хватает ${cost - me.gold} золота`
          : !can
            ? 'Нет места в инвентаре'
            : '';
    const parts = it.parts
      ? `<p class="lbl">Собирается из</p><div class="chips">${it.parts
          .map((p) => {
            const have = me.items.some((x) => x && itemContains(x, p));
            return `<button class="chip${have ? ' have' : ''}" data-open="${p}" style="--ic:${ITEM[p].color}">${icon(p)}<span>${ITEM[p].name}</span><small>${have ? '✓' : ITEM[p].price}</small></button>`;
          })
          .join('')}<span class="chip rc">+ рецепт ${recipeCost(id)}</span></div>`
      : '';
    const into = ITEM_INTO[id].length
      ? `<p class="lbl">Входит в</p><div class="chips">${ITEM_INTO[id]
          .map(
            (p) =>
              `<button class="chip" data-open="${p}" style="--ic:${ITEM[p].color}">${icon(p)}<span>${ITEM[p].name}</span><small>${ITEM[p].price}</small></button>`,
          )
          .join('')}</div>`
      : '';
    const isT = this.target === id;
    const next = isT ? nextPart(me.items, me.gold, id) : null;
    card.innerHTML = `
      <button class="back ghost" type="button">← К списку</button>
      <div class="ch" style="--ic:${it.color}"><span class="ic big">${icon(id)}</span><div><h3>${it.name}</h3><small>${TIER[it.tier]} · ${SECTIONS.find((s) => s.id === it.section)!.name}</small></div></div>
      ${stats.length ? `<ul class="stats">${stats.map((s) => `<li>${s}</li>`).join('')}</ul>` : ''}
      ${it.active || it.consumable || !stats.length ? `<p class="desc">${it.desc}</p>` : ''}
      ${parts}${into}
      <p class="price">Цена: <b class="coin">${cost}</b>${cost < it.price ? ` <s>${it.price}</s> — части уже есть` : ''}</p>
      ${next && next.id !== id ? `<p class="next">Следующим: ${ITEM[next.id].name} (${next.cost})</p>` : ''}
      <div class="acts">
        <button class="buy" type="button" ${can && this.here() ? '' : 'disabled'}>Купить</button>
        <button class="ghost tgtb" type="button" aria-pressed="${isT}">${isT ? '★ Цель отмечена' : '☆ Сделать целью'}</button>
      </div>
      ${reason ? `<p class="why">${reason}</p>` : ''}`;
    card.querySelector('.back')!.addEventListener('click', () => this.back());
    card.querySelector('.buy')!.addEventListener('click', () => this.act.send({ c: 'buy', item: id }));
    card.querySelector('.tgtb')!.addEventListener('click', () => {
      this.target = isT ? null : id;
      if (this.target) this.act.toast(`Цель: ${it.name}. Кнопка у лавки купит следующую часть`);
      this.renderQuick();
      this.render();
    });
  }

  private renderInv() {
    const me = this.me!;
    const box = $('shopInv');
    const slot = (id: string | null, i: number) => {
      const cls = `slot${id ? ' use' : ''}${i === this.selSlot ? ' on' : ''}${i >= INVENTORY ? ' bp' : ''}`;
      const style = id ? ` style="--ic:${ITEM[id].color}"` : '';
      const label = id
        ? `${ITEM[id].name}${i >= INVENTORY ? ', в рюкзаке' : ''}`
        : i >= INVENTORY
          ? 'Пустой слот рюкзака'
          : 'Пустой слот';
      return `<button class="${cls}" data-slot="${i}"${style} aria-label="${label}" ${id ? '' : 'disabled'}>${id ? icon(id) : ''}</button>`;
    };
    const html = me.items.map(slot);
    const key = html.join('');
    if (box.dataset.key !== key) {
      box.dataset.key = key;
      box.innerHTML = `<div class="main">${html.slice(0, INVENTORY).join('')}</div><span class="bpl">Рюкзак</span><div class="pack">${html.slice(INVENTORY).join('')}</div>`;
      box.querySelectorAll<HTMLButtonElement>('[data-slot]').forEach((b) =>
        b.addEventListener('click', () => {
          const i = +b.dataset.slot!;
          this.selSlot = this.selSlot === i ? -1 : i;
          box.dataset.key = '';
          this.renderInv();
        }),
      );
    }
    const actBox = $('shopInvAct');
    const i = this.selSlot;
    const id = i >= 0 ? me.items[i] : null;
    if (!id) {
      // Слот пуст (продали, или предмет как раз перекладывается) — действий нет, выбор не сбрасываем
      actBox.innerHTML = '';
      actBox.dataset.key = '';
      return;
    }
    const full = me.full[i] > 0 ? ` · полный возврат ещё ${Math.ceil(me.full[i])} с` : '';
    const toPack = i < INVENTORY;
    const row = `<span data-i="${i}">${ITEM[id].name}${full}</span><button class="buy sell" type="button" ${this.here() ? '' : 'disabled'}>Продать за ${me.sell[i]}</button><button class="ghost mv" type="button">${toPack ? 'В рюкзак' : 'В основные'}</button><button class="ghost info" type="button" data-open="${id}">Подробнее</button>`;
    if (actBox.dataset.key !== row) {
      actBox.dataset.key = row;
      actBox.innerHTML = row;
      // Номер слота и инвентарь берём в момент нажатия: панель перерисовывается реже, чем идёт игра
      actBox.querySelector('.sell')!.addEventListener('click', () => {
        if (this.selSlot < 0) return;
        this.act.send({ c: 'sell', slot: this.selSlot });
        this.selSlot = -1;
      });
      actBox.querySelector('.mv')!.addEventListener('click', () => {
        const items = (this.act.me() ?? me).items;
        const a = this.selSlot;
        if (a < 0 || !items[a]) return;
        // В свободный слот другой части, а если свободных нет — меняемся с последним
        const range = a < INVENTORY ? [INVENTORY, items.length] : [0, INVENTORY];
        let j = -1;
        for (let k = range[0]; k < range[1]; k++)
          if (!items[k]) {
            j = k;
            break;
          }
        if (j < 0) j = range[1] - 1;
        this.act.send({ c: 'swap', a, b: j });
        this.selSlot = j;
      });
    }
  }

  /** Кнопки быстрой покупки — у лавки на поле и внутри лавки: следующая часть цели */
  private renderQuick() {
    const me = this.me;
    const n = me && this.target ? nextPart(me.items, me.gold, this.target) : null;
    for (const [elId, long] of [
      ['quickBuy', false],
      ['shopQuick', true],
    ] as const) {
      const b = $(elId);
      if (!n || !me) {
        b.hidden = true;
        continue;
      }
      b.hidden = false;
      b.classList.toggle('ok', n.ok && this.here());
      b.style.setProperty('--ic', ITEM[n.id].color);
      const html = `${icon(n.id)}${long ? `<span>★ ${ITEM[this.target!].name}: купить ${ITEM[n.id].name}</span>` : ''}<span class="coin">${n.cost}</span>`;
      if (b.dataset.key !== html) {
        b.dataset.key = html;
        b.innerHTML = html;
      }
      const t = `Купить следующее к цели «${ITEM[this.target!].name}»: ${ITEM[n.id].name}, ${n.cost} золота`;
      if (b.title !== t) {
        b.title = t;
        b.setAttribute('aria-label', t);
      }
    }
  }

  /** Пока покупка не дошла до сервера, повторное нажатие не купит ту же часть второй раз */
  private pending: { key: string; t: number } | null = null;

  quickBuy() {
    const me = this.act.me() ?? this.me;
    if (!me || !this.target) return;
    const key = me.items.join('|');
    if (this.pending && this.pending.key === key && performance.now() - this.pending.t < 700) return;
    this.me = me;
    const n = nextPart(me.items, me.gold, this.target);
    if (!n) return;
    if (!this.here()) return this.act.toast('Покупать можно только у своего фонтана');
    if (!n.ok) return this.act.toast(`Не хватает золота: ${ITEM[n.id].name} стоит ${n.cost}`);
    this.pending = { key, t: performance.now() };
    this.act.send({ c: 'buy', item: n.id });
  }
}
