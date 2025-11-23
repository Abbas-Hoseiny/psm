import {
  getState,
  subscribeState,
  updateSlice,
  type AppState,
} from "@scripts/core/state";
import { buildMediumTableHTML } from "@scripts/features/shared/mediumTable";
import {
  escapeHtml,
  formatGpsCoordinates,
  buildGoogleMapsUrl,
  formatDateFromIso,
} from "@scripts/core/utils";
import { renderCalculationSnapshot } from "@scripts/features/shared/calculationSnapshot";
import { initVirtualList } from "@scripts/core/virtualList";
import { printHtml } from "@scripts/core/print";
import {
  printEntriesChunked,
  buildCompanyPrintHeader,
} from "@scripts/features/shared/printing";
import { getDatabaseSnapshot } from "@scripts/core/database";
import { getActiveDriverKey, saveDatabase } from "@scripts/core/storage";
import type { CalculationItem } from "@scripts/features/calculation";

interface Services {
  state: {
    getState: typeof getState;
    subscribe: typeof subscribeState;
    updateSlice: typeof updateSlice;
  };
  events?: {
    emit?: (eventName: string, payload?: unknown) => void;
    subscribe?: (
      eventName: string,
      handler: (payload: unknown) => void
    ) => (() => void) | void;
  };
}

interface HistoryEntry {
  datum?: string;
  date?: string;
  dateIso?: string | null;
  ersteller?: string;
  standort?: string;
  kultur?: string;
  kisten?: number;
  eppoCode?: string;
  bbch?: string;
  gps?: string;
  gpsCoordinates?: { latitude?: number; longitude?: number } | null;
  gpsPointId?: string | null;
  invekos?: string;
  uhrzeit?: string;
  items: CalculationItem[];
  savedAt?: string;
  [key: string]: unknown;
}

function resolveHistoryDate(entry: HistoryEntry | null): string {
  if (!entry) {
    return "";
  }
  return (
    entry.datum ||
    formatDateFromIso(entry.dateIso) ||
    (typeof entry.date === "string" ? entry.date : "") ||
    ""
  );
}

function resolveHistoryGps(entry: HistoryEntry): string {
  if (entry?.gpsCoordinates) {
    const formatted = formatGpsCoordinates(entry.gpsCoordinates);
    if (formatted) {
      return formatted;
    }
  }
  return "";
}

function resolveHistoryGpsNote(entry: HistoryEntry): string {
  return entry?.gps || "";
}

function resolveHistoryMapUrl(entry: HistoryEntry | null): string | null {
  if (!entry?.gpsCoordinates) {
    return null;
  }
  return buildGoogleMapsUrl(entry.gpsCoordinates);
}

function emitGpsActivationRequest(
  services: Services,
  entry: HistoryEntry | null
): void {
  if (!entry?.gpsPointId) {
    window.alert(
      "Dieser Eintrag ist nicht mit einem gespeicherten GPS-Punkt verknüpft."
    );
    return;
  }
  if (typeof services.events?.emit !== "function") {
    window.alert("GPS-Modul konnte nicht benachrichtigt werden.");
    return;
  }
  services.events.emit("gps:set-active-from-history", {
    id: entry.gpsPointId,
    source: "history",
  });
}

const USE_VIRTUAL_SCROLLING = true;
const INITIAL_LOAD_LIMIT = 200;

let initialized = false;
let virtualListInstance: ReturnType<typeof initVirtualList> | null = null;
const selectedIndexes = new Set<number>();
let historyMessageTimeout: number | null = null;

async function persistHistoryChanges(): Promise<void> {
  const driverKey = getActiveDriverKey();
  if (!driverKey || driverKey === "memory") {
    return;
  }
  try {
    const snapshot = getDatabaseSnapshot();
    await saveDatabase(snapshot);
  } catch (err) {
    console.error("Fehler beim Persistieren der Historie", err);
    window.alert(
      "Historie konnte nicht dauerhaft gespeichert werden. Bitte erneut versuchen."
    );
  }
}

function createSection(): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "section-inner";
  wrapper.innerHTML = `
    <h2 class="text-center mb-4">Historie – Frühere Einträge</h2>
    <div class="card card-dark">
      <div class="card-header d-flex flex-column flex-lg-row justify-content-between align-items-lg-center gap-3 no-print">
        <div class="small text-muted" data-role="selection-info">Keine Einträge ausgewählt.</div>
        <button class="btn btn-outline-light btn-sm" data-action="print-selected" disabled>Ausgewählte drucken</button>
      </div>
      <div class="card-body">
        <div class="alert alert-info d-none" data-role="history-message"></div>
        <div data-role="history-list" class="history-list"></div>
      </div>
    </div>
    <div class="card card-dark mt-4 d-none" id="history-detail">
      <div class="card-header bg-info text-white">
        <h5 class="mb-0">Details</h5>
      </div>
      <div class="card-body" id="history-detail-body"></div>
    </div>
  `;
  return wrapper;
}

function updateCardSelection(
  listContainer: Element | null,
  index: number,
  selected: boolean
): void {
  const card = listContainer?.querySelector<HTMLElement>(
    `.calc-snapshot-card[data-index="${index}"]`
  );
  if (!card) {
    return;
  }
  card.classList.toggle("calc-snapshot-card--selected", selected);
  const checkbox = card.querySelector<HTMLInputElement>(
    '[data-action="toggle-select"]'
  );
  if (checkbox) {
    checkbox.checked = selected;
  }
}

function renderCardsList(
  state: AppState,
  listContainer: HTMLElement,
  labels: AppState["fieldLabels"]
): void {
  const entries: HistoryEntry[] = state.history || [];
  const resolvedLabels = labels || getState().fieldLabels;

  for (const idx of Array.from(selectedIndexes)) {
    if (!entries[idx]) {
      selectedIndexes.delete(idx);
    }
  }

  if (USE_VIRTUAL_SCROLLING && entries.length > INITIAL_LOAD_LIMIT) {
    if (!virtualListInstance) {
      virtualListInstance = initVirtualList(listContainer, {
        itemCount: entries.length,
        estimatedItemHeight: 250,
        overscan: 6,
        renderItem: (node, index) => {
          const entry = entries[index];
          const selected = selectedIndexes.has(index);
          node.innerHTML = renderCalculationSnapshot(entry, resolvedLabels, {
            showActions: true,
            includeCheckbox: true,
            index,
            selected,
            enableGpsActions: true,
          });
        },
      });
    } else {
      virtualListInstance.updateItemCount(entries.length);
    }
  } else {
    if (virtualListInstance) {
      virtualListInstance.destroy();
      virtualListInstance = null;
    }

    const limit = Math.min(entries.length, INITIAL_LOAD_LIMIT);
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < limit; i += 1) {
      const entry = entries[i];
      const selected = selectedIndexes.has(i);
      const cardHtml = renderCalculationSnapshot(entry, resolvedLabels, {
        showActions: true,
        includeCheckbox: true,
        index: i,
        selected,
        enableGpsActions: true,
      });
      const wrapper = document.createElement("div");
      wrapper.innerHTML = cardHtml;
      if (wrapper.firstElementChild) {
        fragment.appendChild(wrapper.firstElementChild);
      }
    }

    listContainer.innerHTML = "";
    listContainer.appendChild(fragment);

    if (entries.length > limit) {
      const loadMoreBtn = document.createElement("button");
      loadMoreBtn.className = "btn btn-secondary w-100 mt-3";
      loadMoreBtn.textContent = `Mehr laden (${
        entries.length - limit
      } weitere)`;
      loadMoreBtn.dataset.action = "load-more";
      loadMoreBtn.dataset.currentLimit = String(limit);
      listContainer.appendChild(loadMoreBtn);
    }
  }
}

function renderHistoryTable(section: HTMLElement, state: AppState): void {
  const listContainer = section.querySelector<HTMLElement>(
    '[data-role="history-list"]'
  );
  if (!listContainer) {
    return;
  }
  renderCardsList(state, listContainer, state.fieldLabels);
}

function showHistoryFeedback(
  section: HTMLElement,
  text?: string,
  variant: "info" | "success" | "warning" | "danger" = "info",
  autoHideMs = 5000
): void {
  const messageNode = section.querySelector<HTMLElement>(
    '[data-role="history-message"]'
  );
  if (!messageNode) {
    return;
  }
  if (historyMessageTimeout) {
    window.clearTimeout(historyMessageTimeout);
    historyMessageTimeout = null;
  }
  if (!text) {
    messageNode.classList.add("d-none");
    messageNode.textContent = "";
    return;
  }
  messageNode.className = `alert alert-${variant}`;
  messageNode.textContent = text;
  messageNode.classList.remove("d-none");
  if (autoHideMs > 0) {
    historyMessageTimeout = window.setTimeout(() => {
      messageNode.classList.add("d-none");
    }, autoHideMs);
  }
}

function renderDetail(
  entry: HistoryEntry | null,
  section: HTMLElement,
  index: number | null,
  labels: AppState["fieldLabels"]
): void {
  const detailCard = section.querySelector<HTMLElement>("#history-detail");
  const detailBody = section.querySelector<HTMLElement>("#history-detail-body");
  if (!detailCard || !detailBody) {
    return;
  }

  if (!entry) {
    detailCard.classList.add("d-none");
    detailBody.innerHTML = "";
    detailCard.dataset.index = "";
    return;
  }

  detailCard.dataset.index = index !== null ? String(index) : "";
  const resolvedLabels = labels || getState().fieldLabels;
  const tableLabels = resolvedLabels.history?.tableColumns ?? {};
  const detailLabels = resolvedLabels.history?.detail ?? {};
  const snapshotTable = buildMediumTableHTML(
    entry.items,
    resolvedLabels,
    "detail"
  );
  const mapUrl = resolveHistoryMapUrl(entry);
  const gpsNoteValue = resolveHistoryGpsNote(entry);
  const gpsCoordsValue = resolveHistoryGps(entry);
  const gpsNoteHtml = gpsNoteValue ? escapeHtml(gpsNoteValue) : "&ndash;";
  const gpsCoordsLink = mapUrl
    ? ` <a class="btn btn-link btn-sm p-0 ms-2 align-baseline" href="${escapeHtml(
        mapUrl
      )}" target="_blank" rel="noopener noreferrer">Google Maps</a>`
    : "";
  const gpsCoordsHtml = gpsCoordsValue
    ? `${escapeHtml(gpsCoordsValue)}${gpsCoordsLink}`
    : "&ndash;";
  const gpsNoteLabel =
    detailLabels.gpsNote ||
    tableLabels.gpsNote ||
    detailLabels.gps ||
    tableLabels.gps ||
    "GPS-Notiz";
  const gpsCoordsLabel =
    detailLabels.gpsCoordinates ||
    tableLabels.gpsCoordinates ||
    detailLabels.gps ||
    tableLabels.gps ||
    "GPS-Koordinaten";

  detailBody.innerHTML = `
    <p>
      <strong>${escapeHtml(tableLabels.date || "Datum")}:</strong> ${escapeHtml(
        resolveHistoryDate(entry)
      )}<br />
      <strong>${escapeHtml(
        detailLabels.creator || "Erstellt von"
      )}:</strong> ${escapeHtml(entry.ersteller || "")}<br />
      <strong>${escapeHtml(
        detailLabels.location || "Standort"
      )}:</strong> ${escapeHtml(entry.standort || "")}<br />
      <strong>${escapeHtml(
        detailLabels.crop || "Kultur"
      )}:</strong> ${escapeHtml(entry.kultur || "")}<br />
      <strong>${escapeHtml(
        detailLabels.quantity || "Kisten"
      )}:</strong> ${escapeHtml(
        entry.kisten !== undefined && entry.kisten !== null
          ? String(entry.kisten)
          : ""
      )}<br />
      <strong>${escapeHtml(
        detailLabels.eppoCode || "EPPO-Code"
      )}:</strong> ${escapeHtml(entry.eppoCode || "")}<br />
      <strong>${escapeHtml(
        detailLabels.bbch || "BBCH-Stadium"
      )}:</strong> ${escapeHtml(entry.bbch || "")}<br />
      <strong>${escapeHtml(
        detailLabels.invekos || "InVeKoS-Schlag"
      )}:</strong> ${escapeHtml(entry.invekos || "")}<br />
      <strong>${escapeHtml(gpsNoteLabel)}:</strong> ${gpsNoteHtml}<br />
      <strong>${escapeHtml(gpsCoordsLabel)}:</strong> ${gpsCoordsHtml}<br />
      <strong>${escapeHtml(
        detailLabels.time || "Uhrzeit"
      )}:</strong> ${escapeHtml(entry.uhrzeit || "")}
    </p>
    <div class="table-responsive">
      ${snapshotTable}
    </div>
    <div class="mt-3 d-flex flex-wrap gap-2">
      <button class="btn btn-outline-secondary no-print" data-action="detail-print">Drucken / PDF</button>
      ${
        entry.gpsPointId != null
          ? `<button class="btn btn-outline-success no-print"
                     data-action="detail-activate-gps"
                     data-index="${typeof index === "number" ? index : ""}">
               GPS im Modul aktivieren
             </button>`
          : ""
      }
      ${
        mapUrl
          ? `<a class="btn btn-outline-info no-print" href="${escapeHtml(
              mapUrl
            )}" target="_blank" rel="noopener noreferrer">
               Google Maps öffnen
             </a>`
          : ""
      }
    </div>
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

async function printSummary(
  entries: HistoryEntry[],
  labels: AppState["fieldLabels"]
): Promise<void> {
  if (!entries.length) {
    window.alert("Keine Einträge zum Drucken ausgewählt.");
    return;
  }
  const company = getState().company || {};
  const headerHtml = buildCompanyPrintHeader(company);
  try {
    await printEntriesChunked(entries, labels, {
      title: "Historie – Übersicht",
      headerHtml,
      chunkSize: 50,
    });
  } catch (err) {
    console.error("Printing failed", err);
    window.alert("Fehler beim Drucken. Bitte erneut versuchen.");
  }
}

function printDetail(
  entry: HistoryEntry | null,
  labels: AppState["fieldLabels"]
): void {
  if (!entry) {
    window.alert("Kein Eintrag zum Drucken vorhanden.");
    return;
  }
  const company = getState().company || {};
  const resolvedLabels = labels || getState().fieldLabels;
  const detailLabels = resolvedLabels.history?.detail ?? {};
  const snapshotTable = buildMediumTableHTML(
    entry.items || [],
    resolvedLabels,
    "detail",
    {
      classes: "history-detail-table",
    }
  );

  const mapUrl = resolveHistoryMapUrl(entry);
  const gpsNoteValue = resolveHistoryGpsNote(entry);
  const gpsCoordsValue = resolveHistoryGps(entry);
  const gpsNoteLabel = detailLabels.gpsNote || detailLabels.gps || "GPS-Notiz";
  const gpsCoordsLabel =
    detailLabels.gpsCoordinates || detailLabels.gps || "GPS-Koordinaten";
  const gpsCoordsHtml = gpsCoordsValue
    ? mapUrl
      ? `${escapeHtml(gpsCoordsValue)} (${escapeHtml(mapUrl)})`
      : escapeHtml(gpsCoordsValue)
    : "";

  const entryDate = resolveHistoryDate(entry);
  const headingHtml = entryDate ? `<h2>${escapeHtml(entryDate)}</h2>` : "";

  const content = `${buildCompanyPrintHeader(company)}
    <section class="history-detail">
      ${headingHtml}
      <p>
        <strong>${escapeHtml(
          detailLabels.creator || "Erstellt von"
        )}:</strong> ${escapeHtml(entry.ersteller || "")}<br />
        <strong>${escapeHtml(
          detailLabels.location || "Standort"
        )}:</strong> ${escapeHtml(entry.standort || "")}<br />
        <strong>${escapeHtml(
          detailLabels.crop || "Kultur"
        )}:</strong> ${escapeHtml(entry.kultur || "")}<br />
        <strong>${escapeHtml(
          detailLabels.quantity || "Kisten"
        )}:</strong> ${escapeHtml(
          entry.kisten !== undefined && entry.kisten !== null
            ? String(entry.kisten)
            : ""
        )}<br />
        <strong>${escapeHtml(
          detailLabels.eppoCode || "EPPO-Code"
        )}:</strong> ${escapeHtml(entry.eppoCode || "")}<br />
        <strong>${escapeHtml(
          detailLabels.bbch || "BBCH-Stadium"
        )}:</strong> ${escapeHtml(entry.bbch || "")}<br />
        <strong>${escapeHtml(
          detailLabels.invekos || "InVeKoS-Schlag"
        )}:</strong> ${escapeHtml(entry.invekos || "")}<br />
        <strong>${escapeHtml(gpsNoteLabel)}:</strong> ${escapeHtml(
          gpsNoteValue || ""
        )}<br />
        <strong>${escapeHtml(gpsCoordsLabel)}:</strong> ${gpsCoordsHtml}<br />
        <strong>${escapeHtml(
          detailLabels.time || "Uhrzeit"
        )}:</strong> ${escapeHtml(entry.uhrzeit || "")}
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

function updateSelectionUI(section: HTMLElement): void {
  const info = section.querySelector<HTMLElement>(
    '[data-role="selection-info"]'
  );
  const printButton = section.querySelector<HTMLButtonElement>(
    '[data-action="print-selected"]'
  );
  if (info) {
    info.textContent = selectedIndexes.size
      ? `${selectedIndexes.size} Eintrag(e) ausgewählt.`
      : "Keine Einträge ausgewählt.";
  }
  if (printButton) {
    printButton.disabled = !selectedIndexes.size;
  }
}

function toggleSectionAvailability(
  section: HTMLElement,
  state: AppState
): void {
  const hasDatabase = Boolean(state.app?.hasDatabase);
  section.classList.toggle("d-none", !hasDatabase);
}

export function initHistory(
  container: Element | null,
  services: Services
): void {
  if (!container || initialized) {
    return;
  }

  const host = container as HTMLElement;
  host.innerHTML = "";
  const section = createSection();
  host.appendChild(section);

  if (typeof services.events?.subscribe === "function") {
    services.events.subscribe(
      "history:gps-activation-result",
      (payload: unknown) => {
        const data =
          payload && typeof payload === "object"
            ? (payload as {
                status?: string;
                name?: string | null;
                id?: string | null;
                message?: string;
              })
            : null;
        if (!data) {
          return;
        }
        const status = (data.status || "info").toLowerCase();
        let variant: "info" | "success" | "warning" | "danger" = "info";
        let autoHide = 5000;
        if (status === "success") {
          variant = "success";
        } else if (status === "error") {
          variant = "danger";
        } else if (status === "warning") {
          variant = "warning";
        } else if (status === "pending") {
          variant = "info";
          autoHide = 0;
        }
        const fallbackName = data.name || data.id || "GPS-Punkt";
        const defaultMessage =
          status === "success"
            ? `"${fallbackName}" wurde aktiviert.`
            : status === "pending"
              ? `"${fallbackName}" wird aktiviert...`
              : `GPS-Aktivierung für "${fallbackName}" konnte nicht abgeschlossen werden.`;
        const text = data.message || defaultMessage;
        showHistoryFeedback(section, text, variant, autoHide);
      }
    );
  }

  const handleStateChange = (nextState: AppState) => {
    toggleSectionAvailability(section, nextState);
    renderHistoryTable(section, nextState);
    const detailCard = section.querySelector<HTMLElement>("#history-detail");
    if (detailCard && !detailCard.classList.contains("d-none")) {
      const detailIndex = Number(detailCard.dataset.index);
      if (!Number.isNaN(detailIndex) && nextState.history[detailIndex]) {
        renderDetail(
          nextState.history[detailIndex] as HistoryEntry,
          section,
          detailIndex,
          nextState.fieldLabels
        );
      } else {
        renderDetail(null, section, null, nextState.fieldLabels);
      }
    }
    updateSelectionUI(section);
  };

  services.state.subscribe(handleStateChange);
  handleStateChange(services.state.getState());

  section.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }
    const action = target.dataset.action;
    if (!action) {
      return;
    }

    if (action === "detail-print") {
      const detailCard = target.closest<HTMLElement>("#history-detail");
      const indexAttr = detailCard?.dataset.index;
      const index =
        typeof indexAttr === "string" && indexAttr !== ""
          ? Number(indexAttr)
          : NaN;
      const state = services.state.getState();
      const entry = Number.isInteger(index)
        ? (state.history[index] as HistoryEntry)
        : null;
      printDetail(entry, state.fieldLabels);
      return;
    }

    if (action === "detail-activate-gps") {
      const detailCard = target.closest<HTMLElement>("#history-detail");
      const indexAttr = target.dataset.index || detailCard?.dataset.index || "";
      const index = indexAttr !== "" ? Number(indexAttr) : NaN;
      if (Number.isNaN(index)) {
        window.alert("Kein Historien-Eintrag ausgewählt.");
        return;
      }
      const state = services.state.getState();
      const entry = state.history[index] as HistoryEntry | undefined;
      emitGpsActivationRequest(services, entry ?? null);
      return;
    }

    if (action === "print-selected") {
      const state = services.state.getState();
      const entries = Array.from(selectedIndexes)
        .sort((a, b) => a - b)
        .map((idx) => state.history[idx] as HistoryEntry)
        .filter(Boolean);
      void printSummary(entries, state.fieldLabels);
      return;
    }

    if (action === "load-more") {
      const btn = target as HTMLButtonElement;
      const currentLimit = parseInt(btn.dataset.currentLimit ?? "0", 10);
      const state = services.state.getState();
      const newLimit = Math.min(
        state.history.length,
        currentLimit + INITIAL_LOAD_LIMIT
      );
      const listContainer = section.querySelector<HTMLElement>(
        '[data-role="history-list"]'
      );
      if (!listContainer) {
        return;
      }
      const resolvedLabels = state.fieldLabels;

      const fragment = document.createDocumentFragment();
      for (let i = currentLimit; i < newLimit; i += 1) {
        const entry = state.history[i] as HistoryEntry;
        const selected = selectedIndexes.has(i);
        const cardHtml = renderCalculationSnapshot(entry, resolvedLabels, {
          showActions: true,
          includeCheckbox: true,
          index: i,
          selected,
          enableGpsActions: true,
        });
        const wrapper = document.createElement("div");
        wrapper.innerHTML = cardHtml;
        if (wrapper.firstElementChild) {
          fragment.appendChild(wrapper.firstElementChild);
        }
      }

      btn.remove();
      listContainer.appendChild(fragment);

      if (newLimit < state.history.length) {
        const newBtn = document.createElement("button");
        newBtn.className = "btn btn-secondary w-100 mt-3";
        newBtn.textContent = `Mehr laden (${
          state.history.length - newLimit
        } weitere)`;
        newBtn.dataset.action = "load-more";
        newBtn.dataset.currentLimit = String(newLimit);
        listContainer.appendChild(newBtn);
      }
      return;
    }

    const index = Number(target.dataset.index);
    if (Number.isNaN(index)) {
      return;
    }

    const state = services.state.getState();

    if (action === "view") {
      const entry = state.history[index] as HistoryEntry | undefined;
      renderDetail(entry ?? null, section, index, state.fieldLabels);
    } else if (action === "delete") {
      if (!window.confirm("Wirklich löschen?")) {
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
      void persistHistoryChanges().catch((err) => {
        console.error("Persist delete history error", err);
      });
    } else if (action === "activate-gps") {
      const entry = state.history[index] as HistoryEntry | undefined;
      emitGpsActivationRequest(services, entry ?? null);
    }
  });

  section.addEventListener("change", (event) => {
    const target = event.target as HTMLInputElement | null;
    if (!target || target.dataset.action !== "toggle-select") {
      return;
    }
    const index = Number(target.dataset.index);
    if (Number.isNaN(index)) {
      return;
    }
    const listContainer = section.querySelector('[data-role="history-list"]');
    if (target.checked) {
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
