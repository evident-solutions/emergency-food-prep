// Pure calculation functions. No DOM access, no storage access.
// Everything the screens display is derived from computeReport() and buildShoppingList().

import { CATEGORIES, ESSENTIALS, PROTEIN_CATEGORY } from './defaults.js';
import { daysBetween, todayISO } from './dates.js';

export const STATUS = Object.freeze({
  GOOD: 'good',
  EXPIRING: 'expiring',
  EXPIRED: 'expired',
});

export const STATUS_LABELS = Object.freeze({
  good: 'Good',
  expiring: 'Expiring soon',
  expired: 'Expired',
});

/** An item is expired if its expiration date is before today. */
export function isExpired(item, today) {
  return item.expires < today;
}

export function itemStatus(item, today, warningDays) {
  if (isExpired(item, today)) return STATUS.EXPIRED;
  const daysLeft = daysBetween(today, item.expires);
  if (daysLeft <= warningDays) return STATUS.EXPIRING;
  return STATUS.GOOD;
}

export function coverageLabel(percent) {
  if (percent >= 100) return 'Covered';
  if (percent >= 80) return 'Close';
  return 'Short';
}

export function coverageLevel(percent) {
  if (percent >= 100) return 'covered';
  if (percent >= 80) return 'close';
  return 'short';
}

/** Stock divided by required, capped at 100, floored so 99.9% is not shown as covered. */
export function percentCovered(stock, required) {
  if (required <= 0) return 100;
  return Math.min(100, Math.floor((stock / required) * 100));
}

function gapOf(required, stock) {
  return Math.max(0, required - stock);
}

/**
 * Compute the full adequacy report for the current state.
 * @param {object} state  App state (settings, quotas, items)
 * @param {string} [today] ISO date; defaults to the real today
 */
export function computeReport(state, today = todayISO()) {
  const { settings, quotas, items } = state;
  const D = settings.days;
  const P = settings.people;
  const W = settings.warningDays;

  const activeItems = [];
  const expiredItems = [];
  for (const item of items) {
    (isExpired(item, today) ? expiredItems : activeItems).push(item);
  }

  const categories = CATEGORIES.map((cat) => {
    const quota = Number(quotas.categories[cat.id]) || 0;
    const required = quota * D * P;
    const catItems = activeItems.filter((i) => i.category === cat.id);
    const stock = catItems.reduce((sum, i) => sum + i.calories * i.quantity, 0);
    const gap = gapOf(required, stock);
    const percent = percentCovered(stock, required);
    const perDay = quota * P;
    const days = perDay > 0 ? Math.floor(stock / perDay) : Infinity;
    return {
      id: cat.id,
      label: cat.label,
      quota,
      required,
      stock,
      gap,
      percent,
      coverage: coverageLabel(percent),
      level: coverageLevel(percent),
      days,
      items: catItems,
    };
  });

  const totals = {
    quota: categories.reduce((s, c) => s + c.quota, 0),
    required: categories.reduce((s, c) => s + c.required, 0),
    stock: categories.reduce((s, c) => s + c.stock, 0),
  };
  totals.gap = gapOf(totals.required, totals.stock);
  totals.percent = percentCovered(totals.stock, totals.required);
  totals.coverage = coverageLabel(totals.percent);
  totals.level = coverageLevel(totals.percent);

  // Calorie days of coverage: the weakest category decides.
  const finiteDays = categories.filter((c) => Number.isFinite(c.days));
  let calorieDays = 0;
  let limitingCategory = null;
  if (finiteDays.length > 0) {
    const weakest = finiteDays.reduce((min, c) => (c.days < min.days ? c : min), finiteDays[0]);
    calorieDays = weakest.days;
    limitingCategory = weakest.label;
  }

  const proteinStock = activeItems.reduce((sum, i) => sum + i.protein * i.quantity, 0);
  const proteinMin = Number(quotas.proteinMin) || 0;
  const proteinTarget = Number(quotas.proteinTarget) || 0;
  const requiredMin = proteinMin * D * P;
  const requiredTarget = proteinTarget * D * P;
  const proteinPerDay = proteinTarget * P;
  const proteinPercent = percentCovered(proteinStock, requiredTarget);
  const protein = {
    stock: proteinStock,
    requiredMin,
    requiredTarget,
    gapMin: gapOf(requiredMin, proteinStock),
    gapTarget: gapOf(requiredTarget, proteinStock),
    percent: proteinPercent,
    percentMin: percentCovered(proteinStock, requiredMin),
    coverage: coverageLabel(proteinPercent),
    level: coverageLevel(proteinPercent),
    days: proteinPerDay > 0 ? Math.floor(proteinStock / proteinPerDay) : 0,
  };

  const water = {
    perPersonPerDay: Number(quotas.waterGallons) || 0,
    gallons: (Number(quotas.waterGallons) || 0) * D * P,
  };

  const sufficient = categories.every((c) => c.gap === 0) && protein.gapMin === 0;

  const notes = [];
  if (protein.gapMin === 0 && protein.gapTarget > 0) {
    notes.push({
      id: 'protein-target',
      text: 'Protein meets the minimum but falls short of the recommended target.',
    });
  }
  if (expiredItems.length > 0) {
    const n = expiredItems.length;
    notes.push({
      id: 'expired',
      text: `${n} expired ${n === 1 ? 'item is' : 'items are'} excluded from all totals and gaps.`,
    });
  }

  const expiring = activeItems
    .map((item) => ({ ...item, daysLeft: daysBetween(today, item.expires) }))
    .filter((item) => item.daysLeft <= W)
    .sort((a, b) => a.daysLeft - b.daysLeft || a.name.localeCompare(b.name));

  const expired = expiredItems
    .map((item) => ({ ...item, daysAgo: -daysBetween(today, item.expires) }))
    .sort((a, b) => a.expires.localeCompare(b.expires));

  return {
    today,
    days: D,
    people: P,
    warningDays: W,
    itemCount: items.length,
    isEmpty: items.length === 0,
    categories,
    totals,
    calorieDays,
    limitingCategory,
    protein,
    water,
    sufficient,
    notes,
    expiring,
    expired,
  };
}

/**
 * Build the shopping list from a report. Suggestions are alternatives, not a combined purchase.
 */
export function buildShoppingList(report, state) {
  const D = report.days;
  const P = report.people;

  const categories = report.categories
    .filter((c) => c.gap > 0)
    .map((c) => ({
      id: c.id,
      label: c.label,
      gap: c.gap,
      suggestions: c.items
        .filter((i) => i.calories > 0)
        .map((i) => ({ id: i.id, name: i.name, count: Math.ceil(c.gap / i.calories) })),
    }));

  let protein = null;
  if (report.protein.gapTarget > 0) {
    const proteinCategory = report.categories.find((c) => c.id === PROTEIN_CATEGORY);
    const sources = proteinCategory ? proteinCategory.items.filter((i) => i.protein > 0) : [];
    protein = {
      gapMin: report.protein.gapMin,
      gapTarget: report.protein.gapTarget,
      suggestions: sources.map((i) => ({
        id: i.id,
        name: i.name,
        forMin: Math.ceil(report.protein.gapMin / i.protein),
        forTarget: Math.ceil(report.protein.gapTarget / i.protein),
      })),
    };
  }

  const essentials = ESSENTIALS.filter((e) => !state.essentials[e.id]).map((e) => ({
    id: e.id,
    label: e.label,
    quantity: e.perPersonPerDay ? D * P : null,
  }));

  return {
    categories,
    protein,
    water: report.water,
    essentials,
    isEmpty: categories.length === 0 && !protein && essentials.length === 0,
  };
}

const STATUS_RANK = { good: 0, expiring: 1, expired: 2 };

/**
 * Sort items for the stock table.
 * @param {Array} items
 * @param {{key:string, dir:'asc'|'desc'}} sort  key "default" = category, then expiration oldest first
 */
export function sortItems(items, sort, today, warningDays) {
  const categoryOrder = Object.fromEntries(CATEGORIES.map((c, idx) => [c.id, idx]));
  const dir = sort.dir === 'desc' ? -1 : 1;
  const byCategory = (a, b) => (categoryOrder[a.category] ?? 99) - (categoryOrder[b.category] ?? 99);
  const byExpires = (a, b) => a.expires.localeCompare(b.expires);
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

  const comparators = {
    default: (a, b) => byCategory(a, b) || byExpires(a, b) || byName(a, b),
    name: (a, b) => byName(a, b) || byExpires(a, b),
    category: (a, b) => byCategory(a, b) || byExpires(a, b) || byName(a, b),
    calories: (a, b) => a.calories - b.calories || byName(a, b),
    protein: (a, b) => a.protein - b.protein || byName(a, b),
    quantity: (a, b) => a.quantity - b.quantity || byName(a, b),
    expires: (a, b) => byExpires(a, b) || byName(a, b),
    status: (a, b) =>
      STATUS_RANK[itemStatus(a, today, warningDays)] - STATUS_RANK[itemStatus(b, today, warningDays)] ||
      byExpires(a, b) ||
      byName(a, b),
  };

  const cmp = comparators[sort.key] || comparators.default;
  return [...items].sort((a, b) => dir * cmp(a, b));
}

/** Find an existing item with the same (case-insensitive) name in the same category. */
export function findDuplicate(items, name, category, excludeId = null) {
  const needle = name.trim().toLowerCase();
  return (
    items.find(
      (i) => i.id !== excludeId && i.category === category && i.name.trim().toLowerCase() === needle,
    ) || null
  );
}
