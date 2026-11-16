// DOM rendering. Each render function takes data and writes HTML into a container.
// No calculations happen here; everything comes from calculations.js.

import { CATEGORIES, ESSENTIALS, categoryLabel } from './defaults.js';
import { STATUS_LABELS, itemStatus } from './calculations.js';
import { formatDate } from './dates.js';
import { getSupportedProviders } from './reminders.js';

/* ---------- helpers ---------- */

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function fmt(n) {
  if (!Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('en-US');
}

function fmtDecimal(n) {
  if (!Number.isFinite(n)) return '—';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function plural(n, one, many = `${one}s`) {
  return n === 1 ? one : many;
}

function $(id) {
  return document.getElementById(id);
}

const LEVEL_ICON = { covered: '✓', close: '◐', short: '✕' };

/** Progress bar with the percentage and label always visible as text. */
export function progressBar(percent, level, label, name) {
  const pct = Math.max(0, Math.min(100, percent));
  return `
    <div class="progress progress--${level}">
      <div class="progress__track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${escapeHtml(name)} coverage: ${pct}%, ${escapeHtml(label)}">
        <div class="progress__fill" style="width:${pct}%"></div>
      </div>
      <span class="progress__text"><span class="progress__icon" aria-hidden="true">${LEVEL_ICON[level] || ''}</span>${pct}% · ${escapeHtml(label)}</span>
    </div>`;
}

/* ---------- adequacy summary ---------- */

export function renderSummary(report) {
  $('plan-line').textContent = `${report.days} ${plural(report.days, 'day')} × ${report.people} ${plural(report.people, 'person', 'people')}`;

  const parts = [];

  if (report.isEmpty) {
    parts.push(`<p class="empty-note" role="status">Add your first item or import a spreadsheet to get started.</p>`);
  }

  const verdictClass = report.sufficient ? 'verdict--ok' : 'verdict--short';
  const verdictIcon = report.sufficient ? '✓' : '✕';
  const verdictText = report.sufficient ? 'Sufficient' : 'Not sufficient';
  parts.push(`
    <div class="verdict ${verdictClass}" role="status">
      <span class="verdict__icon" aria-hidden="true">${verdictIcon}</span>
      <div>
        <p class="verdict__title">${verdictText}</p>
        <p class="verdict__sub">${
          report.sufficient
            ? 'Every category meets its calorie quota and protein meets the minimum.'
            : 'At least one category or protein is below its quota. See gaps below and the shopping list.'
        }</p>
      </div>
    </div>`);

  if (report.notes.length) {
    parts.push(`<ul class="notes">${report.notes
      .map((n) => `<li class="note note--${n.id}"><span aria-hidden="true">ⓘ</span> ${escapeHtml(n.text)}</li>`)
      .join('')}</ul>`);
  }

  const calorieDaysClass = report.calorieDays >= report.days ? 'stat--ok' : 'stat--short';
  const proteinDaysClass = report.protein.days >= report.days ? 'stat--ok' : 'stat--short';
  parts.push(`
    <div class="stats">
      <div class="stat ${calorieDaysClass}">
        <span class="stat__value">${fmt(report.calorieDays)}</span>
        <span class="stat__label">${plural(report.calorieDays, 'day')} of calories</span>
        <span class="stat__hint">${
          report.limitingCategory && !report.isEmpty ? `limited by ${escapeHtml(report.limitingCategory)}` : 'weakest category decides'
        }</span>
      </div>
      <div class="stat ${proteinDaysClass}">
        <span class="stat__value">${fmt(report.protein.days)}</span>
        <span class="stat__label">${plural(report.protein.days, 'day')} of protein</span>
        <span class="stat__hint">at the ${fmtDecimal(report.protein.requiredTarget / Math.max(1, report.days * report.people))} g target</span>
      </div>
      <div class="stat">
        <span class="stat__value">${fmt(report.days)}</span>
        <span class="stat__label">${plural(report.days, 'day')} planned</span>
        <span class="stat__hint">for ${report.people} ${plural(report.people, 'person', 'people')}</span>
      </div>
    </div>`);

  const rows = report.categories
    .map(
      (c) => `
      <tr>
        <th scope="row" data-label="Category">${escapeHtml(c.label)}</th>
        <td data-label="Required (cal)">${fmt(c.required)}</td>
        <td data-label="In stock (cal)">${fmt(c.stock)}</td>
        <td data-label="Gap (cal)" class="${c.gap > 0 ? 'is-gap' : 'is-zero'}">${fmt(c.gap)}</td>
        <td data-label="Coverage" class="cell-progress">${progressBar(c.percent, c.level, c.coverage, c.label)}</td>
      </tr>`,
    )
    .join('');

  const t = report.totals;
  const p = report.protein;
  parts.push(`
    <div class="table-wrap">
      <table class="data-table summary-table">
        <caption class="visually-hidden">Required calories, stock and gap by category</caption>
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">Required (cal)</th>
            <th scope="col">In stock (cal)</th>
            <th scope="col">Gap (cal)</th>
            <th scope="col">Coverage</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
          <tr class="row-total">
            <th scope="row" data-label="Category">All calories</th>
            <td data-label="Required (cal)">${fmt(t.required)}</td>
            <td data-label="In stock (cal)">${fmt(t.stock)}</td>
            <td data-label="Gap (cal)" class="${t.gap > 0 ? 'is-gap' : 'is-zero'}">${fmt(t.gap)}</td>
            <td data-label="Coverage" class="cell-progress">${progressBar(t.percent, t.level, t.coverage, 'Total calories')}</td>
          </tr>
          <tr class="row-protein">
            <th scope="row" data-label="Category">Protein (g)</th>
            <td data-label="Required (g)">
              <span class="stack"><span>min ${fmt(p.requiredMin)}</span><span>target ${fmt(p.requiredTarget)}</span></span>
            </td>
            <td data-label="In stock (g)">${fmt(p.stock)}</td>
            <td data-label="Gap (g)">
              <span class="stack">
                <span class="${p.gapMin > 0 ? 'is-gap' : 'is-zero'}">min ${fmt(p.gapMin)}</span>
                <span class="${p.gapTarget > 0 ? 'is-gap' : 'is-zero'}">target ${fmt(p.gapTarget)}</span>
              </span>
            </td>
            <td data-label="Coverage (of target)" class="cell-progress">${progressBar(p.percent, p.level, p.coverage, 'Protein (against target)')}</td>
          </tr>
        </tbody>
      </table>
    </div>`);

  parts.push(`
    <p class="water-note"><span aria-hidden="true">💧</span> You need <strong>${fmtDecimal(report.water.gallons)} ${plural(report.water.gallons, 'gallon')}</strong> of water (${fmtDecimal(report.water.perPersonPerDay)} gal × ${report.days} ${plural(report.days, 'day')} × ${report.people} ${plural(report.people, 'person', 'people')}). Water is not tracked in the stock table.</p>`);

  $('summary-content').innerHTML = parts.join('');
}

/* ---------- expiring soon ---------- */

export function renderExpiring(report, uiState) {
  const container = $('expiring-content');
  const section = $('expiring');
  if (report.expiring.length === 0) {
    section.classList.add('card--collapsed');
    container.innerHTML = `<p class="muted" role="status">No items expiring soon <span class="muted-small">(within ${report.warningDays} ${plural(report.warningDays, 'day')})</span>.</p>`;
  } else {
    section.classList.remove('card--collapsed');
    const rows = report.expiring
      .map(
        (i) => `
        <tr>
          <th scope="row" data-label="Item">${escapeHtml(i.name)}</th>
          <td data-label="Category">${escapeHtml(categoryLabel(i.category))}</td>
          <td data-label="Expires"><time datetime="${escapeHtml(i.expires)}">${escapeHtml(formatDate(i.expires))}</time></td>
          <td data-label="Days left" class="${i.daysLeft <= 7 ? 'is-gap' : ''}">${
            i.daysLeft === 0 ? 'Today' : `${fmt(i.daysLeft)} ${plural(i.daysLeft, 'day')}`
          }</td>
        </tr>`,
      )
      .join('');
    const count = report.expiring.length;
    container.innerHTML = `
      <details class="disclosure" id="expiring-details" ${uiState.expiringOpen ? 'open' : ''}>
        <summary><span class="badge badge--close">${count}</span> ${count} ${plural(count, 'item')} expiring within ${report.warningDays} ${plural(report.warningDays, 'day')}</summary>
        <p class="card__lede">Rotate these items: use them soon and replace with fresh stock.</p>
        <div class="table-wrap">
          <table class="data-table">
            <caption class="visually-hidden">Items expiring soon, fewest days left first</caption>
            <thead><tr><th scope="col">Item</th><th scope="col">Category</th><th scope="col">Expires</th><th scope="col">Days left</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </details>`;
  }

  // Extension point: one button per reminder provider (calendar export, notifications...).
  const actions = $('reminder-actions');
  const providers = getSupportedProviders();
  actions.innerHTML = providers
    .map((p) => `<button type="button" class="btn btn--small" data-reminder-provider="${escapeHtml(p.id)}">${escapeHtml(p.label)}</button>`)
    .join('');
  actions.hidden = providers.length === 0 || report.expiring.length === 0;
}

/* ---------- expired ---------- */

export function renderExpired(report) {
  const section = $('expired');
  const container = $('expired-content');
  if (report.expired.length === 0) {
    section.hidden = true;
    container.innerHTML = '';
    return;
  }
  section.hidden = false;
  container.innerHTML = `
    <ul class="item-list">
      ${report.expired
        .map(
          (i) => `
        <li class="item-list__row">
          <div class="item-list__main">
            <span class="item-list__name">${escapeHtml(i.name)}</span>
            <span class="badge badge--expired">Expired</span>
            <span class="item-list__meta">${escapeHtml(categoryLabel(i.category))} · ${fmt(i.quantity)} × ${fmt(i.calories)} cal · expired <time datetime="${escapeHtml(i.expires)}">${escapeHtml(formatDate(i.expires))}</time> (${fmt(i.daysAgo)} ${plural(i.daysAgo, 'day')} ago)</span>
          </div>
          <div class="btn-row btn-row--tight">
            <button type="button" class="btn btn--small" data-action="edit" data-id="${escapeHtml(i.id)}" data-focus="expires" aria-label="Update ${escapeHtml(i.name)}">Update</button>
            <button type="button" class="btn btn--small btn--danger-outline" data-action="delete" data-id="${escapeHtml(i.id)}" aria-label="Delete ${escapeHtml(i.name)}">Delete</button>
          </div>
        </li>`,
        )
        .join('')}
    </ul>`;
}

/* ---------- stock table ---------- */

const COLUMNS = [
  { key: 'name', label: 'Name' },
  { key: 'category', label: 'Category' },
  { key: 'calories', label: 'Calories' },
  { key: 'protein', label: 'Protein (g)' },
  { key: 'quantity', label: 'Qty' },
  { key: 'expires', label: 'Expires' },
  { key: 'status', label: 'Status' },
];

export function renderStock(sortedItems, report, sort) {
  const container = $('stock-content');

  // Keep the mobile sort controls in sync.
  $('sort-key').value = sort.key;
  const dirBtn = $('sort-dir');
  dirBtn.textContent = sort.dir === 'desc' ? 'Descending' : 'Ascending';
  dirBtn.setAttribute('aria-pressed', sort.dir === 'desc' ? 'true' : 'false');
  dirBtn.setAttribute('aria-label', `Sort direction: ${sort.dir === 'desc' ? 'descending' : 'ascending'}. Activate to toggle.`);

  if (sortedItems.length === 0) {
    container.innerHTML = `<p class="empty-note">No items yet. Use <strong>Import spreadsheet</strong>, or <strong>Add item</strong> to enter one product.</p>
      <div class="btn-row">
        <button type="button" class="btn btn--primary" data-add-item>Add item</button>
        <button type="button" class="btn" data-open-import>Import spreadsheet</button>
      </div>`;
    return;
  }

  const activeKey = sort.key === 'default' ? 'category' : sort.key;
  const head = COLUMNS.map((col) => {
    const isActive = col.key === activeKey;
    const ariaSort = isActive ? (sort.dir === 'desc' ? 'descending' : 'ascending') : 'none';
    const arrow = isActive ? (sort.dir === 'desc' ? '▼' : '▲') : '↕';
    return `<th scope="col" aria-sort="${ariaSort}">
      <button type="button" class="sort-btn ${isActive ? 'is-active' : ''}" data-sort="${col.key}">
        ${escapeHtml(col.label)} <span class="sort-arrow" aria-hidden="true">${arrow}</span>
      </button>
    </th>`;
  }).join('');

  const rows = sortedItems
    .map((item) => {
      const status = itemStatus(item, report.today, report.warningDays);
      const statusLabel = STATUS_LABELS[status];
      const badge =
        status === 'expired'
          ? `<span class="badge badge--expired">Expired</span>`
          : status === 'expiring'
            ? `<span class="badge badge--close">Expiring soon</span>`
            : `<span class="badge badge--good">Good</span>`;
      return `
      <tr class="${status === 'expired' ? 'is-expired' : ''}" data-id="${escapeHtml(item.id)}">
        <th scope="row" data-label="Name"><span class="cell-name">${escapeHtml(item.name)}</span></th>
        <td data-label="Category">${escapeHtml(categoryLabel(item.category))}</td>
        <td data-label="Calories" class="num">${fmt(item.calories)}</td>
        <td data-label="Protein (g)" class="num">${fmtDecimal(item.protein)}</td>
        <td data-label="Qty" class="num">${fmt(item.quantity)}</td>
        <td data-label="Expires"><time datetime="${escapeHtml(item.expires)}">${escapeHtml(formatDate(item.expires))}</time></td>
        <td data-label="Status">${badge}<span class="visually-hidden"> ${escapeHtml(statusLabel)}</span></td>
        <td data-label="Actions" class="cell-actions">
          <div class="btn-row btn-row--tight">
            <button type="button" class="btn btn--small" data-action="edit" data-id="${escapeHtml(item.id)}" aria-label="Edit ${escapeHtml(item.name)}">Edit</button>
            <button type="button" class="btn btn--small btn--danger-outline" data-action="delete" data-id="${escapeHtml(item.id)}" aria-label="Delete ${escapeHtml(item.name)}">Delete</button>
          </div>
        </td>
      </tr>`;
    })
    .join('');

  container.innerHTML = `
    <div class="table-wrap">
      <table class="data-table stock-table" id="stock-table">
        <caption class="visually-hidden">Stock items. Column headers are buttons that sort the table.</caption>
        <thead><tr>${head}<th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="muted-small">${sortedItems.length} ${plural(sortedItems.length, 'item')} · ${report.expired.length} expired</p>`;
}

/* ---------- shopping list ---------- */

export function renderShopping(list, report) {
  const container = $('shopping-content');
  const parts = [];

  if (report.isEmpty) {
    parts.push(`<p class="empty-note">Add your first item to get started. Until then every category shows its full gap.</p>`);
  }

  if (list.categories.length === 0) {
    parts.push(`<div class="verdict verdict--ok"><span class="verdict__icon" aria-hidden="true">✓</span><p class="verdict__title">All calorie quotas are covered.</p></div>`);
  } else {
    parts.push('<h3 class="subheading">Calories</h3>');
    parts.push(
      `<ul class="shop-list">${list.categories
        .map((c) => {
          let detail;
          if (c.suggestions.length === 0) {
            detail = `<p class="muted">Add an item in this category to get a quantity suggestion.</p>`;
          } else {
            detail = `<ul class="suggestions">${c.suggestions
              .map((s) => `<li>about <strong>${fmt(s.count)}</strong> more ${escapeHtml(s.name)}</li>`)
              .join('')}</ul>`;
          }
          return `<li class="shop-item">
            <div class="shop-item__head">
              <span class="shop-item__title">${escapeHtml(c.label)}</span>
              <span class="shop-item__gap">${fmt(c.gap)} cal short</span>
            </div>
            ${detail}
          </li>`;
        })
        .join('')}</ul>`,
    );
  }

  parts.push('<h3 class="subheading">Protein</h3>');
  if (!list.protein) {
    parts.push(`<p class="ok-line"><span aria-hidden="true">✓</span> Protein meets the target.</p>`);
  } else {
    const p = list.protein;
    let detail;
    if (p.suggestions.length === 0) {
      detail = `<p class="muted">Add protein-dense items such as canned tuna, chicken or beans to the Beans and proteins category to get a quantity suggestion.</p>`;
    } else {
      detail = `<ul class="suggestions">${p.suggestions
        .map(
          (s) =>
            `<li>about <strong>${fmt(s.forTarget)}</strong> more ${escapeHtml(s.name)} to reach the target${
              p.gapMin > 0 ? ` (<strong>${fmt(s.forMin)}</strong> for the minimum)` : ''
            }</li>`,
        )
        .join('')}</ul>`;
    }
    parts.push(`<ul class="shop-list"><li class="shop-item">
      <div class="shop-item__head">
        <span class="shop-item__title">Protein</span>
        <span class="shop-item__gap">${p.gapMin > 0 ? `${fmt(p.gapMin)} g short of minimum · ` : 'minimum met · '}${fmt(p.gapTarget)} g short of target</span>
      </div>
      ${detail}
    </li></ul>`);
  }

  parts.push('<h3 class="subheading">Water</h3>');
  parts.push(
    `<p><span aria-hidden="true">💧</span> <strong>${fmtDecimal(list.water.gallons)} ${plural(list.water.gallons, 'gallon')}</strong> of water for ${report.days} ${plural(report.days, 'day')} × ${report.people} ${plural(report.people, 'person', 'people')}. Water is not tracked in the stock table, so check your supply separately.</p>`,
  );

  parts.push('<h3 class="subheading">Essentials still needed</h3>');
  if (list.essentials.length === 0) {
    parts.push(`<p class="ok-line"><span aria-hidden="true">✓</span> All essentials are ticked off.</p>`);
  } else {
    parts.push(
      `<ul class="plain-list">${list.essentials
        .map(
          (e) =>
            `<li>${escapeHtml(e.label)}${e.quantity ? ` — <strong>${fmt(e.quantity)}</strong> (one per person per day)` : ''}</li>`,
        )
        .join('')}</ul>`,
    );
  }

  container.innerHTML = parts.join('');
}

export function renderEssentials(state, report) {
  const list = $('essentials-list');
  list.innerHTML = ESSENTIALS.map((e) => {
    const checked = state.essentials[e.id] === true;
    const qty = e.perPersonPerDay ? ` <span class="muted-small">(${fmt(report.days * report.people)} needed: one per person per day)</span>` : '';
    return `<li class="checklist__item ${checked ? 'is-done' : ''}">
      <label>
        <input type="checkbox" data-essential="${e.id}" ${checked ? 'checked' : ''}>
        <span>${escapeHtml(e.label)}${qty}</span>
      </label>
    </li>`;
  }).join('');
}

/* ---------- settings ---------- */

export function buildQuotaFields() {
  $('quota-fields').innerHTML = CATEGORIES.map(
    (c) => `
    <div class="field">
      <label for="q-${c.id}">${escapeHtml(c.label)} (cal)</label>
      <input id="q-${c.id}" type="number" inputmode="decimal" min="0" max="10000" step="any" data-quota-category="${c.id}" aria-describedby="q-${c.id}-error">
      <p class="field-error" id="q-${c.id}-error"></p>
    </div>`,
  ).join('');
}

export function renderSettings(state) {
  for (const [key, value] of Object.entries(state.settings)) {
    const input = document.querySelector(`[data-setting="${key}"]`);
    if (input) {
      input.value = value;
      clearFieldError(input);
    }
  }
  for (const [id, value] of Object.entries(state.quotas.categories)) {
    const input = document.querySelector(`[data-quota-category="${id}"]`);
    if (input) {
      input.value = value;
      clearFieldError(input);
    }
  }
  for (const key of ['proteinMin', 'proteinTarget', 'waterGallons']) {
    const input = document.querySelector(`[data-quota="${key}"]`);
    if (input) {
      input.value = state.quotas[key];
      clearFieldError(input);
    }
  }
  renderQuotaTotal(state);
}

export function renderQuotaTotal(state) {
  const total = Object.values(state.quotas.categories).reduce((s, v) => s + (Number(v) || 0), 0);
  $('quota-total').textContent = fmt(total);
}

/* ---------- field errors ---------- */

export function setFieldError(input, message) {
  const errorEl = document.getElementById(`${input.id}-error`);
  if (message) {
    input.setAttribute('aria-invalid', 'true');
    input.classList.add('is-invalid');
    if (errorEl) errorEl.textContent = message;
  } else {
    clearFieldError(input);
  }
}

export function clearFieldError(input) {
  input.removeAttribute('aria-invalid');
  input.classList.remove('is-invalid');
  const errorEl = document.getElementById(`${input.id}-error`);
  if (errorEl) errorEl.textContent = '';
}

/* ---------- item form ---------- */

export function populateCategorySelect() {
  $('f-category').innerHTML =
    `<option value="">Choose a category…</option>` +
    CATEGORIES.map((c) => `<option value="${c.id}">${escapeHtml(c.label)}</option>`).join('');
}

/* ---------- spreadsheet import preview ---------- */

const PREVIEW_ROW_LIMIT = 200;

export function resetImportPreview() {
  $('import-fatal').hidden = true;
  $('import-fatal').textContent = '';
  $('import-preview').hidden = true;
  $('import-mapping').innerHTML = '';
  $('import-rows').innerHTML = '';
  $('import-counts').textContent = '';
  const btn = $('import-apply-btn');
  btn.disabled = true;
  btn.textContent = 'Import';
}

/**
 * Render the result of parseSpreadsheet() into the import dialog.
 * @param {object} parsed  result of parseSpreadsheet()
 * @param {Array} importFields  IMPORT_FIELDS from spreadsheet.js
 * @param {'add'|'replace'} [mode]
 */
export function renderImportPreview(parsed, importFields, mode = 'add') {
  resetImportPreview();
  const fatal = $('import-fatal');

  if (parsed.fatal) {
    fatal.textContent = parsed.fatal;
    fatal.hidden = false;
    fatal.focus();
    return;
  }

  $('import-mapping').innerHTML = importFields
    .map((f) => {
      const idx = parsed.mapping[f.key];
      const header = parsed.headers[idx] ?? '';
      return `<li><span class="mapping-list__field">${escapeHtml(f.label)}</span> <span aria-hidden="true">←</span><span class="visually-hidden">from column</span> <code>${escapeHtml(header)}</code></li>`;
    })
    .join('');

  const c = parsed.counts;
  const updatesShown = mode === 'replace' ? 0 : c.updates;
  const newShown = mode === 'replace' ? c.valid : c.newRows;
  const countParts = [`<strong>${fmt(c.valid)}</strong> ${plural(c.valid, 'row')} ready to import`];
  if (newShown > 0 && mode === 'add') countParts.push(`${fmt(newShown)} new`);
  if (updatesShown > 0) countParts.push(`${fmt(updatesShown)} will update existing ${plural(updatesShown, 'item')}`);
  if (c.errors > 0) countParts.push(`<span class="is-gap">${fmt(c.errors)} ${plural(c.errors, 'row')} with errors will be skipped</span>`);
  $('import-counts').innerHTML = countParts.join(' · ');

  const shown = parsed.rows.slice(0, PREVIEW_ROW_LIMIT);
  const body = shown
    .map((r) => {
      const d = r.display;
      let result;
      if (r.status === 'error') {
        result = `<span class="badge badge--expired">Error</span> ${Object.values(r.errors).map(escapeHtml).join(' ')}`;
      } else if (r.status === 'update' && mode !== 'replace') {
        result = `<span class="badge badge--close">Updates existing</span>`;
      } else {
        result = `<span class="badge badge--good">New</span>`;
      }
      if (r.duplicateOfLine) {
        result += ` <span class="muted-small">(same item as row ${r.duplicateOfLine}; this row's values win)</span>`;
      }
      const cls = r.status === 'error' ? 'is-error' : '';
      const classes = (base, key) => {
        const list = [base, r.errors[key] ? 'cell-error' : ''].filter(Boolean);
        return list.length ? ` class="${list.join(' ')}"` : '';
      };
      return `<tr class="${cls}">
        <td data-label="Row" class="num">${r.line}</td>
        <th scope="row" data-label="Item name"${classes('', 'name')}>${escapeHtml(d.name) || '<span class="muted">(blank)</span>'}</th>
        <td data-label="Category"${classes('', 'category')}>${escapeHtml(r.values.category ? categoryLabel(r.values.category) : d.categoryText) || '<span class="muted">(blank)</span>'}</td>
        <td data-label="Calories"${classes('num', 'calories')}>${escapeHtml(d.calories)}</td>
        <td data-label="Protein (g)"${classes('num', 'protein')}>${escapeHtml(d.protein)}</td>
        <td data-label="Qty"${classes('num', 'quantity')}>${escapeHtml(d.quantity)}</td>
        <td data-label="Expires"${classes('', 'expires')}>${r.values.expires ? escapeHtml(formatDate(r.values.expires)) : escapeHtml(d.dateText)}</td>
        <td data-label="Result">${result}</td>
      </tr>`;
    })
    .join('');

  const more =
    parsed.rows.length > PREVIEW_ROW_LIMIT
      ? `<p class="muted-small">Showing the first ${PREVIEW_ROW_LIMIT} of ${fmt(parsed.rows.length)} rows. All rows will be imported.</p>`
      : '';

  $('import-rows').innerHTML = `
    <table class="data-table import-table">
      <caption class="visually-hidden">Rows found in the spreadsheet and how each will be imported</caption>
      <thead><tr>
        <th scope="col">Row</th><th scope="col">Item name</th><th scope="col">Category</th><th scope="col">Calories</th>
        <th scope="col">Protein (g)</th><th scope="col">Qty</th><th scope="col">Expires</th><th scope="col">Result</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>${more}`;

  $('import-preview').hidden = false;
  const btn = $('import-apply-btn');
  btn.disabled = c.valid === 0;
  btn.textContent = c.valid === 0 ? 'Import' : `Import ${fmt(c.valid)} ${plural(c.valid, 'item')}`;
}

/* ---------- toast ---------- */

let toastTimer = null;
export function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 4000);
}
