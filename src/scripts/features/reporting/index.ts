import {
  extractSliceItems,
  getState,
  subscribeState,
  type AppState,
} from "@scripts/core/state";
import {
  registerAutoRefreshPolicy,
  type AutoRefreshStatus,
} from "@scripts/core/autoRefresh";
import { renderCalculationSnapshot } from "@scripts/features/shared/calculationSnapshot";
import { initVirtualList } from "@scripts/core/virtualList";
import { escapeHtml, parseIsoDate } from "@scripts/core/utils";
import { printEntriesChunked } from "@scripts/features/shared/printing";
import { getActiveDriverKey } from "@scripts/core/storage";
import {
  listHistoryEntriesPaged,
  exportHistoryRange,
  type HistoryCursor,
  type HistoryQueryFilters,
} from "@scripts/core/storage/sqlite";
import type { CalculationItem } from "@scripts/features/calculation";
import {
  createPagerWidget,
  type PagerWidget,
} from "@scripts/features/shared/pagerWidget";
import {
  createDebugOverlayBinding,
  pushDebugOverlayMetrics,
  estimatePayloadKb as estimateOverlayPayloadKb,
} from "@scripts/dev/debugOverlayClient";

interface Services {
  state: {
    getState: typeof getState;
    subscribe: typeof subscribeState;
  };
  events?: {
    subscribe?: (
      eventName: string,
      handler: (payload: unknown) => void
    ) => (() => void) | void;
  };
}

type DateFilter = {
  start: Date;
  end: Date;
  startLabel: string;
  endLabel: string;
};

type ReportingEntry = {
  datum?: string;
  date?: string;
  dateIso?: string | null;
  ersteller?: string;
  standort?: string;
  kultur?: string;
  kisten?: number;
  items?: CalculationItem[];
  [key: string]: unknown;
};

const USE_VIRTUAL_SCROLLING = true;
const INITIAL_LOAD_LIMIT = 200;
const REPORT_PAGE_SIZE = 50;
const numberFormatter = new Intl.NumberFormat("de-DE");

type DataMode = "memory" | "sqlite";

let initialized = false;
let currentEntries: ReportingEntry[] = [];
let activeFilter: DateFilter | null = null;
let virtualListInstance: ReturnType<typeof initVirtualList> | null = null;
let dataMode: DataMode = "memory";
let reportEntries: ReportingEntry[] = [];
let reportCursor: HistoryCursor | null = null;
let reportHasMore = false;
let reportTotalCount = 0;
let isLoadingReport = false;
let reportFilters: HistoryQueryFilters | null = null;
let pendingReportReload: {
  section: HTMLElement;
  labels: AppState["fieldLabels"];
} | null = null;
let reportLoadError: string | null = null;
let reportPageIndex = 0;
let reportPendingAdvance: "next" | null = null;
let reportPagerWidget: PagerWidget | null = null;
let reportPagerTarget: HTMLElement | null = null;
let reportPendingScrollIndex: number | null = null;
let reportPendingScrollFrame: number | null = null;
let reportAutoRefreshCleanup: (() => void) | null = null;
const reportingOverlayBinding = createDebugOverlayBinding({
  id: "reporting",
  label: "Reporting",
  budget: { initialLoad: 25, maxItems: 100 },
});
let reportingLastUpdatedAt: string | null = null;

function createSection(): HTMLElement {
  const section = document.createElement("div");
  section.className = "section-inner";
  section.innerHTML = `
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
        <div class="alert alert-warning py-2 px-3 small d-none" data-role="report-refresh-indicator">
          Neue Daten verfügbar. Ansicht wird beim Öffnen aktualisiert.
        </div>
        <div data-role="report-list" class="report-list"></div>
        <div data-role="report-load-more" class="mt-3"></div>
      </div>
    </div>
  `;
  return section;
}

function parseDate(value: FormDataEntryValue | null): Date | null {
  if (typeof value !== "string" || !value) {
    return null;
  }
  const parts = value.split("-");
  if (parts.length !== 3) {
    return null;
  }
  const [year, month, day] = parts.map(Number);
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
    return null;
  }
  return new Date(year, month - 1, day);
}

function germanDateToIso(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const parts = value.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const [day, month, year] = parts.map(Number);
  if (Number.isNaN(day) || Number.isNaN(month) || Number.isNaN(year)) {
    return null;
  }
  return new Date(year, month - 1, day);
}

function normalizeEntryDate(entry: ReportingEntry | null): Date | null {
  if (!entry) {
    return null;
  }
  if (entry.dateIso) {
    const parsed = parseIsoDate(entry.dateIso);
    if (parsed) {
      return new Date(
        parsed.getFullYear(),
        parsed.getMonth(),
        parsed.getDate()
      );
    }
  }
  const fallbackSource =
    (typeof entry.datum === "string" && entry.datum) ||
    (typeof entry.date === "string" && entry.date) ||
    null;
  return germanDateToIso(fallbackSource);
}

function resolveReportingLabels(labels: AppState["fieldLabels"]): any {
  const resolvedLabels = labels || getState().fieldLabels;
  return resolvedLabels?.reporting || {};
}

function describeFilter(
  entryCount: number,
  labels: AppState["fieldLabels"]
): string {
  const reportingLabels = resolveReportingLabels(labels);
  const infoEmpty = reportingLabels.infoEmpty || "Keine Einträge";
  const infoAll = reportingLabels.infoAll || "Alle Einträge";
  const infoPrefix = reportingLabels.infoPrefix || "Auswahl";

  if (!activeFilter) {
    if (!entryCount) {
      return infoEmpty;
    }
    return `${infoAll} (${entryCount})`;
  }

  const prefix = `${infoPrefix} ${activeFilter.startLabel} – ${activeFilter.endLabel}`;
  if (!entryCount) {
    return `${prefix} (${infoEmpty})`;
  }
  return `${prefix} (${entryCount})`;
}

function updateReportRefreshIndicator(
  section: HTMLElement,
  status: AutoRefreshStatus
): void {
  const indicator = section.querySelector<HTMLElement>(
    '[data-role="report-refresh-indicator"]'
  );
  if (!indicator) {
    return;
  }
  indicator.classList.remove("alert-info", "alert-warning");
  if (status === "idle") {
    indicator.classList.add("d-none");
    return;
  }
  indicator.classList.remove("d-none");
  if (status === "stale") {
    indicator.classList.add("alert-warning");
    indicator.textContent =
      "Neue Daten verfügbar. Ansicht wird beim Öffnen aktualisiert.";
  } else {
    indicator.classList.add("alert-info");
    indicator.textContent = "Aktualisiere Auswertung...";
  }
}

function resolveStorageDriver(state: AppState): string {
  return state.app?.storageDriver || getActiveDriverKey();
}

function shouldUseSqlite(state: AppState): boolean {
  return (
    resolveStorageDriver(state) === "sqlite" && Boolean(state.app?.hasDatabase)
  );
}

function clearReportCache(): void {
  reportEntries = [];
  reportCursor = null;
  reportHasMore = false;
  reportTotalCount = 0;
  currentEntries = [];
  reportLoadError = null;
  reportPageIndex = 0;
  reportPendingAdvance = null;
  reportPendingScrollIndex = null;
  if (reportPendingScrollFrame && typeof window !== "undefined") {
    window.cancelAnimationFrame(reportPendingScrollFrame);
    reportPendingScrollFrame = null;
  }
}

function queueReportScroll(targetIndex: number, immediate = true): void {
  reportPendingScrollIndex = Math.max(0, targetIndex);
  if (immediate) {
    flushPendingReportScroll();
  }
}

function flushPendingReportScroll(): void {
  if (
    reportPendingScrollIndex == null ||
    typeof window === "undefined" ||
    !virtualListInstance
  ) {
    return;
  }
  const targetIndex = reportPendingScrollIndex;
  reportPendingScrollIndex = null;
  if (reportPendingScrollFrame) {
    window.cancelAnimationFrame(reportPendingScrollFrame);
    reportPendingScrollFrame = null;
  }
  reportPendingScrollFrame = window.requestAnimationFrame(() => {
    reportPendingScrollFrame = null;
    if (!virtualListInstance) {
      reportPendingScrollIndex = targetIndex;
      return;
    }
    virtualListInstance.scrollToIndex(targetIndex);
  });
}

function getLoadedPageCount(): number {
  if (dataMode !== "sqlite" || reportEntries.length === 0) {
    return reportEntries.length ? 1 : 0;
  }
  return Math.max(Math.ceil(reportEntries.length / REPORT_PAGE_SIZE), 1);
}

function getSqlitePageOffset(): number {
  if (dataMode !== "sqlite") {
    return 0;
  }
  const maxPage = Math.max(getLoadedPageCount() - 1, 0);
  const safeIndex = Math.min(Math.max(reportPageIndex, 0), maxPage);
  return safeIndex * REPORT_PAGE_SIZE;
}

function getVisibleEntriesCount(): number {
  if (dataMode !== "sqlite") {
    return currentEntries.length;
  }
  const start = getSqlitePageOffset();
  return Math.max(Math.min(reportEntries.length - start, REPORT_PAGE_SIZE), 0);
}

function getEntryByIndex(index: number): ReportingEntry | null {
  if (Number.isNaN(index) || index < 0) {
    return null;
  }
  if (dataMode === "sqlite") {
    return reportEntries[index] || null;
  }
  const entries = currentEntries;
  return entries[index] || null;
}

function getReportingTotalEstimate(): number | null {
  if (dataMode === "sqlite") {
    if (reportTotalCount > 0) {
      return reportTotalCount;
    }
    const derived = reportPageIndex * REPORT_PAGE_SIZE + reportEntries.length;
    return derived || null;
  }
  return currentEntries.length;
}

function buildReportingOverlayNote(): string | undefined {
  const notes: string[] = [];
  if (isLoadingReport) {
    notes.push("Lädt …");
  }
  if (reportLoadError) {
    notes.push("Fehler");
  }
  if (dataMode === "sqlite" && reportHasMore) {
    notes.push("Weitere Seiten verfügbar");
  }
  if (!notes.length) {
    return undefined;
  }
  return notes.join(" · ");
}

function publishReportingOverlayMetrics(): void {
  const buffer = dataMode === "sqlite" ? reportEntries : currentEntries;
  const metrics = {
    items: buffer.length,
    totalCount: getReportingTotalEstimate(),
    cursor: dataMode === "sqlite" ? `Seite ${reportPageIndex + 1}` : null,
    payloadKb: estimateOverlayPayloadKb(buffer.slice(0, REPORT_PAGE_SIZE)),
    lastUpdated: reportingLastUpdatedAt,
    note: buildReportingOverlayNote(),
  };
  pushDebugOverlayMetrics(reportingOverlayBinding, metrics);
}

function toDateBoundaryIso(
  date: Date | null,
  boundary: "start" | "end"
): string | null {
  if (!date || Number.isNaN(date.getTime())) {
    return null;
  }
  const clone = new Date(date.getTime());
  if (boundary === "start") {
    clone.setHours(0, 0, 0, 0);
  } else {
    clone.setHours(23, 59, 59, 999);
  }
  return clone.toISOString();
}

function buildHistoryFiltersFromDateFilter(
  filter: DateFilter | null
): HistoryQueryFilters | null {
  if (!filter) {
    return null;
  }
  const startIso = toDateBoundaryIso(filter.start ?? null, "start");
  const endIso = toDateBoundaryIso(filter.end ?? null, "end");
  const result: HistoryQueryFilters = {};
  if (startIso) {
    result.startDate = startIso;
  }
  if (endIso) {
    result.endDate = endIso;
  }
  return Object.keys(result).length ? result : null;
}

async function loadReportEntries(
  section: HTMLElement,
  labels: AppState["fieldLabels"],
  { reset = false }: { reset?: boolean } = {}
): Promise<void> {
  if (dataMode !== "sqlite") {
    return;
  }
  if (isLoadingReport) {
    if (reset) {
      pendingReportReload = { section, labels };
    }
    return;
  }

  pendingReportReload = null;

  isLoadingReport = true;
  reportLoadError = null;
  updatePagerWidget(section);
  if (reset) {
    clearReportCache();
    currentEntries = [];
    renderTable(section, [], labels);
  }

  const filters = reportFilters || undefined;
  let shouldQueueNextFetch = false;

  try {
    const result = await listHistoryEntriesPaged({
      cursor: reset ? null : reportCursor,
      pageSize: REPORT_PAGE_SIZE,
      sortDirection: "desc",
      includeItems: true,
      includeTotal: reset || reportTotalCount === 0,
      filters,
    });

    const mapped = result.items.map((item) => ({
      ...item,
      items: Array.isArray(item.items) ? item.items : [],
    }));

    reportEntries = reset ? mapped : [...reportEntries, ...mapped];
    reportCursor = result.nextCursor ?? null;
    reportHasMore = Boolean(result.hasMore);
    if (typeof result.totalCount === "number") {
      reportTotalCount = result.totalCount;
    } else if (!reportHasMore) {
      reportTotalCount = reportEntries.length;
    }

    if (reset) {
      reportPageIndex = 0;
      queueReportScroll(0, false);
    }
    const maxPageIndex = Math.max(getLoadedPageCount() - 1, 0);
    if (reportPendingAdvance !== "next") {
      reportPageIndex = Math.min(reportPageIndex, maxPageIndex);
    } else {
      const targetReady =
        reportPendingScrollIndex != null &&
        reportPendingScrollIndex < reportEntries.length;
      if (targetReady || !reportHasMore) {
        reportPendingAdvance = null;
        if (!reportHasMore && !targetReady) {
          reportPendingScrollIndex = null;
        }
      } else {
        shouldQueueNextFetch = true;
      }
    }
    renderTable(section, reportEntries, labels);
  } catch (error) {
    console.error("Auswertung konnte nicht geladen werden", error);
    reportLoadError =
      "Auswertung konnte nicht geladen werden. Bitte erneut versuchen.";
    window.alert(reportLoadError);
    reportPendingAdvance = null;
    reportPendingScrollIndex = null;
  } finally {
    isLoadingReport = false;
    updatePagerWidget(section);
    if (pendingReportReload) {
      const { section: queuedSection, labels: queuedLabels } =
        pendingReportReload;
      pendingReportReload = null;
      void loadReportEntries(queuedSection, queuedLabels, { reset: true });
      return;
    }
    if (shouldQueueNextFetch) {
      const latestLabels = getState().fieldLabels;
      void loadReportEntries(section, latestLabels);
      return;
    }
    reportPendingAdvance = null;
  }
}

function ensurePagerWidget(section: HTMLElement): PagerWidget | null {
  const target = section.querySelector<HTMLElement>(
    '[data-role="report-load-more"]'
  );
  if (!target) {
    return null;
  }
  if (!reportPagerWidget || reportPagerTarget !== target) {
    reportPagerWidget?.destroy();
    const widget = createPagerWidget(target, {
      onPrev: () => goToPrevPage(section),
      onNext: () => goToNextPage(section),
      labels: {
        prev: "Zurück",
        next: "Weiter",
        loading: "Lade Auswertung...",
        empty: "Keine Einträge",
      },
    });
    reportPagerWidget = widget;
    reportPagerTarget = target;
  }
  return reportPagerWidget;
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
  if (reportLoadError) {
    widget.update({ status: "error", message: reportLoadError });
    return;
  }

  const totalLoaded = reportEntries.length;
  const visibleCount = getVisibleEntriesCount();
  const pageOffset = getSqlitePageOffset();
  const totalKnown =
    reportTotalCount > 0 ? reportTotalCount : Math.max(totalLoaded, 0);

  const info = visibleCount
    ? `Einträge ${numberFormatter.format(pageOffset + 1)}–${numberFormatter.format(
        pageOffset + visibleCount
      )}${totalKnown ? ` von ${numberFormatter.format(totalKnown)}` : ""}`
    : totalLoaded === 0 && isLoadingReport
      ? "Lade Auswertung..."
      : "Keine Einträge auf dieser Seite.";

  if (totalLoaded === 0 && !isLoadingReport) {
    widget.update({ status: "disabled", info });
    return;
  }

  const loadedPages = getLoadedPageCount();
  const canPrev = reportPageIndex > 0 && !isLoadingReport;
  const canNext =
    !isLoadingReport && (reportPageIndex + 1 < loadedPages || reportHasMore);

  widget.update({
    status: "ready",
    info,
    canPrev,
    canNext,
    loadingDirection: isLoadingReport ? reportPendingAdvance : null,
  });
}

function goToPrevPage(section: HTMLElement): void {
  if (dataMode !== "sqlite" || reportPageIndex === 0) {
    return;
  }
  const targetPage = Math.max(reportPageIndex - 1, 0);
  reportPageIndex = targetPage;
  const targetIndex = targetPage * REPORT_PAGE_SIZE;
  queueReportScroll(targetIndex);
  updatePagerWidget(section);
}

function goToNextPage(section: HTMLElement): void {
  if (dataMode !== "sqlite") {
    return;
  }
  const targetPage = reportPageIndex + 1;
  const targetIndex = targetPage * REPORT_PAGE_SIZE;
  if (targetIndex < reportEntries.length) {
    reportPageIndex = targetPage;
    queueReportScroll(targetIndex);
    updatePagerWidget(section);
    return;
  }
  if (isLoadingReport) {
    reportPendingAdvance = "next";
    queueReportScroll(targetIndex, false);
    updatePagerWidget(section);
    return;
  }
  if (!reportHasMore) {
    return;
  }
  reportPendingAdvance = "next";
  queueReportScroll(targetIndex, false);
  updatePagerWidget(section);
  const labels = getState().fieldLabels;
  void loadReportEntries(section, labels);
}

function renderCardsList(
  section: HTMLElement,
  listContainer: HTMLElement,
  labels: AppState["fieldLabels"]
): void {
  const resolvedLabels = labels || getState().fieldLabels;
  const entries = dataMode === "sqlite" ? reportEntries : currentEntries;

  const isSqliteMode = dataMode === "sqlite";
  const shouldVirtualize =
    isSqliteMode ||
    (USE_VIRTUAL_SCROLLING && entries.length > INITIAL_LOAD_LIMIT);

  if (shouldVirtualize) {
    const estimatedItemHeight = 200;
    const lazyThreshold = isSqliteMode
      ? Math.max(10, Math.floor(REPORT_PAGE_SIZE / 2))
      : undefined;

    const renderVirtualItem = (node: HTMLElement, index: number) => {
      const entry = getEntryByIndex(index);
      if (!entry) {
        node.innerHTML = "";
        return;
      }
      node.innerHTML = renderCalculationSnapshot(entry, resolvedLabels, {
        showActions: false,
        includeCheckbox: false,
      });
    };

    const onRangeChange = (start: number, _end: number) => {
      if (!isSqliteMode) {
        return;
      }
      const nextPage = Math.max(Math.floor(start / REPORT_PAGE_SIZE), 0);
      if (nextPage !== reportPageIndex) {
        reportPageIndex = nextPage;
        updatePagerWidget(section);
      }
    };

    const onRequestMore = isSqliteMode
      ? () => {
          if (!reportHasMore || isLoadingReport) {
            return;
          }
          const latestLabels = getState().fieldLabels;
          return loadReportEntries(section, latestLabels);
        }
      : undefined;

    const canRequestMore = isSqliteMode ? () => reportHasMore : undefined;
    const isRequestPending = isSqliteMode ? () => isLoadingReport : undefined;

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

    flushPendingReportScroll();
    return;
  }

  if (virtualListInstance) {
    virtualListInstance.destroy();
    virtualListInstance = null;
    listContainer.innerHTML = "";
    if (reportPendingScrollFrame && typeof window !== "undefined") {
      window.cancelAnimationFrame(reportPendingScrollFrame);
      reportPendingScrollFrame = null;
    }
    reportPendingScrollIndex = null;
  }

  const limit = Math.min(entries.length, INITIAL_LOAD_LIMIT);
  const fragment = document.createDocumentFragment();

  for (let i = 0; i < limit; i += 1) {
    const entry = entries[i];
    const cardHtml = renderCalculationSnapshot(entry, resolvedLabels, {
      showActions: false,
      includeCheckbox: false,
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

function renderTable(
  section: HTMLElement,
  entries: ReportingEntry[],
  labels: AppState["fieldLabels"]
): void {
  currentEntries = entries.slice();

  const listContainer = section.querySelector<HTMLElement>(
    '[data-role="report-list"]'
  );
  if (listContainer) {
    renderCardsList(section, listContainer, labels);
  }

  updatePagerWidget(section);

  const info = section.querySelector<HTMLElement>('[data-role="report-info"]');
  if (info) {
    info.textContent = describeFilter(entries.length, labels);
  }

  const printButton = section.querySelector<HTMLButtonElement>(
    '[data-action="print-report"]'
  );
  if (printButton) {
    printButton.disabled = entries.length === 0;
  }

  reportingLastUpdatedAt = new Date().toISOString();
  publishReportingOverlayMetrics();
}

function applyFilter(
  section: HTMLElement,
  state: AppState,
  filter: DateFilter | null
): void {
  const source = extractSliceItems<ReportingEntry>(state.history);
  if (!filter) {
    renderTable(section, source, state.fieldLabels);
    return;
  }

  const filtered = source.filter((entry) => {
    const normalizedDate = normalizeEntryDate(entry);
    if (!normalizedDate) {
      return false;
    }
    return normalizedDate >= filter.start && normalizedDate <= filter.end;
  });

  renderTable(section, filtered, state.fieldLabels);
}

function toggleSection(section: HTMLElement, state: AppState): boolean {
  const ready = Boolean(state.app?.hasDatabase);
  const active = ready && state.app?.activeSection === "report";
  section.classList.toggle("d-none", !(ready && active));
  return active;
}

function buildCompanyHeader(company: AppState["company"]): string {
  const hasContent = Boolean(
    company?.name ||
      company?.headline ||
      company?.address ||
      company?.contactEmail
  );
  if (!hasContent) {
    return "";
  }
  const address = company?.address
    ? escapeHtml(company.address).replace(/\n/g, "<br />")
    : "";
  const email = company?.contactEmail
    ? `<p>${escapeHtml(company.contactEmail)}</p>`
    : "";
  return `
    <div class="print-meta">
      ${company?.name ? `<h1>${escapeHtml(company.name)}</h1>` : ""}
      ${company?.headline ? `<p>${escapeHtml(company.headline)}</p>` : ""}
      ${address ? `<p>${address}</p>` : ""}
      ${email}
    </div>
  `;
}

function buildFilterInfo(
  filter: DateFilter | null,
  labels: AppState["fieldLabels"]
): string {
  const reportingLabels = resolveReportingLabels(labels);
  const prefix = escapeHtml(reportingLabels.infoPrefix || "Auswahl");
  if (!filter) {
    const infoAll = escapeHtml(reportingLabels.infoAll || "Alle Einträge");
    return `<p>${prefix}: ${infoAll}</p>`;
  }
  return `<p>${prefix}: ${escapeHtml(filter.startLabel)} – ${escapeHtml(
    filter.endLabel
  )}</p>`;
}

async function printReport(
  entries: ReportingEntry[],
  filter: DateFilter | null,
  labels: AppState["fieldLabels"]
): Promise<void> {
  if (dataMode !== "sqlite" && !entries.length) {
    window.alert("Keine Daten für den Druck vorhanden.");
    return;
  }
  let entriesToPrint = entries;
  if (dataMode === "sqlite") {
    try {
      const exportResult = await exportHistoryRange({
        filters: buildHistoryFiltersFromDateFilter(filter) || undefined,
        sortDirection: "asc",
      });
      entriesToPrint = exportResult.entries as ReportingEntry[];
    } catch (error) {
      console.error("Bericht konnte nicht exportiert werden", error);
      window.alert(
        "Bericht konnte nicht für den Druck vorbereitet werden. Bitte erneut versuchen."
      );
      return;
    }
    if (!entriesToPrint.length) {
      window.alert("Keine Daten für den Druck vorhanden.");
      return;
    }
  }
  const resolvedLabels = labels || getState().fieldLabels;
  const reportingLabels = resolveReportingLabels(resolvedLabels);
  const company = getState().company || {};
  const headerHtml =
    buildCompanyHeader(company) + buildFilterInfo(filter, resolvedLabels);
  try {
    await printEntriesChunked(entriesToPrint, resolvedLabels, {
      title: reportingLabels.printTitle || "Bericht",
      headerHtml,
      chunkSize: 50,
    });
  } catch (err) {
    console.error("Printing failed", err);
    window.alert("Fehler beim Drucken. Bitte erneut versuchen.");
  }
}

export function initReporting(
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

  reportAutoRefreshCleanup?.();
  reportAutoRefreshCleanup = registerAutoRefreshPolicy({
    section: "report",
    event: "history:data-changed",
    shouldHandleEvent: () => dataMode === "sqlite",
    shouldRefresh: () => dataMode === "sqlite",
    onRefresh: () => {
      reportFilters = buildHistoryFiltersFromDateFilter(activeFilter);
      return loadReportEntries(section, services.state.getState().fieldLabels, {
        reset: true,
      });
    },
    onStatusChange: (status) => updateReportRefreshIndicator(section, status),
  });

  const filterForm = section.querySelector<HTMLFormElement>("#report-filter");
  filterForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(filterForm);
    const start = parseDate(formData.get("report-start"));
    const end = parseDate(formData.get("report-end"));
    if (!start || !end) {
      window.alert("Bitte gültige Daten auswählen!");
      return;
    }
    if (start > end) {
      window.alert("Das Startdatum muss vor dem Enddatum liegen.");
      return;
    }
    activeFilter = {
      start,
      end,
      startLabel: new Intl.DateTimeFormat("de-DE").format(start),
      endLabel: new Intl.DateTimeFormat("de-DE").format(end),
    };
    const state = services.state.getState();
    if (dataMode === "sqlite") {
      reportFilters = buildHistoryFiltersFromDateFilter(activeFilter);
      if (isLoadingReport) {
        pendingReportReload = { section, labels: state.fieldLabels };
      } else {
        void loadReportEntries(section, state.fieldLabels, { reset: true });
      }
    } else {
      applyFilter(section, state, activeFilter);
    }
  });

  const handleStateChange = (nextState: AppState) => {
    const active = toggleSection(section, nextState);
    const nextMode: DataMode = shouldUseSqlite(nextState) ? "sqlite" : "memory";
    const modeChanged = nextMode !== dataMode;

    if (modeChanged) {
      dataMode = nextMode;
      clearReportCache();
      if (dataMode === "sqlite") {
        reportFilters = buildHistoryFiltersFromDateFilter(activeFilter);
      } else {
        reportFilters = null;
      }
    }

    if (!active) {
      return;
    }

    if (dataMode === "sqlite") {
      if (modeChanged || (!reportEntries.length && !isLoadingReport)) {
        reportFilters = buildHistoryFiltersFromDateFilter(activeFilter);
        void loadReportEntries(section, nextState.fieldLabels, { reset: true });
      } else {
        renderTable(section, reportEntries, nextState.fieldLabels);
      }
    } else {
      applyFilter(section, nextState, activeFilter);
    }
  };

  services.state.subscribe(handleStateChange);
  handleStateChange(services.state.getState());

  section.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }

    if (target.dataset.action === "load-more") {
      if (dataMode === "sqlite") {
        return;
      }
      const btn = target as HTMLButtonElement;
      const currentLimit = parseInt(btn.dataset.currentLimit || "0", 10);
      const listContainer = section.querySelector<HTMLElement>(
        '[data-role="report-list"]'
      );
      if (!listContainer) {
        return;
      }
      const newLimit = Math.min(
        currentEntries.length,
        currentLimit + INITIAL_LOAD_LIMIT
      );
      const labels = services.state.getState().fieldLabels;
      const fragment = document.createDocumentFragment();

      for (let i = currentLimit; i < newLimit; i += 1) {
        const entry = currentEntries[i];
        const cardHtml = renderCalculationSnapshot(entry, labels, {
          showActions: false,
          includeCheckbox: false,
        });
        const wrapper = document.createElement("div");
        wrapper.innerHTML = cardHtml;
        if (wrapper.firstElementChild) {
          fragment.appendChild(wrapper.firstElementChild);
        }
      }

      btn.remove();
      listContainer.appendChild(fragment);

      if (newLimit < currentEntries.length) {
        const newBtn = document.createElement("button");
        newBtn.className = "btn btn-secondary w-100 mt-3";
        newBtn.textContent = `Mehr laden (${
          currentEntries.length - newLimit
        } weitere)`;
        newBtn.dataset.action = "load-more";
        newBtn.dataset.currentLimit = String(newLimit);
        listContainer.appendChild(newBtn);
      }
      return;
    }

    const printTrigger = target.closest<HTMLButtonElement>(
      '[data-action="print-report"]'
    );
    if (printTrigger) {
      void printReport(
        currentEntries,
        activeFilter,
        services.state.getState().fieldLabels
      );
    }
  });

  initialized = true;
}
