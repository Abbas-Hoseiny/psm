import { getState } from "../../core/state.js";
import { printHtml } from "../../core/print.js";
import { saveDatabase, getActiveDriverKey } from "../../core/storage/index.js";
import { getDatabaseSnapshot } from "../../core/database.js";
import { buildMediumTableHTML } from "../shared/mediumTable.js";
import { escapeHtml } from "../../core/utils.js";
import { renderCalculationSnapshot } from "../shared/calculationSnapshot.js";
import { printEntriesChunked } from "../shared/printing.js";
import { createPagerWidget } from "../shared/pagerWidget.js";

let initialized = false;
const selectedIndexes = new Set();
const HISTORY_PAGE_SIZE = 50;
const numberFormatter = new Intl.NumberFormat("de-DE");
let historyPageIndex = 0;
let historyPagerWidget = null;
let historyPagerTarget = null;

async function persistHistoryChanges() {
  const driverKey = getActiveDriverKey();
  if (!driverKey || driverKey === "memory") {
    return;
  }
  try {
    const snapshot = getDatabaseSnapshot();
    await saveDatabase(snapshot);
  } catch (err) {
    console.error("Fehler beim Persistieren der Historie", err);
    alert(
      "Historie konnte nicht dauerhaft gespeichert werden. Bitte erneut versuchen."
    );
  }
}

function createSection() {
  const section = document.createElement("section");
  section.className = "section-container d-none";
  section.dataset.section = "history";
  section.innerHTML = `
    <div class="section-inner">
      <h2 class="text-center mb-4">Historie – Frühere Einträge</h2>
      <div class="card card-dark">
        <div class="card-header d-flex flex-column flex-lg-row justify-content-between align-items-lg-center gap-3 no-print">
          <div class="small text-muted" data-role="selection-info">Keine Einträge ausgewählt.</div>
          <button class="btn btn-outline-light btn-sm" data-action="print-selected" disabled>Ausgewählte drucken</button>
        </div>
        <div class="card-body">
          <div class="alert alert-info d-none" data-role="history-message"></div>
          <div data-role="history-list" class="history-list"></div>
          <div data-role="history-load-more" class="mt-3"></div>
        </div>
      </div>
      <div class="card card-dark mt-4 d-none" id="history-detail">
        <div class="card-header bg-info text-white">
          <h5 class="mb-0">Details</h5>
        </div>
        <div class="card-body" id="history-detail-body"></div>
      </div>
    </div>
  `;
  return section;
}

/**
 * Incremental update for single card selection
 */
function updateCardSelection(listContainer, index, selected) {
  const card = listContainer.querySelector(
    `.calc-snapshot-card[data-index="${index}"]`
  );
  if (!card) return;

  card.classList.toggle("calc-snapshot-card--selected", selected);
  const checkbox = card.querySelector('[data-action="toggle-select"]');
  if (checkbox) {
    checkbox.checked = selected;
  }
}

function clampPageOffset(entriesLength) {
  if (!entriesLength) {
    historyPageIndex = 0;
    return 0;
  }
  const maxPage = Math.max(Math.ceil(entriesLength / HISTORY_PAGE_SIZE) - 1, 0);
  if (historyPageIndex > maxPage) {
    historyPageIndex = maxPage;
  }
  if (historyPageIndex < 0) {
    historyPageIndex = 0;
  }
  return historyPageIndex * HISTORY_PAGE_SIZE;
}

function ensurePagerWidget(section) {
  const target = section.querySelector('[data-role="history-load-more"]');
  if (!target) {
    return null;
  }
  if (!historyPagerWidget || historyPagerTarget !== target) {
    if (
      historyPagerWidget &&
      typeof historyPagerWidget.destroy === "function"
    ) {
      historyPagerWidget.destroy();
    }
    historyPagerWidget = createPagerWidget(target, {
      onPrev: () => goToPrevPage(section),
      onNext: () => goToNextPage(section),
      labels: {
        prev: "Zurück",
        next: "Weiter",
        loading: "Lade Historie…",
        empty: "Keine Historien-Einträge",
      },
    });
    historyPagerTarget = target;
  }
  return historyPagerWidget;
}

function updatePagerWidget(section, entriesLength) {
  const widget = ensurePagerWidget(section);
  if (!widget) {
    return;
  }
  if (!entriesLength) {
    widget.update({ status: "disabled", info: "Keine Historien-Einträge." });
    return;
  }
  const pageOffset = clampPageOffset(entriesLength);
  const visibleCount = Math.min(entriesLength - pageOffset, HISTORY_PAGE_SIZE);
  const info = `Einträge ${numberFormatter.format(
    pageOffset + 1
  )}–${numberFormatter.format(pageOffset + visibleCount)} von ${numberFormatter.format(
    entriesLength
  )}`;
  const canPrev = historyPageIndex > 0;
  const canNext = pageOffset + visibleCount < entriesLength;
  widget.update({
    status: "ready",
    info,
    canPrev,
    canNext,
  });
}

function goToPrevPage(section) {
  if (historyPageIndex === 0) {
    return;
  }
  historyPageIndex = Math.max(historyPageIndex - 1, 0);
  renderTable(getState(), section, getState().fieldLabels);
}

function goToNextPage(section) {
  const entries = getState().history || [];
  if ((historyPageIndex + 1) * HISTORY_PAGE_SIZE >= entries.length) {
    return;
  }
  historyPageIndex += 1;
  renderTable(getState(), section, getState().fieldLabels);
}

/**
 * Initialize or update virtual list
 */
function renderCardsList(state, listContainer, labels) {
  const entries = state.history || [];
  const resolvedLabels = labels || getState().fieldLabels;

  for (const idx of Array.from(selectedIndexes)) {
    if (!entries[idx]) {
      selectedIndexes.delete(idx);
    }
  }

  const pageOffset = clampPageOffset(entries.length);
  const visibleEntries = entries.slice(
    pageOffset,
    Math.min(pageOffset + HISTORY_PAGE_SIZE, entries.length)
  );

  listContainer.innerHTML = "";

  if (!visibleEntries.length) {
    const empty = document.createElement("p");
    empty.className = "text-muted text-center mb-0";
    empty.textContent = "Keine Historien-Einträge vorhanden.";
    listContainer.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  visibleEntries.forEach((entry, idx) => {
    const absoluteIndex = pageOffset + idx;
    const selected = selectedIndexes.has(absoluteIndex);
    const cardHtml = renderCalculationSnapshot(entry, resolvedLabels, {
      showActions: true,
      includeCheckbox: true,
      index: absoluteIndex,
      selected,
    });
    const wrapper = document.createElement("div");
    wrapper.innerHTML = cardHtml;
    fragment.appendChild(wrapper.firstElementChild);
  });

  listContainer.appendChild(fragment);
}

function renderTable(state, section, labels) {
  const listContainer = section.querySelector('[data-role="history-list"]');
  const entries = state.history || [];
  clampPageOffset(entries.length);
  if (listContainer) {
    renderCardsList(state, listContainer, labels);
  }
  updatePagerWidget(section, entries.length);
}

function renderDetail(entry, section, index = null, labels) {
  const detailCard = section.querySelector("#history-detail");
  const detailBody = section.querySelector("#history-detail-body");
  if (!entry) {
    detailCard.classList.add("d-none");
    detailBody.innerHTML = "";
    delete detailCard.dataset.index;
    return;
  }
  detailCard.dataset.index = index !== null ? String(index) : "";
  const resolvedLabels = labels || getState().fieldLabels;
  const tableLabels = resolvedLabels.history.tableColumns;
  const detailLabels = resolvedLabels.history.detail;
  const snapshotTable = buildMediumTableHTML(
    entry.items,
    resolvedLabels,
    "detail"
  );
  detailBody.innerHTML = `
    <p>
      <strong>${escapeHtml(tableLabels.date)}:</strong> ${escapeHtml(entry.datum || entry.date || "")}<br />
      <strong>${escapeHtml(detailLabels.creator)}:</strong> ${escapeHtml(entry.ersteller || "")}<br />
      <strong>${escapeHtml(detailLabels.location)}:</strong> ${escapeHtml(entry.standort || "")}<br />
      <strong>${escapeHtml(detailLabels.crop)}:</strong> ${escapeHtml(entry.kultur || "")}<br />
      <strong>${escapeHtml(detailLabels.quantity)}:</strong> ${escapeHtml(entry.kisten != null ? String(entry.kisten) : "")}
    </p>
    <div class="table-responsive">
      ${snapshotTable}
    </div>
    <button class="btn btn-outline-secondary no-print" data-action="detail-print">Drucken / PDF</button>
  `;
  detailCard.classList.remove("d-none");
}

const HISTORY_SUMMARY_STYLES = `
  .history-summary {
    margin-top: 1.5rem;
  }
  .history-summary table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.95rem;
  }
  .history-summary th,
  .history-summary td {
    border: 1px solid #555;
    padding: 6px 8px;
    vertical-align: top;
  }
  .history-summary th {
    background: #f2f2f2;
  }
  .history-summary td div + div {
    margin-top: 0.25rem;
  }
  .history-detail h2 {
    margin-top: 1.5rem;
  }
  .history-detail table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.95rem;
  }
  .history-detail th,
  .history-detail td {
    border: 1px solid #555;
    padding: 6px 8px;
    text-align: left;
  }
  .nowrap {
    white-space: nowrap;
  }
`;

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

/**
 * Print selected entries using chunked printing
 */
async function printSummary(entries, labels) {
  if (!entries.length) {
    alert("Keine Einträge zum Drucken ausgewählt.");
    return;
  }

  const company = getState().company || {};
  const headerHtml = buildCompanyHeader(company);

  try {
    await printEntriesChunked(entries, labels, {
      title: "Historie – Übersicht",
      headerHtml,
      chunkSize: 50,
    });
  } catch (err) {
    console.error("Printing failed", err);
    alert("Fehler beim Drucken. Bitte erneut versuchen.");
  }
}

/**
 * Print single entry detail
 */
function printDetail(entry, labels) {
  if (!entry) {
    alert("Kein Eintrag zum Drucken vorhanden.");
    return;
  }
  const company = getState().company || {};
  const resolvedLabels = labels || getState().fieldLabels;
  const detailLabels = resolvedLabels.history.detail;
  const snapshotTable = buildMediumTableHTML(
    entry.items,
    resolvedLabels,
    "detail",
    { classes: "history-detail-table" }
  );
  const entryDate = entry.datum || entry.date || "";
  const headingHtml = entryDate ? `<h2>${escapeHtml(entryDate)}</h2>` : "";

  const content = `${buildCompanyHeader(company)}
    <section class="history-detail">
      ${headingHtml}
      <p>
        <strong>${escapeHtml(detailLabels.creator)}:</strong> ${escapeHtml(entry.ersteller || "")}<br />
        <strong>${escapeHtml(detailLabels.location)}:</strong> ${escapeHtml(entry.standort || "")}<br />
        <strong>${escapeHtml(detailLabels.crop)}:</strong> ${escapeHtml(entry.kultur || "")}<br />
        <strong>${escapeHtml(detailLabels.quantity)}:</strong> ${escapeHtml(entry.kisten != null ? String(entry.kisten) : "")}
      </p>
      ${snapshotTable}
    </section>
  `;

  printHtml({
    title: entryDate || "Historie",
    styles: HISTORY_SUMMARY_STYLES,
    content,
  });
}

function updateSelectionUI(section) {
  const info = section.querySelector('[data-role="selection-info"]');
  const printButton = section.querySelector('[data-action="print-selected"]');
  if (info) {
    info.textContent = selectedIndexes.size
      ? `${selectedIndexes.size} Eintrag(e) ausgewählt.`
      : "Keine Einträge ausgewählt.";
  }
  if (printButton) {
    printButton.disabled = !selectedIndexes.size;
  }
}

export function initHistory(container, services) {
  if (!container || initialized) {
    return;
  }
  const section = createSection();
  container.appendChild(section);

  function toggleVisibility(state) {
    const active = state.app.activeSection === "history";
    const ready = state.app.hasDatabase;
    section.classList.toggle("d-none", !(active && ready));
  }

  services.state.subscribe((nextState) => {
    toggleVisibility(nextState);
    renderTable(nextState, section, nextState.fieldLabels);
    const detailCard = section.querySelector("#history-detail");
    if (detailCard && !detailCard.classList.contains("d-none")) {
      const detailIndex = Number(detailCard.dataset.index);
      if (!Number.isNaN(detailIndex) && nextState.history[detailIndex]) {
        renderDetail(
          nextState.history[detailIndex],
          section,
          detailIndex,
          nextState.fieldLabels
        );
      } else {
        renderDetail(null, section, null, nextState.fieldLabels);
      }
    }
    updateSelectionUI(section);
  });

  toggleVisibility(getState());
  renderTable(getState(), section, getState().fieldLabels);
  updateSelectionUI(section);

  section.addEventListener("click", (event) => {
    const action = event.target.dataset.action;
    if (!action) {
      return;
    }

    // Handle detail print
    if (action === "detail-print") {
      const detailCard = event.target.closest("#history-detail");
      const indexAttr = detailCard ? detailCard.dataset.index : undefined;
      const index =
        typeof indexAttr === "string" && indexAttr !== ""
          ? Number(indexAttr)
          : NaN;
      const state = getState();
      const entry = Number.isInteger(index) ? state.history[index] : null;
      printDetail(entry, state.fieldLabels);
      return;
    }

    // Handle print selected
    if (action === "print-selected") {
      const state = getState();
      const entries = Array.from(selectedIndexes)
        .sort((a, b) => a - b)
        .map((idx) => state.history[idx])
        .filter(Boolean);
      printSummary(entries, state.fieldLabels);
      return;
    }

    const index = Number(event.target.dataset.index);
    if (Number.isNaN(index)) {
      return;
    }
    const state = getState();

    if (action === "view") {
      const entry = state.history[index];
      renderDetail(entry, section, index, state.fieldLabels);
    } else if (action === "delete") {
      if (!confirm("Wirklich löschen?")) {
        return;
      }
      services.state.updateSlice("history", (history) => {
        const copy = [...history];
        copy.splice(index, 1);
        return copy;
      });
      selectedIndexes.clear();
      updateSelectionUI(section);
      renderDetail(null, section, null, state.fieldLabels);
      persistHistoryChanges().catch((err) => {
        console.error("Persist delete history error", err);
      });
    }
  });

  section.addEventListener("change", (event) => {
    const action = event.target.dataset.action;
    if (action !== "toggle-select") {
      return;
    }
    const index = Number(event.target.dataset.index);
    if (Number.isNaN(index)) {
      return;
    }

    // Incremental update: only modify this specific card
    const listContainer = section.querySelector('[data-role="history-list"]');
    if (event.target.checked) {
      selectedIndexes.add(index);
      updateCardSelection(listContainer, index, true);
    } else {
      selectedIndexes.delete(index);
      updateCardSelection(listContainer, index, false);
    }
    updateSelectionUI(section);
  });

  initialized = true;
}
