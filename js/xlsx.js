// Minimal XLSX reader: unzip the workbook and turn the first sheet into a grid of strings.
// Only the Open XML formats (.xlsx / .xlsm) are supported. No third-party library.

const EOCD = 0x06054b50;
const CDH = 0x02014b50;
const LOCAL = 0x04034b50;
const SPREADSHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const WORKSHEET_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet';

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

export function isZip(bytes) {
  return bytes && bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);
}

function findEocd(bytes) {
  const start = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= start; i -= 1) {
    if (u32(bytes, i) === EOCD) return i;
  }
  return -1;
}

function readZipEntries(bytes) {
  const eocd = findEocd(bytes);
  if (eocd < 0) throw new Error('That file is not a valid Excel workbook.');
  const count = u16(bytes, eocd + 10);
  let offset = u32(bytes, eocd + 16);
  const entries = new Map();
  for (let i = 0; i < count; i += 1) {
    if (u32(bytes, offset) !== CDH) break;
    const method = u16(bytes, offset + 10);
    const compSize = u32(bytes, offset + 20);
    const size = u32(bytes, offset + 24);
    const nameLen = u16(bytes, offset + 28);
    const extraLen = u16(bytes, offset + 30);
    const commentLen = u16(bytes, offset + 32);
    const localOff = u32(bytes, offset + 42);
    const name = new TextDecoder('utf-8').decode(bytes.subarray(offset + 46, offset + 46 + nameLen)).replace(/\\/g, '/');
    entries.set(name, { method, compSize, size, localOff });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('This browser cannot unpack Excel files. Use a current browser, or save the sheet as CSV.');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZipFile(bytes, entry) {
  if (u32(bytes, entry.localOff) !== LOCAL) throw new Error('That Excel file looks damaged.');
  const nameLen = u16(bytes, entry.localOff + 26);
  const extraLen = u16(bytes, entry.localOff + 28);
  const start = entry.localOff + 30 + nameLen + extraLen;
  const compressed = bytes.subarray(start, start + entry.compSize);
  if (entry.method === 0) return compressed;
  if (entry.method === 8) return inflateRaw(compressed);
  throw new Error('That Excel file uses a compression method this app cannot read. Save the sheet as CSV and try again.');
}

function xml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('The workbook XML could not be read.');
  return doc;
}

function els(root, name) {
  if (!root) return [];
  const a = [...root.getElementsByTagNameNS(SPREADSHEET_NS, name)];
  return a.length ? a : [...root.getElementsByTagName(name)];
}

function textOf(node) {
  return (node && node.textContent ? node.textContent : '').trim();
}

function colFromRef(ref) {
  const m = /^([A-Za-z]+)/.exec(ref || '');
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function rowFromRef(ref) {
  const m = /(\d+)$/.exec(ref || '');
  return m ? Number(m[1]) - 1 : 0;
}

function formatNumber(n) {
  if (!Number.isFinite(n)) return '';
  if (Number.isInteger(n)) return String(n);
  return String(n);
}

// Built-in Excel number formats that mean a date (or date+time).
const DATE_FMT_IDS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22,
  27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
  45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58,
]);

function formatLooksLikeDate(code) {
  const c = String(code || '').toLowerCase();
  if (!c || c === 'general') return false;
  if (/[\[\]]/.test(c) && !/[ymd]/.test(c)) return false;
  return /[ymd]/.test(c);
}

function parseStyles(doc) {
  const custom = new Map();
  for (const node of els(doc, 'numFmt')) {
    custom.set(Number(node.getAttribute('numFmtId')), node.getAttribute('formatCode') || '');
  }
  const dateXfs = new Set();
  els(doc, 'cellXfs')[0] && els(els(doc, 'cellXfs')[0], 'xf').forEach((xf, idx) => {
    const id = Number(xf.getAttribute('numFmtId'));
    const code = custom.get(id);
    if (DATE_FMT_IDS.has(id) || formatLooksLikeDate(code)) dateXfs.add(idx);
  });
  return dateXfs;
}

function parseSharedStrings(doc) {
  return els(doc, 'si').map((si) => els(si, 't').map(textOf).join(''));
}

function parseRels(doc) {
  const map = new Map();
  const nodes = [...doc.getElementsByTagNameNS(PKG_REL_NS, 'Relationship'), ...doc.getElementsByTagName('Relationship')];
  for (const node of nodes) {
    map.set(node.getAttribute('Id'), { type: node.getAttribute('Type'), target: node.getAttribute('Target') });
  }
  return map;
}

function firstSheetPath(workbookDoc, rels) {
  const sheets = els(workbookDoc, 'sheet');
  if (sheets.length === 0) throw new Error('The workbook has no sheets.');
  const rid = sheets[0].getAttributeNS(REL_NS, 'id') || sheets[0].getAttribute('r:id');
  const rel = rid && rels.get(rid);
  const target = rel && rel.type === WORKSHEET_REL ? rel.target : (rel && rel.target) || 'worksheets/sheet1.xml';
  const cleaned = target.replace(/^\//, '');
  return cleaned.startsWith('xl/') ? cleaned : `xl/${cleaned}`;
}

export function excelSerialToISO(n) {
  if (!Number.isFinite(n) || n < 1 || n >= 2958466) return null;
  // Excel's day 1 is 1900-01-01; it also pretends 1900 was a leap year.
  // Using 1899-12-30 as the epoch matches every real date from 1900-03-01 onward.
  const utc = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
  const y = utc.getUTCFullYear();
  const m = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const d = String(utc.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function cellValue(cell, shared, dateXfs) {
  const type = cell.getAttribute('t') || 'n';
  const style = Number(cell.getAttribute('s'));
  const isDate = Number.isFinite(style) && dateXfs.has(style);
  if (type === 's') {
    const idx = Number(textOf(els(cell, 'v')[0]));
    return Number.isFinite(idx) ? (shared[idx] ?? '') : '';
  }
  if (type === 'inlineStr') return els(cell, 't').map(textOf).join('');
  if (type === 'str' || type === 'e') return textOf(els(cell, 'v')[0]);
  if (type === 'b') return textOf(els(cell, 'v')[0]) === '1' ? 'TRUE' : 'FALSE';
  const raw = textOf(els(cell, 'v')[0]);
  if (raw === '') return '';
  const n = Number(raw);
  if (isDate && Number.isFinite(n)) return excelSerialToISO(n) || raw;
  if (Number.isFinite(n)) return formatNumber(n);
  return raw;
}

function sheetToRows(sheetDoc, shared, dateXfs) {
  const grid = [];
  let maxCol = 0;
  for (const cell of els(sheetDoc, 'c')) {
    const ref = cell.getAttribute('r') || '';
    const r = rowFromRef(ref);
    const c = colFromRef(ref);
    if (!grid[r]) grid[r] = [];
    grid[r][c] = cellValue(cell, shared, dateXfs);
    if (c > maxCol) maxCol = c;
  }
  return grid.map((row) => {
    const out = [];
    for (let i = 0; i <= maxCol; i += 1) out.push(row && row[i] != null ? String(row[i]) : '');
    return out;
  });
}

/**
 * Read the first worksheet of an .xlsx / .xlsm ArrayBuffer into a string grid.
 * @returns {Promise<string[][]>}
 */
export async function parseXlsx(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (!isZip(bytes)) {
    throw new Error('That file is not a valid Excel workbook (.xlsx). Save it as .xlsx or CSV and try again.');
  }
  const entries = readZipEntries(bytes);
  const readText = async (path) => {
    const entry = entries.get(path);
    if (!entry) return null;
    return new TextDecoder('utf-8').decode(await readZipFile(bytes, entry));
  };

  const workbookText = await readText('xl/workbook.xml');
  if (!workbookText) throw new Error('That Excel file is missing its workbook. Try saving as .xlsx or CSV.');
  const relsText = await readText('xl/_rels/workbook.xml.rels');
  const rels = relsText ? parseRels(xml(relsText)) : new Map();
  const sheetPath = firstSheetPath(xml(workbookText), rels);
  const sheetText = await readText(sheetPath);
  if (!sheetText) throw new Error('The first sheet in that workbook could not be read.');

  const sharedText = await readText('xl/sharedStrings.xml');
  const shared = sharedText ? parseSharedStrings(xml(sharedText)) : [];
  const stylesText = await readText('xl/styles.xml');
  const dateXfs = stylesText ? parseStyles(xml(stylesText)) : new Set();

  const rows = sheetToRows(xml(sheetText), shared, dateXfs);
  if (rows.length === 0) throw new Error('The first sheet is empty.');
  return rows;
}
