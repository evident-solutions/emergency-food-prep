// Application controller: holds state, wires events, triggers renders.

import { createDefaultQuotas, DEFAULT_SETTINGS, generateId, categoryLabel } from './defaults.js';
import * as storage from './storage.js';
import { computeReport, buildShoppingList, sortItems, findDuplicate } from './calculations.js';
import { validateItem, validateNumber, SETTING_LIMITS, QUOTA_LIMITS } from './validation.js';
import { todayISO } from './dates.js';
import * as ui from './ui.js';
import { buildReminderEvents, getProvider } from './reminders.js';
import { parseSpreadsheet, parseSpreadsheetRows, applyImport, buildCsvTemplate, IMPORT_FIELDS, TEMPLATE_FILE_NAME } from './spreadsheet.js';
import { parseXlsx } from './xlsx.js';
import * as backupFile from './backupFile.js';

const app = {
  state: null,
  storageOk: true,
  sort: { key: 'default', dir: 'asc' },
  activeTab: 'plan',
  editingId: null,
  allowDuplicate: false,
  uiState: { expiringOpen: true },
  lastReport: null,
  sheetParsed: null,
  sheetSourceName: '',
  backup: { supported: false, name: '', needsPermission: false, handle: null },
  localExportedAt: null,
  backupWriteGen: 0,
};

const $ = (id) => document.getElementById(id);

/* ============================================================
   State changes
   ============================================================ */

function persist() {
  const now = new Date();
  if (app.storageOk) {
    const ok = storage.saveState(app.state, now);
    if (!ok) {
      app.storageOk = false;
      $('storage-banner').hidden = false;
    }
  }
  app.localExportedAt = now.toISOString();
  mirrorBackupFile(storage.serializeForExport(app.state, now));
}

/** Apply a mutation, save, and re-render everything derived from state. */
function commit(mutator) {
  if (typeof mutator === 'function') mutator(app.state);
  persist();
  renderAll();
}

/* ============================================================
   Rendering
   ============================================================ */

function renderAll() {
  const today = todayISO();
  const report = computeReport(app.state, today);
  app.lastReport = report;
  const list = buildShoppingList(report, app.state);
  const sorted = sortItems(app.state.items, app.sort, today, app.state.settings.warningDays);

  ui.renderSummary(report);
  ui.renderExpiring(report, app.uiState);
  ui.renderExpired(report);
  ui.renderStock(sorted, report, app.sort);
  ui.renderShopping(list, report);
  ui.renderEssentials(app.state, report);
  ui.renderQuotaTotal(app.state);

  const details = $('expiring-details');
  if (details) {
    details.addEventListener('toggle', () => {
      app.uiState.expiringOpen = details.open;
    });
  }
}

/* ============================================================
   Tabs
   ============================================================ */

const TABS = ['plan', 'shopping', 'settings'];

function showTab(name, { focus = false } = {}) {
  if (!TABS.includes(name)) return;
  app.activeTab = name;
  for (const tab of TABS) {
    const button = $(`tab-${tab}`);
    const panel = $(`panel-${tab}`);
    const selected = tab === name;
    button.setAttribute('aria-selected', selected ? 'true' : 'false');
    button.tabIndex = selected ? 0 : -1;
    panel.hidden = !selected;
    if (selected && focus) button.focus();
  }
  if (name === 'settings') ui.renderSettings(app.state);
  try {
    history.replaceState(null, '', `#${name}`);
  } catch {
    /* ignore */
  }
}

function initTabs() {
  const tablist = document.querySelector('.tablist');
  tablist.addEventListener('click', (event) => {
    const button = event.target.closest('[data-tab]');
    if (button) showTab(button.dataset.tab);
  });
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-tab]');
    if (button && !button.closest('.tablist')) showTab(button.dataset.tab);
  });
  tablist.addEventListener('keydown', (event) => {
    const idx = TABS.indexOf(app.activeTab);
    let next = null;
    if (event.key === 'ArrowRight') next = TABS[(idx + 1) % TABS.length];
    else if (event.key === 'ArrowLeft') next = TABS[(idx - 1 + TABS.length) % TABS.length];
    else if (event.key === 'Home') next = TABS[0];
    else if (event.key === 'End') next = TABS[TABS.length - 1];
    if (next) {
      event.preventDefault();
      showTab(next, { focus: true });
    }
  });
  const fromHash = location.hash.replace('#', '');
  showTab(TABS.includes(fromHash) ? fromHash : 'plan');
}

/* ============================================================
   Item form (add / edit)
   ============================================================ */

const FIELD_IDS = {
  name: 'f-name',
  category: 'f-category',
  calories: 'f-calories',
  protein: 'f-protein',
  quantity: 'f-quantity',
  expires: 'f-expires',
};

function readForm() {
  return Object.fromEntries(Object.entries(FIELD_IDS).map(([key, id]) => [key, $(id).value]));
}

function fillForm(item) {
  $('f-name').value = item ? item.name : '';
  $('f-category').value = item ? item.category : '';
  $('f-calories').value = item ? item.calories : '';
  $('f-protein').value = item ? item.protein : '';
  $('f-quantity').value = item ? item.quantity : '';
  $('f-expires').value = item ? item.expires : '';
}

function clearFormErrors() {
  for (const id of Object.values(FIELD_IDS)) ui.clearFieldError($(id));
  $('form-alert').hidden = true;
  $('form-alert').textContent = '';
  $('duplicate-warning').hidden = true;
}

function openItemForm(itemId = null, { focusField = null } = {}) {
  const dialog = $('item-dialog');
  const item = itemId ? app.state.items.find((i) => i.id === itemId) : null;
  app.editingId = item ? item.id : null;
  app.allowDuplicate = false;
  clearFormErrors();
  fillForm(item);
  $('item-dialog-title').textContent = item ? `Edit ${item.name}` : 'Add item';
  $('item-save-btn').textContent = item ? 'Save changes' : 'Save item';
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  const target = focusField && FIELD_IDS[focusField] ? $(FIELD_IDS[focusField]) : $('f-name');
  target.focus();
}

function closeItemForm() {
  const dialog = $('item-dialog');
  if (dialog.open) dialog.close();
  app.editingId = null;
  app.allowDuplicate = false;
}

function handleItemSubmit(event) {
  event.preventDefault();
  clearFormErrors();

  const raw = readForm();
  const { values, errors, valid } = validateItem(raw);

  if (!valid) {
    let first = null;
    for (const [key, message] of Object.entries(errors)) {
      const input = $(FIELD_IDS[key]);
      ui.setFieldError(input, message);
      if (!first) first = input;
    }
    const count = Object.keys(errors).length;
    const alert = $('form-alert');
    alert.textContent = `Please fix ${count} ${count === 1 ? 'problem' : 'problems'} below.`;
    alert.hidden = false;
    if (first) first.focus();
    return;
  }

  if (!app.allowDuplicate) {
    const duplicate = findDuplicate(app.state.items, values.name, values.category, app.editingId);
    if (duplicate) {
      const warning = $('duplicate-warning');
      $('duplicate-text').textContent = `An item named "${duplicate.name}" already exists in ${categoryLabel(
        duplicate.category,
      )} (quantity ${duplicate.quantity}, expires ${duplicate.expires}). Edit that row instead, or add this as a separate row.`;
      warning.hidden = false;
      $('dup-edit-btn').dataset.id = duplicate.id;
      $('dup-edit-btn').focus();
      return;
    }
  }

  if (app.editingId) {
    const id = app.editingId;
    commit((state) => {
      const idx = state.items.findIndex((i) => i.id === id);
      if (idx >= 0) state.items[idx] = { ...state.items[idx], ...values };
    });
    ui.showToast(`Updated ${values.name}.`);
  } else {
    commit((state) => {
      state.items.push({ id: generateId(), ...values });
    });
    ui.showToast(`Added ${values.name}.`);
  }
  closeItemForm();
}

function deleteItem(id) {
  const item = app.state.items.find((i) => i.id === id);
  if (!item) return;
  if (!window.confirm(`Delete "${item.name}"? This cannot be undone.`)) return;
  commit((state) => {
    state.items = state.items.filter((i) => i.id !== id);
  });
  ui.showToast(`Deleted ${item.name}.`);
  $('add-item-btn').focus();
}

function initItemForm() {
  ui.populateCategorySelect();
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-add-item]')) openItemForm(null);
  });
  $('item-form').addEventListener('submit', handleItemSubmit);
  $('item-cancel-btn').addEventListener('click', closeItemForm);
  $('item-dialog').addEventListener('close', () => {
    app.editingId = null;
    app.allowDuplicate = false;
  });

  // Clear an inline error as soon as the user edits that field.
  for (const id of Object.values(FIELD_IDS)) {
    $(id).addEventListener('input', () => ui.clearFieldError($(id)));
  }

  $('dup-edit-btn').addEventListener('click', (event) => {
    const id = event.currentTarget.dataset.id;
    if (id) openItemForm(id);
  });
  $('dup-add-btn').addEventListener('click', () => {
    app.allowDuplicate = true;
    $('item-form').requestSubmit();
  });

  // Edit / Delete / Update buttons in the stock table and expired panel (event delegation).
  const handleRowAction = (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const { action, id } = button.dataset;
    if (action === 'edit') openItemForm(id, { focusField: button.dataset.focus || null });
    else if (action === 'delete') deleteItem(id);
  };
  $('stock-content').addEventListener('click', handleRowAction);
  $('expired-content').addEventListener('click', handleRowAction);
}

/* ============================================================
   Sorting
   ============================================================ */

function setSort(key, dir) {
  app.sort = { key, dir };
  renderAll();
}

function initSorting() {
  $('stock-content').addEventListener('click', (event) => {
    const button = event.target.closest('[data-sort]');
    if (!button) return;
    const key = button.dataset.sort;
    const activeKey = app.sort.key === 'default' ? 'category' : app.sort.key;
    if (key === activeKey) {
      setSort(app.sort.key, app.sort.dir === 'asc' ? 'desc' : 'asc');
    } else {
      setSort(key, 'asc');
    }
  });
  $('sort-key').addEventListener('change', (event) => setSort(event.target.value, app.sort.dir));
  $('sort-dir').addEventListener('click', () => setSort(app.sort.key, app.sort.dir === 'asc' ? 'desc' : 'asc'));
}

/* ============================================================
   Settings
   ============================================================ */

function initSettings() {
  ui.buildQuotaFields();

  document.querySelectorAll('[data-setting]').forEach((input) => {
    input.addEventListener('input', () => {
      const key = input.dataset.setting;
      const { value, error } = validateNumber(input.value, SETTING_LIMITS[key]);
      ui.setFieldError(input, error);
      if (error) return;
      commit((state) => {
        state.settings[key] = value;
      });
    });
  });

  document.querySelectorAll('[data-quota-category]').forEach((input) => {
    input.addEventListener('input', () => {
      const id = input.dataset.quotaCategory;
      const { value, error } = validateNumber(input.value, {
        ...QUOTA_LIMITS.category,
        label: `${categoryLabel(id)} quota`,
      });
      ui.setFieldError(input, error);
      if (error) return;
      commit((state) => {
        state.quotas.categories[id] = value;
      });
    });
  });

  document.querySelectorAll('[data-quota]').forEach((input) => {
    input.addEventListener('input', () => {
      const key = input.dataset.quota;
      const { value, error } = validateNumber(input.value, QUOTA_LIMITS[key]);
      ui.setFieldError(input, error);
      if (error) return;
      commit((state) => {
        state.quotas[key] = value;
      });
    });
  });

  $('reset-quotas-btn').addEventListener('click', () => {
    commit((state) => {
      state.quotas = createDefaultQuotas();
    });
    ui.renderSettings(app.state);
    ui.showToast('Quotas reset to defaults.');
  });

  $('reset-all-btn').addEventListener('click', () => {
    if (!window.confirm('Reset plan settings and all quotas to their defaults? Your stock items and checklist are kept.')) return;
    commit((state) => {
      state.settings = { ...DEFAULT_SETTINGS };
      state.quotas = createDefaultQuotas();
    });
    ui.renderSettings(app.state);
    ui.showToast('Plan settings and quotas reset to defaults.');
  });
}

/* ============================================================
   Essentials checklist
   ============================================================ */

function initEssentials() {
  $('essentials-list').addEventListener('change', (event) => {
    const box = event.target.closest('[data-essential]');
    if (!box) return;
    const id = box.dataset.essential;
    const checked = box.checked;
    commit((state) => {
      state.essentials[id] = checked;
    });
    // Restore focus to the same checkbox after re-render.
    const again = document.querySelector(`[data-essential="${id}"]`);
    if (again) again.focus();
  });
}

/* ============================================================
   Export / import
   ============================================================ */

function setDataStatus(message) {
  $('data-status').textContent = message;
}

function setFileLinkStatus(message) {
  const line = $('file-link-status');
  if (line) line.textContent = message;
}

function renderFileLinkPanel() {
  const help = $('file-link-help');
  const nameEl = $('file-link-name');
  const createBtn = $('file-link-create-btn');
  const openBtn = $('file-link-open-btn');
  const writeBtn = $('file-link-write-btn');
  const stopBtn = $('file-link-stop-btn');
  if (!help || !createBtn) return;

  if (!app.backup.supported) {
    help.textContent = 'This browser cannot keep a live file link. Use Export JSON after big changes. The plan still saves in this browser and works offline.';
    createBtn.hidden = true;
    openBtn.hidden = true;
    writeBtn.hidden = true;
    stopBtn.hidden = true;
    nameEl.hidden = true;
    return;
  }

  const linked = Boolean(app.backup.name);
  if (!linked) {
    help.textContent = 'Choose a JSON file on this computer. After that, every change also overwrites that file. This browser copy stays the live store, so the app still works offline.';
    createBtn.hidden = false;
    openBtn.hidden = false;
    writeBtn.hidden = true;
    stopBtn.hidden = true;
    nameEl.hidden = true;
    nameEl.textContent = '';
    return;
  }

  help.textContent = app.backup.needsPermission
    ? 'The file is remembered, but this browser needs permission again before it can write. Click Write now — that does not need the internet.'
    : 'Each change is saved in this browser and written to this file.';
  nameEl.hidden = false;
  nameEl.textContent = `Linked file: ${app.backup.name}`;
  createBtn.hidden = true;
  openBtn.hidden = false;
  writeBtn.hidden = false;
  stopBtn.hidden = false;
}

function applyBackupResult(result, { quiet } = {}) {
  if (!result || result.state === 'unlinked') {
    app.backup.name = '';
    app.backup.needsPermission = false;
    app.backup.handle = null;
    renderFileLinkPanel();
    if (!quiet) setFileLinkStatus('');
    return;
  }

  app.backup.name = result.name || '';
  app.backup.handle = result.handle || null;
  app.backup.needsPermission = result.state === 'needs-permission';
  renderFileLinkPanel();

  if (result.state === 'ok' && !quiet) {
    setFileLinkStatus(`Wrote ${result.name}.`);
  } else if (result.state === 'needs-permission') {
    setFileLinkStatus(`Waiting for permission to write ${result.name}.`);
  } else if (result.state === 'error') {
    setFileLinkStatus(result.message || `Could not update ${result.name}.`);
  }
}

async function mirrorBackupFile(text) {
  if (!app.backup.supported || !app.backup.name) return;
  const gen = ++app.backupWriteGen;
  const payload = text || storage.serializeForExport(app.state);
  const result = await backupFile.writeIfAllowed(payload);
  if (gen !== app.backupWriteGen) return;
  applyBackupResult(result, { quiet: result.state === 'ok' });
  if (result.state === 'ok') setFileLinkStatus(`Last wrote ${result.name}.`);
}

async function linkNewBackupFile() {
  try {
    const handle = await backupFile.pickNewFile();
    const now = new Date();
    const text = storage.serializeForExport(app.state, now);
    if (app.storageOk) storage.saveState(app.state, now);
    app.localExportedAt = now.toISOString();
    await backupFile.writeHandle(handle, text);
    app.backup.name = handle.name;
    app.backup.handle = handle;
    app.backup.needsPermission = false;
    renderFileLinkPanel();
    setFileLinkStatus(`Linked ${handle.name}. This file will stay in sync.`);
    ui.showToast(`Saving to ${handle.name}.`);
  } catch (error) {
    if (error && error.name === 'AbortError') {
      setFileLinkStatus('File picker cancelled.');
      return;
    }
    setFileLinkStatus(error && error.message ? error.message : 'Could not create that file.');
  }
}

async function linkExistingBackupFile() {
  try {
    const handle = await backupFile.pickExistingFile();
    const text = await backupFile.readHandle(handle);
    let parsed;
    try {
      parsed = storage.parseImport(text);
    } catch (error) {
      setFileLinkStatus(error.message || 'That file is not an Emergency Food Prep export.');
      window.alert(error.message || 'That file is not an Emergency Food Prep export.');
      return;
    }
    if (!window.confirm('This will replace all current data in this browser with the file, then keep the file linked. Continue?')) {
      setFileLinkStatus('Link cancelled. This browser copy was not changed.');
      return;
    }
    await backupFile.rememberHandle(handle);
    app.state = parsed.state;
    app.backup.name = handle.name;
    app.backup.handle = handle;
    app.backup.needsPermission = false;
    persist();
    renderAll();
    ui.renderSettings(app.state);
    renderFileLinkPanel();
    const dropped = parsed.dropped ? ` ${parsed.dropped} invalid ${parsed.dropped === 1 ? 'item was' : 'items were'} skipped.` : '';
    setFileLinkStatus(`Restored from ${handle.name} and linked it.${dropped}`);
    ui.showToast(`Using ${handle.name}.`);
  } catch (error) {
    if (error && error.name === 'AbortError') {
      setFileLinkStatus('File picker cancelled.');
      return;
    }
    setFileLinkStatus(error && error.message ? error.message : 'Could not open that file.');
  }
}

async function writeBackupFileNow() {
  const handle = app.backup.handle || await backupFile.getHandle();
  if (!handle) {
    setFileLinkStatus('No file is linked.');
    return;
  }
  const permission = await backupFile.requestPermission(handle, 'readwrite');
  if (permission !== 'granted') {
    app.backup.needsPermission = true;
    renderFileLinkPanel();
    setFileLinkStatus('Permission was not granted. The plan is still saved in this browser.');
    return;
  }
  try {
    const now = new Date();
    const text = storage.serializeForExport(app.state, now);
    if (app.storageOk) storage.saveState(app.state, now);
    app.localExportedAt = now.toISOString();
    await backupFile.writeHandle(handle, text);
    app.backup.handle = handle;
    app.backup.name = handle.name;
    app.backup.needsPermission = false;
    renderFileLinkPanel();
    setFileLinkStatus(`Wrote ${handle.name}.`);
    ui.showToast(`Wrote ${handle.name}.`);
  } catch (error) {
    setFileLinkStatus(error && error.message ? error.message : 'Could not write the file.');
  }
}

async function stopLinkingBackupFile() {
  const name = app.backup.name;
  await backupFile.clearHandle();
  app.backup.name = '';
  app.backup.handle = null;
  app.backup.needsPermission = false;
  renderFileLinkPanel();
  setFileLinkStatus(name
    ? `Stopped linking ${name}. The file is still on disk. This browser copy is unchanged.`
    : 'No file was linked.');
}

async function restoreBackupLink() {
  app.backup.supported = backupFile.isSupported();
  if (!app.backup.supported) {
    renderFileLinkPanel();
    return;
  }
  const inspection = await backupFile.inspectLinkedFile();
  if (inspection.state === 'unlinked') {
    const remembered = backupFile.rememberedName();
    if (remembered) {
      app.backup.name = remembered;
      app.backup.needsPermission = true;
      renderFileLinkPanel();
      setFileLinkStatus(`Remembered ${remembered}. Click Write now to allow updates.`);
      return;
    }
    applyBackupResult({ state: 'unlinked' }, { quiet: true });
    return;
  }

  applyBackupResult(inspection, { quiet: true });

  if (inspection.state === 'readable' && inspection.text) {
    try {
      const parsed = JSON.parse(inspection.text);
      const fileAt = typeof parsed.exportedAt === 'string' ? parsed.exportedAt : '';
      if (fileAt && app.localExportedAt && fileAt > app.localExportedAt) {
        setFileLinkStatus(`${inspection.name} is newer than this browser copy. Click Use an existing file to load it into this browser.`);
        return;
      }
    } catch {
      /* ignore compare errors */
    }
    setFileLinkStatus(`Linked ${inspection.name}.`);
  }
}

function downloadText(text, fileName, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportData() {
  const now = new Date();
  const fileName = storage.exportFileName(now);
  downloadText(storage.serializeForExport(app.state, now), fileName, 'application/json');
  setDataStatus(`Exported ${fileName}.`);
}

function importData(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let result;
    try {
      result = storage.parseImport(String(reader.result));
    } catch (err) {
      setDataStatus(err.message || 'Import failed.');
      window.alert(err.message || 'Import failed.');
      return;
    }
    if (!window.confirm('This will replace all current data. Continue?')) {
      setDataStatus('Import cancelled.');
      return;
    }
    app.state = result.state;
    persist();
    renderAll();
    ui.renderSettings(app.state);
    const dropped = result.dropped ? ` ${result.dropped} invalid ${result.dropped === 1 ? 'item was' : 'items were'} skipped.` : '';
    setDataStatus(`Imported ${app.state.items.length} ${app.state.items.length === 1 ? 'item' : 'items'} from ${file.name}.${dropped}`);
    ui.showToast('Data imported.');
  };
  reader.onerror = () => {
    setDataStatus('Could not read that file.');
  };
  reader.readAsText(file);
}

function initData() {
  $('export-btn').addEventListener('click', exportData);
  $('import-btn').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', (event) => {
    const file = event.target.files && event.target.files[0];
    importData(file);
    event.target.value = '';
  });
  $('file-link-create-btn').addEventListener('click', linkNewBackupFile);
  $('file-link-open-btn').addEventListener('click', linkExistingBackupFile);
  $('file-link-write-btn').addEventListener('click', writeBackupFileNow);
  $('file-link-stop-btn').addEventListener('click', stopLinkingBackupFile);
}

/* ============================================================
   Spreadsheet import
   ============================================================ */

function openImportDialog() {
  const dialog = $('import-dialog');
  app.sheetParsed = null;
  app.sheetSourceName = '';
  $('sheet-file').value = '';
  $('sheet-paste').value = '';
  const addMode = document.querySelector('input[name="import-mode"][value="add"]');
  if (addMode) addMode.checked = true;
  ui.resetImportPreview();
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  $('sheet-file').focus();
}

function closeImportDialog() {
  const dialog = $('import-dialog');
  if (dialog.open) dialog.close();
  app.sheetParsed = null;
}

function selectedImportMode() {
  return document.querySelector('input[name="import-mode"]:checked')?.value === 'replace' ? 'replace' : 'add';
}

function previewSheetText(text, sourceName) {
  app.sheetSourceName = sourceName;
  app.sheetParsed = parseSpreadsheet(text, { existingItems: app.state.items });
  ui.renderImportPreview(app.sheetParsed, IMPORT_FIELDS, selectedImportMode());
  if (!app.sheetParsed.fatal) {
    $('import-counts').focus();
  }
}

function showSheetFatal(message) {
  app.sheetParsed = { fatal: message };
  ui.renderImportPreview(app.sheetParsed, IMPORT_FIELDS);
}

function previewSheetRows(rows, sourceName) {
  app.sheetSourceName = sourceName;
  app.sheetParsed = parseSpreadsheetRows(rows, { existingItems: app.state.items });
  ui.renderImportPreview(app.sheetParsed, IMPORT_FIELDS, selectedImportMode());
  if (!app.sheetParsed.fatal) $('import-counts').focus();
}

async function handleSheetFile(file) {
  if (!file) return;
  const lower = file.name.toLowerCase();
  if (/\.xls$/.test(lower) && !/\.xlsx$/.test(lower) && !/\.xlsm$/.test(lower)) {
    showSheetFatal(`"${file.name}" is an older Excel format (.xls). Save it as Excel Workbook (.xlsx) or CSV and try again.`);
    return;
  }
  if (/\.(numbers|ods)$/.test(lower)) {
    showSheetFatal(`"${file.name}" cannot be read directly. Save it as Excel (.xlsx) or CSV, or copy the cells and paste them below.`);
    return;
  }
  try {
    if (/\.(xlsx|xlsm)$/.test(lower)) {
      const rows = await parseXlsx(await file.arrayBuffer());
      previewSheetRows(rows, file.name);
      return;
    }
    const text = await file.text();
    previewSheetText(text, file.name);
  } catch (err) {
    showSheetFatal(err && err.message ? err.message : 'Could not read that file.');
  }
}

let pasteTimer = null;
function handleSheetPaste() {
  clearTimeout(pasteTimer);
  pasteTimer = setTimeout(() => {
    const text = $('sheet-paste').value;
    if (!text.trim()) {
      app.sheetParsed = null;
      ui.resetImportPreview();
      return;
    }
    $('sheet-file').value = '';
    previewSheetText(text, 'pasted cells');
  }, 150);
}

function handleImportSubmit(event) {
  event.preventDefault();
  const parsed = app.sheetParsed;
  if (!parsed || parsed.fatal || parsed.counts.valid === 0) return;

  const mode = selectedImportMode();
  if (mode === 'replace' && app.state.items.length > 0) {
    const n = app.state.items.length;
    if (!window.confirm(`This will replace all ${n} current stock ${n === 1 ? 'item' : 'items'}. Continue?`)) return;
  }

  const result = applyImport(app.state.items, parsed.rows, mode);
  commit((state) => {
    state.items = result.items;
  });

  const bits = [];
  if (mode === 'replace') bits.push(`replaced stock with ${result.added} ${result.added === 1 ? 'item' : 'items'}`);
  else {
    if (result.added) bits.push(`added ${result.added} ${result.added === 1 ? 'item' : 'items'}`);
    if (result.updated) bits.push(`updated ${result.updated} ${result.updated === 1 ? 'item' : 'items'}`);
  }
  if (parsed.counts.errors) bits.push(`skipped ${parsed.counts.errors} ${parsed.counts.errors === 1 ? 'row' : 'rows'} with errors`);
  const summary = `Spreadsheet import (${app.sheetSourceName}): ${bits.join(', ')}.`;
  setDataStatus(summary);
  ui.showToast(summary);
  closeImportDialog();
  showTab('plan');
  $('stock-heading').scrollIntoView({ block: 'start' });
}

function downloadTemplate() {
  downloadText(buildCsvTemplate(), TEMPLATE_FILE_NAME, 'text/csv');
  setDataStatus(`Downloaded ${TEMPLATE_FILE_NAME}.`);
}

function initSpreadsheetImport() {
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-open-import], #import-sheet-btn')) openImportDialog();
  });
  $('template-btn').addEventListener('click', downloadTemplate);
  $('sheet-file').addEventListener('change', (event) => {
    const file = event.target.files && event.target.files[0];
    if (file) {
      $('sheet-paste').value = '';
      handleSheetFile(file);
    }
  });
  $('sheet-paste').addEventListener('input', handleSheetPaste);
  document.querySelectorAll('input[name="import-mode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (app.sheetParsed && !app.sheetParsed.fatal) {
        ui.renderImportPreview(app.sheetParsed, IMPORT_FIELDS, selectedImportMode());
      }
    });
  });
  $('import-form').addEventListener('submit', handleImportSubmit);
  $('import-cancel-btn').addEventListener('click', closeImportDialog);
  $('import-dialog').addEventListener('close', () => {
    app.sheetParsed = null;
  });
}

/* ============================================================
   Reminders (extension point) and print
   ============================================================ */

function initReminders() {
  $('reminder-actions').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-reminder-provider]');
    if (!button) return;
    const provider = getProvider(button.dataset.reminderProvider);
    if (!provider || !app.lastReport) return;
    try {
      await provider.deliver(buildReminderEvents(app.lastReport), { state: app.state, report: app.lastReport });
    } catch (err) {
      ui.showToast(err && err.message ? err.message : 'Reminder action failed.');
    }
  });
}

function initPrint() {
  $('print-btn').addEventListener('click', () => window.print());

  // A collapsed expiring-soon panel would print empty; open it for printing and restore afterwards.
  let wasOpen = null;
  window.addEventListener('beforeprint', () => {
    const details = $('expiring-details');
    if (details) {
      wasOpen = details.open;
      details.open = true;
    }
  });
  window.addEventListener('afterprint', () => {
    const details = $('expiring-details');
    if (details && wasOpen !== null) details.open = wasOpen;
    wasOpen = null;
  });
}

/* ============================================================
   Service worker
   ============================================================ */

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js?v=9')
      .then((reg) => {
        reg.addEventListener('updatefound', () => {
          const worker = reg.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'activated' && navigator.serviceWorker.controller) {
              location.reload();
            }
          });
        });
        return reg.update();
      })
      .catch(() => {
        /* offline support unavailable; the app still works online */
      });
  });
}

/* ============================================================
   Boot
   ============================================================ */

function boot() {
  app.storageOk = storage.isStorageAvailable();
  if (!app.storageOk) $('storage-banner').hidden = false;

  const loaded = storage.loadState();
  app.state = loaded.state;
  app.localExportedAt = loaded.exportedAt || null;
  if (loaded.found && loaded.dropped > 0) {
    ui.showToast(`${loaded.dropped} saved ${loaded.dropped === 1 ? 'item was' : 'items were'} invalid and skipped.`);
  }

  initItemForm();
  initSorting();
  initSettings();
  initEssentials();
  initData();
  app.backup.supported = backupFile.isSupported();
  renderFileLinkPanel();
  restoreBackupLink();
  initSpreadsheetImport();
  initReminders();
  initPrint();
  initTabs();
  ui.renderSettings(app.state);
  renderAll();

  // "Today" can change while the page stays open; refresh when the user comes back.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') renderAll();
  });

  registerServiceWorker();
}

boot();
