// Persistence: local storage with a schema version, plus JSON export/import.

import {
  CATEGORY_IDS,
  ESSENTIALS,
  createDefaultState,
  createDefaultQuotas,
  generateId,
  DEFAULT_SETTINGS,
} from './defaults.js';
import { isValidStoredItem, SETTING_LIMITS, QUOTA_LIMITS } from './validation.js';
import { fileTimestamp } from './dates.js';

export const STORAGE_KEY = 'survival-plan';
export const SCHEMA_VERSION = 1;

/** Detect whether local storage is usable (it throws in some private modes). */
export function isStorageAvailable() {
  try {
    const probe = '__survival_plan_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function clampNumber(value, limits, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < limits.min || n > limits.max) return fallback;
  if (limits.integer && !Number.isInteger(n)) return fallback;
  return n;
}

/**
 * Coerce any loaded object into a well-formed state, filling defaults for anything missing or invalid.
 * Returns the normalized state plus a count of items that were dropped as invalid.
 */
export function normalizeState(raw) {
  const base = createDefaultState();
  const source = raw && typeof raw === 'object' ? raw : {};

  const settingsIn = source.settings && typeof source.settings === 'object' ? source.settings : {};
  base.settings = {
    days: clampNumber(settingsIn.days, SETTING_LIMITS.days, DEFAULT_SETTINGS.days),
    people: clampNumber(settingsIn.people, SETTING_LIMITS.people, DEFAULT_SETTINGS.people),
    warningDays: clampNumber(settingsIn.warningDays, SETTING_LIMITS.warningDays, DEFAULT_SETTINGS.warningDays),
  };

  const defaults = createDefaultQuotas();
  const quotasIn = source.quotas && typeof source.quotas === 'object' ? source.quotas : {};
  const catIn = quotasIn.categories && typeof quotasIn.categories === 'object' ? quotasIn.categories : {};
  base.quotas = {
    categories: Object.fromEntries(
      CATEGORY_IDS.map((id) => [id, clampNumber(catIn[id], QUOTA_LIMITS.category, defaults.categories[id])]),
    ),
    proteinMin: clampNumber(quotasIn.proteinMin, QUOTA_LIMITS.proteinMin, defaults.proteinMin),
    proteinTarget: clampNumber(quotasIn.proteinTarget, QUOTA_LIMITS.proteinTarget, defaults.proteinTarget),
    waterGallons: clampNumber(quotasIn.waterGallons, QUOTA_LIMITS.waterGallons, defaults.waterGallons),
  };

  let dropped = 0;
  const itemsIn = Array.isArray(source.items) ? source.items : [];
  const seenIds = new Set();
  base.items = [];
  for (const item of itemsIn) {
    if (!isValidStoredItem(item)) {
      dropped += 1;
      continue;
    }
    let id = typeof item.id === 'string' && item.id ? item.id : generateId();
    if (seenIds.has(id)) id = generateId();
    seenIds.add(id);
    base.items.push({
      id,
      name: String(item.name).trim(),
      category: item.category,
      calories: Number(item.calories),
      protein: Number(item.protein),
      quantity: Number(item.quantity),
      expires: String(item.expires).trim(),
    });
  }

  const essIn = source.essentials && typeof source.essentials === 'object' ? source.essentials : {};
  base.essentials = Object.fromEntries(ESSENTIALS.map((e) => [e.id, essIn[e.id] === true]));

  return { state: base, dropped };
}

/**
 * Upgrade data written by older schema versions. Add a case per version bump.
 * Returns the migrated raw object (not yet normalized).
 */
export function migrate(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  let data = { ...raw };
  let version = Number(data.schemaVersion) || 0;

  // Version 0 (pre-release) → 1: same shape, just stamp the version.
  if (version < 1) {
    version = 1;
  }

  // Future migrations:
  // if (version < 2) { ...transform data...; version = 2; }

  data.schemaVersion = version;
  return data;
}

/** Load state from local storage. Returns { state, dropped, found, exportedAt }. */
export function loadState() {
  let text = null;
  try {
    text = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    text = null;
  }
  if (!text) return { ...normalizeState(null), found: false, exportedAt: null };
  try {
    const parsed = migrate(JSON.parse(text));
    const exportedAt = typeof parsed.exportedAt === 'string' ? parsed.exportedAt : null;
    return { ...normalizeState(parsed), found: true, exportedAt };
  } catch {
    return { ...normalizeState(null), found: false, exportedAt: null };
  }
}

/** Build the serializable document (state plus schema metadata). */
export function toDocument(state, now = new Date()) {
  return {
    app: 'survival-plan',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    settings: state.settings,
    quotas: state.quotas,
    items: state.items,
    essentials: state.essentials,
  };
}

/** Save state. Returns true on success, false if storage failed. */
export function saveState(state, now = new Date()) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(toDocument(state, now)));
    return true;
  } catch {
    return false;
  }
}

export function exportFileName(now = new Date()) {
  return `emergency-food-prep-${fileTimestamp(now)}.json`;
}

export function serializeForExport(state, now = new Date()) {
  return JSON.stringify(toDocument(state, now), null, 2);
}

/**
 * Parse an imported JSON file. Throws an Error with a user-facing message on failure.
 * @returns {{ state: object, dropped: number }}
 */
export function parseImport(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file is not a backup from this app.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('That file is not a backup from this app.');
  }
  const hasKnownShape = 'items' in parsed || 'settings' in parsed || 'quotas' in parsed || 'essentials' in parsed;
  if (!hasKnownShape) {
    throw new Error('That file is not a backup from this app.');
  }
  const version = Number(parsed.schemaVersion) || 0;
  if (version > SCHEMA_VERSION) {
    throw new Error(
      `This file was created by a newer version of Emergency Food Prep (schema ${version}). Update the app and try again.`,
    );
  }
  return normalizeState(migrate(parsed));
}
