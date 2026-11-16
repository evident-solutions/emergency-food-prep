// Input validation. Pure functions: take raw form values, return parsed values and errors.

import { CATEGORY_IDS } from './defaults.js';
import { parseISODate } from './dates.js';

export const ITEM_LIMITS = Object.freeze({
  name: { min: 1, max: 100 },
  calories: { min: 0, max: 100000 },
  protein: { min: 0, max: 500 },
  quantity: { min: 0, max: 9999 },
});

export const SETTING_LIMITS = Object.freeze({
  days: { min: 1, max: 365, integer: true, label: 'Days to cover' },
  people: { min: 1, max: 20, integer: true, label: 'Number of people' },
  warningDays: { min: 1, max: 365, integer: true, label: 'Expiration warning window' },
});

export const QUOTA_LIMITS = Object.freeze({
  category: { min: 0, max: 10000, integer: false, label: 'Calorie quota' },
  proteinMin: { min: 0, max: 500, integer: false, label: 'Protein minimum' },
  proteinTarget: { min: 0, max: 500, integer: false, label: 'Protein target' },
  waterGallons: { min: 0, max: 100, integer: false, label: 'Water per person per day' },
});

function fmt(n) {
  return Number(n).toLocaleString('en-US');
}

/**
 * Validate a single numeric field.
 * @returns {{ value: number|null, error: string|null }}
 */
export function validateNumber(raw, { min, max, integer, label }) {
  const text = raw === null || raw === undefined ? '' : String(raw).trim();
  if (text === '') return { value: null, error: `${label} is required.` };
  const value = Number(text);
  if (!Number.isFinite(value)) return { value: null, error: `${label} must be a number.` };
  if (value < 0) return { value: null, error: `${label} cannot be negative.` };
  if (integer && !Number.isInteger(value)) {
    return { value: null, error: `${label} must be a whole number.` };
  }
  if (value < min) return { value: null, error: `${label} must be at least ${fmt(min)}.` };
  if (value > max) return { value: null, error: `${label} cannot exceed ${fmt(max)}.` };
  return { value, error: null };
}

/**
 * Validate the raw item form values.
 * @param {{name:string, category:string, calories:string, protein:string, quantity:string, expires:string}} raw
 * @returns {{ values: object, errors: Record<string,string>, valid: boolean }}
 */
export function validateItem(raw) {
  const errors = {};
  const values = {};

  const name = (raw.name || '').trim();
  if (name.length < ITEM_LIMITS.name.min) {
    errors.name = 'Item name is required.';
  } else if (name.length > ITEM_LIMITS.name.max) {
    errors.name = `Item name must be ${ITEM_LIMITS.name.max} characters or fewer.`;
  } else {
    values.name = name;
  }

  if (!CATEGORY_IDS.includes(raw.category)) {
    errors.category = 'Choose a category.';
  } else {
    values.category = raw.category;
  }

  const calories = validateNumber(raw.calories, { ...ITEM_LIMITS.calories, integer: false, label: 'Calories per unit' });
  if (calories.error) errors.calories = calories.error; else values.calories = calories.value;

  const protein = validateNumber(raw.protein, { ...ITEM_LIMITS.protein, integer: false, label: 'Protein per unit' });
  if (protein.error) errors.protein = protein.error; else values.protein = protein.value;

  const quantity = validateNumber(raw.quantity, { ...ITEM_LIMITS.quantity, integer: true, label: 'Quantity' });
  if (quantity.error) errors.quantity = quantity.error; else values.quantity = quantity.value;

  const expires = (raw.expires || '').trim();
  if (expires === '') {
    errors.expires = 'Expiration date is required.';
  } else if (!parseISODate(expires)) {
    errors.expires = 'Enter a valid date.';
  } else {
    values.expires = expires;
  }

  return { values, errors, valid: Object.keys(errors).length === 0 };
}

/**
 * Check whether a stored item object is structurally valid (used on load/import).
 */
export function isValidStoredItem(item) {
  if (!item || typeof item !== 'object') return false;
  const result = validateItem({
    name: item.name,
    category: item.category,
    calories: item.calories,
    protein: item.protein,
    quantity: item.quantity,
    expires: item.expires,
  });
  return result.valid;
}
