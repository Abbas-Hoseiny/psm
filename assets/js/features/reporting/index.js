import { getState } from "../../core/state.js";
import { escapeHtml } from "../../core/utils.js";
import { renderCalculationSnapshot } from "../shared/calculationSnapshot.js";
import { printEntriesChunked } from "../shared/printing.js";
import { createPagerWidget } from "../shared/pagerWidget.js";

let initialized = false;
let currentEntries = [];
let activeFilter = null;
let reportPageIndex = 0;
let reportPagerWidget = null;
let reportPagerTarget = null;
const REPORT_PAGE_SIZE = 50;
const numberFormatter = new Intl.NumberFormat("de-DE");

function createSection() {
  const section = document.createElement("section");
  section.className = "section-container d-none";
  section.dataset.section = "report";
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
          <div data-role="report-list" class="report-list"></div>
          <div data-role="report-load-more" class="mt-3"></div>
        </div>
      </div>
    </div>
  `;
  return section;
}

function parseDate(value) {
  if (!value) {
    return null;
  }
  const parts = value.split("-");
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
  const parts = value.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const [day, month, year] = parts.map(Number);
  return new Date(year, month - 1, day);
}

function clampPageOffset(entriesLength) {
  if (!entriesLength) {
    reportPageIndex = 0;
    return 0;
  }
  const maxPage = Math.max(Math.ceil(entriesLength / REPORT_PAGE_SIZE) - 1, 0);
  if (reportPageIndex > maxPage) {
    reportPageIndex = maxPage;
  }
  if (reportPageIndex < 0) {
    reportPageIndex = 0;
  }
  return reportPageIndex * REPORT_PAGE_SIZE;
}

function ensurePagerWidget(section) {
  const target = section.querySelector('[data-role="report-load-more"]');
  if (!target) {
    return null;
  }
  if (!reportPagerWidget || reportPagerTarget !== target) {
    if (reportPagerWidget && typeof reportPagerWidget.destroy === "function") {
      reportPagerWidget.destroy();
    }
    reportPagerWidget = createPagerWidget(target, {
      onPrev: () => goToPrevPage(section),
      onNext: () => goToNextPage(section),
      labels: {
        prev: "Zurück",
        next: "Weiter",
        loading: "Lädt ...",
        empty: "Keine Einträge",
      },
    });
    reportPagerTarget = target;
  }
  return reportPagerWidget;
}

function updatePagerWidget(section, entriesLength) {
  const widget = ensurePagerWidget(section);
  if (!widget) {
    return;
  }
  if (!entriesLength) {
    widget.update({ status: "disabled", info: "Keine Einträge verfügbar." });
    return;
  }
  const pageOffset = clampPageOffset(entriesLength);
  const visibleCount = Math.min(entriesLength - pageOffset, REPORT_PAGE_SIZE);
  const info = `Einträge ${numberFormatter.format(pageOffset + 1)}–${numberFormatter.format(
    pageOffset + visibleCount
  )} von ${numberFormatter.format(entriesLength)}`;
  const canPrev = reportPageIndex > 0;
  const canNext = pageOffset + visibleCount < entriesLength;
  widget.update({
    status: "ready",
    info,
    canPrev,
    canNext,
  });
}

function goToPrevPage(section) {
  if (reportPageIndex === 0) {
    return;
  }
  reportPageIndex = Math.max(reportPageIndex - 1, 0);
  renderTable(section, currentEntries, getState().fieldLabels);
}

function goToNextPage(section) {
  const total = currentEntries.length;
  if ((reportPageIndex + 1) * REPORT_PAGE_SIZE >= total) {
    return;
  }
  reportPageIndex += 1;
  renderTable(section, currentEntries, getState().fieldLabels);
}

/**
 * Render cards list with virtual scrolling support
 */
function renderCardsList(listContainer, entries, labels) {
  const resolvedLabels = labels || getState().fieldLabels;
  const pageOffset = clampPageOffset(entries.length);
  const visibleEntries = entries.slice(
    pageOffset,
    Math.min(pageOffset + REPORT_PAGE_SIZE, entries.length)
  );

  const fragment = document.createDocumentFragment();
  for (const entry of visibleEntries) {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = renderCalculationSnapshot(entry, resolvedLabels, {
      showActions: false,
      includeCheckbox: false,
    });
    fragment.appendChild(wrapper.firstElementChild);
  }

  listContainer.innerHTML = "";
  listContainer.appendChild(fragment);
}

function renderTable(section, entries, labels) {
  const resolvedLabels = labels || getState().fieldLabels;
  const listContainer = section.querySelector('[data-role="report-list"]');
  const info = section.querySelector('[data-role="report-info"]');
  const printButton = section.querySelector('[data-action="print-report"]');

  currentEntries = entries.slice();

  if (listContainer) {
    renderCardsList(listContainer, entries, resolvedLabels);
  }

  updatePagerWidget(section, entries.length);

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

function applyFilter(section, state, filter, { resetPage = false } = {}) {
  const source = state.history || [];
  if (resetPage) {
    reportPageIndex = 0;
  }
  if (!filter) {
    renderTable(section, source, state.fieldLabels);
    return;
  }
  const filtered = source.filter((entry) => {
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

  const filterForm = section.querySelector("#report-filter");
  filterForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(filterForm);
    const start = parseDate(formData.get("report-start"));
    const end = parseDate(formData.get("report-end"));
    if (!start || !end) {
      alert("Bitte gültige Daten auswählen!");
      return;
    }
    if (start > end) {
      alert("Das Startdatum muss vor dem Enddatum liegen.");
      return;
    }
    activeFilter = {
      start,
      end,
      startLabel: new Intl.DateTimeFormat("de-DE").format(start),
      endLabel: new Intl.DateTimeFormat("de-DE").format(end),
    };
    applyFilter(section, getState(), activeFilter, { resetPage: true });
  });

  function toggle(state) {
    const ready = state.app.hasDatabase;
    const active = state.app.activeSection === "report";
    section.classList.toggle("d-none", !(ready && active));
    if (ready) {
      applyFilter(section, state, activeFilter, { resetPage: true });
    }
  }

  toggle(getState());

  services.state.subscribe((nextState) => {
    toggle(nextState);
  });

  section.addEventListener("click", (event) => {
    // Handle print report
    const trigger = event.target.closest('[data-action="print-report"]');
    if (!trigger) {
      return;
    }
    if (!currentEntries.length) {
      alert("Keine Daten für den Druck vorhanden.");
      return;
    }
    printReport(currentEntries, activeFilter, getState().fieldLabels);
  });

  initialized = true;
}

function buildCompanyHeader(company = {}) {
  const hasContent = Boolean(
    company.name || company.headline || company.address || company.contactEmail
  );
  if (!hasContent) {
    return "";
  }
  return `
    <div class="print-meta">
      ${company.name ? `<h1>${escapeHtml(company.name)}</h1>` : ""}
      ${company.headline ? `<p>${escapeHtml(company.headline)}</p>` : ""}
      ${company.address ? `<p>${escapeHtml(company.address).replace(/\n/g, "<br />")}</p>` : ""}
      ${company.contactEmail ? `<p>${escapeHtml(company.contactEmail)}</p>` : ""}
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

async function printReport(entries, filter, labels) {
  const resolvedLabels = labels || getState().fieldLabels;
  const company = getState().company || {};
  const headerHtml =
    buildCompanyHeader(company) + buildFilterInfo(filter, resolvedLabels);

  try {
    await printEntriesChunked(entries, resolvedLabels, {
      title: resolvedLabels.reporting.printTitle,
      headerHtml,
      chunkSize: 50,
    });
  } catch (err) {
    console.error("Printing failed", err);
    alert("Fehler beim Drucken. Bitte erneut versuchen.");
  }
}
