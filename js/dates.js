// Date helpers. All dates in the app are ISO "YYYY-MM-DD" strings in local time,
// which makes them sortable and comparable with plain string operators.

const DAY_MS = 86400000;

export function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayISO(now = new Date()) {
  return toISODate(now);
}

/** Parse "YYYY-MM-DD" into a local-midnight Date, or null if invalid. */
export function parseISODate(iso) {
  if (typeof iso !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function buildISO(year, month, day) {
  if (year < 100) year += 2000;
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return parseISODate(iso) ? iso : null;
}

function monthIndex(name) {
  const idx = MONTHS.indexOf(name.slice(0, 3).toLowerCase());
  return idx >= 0 ? idx + 1 : null;
}

/**
 * Parse a date typed or exported in a variety of common formats into "YYYY-MM-DD".
 * Supported: YYYY-MM-DD, YYYY/MM/DD, M/D/YYYY, M/D/YY, M-D-YYYY, D-Mon-YYYY, Mon D, YYYY, D Mon YYYY.
 * Slash/dash dates are always read month-first (US). Returns null if unrecognised or invalid.
 */
export function parseFlexibleDate(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().replace(/\s+/g, ' ');
  if (!text) return null;

  let m;
  // YYYY-MM-DD or YYYY/MM/DD (optionally followed by a time, which is ignored)
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(text))) {
    return buildISO(+m[1], +m[2], +m[3]);
  }
  // M/D/YYYY, M/D/YY, M-D-YYYY, M.D.YYYY
  if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:[ T].*)?$/.exec(text))) {
    return buildISO(+m[3], +m[1], +m[2]);
  }
  // D-Mon-YYYY, D Mon YYYY, D-Mon-YY
  if ((m = /^(\d{1,2})[-/ ]([A-Za-z]{3,9})\.?,?[-/ ](\d{2}|\d{4})$/.exec(text))) {
    const month = monthIndex(m[2]);
    return month ? buildISO(+m[3], month, +m[1]) : null;
  }
  // Mon D, YYYY / Month D YYYY
  if ((m = /^([A-Za-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{2}|\d{4})$/.exec(text))) {
    const month = monthIndex(m[1]);
    return month ? buildISO(+m[3], month, +m[2]) : null;
  }
  // Excel serial day number (e.g. 45917 → 2025-09-17). Restricted so a year like 2028 is not treated as a date.
  if (/^\d{5}(?:\.\d+)?$/.test(text)) {
    return parseExcelSerial(Number(text));
  }
  return null;
}

/** Convert an Excel serial day number to YYYY-MM-DD, or null if out of range. */
export function parseExcelSerial(n) {
  if (!Number.isFinite(n) || n < 20000 || n > 80000) return null;
  const utc = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * DAY_MS);
  return buildISO(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate());
}

/** Whole days from `fromISO` to `toISO` (positive if `toISO` is later). NaN if invalid. */
export function daysBetween(fromISO, toISO) {
  const a = parseISODate(fromISO);
  const b = parseISODate(toISO);
  if (!a || !b) return NaN;
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

/** Add (or subtract) whole days to an ISO date string. */
export function addDays(iso, days) {
  const d = parseISODate(iso);
  if (!d) return null;
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** Human-readable date, e.g. "Mar 1, 2028". Falls back to the raw string. */
export function formatDate(iso) {
  const d = parseISODate(iso);
  if (!d) return String(iso ?? '');
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Timestamp suitable for file names: 2026-10-30-173605 */
export function fileTimestamp(now = new Date()) {
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${toISODate(now)}-${hh}${mm}${ss}`;
}
