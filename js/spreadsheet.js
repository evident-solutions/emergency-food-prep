// Spreadsheet import: parse CSV/TSV text (from a file or pasted cells) and map it onto stock items.
// Pure functions only; the dialog UI lives in ui.js / app.js.

import { CATEGORIES, generateId } from './defaults.js';
import { validateItem } from './validation.js';
import { parseFlexibleDate } from './dates.js';
import { findDuplicate } from './calculations.js';

/* ------------------------------------------------------------------
   Header mapping
   ------------------------------------------------------------------ */

export const IMPORT_FIELDS = Object.freeze([
  { key: 'name', label: 'Item name', header: 'Item Name' },
  { key: 'category', label: 'Category', header: 'Category' },
  { key: 'calories', label: 'Calories per unit', header: 'Calories per Unit' },
  { key: 'protein', label: 'Protein per unit (g)', header: 'Protein per Unit (g)' },
  { key: 'quantity', label: 'Quantity', header: 'Quantity' },
  { key: 'expires', label: 'Expiration date', header: 'Expiration Date' },
]);

// Aliases are compared after normalizeHeader(): lower-case, letters and digits only.
const HEADER_ALIASES = {
  name: ['itemname', 'name', 'item', 'product', 'productname', 'food', 'description'],
  category: ['category', 'cat', 'type', 'group', 'foodgroup'],
  calories: [
    'caloriesperunit', 'calories', 'cal', 'cals', 'kcal', 'calorie', 'caloriespercontainer',
    'caloriesunit', 'totalcalories', 'energy',
  ],
  protein: [
    'proteinperunitg', 'proteinperunit', 'protein', 'proteing', 'proteingrams', 'proteinpercontainer',
    'proteinpercontainerg', 'totalprotein', 'proteinunit',
  ],
  quantity: ['quantity', 'qty', 'count', 'units', 'amount', 'number', 'num', 'onhand', 'stock'],
  expires: [
    'expirationdate', 'expiration', 'expires', 'expiry', 'expirydate', 'exp', 'expdate', 'bestby',
    'bestbydate', 'useby', 'usebydate', 'bestbefore', 'bestbeforedate', 'date', 'expireson',
  ],
};

export function normalizeHeader(text) {
  return String(text ?? '')
    .replace(/^\uFEFF/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Map a header row onto the six stock fields.
 * @returns {{ mapping: Record<string, number>, missing: string[], headers: string[] }}
 */
export function mapHeaders(headerRow) {
  const headers = headerRow.map((h) => String(h ?? '').replace(/^\uFEFF/, '').trim());
  const normalized = headers.map(normalizeHeader);
  const mapping = {};
  const used = new Set();

  for (const field of IMPORT_FIELDS) {
    const aliases = HEADER_ALIASES[field.key];
    let found = -1;
    // Prefer exact alias matches in alias priority order.
    for (const alias of aliases) {
      const idx = normalized.findIndex((h, i) => h === alias && !used.has(i));
      if (idx >= 0) {
        found = idx;
        break;
      }
    }
    // Fall back to "header starts with alias" (e.g. "Calories (whole can)").
    if (found < 0) {
      for (const alias of aliases) {
        const idx = normalized.findIndex((h, i) => h.startsWith(alias) && !used.has(i) && alias.length >= 3);
        if (idx >= 0) {
          found = idx;
          break;
        }
      }
    }
    if (found >= 0) {
      mapping[field.key] = found;
      used.add(found);
    }
  }

  const missing = IMPORT_FIELDS.filter((f) => !(f.key in mapping)).map((f) => f.label);
  return { mapping, missing, headers };
}

/* ------------------------------------------------------------------
   Delimited text parsing (RFC 4180-style, tolerant)
   ------------------------------------------------------------------ */

export function detectDelimiter(text) {
  const sample = text.split(/\r?\n/).filter((line) => line.trim()).slice(0, 10).join('\n');
  const counts = {
    '\t': (sample.match(/\t/g) || []).length,
    ',': (sample.match(/,/g) || []).length,
    ';': (sample.match(/;/g) || []).length,
  };
  if (counts['\t'] > 0) return '\t';
  if (counts[';'] > counts[',']) return ';';
  return ',';
}

/**
 * Parse delimited text into rows of cells. Handles quoted fields (with embedded delimiters,
 * quotes and newlines), CRLF/CR/LF line endings and a leading BOM.
 */
export function parseDelimited(text, delimiter = detectDelimiter(text)) {
  const src = String(text ?? '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function isBlankRow(row) {
  return row.every((cell) => String(cell ?? '').trim() === '');
}

/* ------------------------------------------------------------------
   Cell parsing
   ------------------------------------------------------------------ */

function normalizeCategoryText(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]/g, '');
}

const CATEGORY_ALIASES = {
  starches: ['starchesandgrains', 'starches', 'starch', 'grains', 'grain', 'carbs', 'carbohydrates', 'starchgrains'],
  proteins: ['beansandproteins', 'beansproteins', 'proteins', 'protein', 'beans', 'bean', 'meat', 'meats'],
  fats: ['fats', 'fat', 'oils', 'oil', 'fatsandoils'],
  produce: ['fruitsandvegetables', 'fruitsvegetables', 'produce', 'fruits', 'fruit', 'vegetables', 'vegetable', 'veg', 'fruitsandveg', 'fruitveg'],
  morale: ['flexiblemorale', 'flexible', 'morale', 'flexiblemoraleitems', 'treats', 'comfort', 'other', 'misc'],
};

/** Resolve a free-text category cell to a category id, or null. */
export function parseCategory(text) {
  const norm = normalizeCategoryText(text);
  if (!norm) return null;
  for (const cat of CATEGORIES) {
    if (norm === normalizeCategoryText(cat.label) || norm === cat.id) return cat.id;
  }
  for (const [id, aliases] of Object.entries(CATEGORY_ALIASES)) {
    if (aliases.includes(norm)) return id;
  }
  return null;
}

/** Strip thousands separators, whitespace and trailing units so validateNumber can parse the value. */
export function cleanNumberCell(text) {
  let s = String(text ?? '').trim();
  if (!s) return '';
  s = s.replace(/\s+/g, '');
  s = s.replace(/(kcal|cal(ories)?|grams?|g)$/i, '');
  // Remove thousands separators only when they look like thousands separators (1,234 or 1.234.567).
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  return s;
}

/* ------------------------------------------------------------------
   Full parse
   ------------------------------------------------------------------ */

/**
 * @typedef {object} ParsedRow
 * @property {number} line        1-based line number in the source (header excluded from counting)
 * @property {string[]} raw       the original cells
 * @property {object} values      parsed field values (only for valid rows)
 * @property {Record<string,string>} errors
 * @property {'new'|'update'|'error'} status
 * @property {string|null} existingId  id of the stock item this row would update
 */

function emptyParse(fatal = null) {
  return { fatal, headers: [], mapping: {}, rows: [], counts: { valid: 0, newRows: 0, updates: 0, errors: 0 } };
}

/**
 * Parse an already-tokenised grid (from CSV or an Excel sheet) into candidate stock items.
 * @param {string[][]} allRows
 * @param {{ existingItems?: object[] }} [options]
 */
export function parseSpreadsheetRows(allRows, { existingItems = [] } = {}) {
  const empty = emptyParse();
  const nonBlank = allRows.map((row, idx) => ({ row, idx })).filter(({ row }) => !isBlankRow(row));
  if (nonBlank.length === 0) return { ...empty, fatal: 'The file is empty.' };

  const headerEntry = nonBlank[0];
  const { mapping, missing, headers } = mapHeaders(headerEntry.row);
  if (missing.length > 0) {
    const found = headers.filter(Boolean).map((h) => `"${h}"`).join(', ') || '(none)';
    return {
      ...empty,
      headers,
      mapping,
      fatal: `Could not find ${missing.length === 1 ? 'a column' : 'columns'} for: ${missing.join(', ')}. Headers found: ${found}. The first row must contain the column names.`,
    };
  }

  const dataEntries = nonBlank.slice(1);
  if (dataEntries.length === 0) {
    return { ...empty, headers, mapping, fatal: 'The header row was found but there are no data rows below it.' };
  }

  // Track duplicates within the sheet itself so a later row updates the earlier one, not both.
  const seenInSheet = new Map();
  const rows = dataEntries.map(({ row, idx }) => {
    const cell = (key) => (mapping[key] < row.length ? String(row[mapping[key]] ?? '').trim() : '');
    const categoryText = cell('category');
    const categoryId = parseCategory(categoryText);
    const dateText = cell('expires');
    const iso = parseFlexibleDate(dateText);

    const raw = {
      name: cell('name'),
      category: categoryId || '',
      calories: cleanNumberCell(cell('calories')),
      protein: cleanNumberCell(cell('protein')),
      quantity: cleanNumberCell(cell('quantity')),
      expires: iso || '',
    };
    const { values, errors } = validateItem(raw);

    if (!categoryId && categoryText) {
      errors.category = `Unknown category "${categoryText}". Use one of: ${CATEGORIES.map((c) => c.label).join(', ')}.`;
    }
    if (!iso && dateText) {
      errors.expires = `Could not read the date "${dateText}". Use YYYY-MM-DD or M/D/YYYY.`;
    }

    const parsed = {
      line: idx + 1,
      raw: row,
      display: { ...raw, categoryText, dateText },
      values,
      errors,
      status: 'error',
      existingId: null,
    };

    if (Object.keys(errors).length === 0) {
      const sheetKey = `${values.category}::${values.name.toLowerCase()}`;
      const existing = findDuplicate(existingItems, values.name, values.category);
      if (existing) {
        parsed.existingId = existing.id;
        parsed.status = 'update';
      } else {
        parsed.status = 'new';
      }
      if (seenInSheet.has(sheetKey)) {
        parsed.duplicateOfLine = seenInSheet.get(sheetKey);
      } else {
        seenInSheet.set(sheetKey, parsed.line);
      }
    }
    return parsed;
  });

  const counts = {
    valid: rows.filter((r) => r.status !== 'error').length,
    newRows: rows.filter((r) => r.status === 'new').length,
    updates: rows.filter((r) => r.status === 'update').length,
    errors: rows.filter((r) => r.status === 'error').length,
  };

  return { fatal: null, headers, mapping, rows, counts };
}

/**
 * Parse spreadsheet text (CSV / TSV / pasted cells) into candidate stock items.
 * @param {string} text
 * @param {{ existingItems?: object[] }} [options]
 */
export function parseSpreadsheet(text, { existingItems = [] } = {}) {
  const source = String(text ?? '');
  if (!source.trim()) return emptyParse('Nothing to import. Choose a file or paste spreadsheet cells.');
  return parseSpreadsheetRows(parseDelimited(source), { existingItems });
}

/**
 * Produce the new items array for a parsed import. Does not mutate `items`.
 * @param {object[]} items   current stock items
 * @param {ParsedRow[]} rows parsed rows (error rows are ignored)
 * @param {'add'|'replace'} mode
 * @returns {{ items: object[], added: number, updated: number }}
 */
export function applyImport(items, rows, mode) {
  const valid = rows.filter((r) => r.status !== 'error');
  let added = 0;
  let updated = 0;

  if (mode === 'replace') {
    const result = [];
    for (const row of valid) {
      const dup = findDuplicate(result, row.values.name, row.values.category);
      if (dup) {
        Object.assign(dup, row.values);
      } else {
        result.push({ id: generateId(), ...row.values });
        added += 1;
      }
    }
    return { items: result, added, updated: 0 };
  }

  const result = items.map((i) => ({ ...i }));
  for (const row of valid) {
    const existing = findDuplicate(result, row.values.name, row.values.category);
    if (existing) {
      Object.assign(existing, row.values);
      updated += 1;
    } else {
      result.push({ id: generateId(), ...row.values });
      added += 1;
    }
  }
  return { items: result, added, updated };
}

/* ------------------------------------------------------------------
   Template
   ------------------------------------------------------------------ */

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsvTemplate() {
  const header = IMPORT_FIELDS.map((f) => f.header);
  const example = ['Black beans', 'Beans and proteins', 350, 20, 12, '2028-03-01'];
  return [header, example].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export const TEMPLATE_FILE_NAME = 'emergency-food-prep-stock-template.csv';
