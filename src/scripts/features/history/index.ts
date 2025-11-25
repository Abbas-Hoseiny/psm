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
import {
  listHistoryEntriesPaged,
  deleteHistoryEntryById,
  persistSqliteDatabaseFile,
  type HistoryCursor,
} from "@scripts/core/storage/sqlite";
import type { CalculationItem } from "@scripts/features/calculation";
import {
  createPagerWidget,
  type PagerWidget,
} from "@scripts/features/shared/pagerWidget";

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
  id?: number | string;
  datum?: string;
  date?: string;
  dateIso?: string | null;
  ersteller?: string;
  standort?: string;
  kultur?: string;
  usageType?: string;
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

function resolveStorageDriver(state: AppState): string {
  return state.app?.storageDriver || getActiveDriverKey();
}

function shouldUseSqlite(state: AppState): boolean {
  return (
    resolveStorageDriver(state) === "sqlite" && Boolean(state.app?.hasDatabase)
  );
}

function clearHistoryCache(): void {
  historyEntries = [];
  historyCursor = null;
  historyHasMore = false;
  historyTotalCount = 0;
  historyLoadError = null;
  historyPageIndex = 0;
  historyPendingAdvance = null;
  historyPendingScrollIndex = null;
  if (historyPendingScrollFrame && typeof window !== "undefined") {
    window.cancelAnimationFrame(historyPendingScrollFrame);
    historyPendingScrollFrame = null;
  }
}

function queuePageScroll(targetIndex: number, immediate = true): void {
  historyPendingScrollIndex = Math.max(0, targetIndex);
  if (immediate) {
    flushPendingVirtualScroll();
  }
}

function flushPendingVirtualScroll(): void {
  if (
    historyPendingScrollIndex == null ||
    typeof window === "undefined" ||
    !virtualListInstance
  ) {
    return;
  }
  const targetIndex = historyPendingScrollIndex;
  historyPendingScrollIndex = null;
  if (historyPendingScrollFrame) {
    window.cancelAnimationFrame(historyPendingScrollFrame);
    historyPendingScrollFrame = null;
  }
  historyPendingScrollFrame = window.requestAnimationFrame(() => {
    historyPendingScrollFrame = null;
    if (!virtualListInstance) {
      historyPendingScrollIndex = targetIndex;
      return;
    }
    virtualListInstance.scrollToIndex(targetIndex);
  });
}

function getEntriesSnapshot(state: AppState): HistoryEntry[] {
  if (dataMode === "sqlite") {
    return historyEntries;
  }
  return Array.isArray(state.history) ? (state.history as HistoryEntry[]) : [];
}

function getLoadedPageCount(): number {
  if (dataMode !== "sqlite" || historyEntries.length === 0) {
    return historyEntries.length ? 1 : 0;
  }
  return Math.max(Math.ceil(historyEntries.length / HISTORY_PAGE_SIZE), 1);
}

function getSqlitePageOffset(): number {
  if (dataMode !== "sqlite") {
    return 0;
  }
  const maxPage = Math.max(getLoadedPageCount() - 1, 0);
  const safeIndex = Math.min(Math.max(historyPageIndex, 0), maxPage);
  return safeIndex * HISTORY_PAGE_SIZE;
}

function getVisibleEntriesCount(): number {
  if (dataMode !== "sqlite") {
    const state = getState();
    const entries = Array.isArray(state.history)
      ? (state.history as HistoryEntry[])
      : historyEntries;
    return entries.length;
  }
  const start = getSqlitePageOffset();
  return Math.max(
    Math.min(historyEntries.length - start, HISTORY_PAGE_SIZE),
    0
  );
}

function getEntryByIndex(state: AppState, index: number): HistoryEntry | null {
  if (Number.isNaN(index) || index < 0) {
    return null;
  }
  const entries = getEntriesSnapshot(state);
  return entries[index] || null;
}

function mapWorkerHistoryEntry(record: Record<string, any>): HistoryEntry {
  const entry: HistoryEntry = {
    id: record.id ?? record.historyId ?? record.rowid,
    ...record,
    items: Array.isArray(record.items) ? record.items : [],
  };
  if (!entry.savedAt && typeof record.createdAt === "string") {
    entry.savedAt = record.createdAt;
  }
  return entry;
}

async function loadHistoryEntries(
  section: HTMLElement,
  labels: AppState["fieldLabels"],
  { reset = false }: { reset?: boolean } = {}
): Promise<void> {
  if (dataMode !== "sqlite" || isLoadingHistory) {
    return;
  }

  isLoadingHistory = true;
  historyLoadError = null;
  updatePagerWidget(section);
  if (reset) {
    clearHistoryCache();
    selectedIndexes.clear();
    renderHistoryTable(section, getState());
    updateSelectionUI(section);
  }

  let shouldQueueNextFetch = false;
  try {
    const result = await listHistoryEntriesPaged({
      cursor: reset ? null : historyCursor,
      pageSize: HISTORY_PAGE_SIZE,
      sortDirection: "desc",
      includeItems: true,
      includeTotal: reset || historyTotalCount === 0,
    });
    const mapped = result.items.map((item) => mapWorkerHistoryEntry(item));
    historyEntries = reset ? mapped : [...historyEntries, ...mapped];
    historyCursor = result.nextCursor ?? null;
    historyHasMore = Boolean(result.hasMore);
    if (typeof result.totalCount === "number") {
      historyTotalCount = result.totalCount;
    } else if (!historyHasMore) {
      historyTotalCount = historyEntries.length;
    }
    if (reset) {
      historyPageIndex = 0;
      queuePageScroll(0, false);
    }
    const maxPageIndex = Math.max(getLoadedPageCount() - 1, 0);
    if (historyPendingAdvance !== "next") {
      historyPageIndex = Math.min(historyPageIndex, maxPageIndex);
    } else {
      const targetReady =
        historyPendingScrollIndex != null &&
        historyPendingScrollIndex < historyEntries.length;
      if (targetReady || !historyHasMore) {
        historyPendingAdvance = null;
        if (!historyHasMore && !targetReady) {
          historyPendingScrollIndex = null;
        }
      } else {
        shouldQueueNextFetch = true;
      }
    }
    renderHistoryTable(section, getState());
  } catch (error) {
    console.error("History konnte nicht geladen werden", error);
    historyLoadError = "Historie konnte nicht geladen werden.";
    window.alert(
      "Historie konnte nicht geladen werden. Bitte erneut versuchen."
    );
    historyPendingAdvance = null;
    historyPendingScrollIndex = null;
  } finally {
    isLoadingHistory = false;
    updatePagerWidget(section);
    if (historyNeedsRefresh) {
      historyNeedsRefresh = false;
      historyPendingAdvance = null;
      void loadHistoryEntries(section, labels, { reset: true });
      return;
    }
    if (shouldQueueNextFetch) {
      const latestLabels = getState().fieldLabels;
      void loadHistoryEntries(section, latestLabels);
      return;
    }
    historyPendingAdvance = null;
  }
}

function ensurePagerWidget(section: HTMLElement): PagerWidget | null {
  const target = section.querySelector<HTMLElement>(
    '[data-role="history-load-more"]'
  );
  if (!target) {
    return null;
  }
  if (!historyPagerWidget || historyPagerTarget !== target) {
    historyPagerWidget?.destroy();
    const widget = createPagerWidget(target, {
      onPrev: () => goToPrevPage(section),
      onNext: () => goToNextPage(section),
      labels: {
        prev: "Zurück",
        next: "Weiter",
        loading: "Lade Historie...",
        empty: "Keine Historien-Einträge",
      },
    });
    historyPagerWidget = widget;
    historyPagerTarget = target;
  }
  return historyPagerWidget;
}

function updatePagerWidget(section: HTMLElement): void {
  const widget = ensurePagerWidget(section);
  if (!widget) {
    return;
  }
  if (dataMode !== "sqlite") {
    widget.update({ status: "hidden" });
    return;
  }
  if (historyLoadError) {
    widget.update({ status: "error", message: historyLoadError });
    return;
  }

  const totalLoaded = historyEntries.length;
  const visibleCount = getVisibleEntriesCount();
  const pageOffset = getSqlitePageOffset();
  const totalKnown =
    historyTotalCount > 0 ? historyTotalCount : Math.max(totalLoaded, 0);

  const info = visibleCount
    ? `Einträge ${numberFormatter.format(pageOffset + 1)}–${numberFormatter.format(
        pageOffset + visibleCount
      )}${totalKnown ? ` von ${numberFormatter.format(totalKnown)}` : ""}`
    : totalLoaded === 0 && isLoadingHistory
      ? "Lade Historie..."
      : "Keine Einträge auf dieser Seite.";

  if (totalLoaded === 0 && !isLoadingHistory) {
    widget.update({ status: "disabled", info });
    return;
  }

  const loadedPages = getLoadedPageCount();
  const canPrev = historyPageIndex > 0 && !isLoadingHistory;
  const canNext =
    !isLoadingHistory && (historyPageIndex + 1 < loadedPages || historyHasMore);

  widget.update({
    status: "ready",
    info,
    canPrev,
    canNext,
    loadingDirection: isLoadingHistory ? historyPendingAdvance : null,
  });
}

function goToPrevPage(section: HTMLElement): void {
  if (
    dataMode !== "sqlite" ||
    historyPageIndex === 0 ||
    historyPendingAdvance === "next"
  ) {
    return;
  }
  const targetPage = Math.max(historyPageIndex - 1, 0);
  historyPageIndex = targetPage;
  const targetIndex = targetPage * HISTORY_PAGE_SIZE;
  queuePageScroll(targetIndex);
  updatePagerWidget(section);
}

function goToNextPage(section: HTMLElement): void {
  if (dataMode !== "sqlite") {
    return;
  }
  const targetPage = historyPageIndex + 1;
  const targetIndex = targetPage * HISTORY_PAGE_SIZE;
  if (targetIndex < historyEntries.length) {
    historyPageIndex = targetPage;
    queuePageScroll(targetIndex);
    updatePagerWidget(section);
    return;
  }
  if (isLoadingHistory) {
    historyPendingAdvance = "next";
    queuePageScroll(targetIndex, false);
    updatePagerWidget(section);
    return;
  }
  if (!historyHasMore) {
    return;
  }
  historyPendingAdvance = "next";
  queuePageScroll(targetIndex, false);
  updatePagerWidget(section);
  const labels = getState().fieldLabels;
  void loadHistoryEntries(section, labels);
}

const USE_VIRTUAL_SCROLLING = true;
const INITIAL_LOAD_LIMIT = 200;
const HISTORY_PAGE_SIZE = 50;
const numberFormatter = new Intl.NumberFormat("de-DE");

type DataMode = "sqlite" | "memory";

let dataMode: DataMode = "memory";
let historyEntries: HistoryEntry[] = [];
let historyCursor: HistoryCursor | null = null;
let historyHasMore = false;
let historyTotalCount = 0;
let isLoadingHistory = false;
let historyNeedsRefresh = false;
let historyLoadError: string | null = null;
let historyPageIndex = 0;
let historyPendingAdvance: "next" | null = null;
let historyPagerWidget: PagerWidget | null = null;
let historyPagerTarget: HTMLElement | null = null;
let historyPendingScrollIndex: number | null = null;
let historyPendingScrollFrame: number | null = null;

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
        <div data-role="history-load-more" class="mt-3"></div>
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
  section: HTMLElement,
  state: AppState,
  listContainer: HTMLElement,
  labels: AppState["fieldLabels"]
): void {
  const entries = getEntriesSnapshot(state);
  const resolvedLabels = labels || getState().fieldLabels;

  for (const idx of Array.from(selectedIndexes)) {
    if (!entries[idx]) {
      selectedIndexes.delete(idx);
    }
  }

  const isSqliteMode = dataMode === "sqlite";
  const shouldVirtualize =
    isSqliteMode ||
    (USE_VIRTUAL_SCROLLING && entries.length > INITIAL_LOAD_LIMIT);

  if (shouldVirtualize) {
    const estimatedItemHeight = 250;
    const lazyThreshold = isSqliteMode
      ? Math.max(10, Math.floor(HISTORY_PAGE_SIZE / 2))
      : undefined;
    const renderVirtualItem = (node: HTMLElement, index: number) => {
      const currentState = getState();
      const entry = getEntryByIndex(currentState, index);
      if (!entry) {
        node.innerHTML = "";
        return;
      }
      const latestLabels = currentState.fieldLabels || resolvedLabels;
      const selected = selectedIndexes.has(index);
      node.innerHTML = renderCalculationSnapshot(entry, latestLabels, {
        showActions: true,
        includeCheckbox: true,
        index,
        selected,
        enableGpsActions: true,
      });
    };

    const onRangeChange = (start: number, _end: number) => {
      if (!isSqliteMode) {
        return;
      }
      const nextPage = Math.max(Math.floor(start / HISTORY_PAGE_SIZE), 0);
      if (nextPage !== historyPageIndex) {
        historyPageIndex = nextPage;
        updatePagerWidget(section);
      }
    };

    const onRequestMore = isSqliteMode
      ? () => {
          if (!historyHasMore || isLoadingHistory) {
            return;
          }
          const latestLabels = getState().fieldLabels;
          return loadHistoryEntries(section, latestLabels);
        }
      : undefined;

    const canRequestMore = isSqliteMode ? () => historyHasMore : undefined;
    const isRequestPending = isSqliteMode ? () => isLoadingHistory : undefined;

    if (!virtualListInstance) {
      listContainer.innerHTML = "";
      virtualListInstance = initVirtualList(listContainer, {
        itemCount: entries.length,
        estimatedItemHeight,
        overscan: 6,
        renderItem: renderVirtualItem,
        lazyLoadThreshold: lazyThreshold,
        onRangeChange,
        onRequestMore,
        canRequestMore,
        isRequestPending,
      });
    } else {
      virtualListInstance.updateItemCount(entries.length);
    }

    flushPendingVirtualScroll();
    return;
  }

  if (virtualListInstance) {
    virtualListInstance.destroy();
    virtualListInstance = null;
    listContainer.innerHTML = "";
    if (historyPendingScrollFrame && typeof window !== "undefined") {
      window.cancelAnimationFrame(historyPendingScrollFrame);
      historyPendingScrollFrame = null;
    }
    historyPendingScrollIndex = null;
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
    loadMoreBtn.textContent = `Mehr laden (${entries.length - limit} weitere)`;
    loadMoreBtn.dataset.action = "load-more";
    loadMoreBtn.dataset.currentLimit = String(limit);
    listContainer.appendChild(loadMoreBtn);
  }
}

function renderHistoryTable(section: HTMLElement, state: AppState): void {
  const listContainer = section.querySelector<HTMLElement>(
    '[data-role="history-list"]'
  );
  if (!listContainer) {
    return;
  }
  renderCardsList(section, state, listContainer, state.fieldLabels);
  updatePagerWidget(section);
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

    services.events.subscribe("history:data-changed", () => {
      if (dataMode !== "sqlite") {
        return;
      }
      historyNeedsRefresh = true;
      const isHidden = section.classList.contains("d-none");
      if (isHidden || isLoadingHistory) {
        return;
      }
      historyNeedsRefresh = false;
      void loadHistoryEntries(section, getState().fieldLabels, {
        reset: true,
      });
    });
  }

  const handleStateChange = (nextState: AppState) => {
    const nextMode: DataMode = shouldUseSqlite(nextState) ? "sqlite" : "memory";
    if (nextMode !== dataMode) {
      dataMode = nextMode;
      selectedIndexes.clear();
      updateSelectionUI(section);
      clearHistoryCache();
      historyNeedsRefresh = false;
      if (dataMode === "sqlite") {
        void loadHistoryEntries(section, nextState.fieldLabels, {
          reset: true,
        });
      }
    } else if (
      dataMode === "sqlite" &&
      !isLoadingHistory &&
      historyEntries.length === 0 &&
      nextState.app?.hasDatabase
    ) {
      void loadHistoryEntries(section, nextState.fieldLabels, { reset: true });
    }
    toggleSectionAvailability(section, nextState);

    if (
      dataMode === "sqlite" &&
      historyNeedsRefresh &&
      !isLoadingHistory &&
      !section.classList.contains("d-none")
    ) {
      historyNeedsRefresh = false;
      void loadHistoryEntries(section, nextState.fieldLabels, { reset: true });
    }

    renderHistoryTable(section, nextState);
    const detailCard = section.querySelector<HTMLElement>("#history-detail");
    if (detailCard && !detailCard.classList.contains("d-none")) {
      const detailIndex = Number(detailCard.dataset.index);
      if (!Number.isNaN(detailIndex)) {
        const entry = getEntryByIndex(nextState, detailIndex);
        if (entry) {
          renderDetail(entry, section, detailIndex, nextState.fieldLabels);
        } else {
          renderDetail(null, section, null, nextState.fieldLabels);
        }
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
    const state = services.state.getState();

    if (action === "detail-print") {
      const detailCard = target.closest<HTMLElement>("#history-detail");
      const indexAttr = detailCard?.dataset.index;
      const index =
        typeof indexAttr === "string" && indexAttr !== ""
          ? Number(indexAttr)
          : NaN;
      const entry = Number.isInteger(index)
        ? getEntryByIndex(state, index)
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
      const entry = getEntryByIndex(state, index);
      emitGpsActivationRequest(services, entry ?? null);
      return;
    }

    if (action === "print-selected") {
      const entries = Array.from(selectedIndexes)
        .sort((a, b) => a - b)
        .map((idx) => getEntryByIndex(state, idx))
        .filter((entry): entry is HistoryEntry => Boolean(entry));
      void printSummary(entries, state.fieldLabels);
      return;
    }

    if (action === "load-more") {
      const btn = target as HTMLButtonElement;
      const currentLimit = parseInt(btn.dataset.currentLimit ?? "0", 10);
      const entries = getEntriesSnapshot(state);
      const newLimit = Math.min(
        entries.length,
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

      btn.remove();
      listContainer.appendChild(fragment);

      if (newLimit < entries.length) {
        const newBtn = document.createElement("button");
        newBtn.className = "btn btn-secondary w-100 mt-3";
        newBtn.textContent = `Mehr laden (${
          entries.length - newLimit
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

    const entry = getEntryByIndex(state, index);
    if (!entry) {
      return;
    }

    if (action === "view") {
      renderDetail(entry, section, index, state.fieldLabels);
    } else if (action === "delete") {
      if (!window.confirm("Wirklich löschen?")) {
        return;
      }
      if (dataMode === "sqlite") {
        const rawId = entry.id;
        const entryId =
          typeof rawId === "string"
            ? Number(rawId)
            : (rawId as number | undefined);
        if (entryId == null || Number.isNaN(entryId)) {
          window.alert("Eintrag kann nicht gelöscht werden (fehlende ID).");
          return;
        }
        void (async () => {
          try {
            await deleteHistoryEntryById(entryId);
            await persistSqliteDatabaseFile().catch(() => undefined);
            selectedIndexes.clear();
            updateSelectionUI(section);
            renderDetail(null, section, null, state.fieldLabels);
            await loadHistoryEntries(section, state.fieldLabels, {
              reset: true,
            });
            services.events?.emit?.("history:data-changed", {
              type: "deleted",
              id: entryId,
            });
          } catch (error) {
            console.error("SQLite history delete failed", error);
            window.alert(
              "Eintrag konnte nicht gelöscht werden. Bitte erneut versuchen."
            );
          }
        })();
      } else {
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
        services.events?.emit?.("history:data-changed", {
          type: "deleted",
          id: entry?.id ?? null,
        });
      }
    } else if (action === "activate-gps") {
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
