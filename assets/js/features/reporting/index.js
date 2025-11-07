import { getState } from '../../core/state.js';
import { printHtml } from '../../core/print.js';
import { buildMediumSummaryLines } from '../shared/mediumTable.js';

let initialized = false;
let currentEntries = [];
let activeFilter = null;

function createSection() {
  const section = document.createElement('section');
  section.className = 'section-container d-none';
  section.dataset.section = 'report';
  section.innerHTML = `
    <div class="section-inner">
      <h2 class="text-center mb-4">Auswertung nach Datum</h2>
      <div class="card card-dark no-print mb-4">
        <div class="card-body">
          <form id="report-filter" class="row g-3">
            <div class="col-md-4">
              <label class="form-label" for="report-start">Startdatum</label>
              <input type="date" class="form-control" id="report-start" name="report-start" required />
            </div>
            <div class="col-md-4">
              <label class="form-label" for="report-end">Enddatum</label>
              <input type="date" class="form-control" id="report-end" name="report-end" required />
            </div>
            <div class="col-md-4 d-flex align-items-end">
              <button class="btn btn-success w-100" type="submit">Anzeigen</button>
            </div>
          </form>
        </div>
      </div>
      <div class="card card-dark">
        <div class="card-header d-flex flex-column flex-lg-row justify-content-between align-items-lg-center gap-3 no-print">
          <div class="small text-muted" data-role="report-info">Alle Einträge</div>
          <button class="btn btn-outline-light btn-sm" data-action="print-report" disabled>Drucken</button>
        </div>
        <div class="card-body">
          <div class="table-responsive">
            <table class="table table-dark table-bordered" id="report-table">
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Erstellt von</th>
                  <th>Standort</th>
                  <th>Kultur</th>
                  <th>Kisten</th>
                  <th>Mittel &amp; Gesamtmengen</th>
                </tr>
              </thead>
              <tbody></tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;
  return section;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseDate(value) {
  if (!value) {
    return null;
  }
  const parts = value.split('-');
  if (parts.length !== 3) {
    return null;
  }
  const [year, month, day] = parts.map(Number);
  return new Date(year, month - 1, day);
}

function germanDateToIso(value) {
  if (!value) {
    return null;
  }
  const parts = value.split('.');
  if (parts.length !== 3) {
    return null;
  }
  const [day, month, year] = parts.map(Number);
  return new Date(year, month - 1, day);
}

function renderTable(section, entries, labels) {
  const resolvedLabels = labels || getState().fieldLabels;
  const tbody = section.querySelector('#report-table tbody');
  const thead = section.querySelector('#report-table thead');
  tbody.innerHTML = '';
  const info = section.querySelector('[data-role="report-info"]');
  const printButton = section.querySelector('[data-action="print-report"]');
  currentEntries = entries.slice();
  if (thead) {
    const tableLabels = resolvedLabels.reporting.tableColumns;
    thead.innerHTML = `
      <tr>
        <th>${escapeHtml(tableLabels.date)}</th>
        <th>${escapeHtml(tableLabels.creator)}</th>
        <th>${escapeHtml(tableLabels.location)}</th>
        <th>${escapeHtml(tableLabels.crop)}</th>
        <th>${escapeHtml(tableLabels.quantity)}</th>
        <th>${escapeHtml(tableLabels.mediums)}</th>
      </tr>
    `;
  }
  entries.forEach(entry => {
    const row = document.createElement('tr');
    const mediumLines = buildMediumSummaryLines(entry.items, resolvedLabels);
    const mediumsCell = mediumLines.length ? mediumLines.map(line => `<div>${line}</div>`).join('') : '-';
    row.innerHTML = `
      <td>${escapeHtml(entry.datum || entry.date || '')}</td>
      <td>${escapeHtml(entry.ersteller || '')}</td>
      <td>${escapeHtml(entry.standort || '')}</td>
      <td>${escapeHtml(entry.kultur || '')}</td>
      <td>${escapeHtml(entry.kisten != null ? String(entry.kisten) : '')}</td>
      <td>${mediumsCell}</td>
    `;
    tbody.appendChild(row);
  });
  if (info) {
    info.textContent = describeFilter(entries.length, resolvedLabels);
  }
  if (printButton) {
    printButton.disabled = entries.length === 0;
  }
}

function describeFilter(entryCount, labels) {
  const resolvedLabels = labels || getState().fieldLabels;
  if (!activeFilter) {
    if (!entryCount) {
      return resolvedLabels.reporting.infoEmpty;
    }
    return `${resolvedLabels.reporting.infoAll} (${entryCount})`;
  }
  const { startLabel, endLabel } = activeFilter;
  const prefix = `${resolvedLabels.reporting.infoPrefix} ${startLabel} – ${endLabel}`;
  if (!entryCount) {
    return `${prefix} (${resolvedLabels.reporting.infoEmpty})`;
  }
  return `${prefix} (${entryCount})`;
}

function applyFilter(section, state, filter) {
  const source = state.history || [];
  if (!filter) {
    renderTable(section, source, state.fieldLabels);
    return;
  }
  const filtered = source.filter(entry => {
    const isoDate = germanDateToIso(entry.datum || entry.date);
    if (!isoDate) {
      return false;
    }
    return isoDate >= filter.start && isoDate <= filter.end;
  });
  renderTable(section, filtered, state.fieldLabels);
}

export function initReporting(container, services) {
  if (!container || initialized) {
    return;
  }
  const section = createSection();
  container.appendChild(section);

  const filterForm = section.querySelector('#report-filter');
  filterForm.addEventListener('submit', event => {
    event.preventDefault();
    const formData = new FormData(filterForm);
    const start = parseDate(formData.get('report-start'));
    const end = parseDate(formData.get('report-end'));
    if (!start || !end) {
      alert('Bitte gültige Daten auswählen!');
      return;
    }
    if (start > end) {
      alert('Das Startdatum muss vor dem Enddatum liegen.');
      return;
    }
    activeFilter = {
      start,
      end,
      startLabel: new Intl.DateTimeFormat('de-DE').format(start),
      endLabel: new Intl.DateTimeFormat('de-DE').format(end)
    };
    applyFilter(section, getState(), activeFilter);
  });

  function toggle(state) {
    const ready = state.app.hasDatabase;
    const active = state.app.activeSection === 'report';
    section.classList.toggle('d-none', !(ready && active));
    if (ready) {
      applyFilter(section, state, activeFilter);
    }
  }

  toggle(getState());

  services.state.subscribe((nextState) => {
    toggle(nextState);
  });

  section.addEventListener('click', event => {
    const trigger = event.target.closest('[data-action="print-report"]');
    if (!trigger) {
      return;
    }
    if (!currentEntries.length) {
      alert('Keine Daten für den Druck vorhanden.');
      return;
    }
    printReport(currentEntries, activeFilter, getState().fieldLabels);
  });

  initialized = true;
}

const REPORT_STYLES = `
  .report-summary {
    margin-top: 1.5rem;
  }
  .report-summary table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.95rem;
  }
  .report-summary th,
  .report-summary td {
    border: 1px solid #555;
    padding: 6px 8px;
    vertical-align: top;
  }
  .report-summary th {
    background: #f2f2f2;
  }
  .report-summary td div + div {
    margin-top: 0.25rem;
  }
`;

function buildCompanyHeader(company = {}) {
  const hasContent = Boolean(
    company.name || company.headline || company.address || company.contactEmail
  );
  if (!hasContent) {
    return '';
  }
  return `
    <div class="print-meta">
      ${company.name ? `<h1>${escapeHtml(company.name)}</h1>` : ''}
      ${company.headline ? `<p>${escapeHtml(company.headline)}</p>` : ''}
      ${company.address ? `<p>${escapeHtml(company.address).replace(/\n/g, '<br />')}</p>` : ''}
      ${company.contactEmail ? `<p>${escapeHtml(company.contactEmail)}</p>` : ''}
    </div>
  `;
}

function buildFilterInfo(filter, labels) {
  const resolvedLabels = labels || getState().fieldLabels;
  const prefix = escapeHtml(resolvedLabels.reporting.infoPrefix);
  if (!filter) {
    return `<p>${prefix}: ${escapeHtml(resolvedLabels.reporting.infoAll)}</p>`;
  }
  return `<p>${prefix}: ${escapeHtml(filter.startLabel)} – ${escapeHtml(filter.endLabel)}</p>`;
}

function buildReportTable(entries, labels) {
  const resolvedLabels = labels || getState().fieldLabels;
  const tableLabels = resolvedLabels.reporting.tableColumns;
  const rows = entries
    .map(entry => {
      const summaryLines = buildMediumSummaryLines(entry.items, resolvedLabels);
      const mediumsCell = summaryLines.length ? summaryLines.join('<br />') : '-';
      return `
      <tr>
        <td>${escapeHtml(entry.datum || entry.date || '')}</td>
        <td>${escapeHtml(entry.ersteller || '')}</td>
        <td>${escapeHtml(entry.standort || '')}</td>
        <td>${escapeHtml(entry.kultur || '')}</td>
        <td class="nowrap">${escapeHtml(entry.kisten != null ? String(entry.kisten) : '')}</td>
        <td>${mediumsCell}</td>
      </tr>
      `;
    })
    .join('');
  return `
    <section class="report-summary">
  <h2>${escapeHtml(resolvedLabels.reporting.printTitle)}</h2>
      <table>
        <thead>
          <tr>
            <th>${escapeHtml(tableLabels.date)}</th>
            <th>${escapeHtml(tableLabels.creator)}</th>
            <th>${escapeHtml(tableLabels.location)}</th>
            <th>${escapeHtml(tableLabels.crop)}</th>
            <th>${escapeHtml(tableLabels.quantity)}</th>
            <th>${escapeHtml(tableLabels.mediums)}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
  `;
}

function printReport(entries, filter, labels) {
  const resolvedLabels = labels || getState().fieldLabels;
  const company = getState().company || {};
  const content = `${buildCompanyHeader(company)}${buildFilterInfo(filter, resolvedLabels)}${buildReportTable(entries, resolvedLabels)}`;
  printHtml({
    title: resolvedLabels.reporting.printTitle,
    styles: REPORT_STYLES,
    content
  });
}
