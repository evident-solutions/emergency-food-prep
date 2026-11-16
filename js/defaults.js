// Constants and default values for Emergency Food Prep.
// Everything that defines "what the app knows" lives here so that other
// modules (calculations, storage, UI) never hard-code categories or quotas.

export const CATEGORIES = Object.freeze([
  { id: 'starches', label: 'Starches and grains', defaultQuota: 850 },
  { id: 'proteins', label: 'Beans and proteins', defaultQuota: 500 },
  { id: 'fats', label: 'Fats', defaultQuota: 400 },
  { id: 'produce', label: 'Fruits and vegetables', defaultQuota: 200 },
  { id: 'morale', label: 'Flexible / morale', defaultQuota: 200 },
]);

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

export function categoryLabel(id) {
  const cat = CATEGORIES.find((c) => c.id === id);
  return cat ? cat.label : id;
}

// The category whose items are offered as protein suggestions on the shopping list.
export const PROTEIN_CATEGORY = 'proteins';

export const ESSENTIALS = Object.freeze([
  { id: 'canOpener', label: 'Manual can opener' },
  { id: 'heatSource', label: 'Cooking heat source and fuel' },
  { id: 'waterFilter', label: 'Water filter or purification tablets' },
  { id: 'multivitamins', label: 'Multivitamins', perPersonPerDay: true },
  { id: 'waterContainers', label: 'Water storage containers' },
]);

export const DEFAULT_SETTINGS = Object.freeze({
  days: 30,
  people: 2,
  warningDays: 30,
});

export const DEFAULT_QUOTAS = Object.freeze({
  categories: Object.freeze(
    Object.fromEntries(CATEGORIES.map((c) => [c.id, c.defaultQuota])),
  ),
  proteinMin: 50,
  proteinTarget: 70,
  waterGallons: 1,
});

export function createDefaultEssentials() {
  return Object.fromEntries(ESSENTIALS.map((e) => [e.id, false]));
}

export function createDefaultQuotas() {
  return {
    categories: { ...DEFAULT_QUOTAS.categories },
    proteinMin: DEFAULT_QUOTAS.proteinMin,
    proteinTarget: DEFAULT_QUOTAS.proteinTarget,
    waterGallons: DEFAULT_QUOTAS.waterGallons,
  };
}

export function createDefaultState() {
  return {
    settings: { ...DEFAULT_SETTINGS },
    quotas: createDefaultQuotas(),
    items: [],
    essentials: createDefaultEssentials(),
  };
}

export function generateId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
