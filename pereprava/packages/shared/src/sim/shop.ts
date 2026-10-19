// Лавка: цены с учётом инвентаря, «что купить дальше» к цели, стоимость продажи.
// Чистые функции от инвентаря и золота — их зовут и симуляция, и интерфейс, и бот.
import { ITEM, recipeCost } from '../data/items';

/** Основных слотов (дают прибавки, предметы применяются клавишами 1–6) */
export const INVENTORY = 6;
/** Слотов рюкзака: предметы лежат без прибавок, их части засчитываются в рецепты */
export const BACKPACK = 3;
export const ALL_SLOTS = INVENTORY + BACKPACK;
/** Сколько секунд после покупки предмет продаётся за полную цену */
export const FULL_REFUND_TIME = 10;

/** Сколько стоит купить id при таком инвентаре и какие слоты уйдут в рецепт.
 *  Части ищутся на любой глубине: сначала целиком промежуточный предмет, потом его части. */
export function itemCostFor(items: readonly (string | null)[], id: string): { cost: number; consume: number[] } {
  const taken = new Set<number>();
  const rec = (x: string, top: boolean): number => {
    if (!top) {
      const i = items.findIndex((y, j) => y === x && !taken.has(j));
      if (i >= 0) {
        taken.add(i);
        return 0;
      }
    }
    const it = ITEM[x];
    if (!it.parts) return it.price;
    let c = recipeCost(x);
    for (const p of it.parts) c += rec(p, false);
    return c;
  };
  const cost = rec(id, true);
  return { cost: Math.max(0, cost), consume: [...taken].sort((a, b) => a - b) };
}

/** Можно ли купить, если известны только золото и инвентарь (для интерфейса и бота) */
export function canAfford(items: readonly (string | null)[], gold: number, id: string): boolean {
  const it = ITEM[id];
  if (!it) return false;
  const { cost, consume } = itemCostFor(items, id);
  if (gold < cost) return false;
  if (items.filter((x) => !x).length + consume.length < 1) return false;
  return !(it.unique && items.includes(id));
}

/** Что купить следующим, чтобы прийти к цели: сам предмет, если по карману, иначе первая по
 *  порядку недостающая часть (вглубь дерева). ok — хватает ли золота и места прямо сейчас.
 *  null — цель уже собрана и она «одна на героя». */
export function nextPart(
  items: readonly (string | null)[],
  gold: number,
  target: string,
): { id: string; cost: number; ok: boolean } | null {
  const t = ITEM[target];
  if (!t || (t.unique && items.includes(target))) return null;
  // '#' — слот, уже отданный в рецепт выше по дереву: не свободен и не совпадает ни с чем
  const walk = (id: string, pool: (string | null)[]): { id: string; cost: number; ok: boolean } => {
    const cost = itemCostFor(pool, id).cost;
    if (canAfford(pool, gold, id)) return { id, cost, ok: true };
    const it = ITEM[id];
    if (!it.parts) return { id, cost, ok: false };
    const rest = [...pool];
    let fallback: { id: string; cost: number; ok: boolean } | null = null;
    for (const p of it.parts) {
      const i = rest.indexOf(p);
      if (i >= 0) {
        rest[i] = '#';
        continue;
      }
      const r = walk(p, rest);
      if (r.ok) return r;
      fallback ??= r;
    }
    return fallback ?? { id, cost, ok: false };
  };
  return walk(target, [...items]);
}

/** Сколько вернут за предмет: полную уплаченную сумму в первые 10 с, потом половину цены */
export function sellValue(id: string, boughtAt: number, paid: number, now: number): number {
  if (now - boughtAt < FULL_REFUND_TIME && paid > 0) return paid;
  return Math.floor(ITEM[id].price / 2);
}
