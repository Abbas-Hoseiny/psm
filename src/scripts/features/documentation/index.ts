import {
  getState,
  subscribeState,
  updateSlice,
  type AppState,
} from "@scripts/core/state";
import { getDatabaseSnapshot } from "@scripts/core/database";
import { getActiveDriverKey, saveDatabase } from "@scripts/core/storage";
import {
  deleteHistoryEntryById,
  getHistoryEntryById,
  listHistoryEntries,
  type HistoryQueryFilters,
} from "@scripts/core/storage/sqlite";
import {
  buildGoogleMapsUrl,
  escapeHtml,
  formatDateFromIso,
  formatGpsCoordinates,
  parseIsoDate,
} from "@scripts/core/utils";
import {
  buildCompanyPrintHeader,
  printEntriesChunked,
} from "@scripts/features/shared/printing";
import { buildMediumTableHTML } from "@scripts/features/shared/mediumTable";
import type { CalculationItem } from "@scripts/features/calculation";

interface Services {
  state: {
    getState: typeof getState;
    subscribe: typeof subscribeState;
  };
}

type DocumentationEntrySource = "sqlite" | "state";

type DataMode = "memory" | "sqlite";

interface DocumentationEntry {
  id: string;
  entry: HistoryEntry;
  source: DocumentationEntrySource;
  ref: number;
}

interface HistoryEntry {
  datum?: string;
  date?: string;
  dateIso?: string | null;
  ersteller?: string;
  standort?: string;
  usageType?: string;
  kultur?: string;
  kisten?: number;
  eppoCode?: string;
  bbch?: string;
  gps?: string;
  gpsCoordinates?: { latitude?: number; longitude?: number } | null;
  gpsPointId?: string | null;
  invekos?: string;
  uhrzeit?: string;
  items?: CalculationItem[];
  savedAt?: string;
  [key: string]: unknown;
}

interface DocumentationFilters {
  startDate?: string;
  endDate?: string;
  creator?: string;
  location?: string;
  crop?: string;
  usageType?: string;
  eppoCode?: string;
  invekos?: string;
  search?: string;
}

type EntryDetailPayload = { entry: DocumentationEntry; detail: HistoryEntry };

const PAGE_SIZE = 50;
let initialized = false;
let dataMode: DataMode = "memory";
let currentFilters: DocumentationFilters = {};
let currentPage = 1;
let totalEntries = 0;
let allEntries: DocumentationEntry[] = [];
let visibleEntries: DocumentationEntry[] = [];
const selectedEntryIds = new Set<string>();
const entryDetailCache = new Map<string, HistoryEntry>();
let isLoadingEntries = false;
let currentLoadToken: symbol | null = null;
let lastHistoryLength = 0;

function resolveStorageDriver(state: AppState): string {
  return state.app?.storageDriver || getActiveDriverKey();
}

function createEntryId(source: DocumentationEntrySource, ref: number): string {
  return `${source}:${ref}`;
}

function toHistoryQueryFilters(
  filters: DocumentationFilters
): HistoryQueryFilters {
  const query: HistoryQueryFilters = {};
  if (filters.startDate) {
    query.startDate = filters.startDate;
  }
  if (filters.endDate) {
    query.endDate = filters.endDate;
  }
  if (filters.creator) {
    query.creator = filters.creator;
  }
  if (filters.location) {
    query.location = filters.location;
  }
  if (filters.crop) {
    query.crop = filters.crop;
  }
  if (filters.usageType) {
    query.usageType = filters.usageType;
  }
  if (filters.eppoCode) {
    query.eppoCode = filters.eppoCode;
  }
  if (filters.invekos) {
    query.invekos = filters.invekos;
  }
  if (filters.search) {
    query.text = filters.search;
  }
  return query;
}

function mapStateHistoryEntry(
  entry: HistoryEntry,
  index: number
): DocumentationEntry {
  return {
    id: createEntryId("state", index),
    entry,
    source: "state",
    ref: index,
  };
}

function mapSqliteHistoryEntry(
  record: Record<string, unknown>
): DocumentationEntry {
  const id = Number(record?.id ?? record?.historyId ?? 0);
  const entry: HistoryEntry = { ...(record as HistoryEntry) };
  delete (entry as { id?: unknown }).id;
  return {
    id: createEntryId("sqlite", id),
    entry,
    source: "sqlite",
    ref: id,
  };
}

function findEntryById(id: string): DocumentationEntry | undefined {
  return allEntries.find((entry) => entry.id === id);
}

async function resolveEntryDetail(
  entry: DocumentationEntry
): Promise<HistoryEntry | null> {
  if (entryDetailCache.has(entry.id)) {
    return entryDetailCache.get(entry.id)!;
  }
  let resolved: HistoryEntry | null = null;
  if (entry.source === "sqlite") {
    try {
      resolved = await getHistoryEntryById(entry.ref);
    } catch (error) {
      console.error("History entry fetch failed", error);
    }
  } else {
    const stateEntry = getState().history?.[entry.ref] as
      | HistoryEntry
      | undefined;
    resolved = stateEntry || entry.entry;
  }
  if (resolved) {
    entryDetailCache.set(entry.id, resolved);
  }
  return resolved;
}

function resolveEntryDate(entry: HistoryEntry | null): string {
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

function resolveGps(entry: HistoryEntry): string {
  if (entry?.gpsCoordinates) {
    const formatted = formatGpsCoordinates(entry.gpsCoordinates);
    if (formatted) {
      return formatted;
    }
  }
  return "";
}

function resolveGpsNote(entry: HistoryEntry): string {
  return entry?.gps || "";
}

function normalizeEntryDate(entry: HistoryEntry | null): Date | null {
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
  if (!fallbackSource) {
    return null;
  }
  const parts = fallbackSource.split(".");
  if (parts.length === 3) {
    const [day, month, year] = parts.map(Number);
    if (!Number.isNaN(day) && !Number.isNaN(month) && !Number.isNaN(year)) {
      return new Date(year, month - 1, day);
    }
  }
  return null;
}

function matchesFilter(
  entry: HistoryEntry,
  filters: DocumentationFilters
): boolean {
  const normalizedDate = normalizeEntryDate(entry);
  if (filters.startDate) {
    const start = new Date(filters.startDate);
    start.setHours(0, 0, 0, 0);
    if (!normalizedDate || normalizedDate < start) {
      return false;
    }
  }
  if (filters.endDate) {
    const end = new Date(filters.endDate);
    end.setHours(23, 59, 59, 999);
    if (!normalizedDate || normalizedDate > end) {
      return false;
    }
  }

  const textChecks: Array<[keyof DocumentationFilters, string | undefined]> = [
    ["creator", entry.ersteller],
    ["location", entry.standort],
    ["crop", entry.kultur],
    ["usageType", entry.usageType],
    ["eppoCode", entry.eppoCode],
    ["invekos", entry.invekos],
  ];

  for (const [filterKey, value] of textChecks) {
    const needle = filters[filterKey];
    const normalizedNeedle = needle?.trim().toLowerCase();
    if (
      normalizedNeedle &&
      !`${value || ""}`.toLowerCase().includes(normalizedNeedle)
    ) {
      return false;
    }
  }

  const normalizedSearch = filters.search?.trim().toLowerCase();
  if (normalizedSearch) {
    const haystack = [
      entry.ersteller,
      entry.standort,
      entry.kultur,
      entry.usageType,
      entry.eppoCode,
      entry.invekos,
      entry.bbch,
      entry.gps,
    ]
      .map((value) => (value ? value.toLowerCase() : ""))
      .join(" ");
    if (!haystack.includes(normalizedSearch)) {
      return false;
    }
  }

  return true;
}

function sortEntries(entries: DocumentationEntry[]): DocumentationEntry[] {
  return entries.slice().sort((a, b) => {
    const dateA =
      normalizeEntryDate(a.entry)?.getTime() ||
      new Date(a.entry.savedAt || 0).getTime();
    const dateB =
      normalizeEntryDate(b.entry)?.getTime() ||
      new Date(b.entry.savedAt || 0).getTime();
    return dateB - dateA;
  });
}

function paginateEntries(): void {
  const end = currentPage * PAGE_SIZE;
  visibleEntries = allEntries.slice(0, end);
}

function resetSelection(section?: HTMLElement | null): void {
  selectedEntryIds.clear();
  if (section) {
    updateSelectionInfo(section);
  }
}

function updateSelectionInfo(section: HTMLElement): void {
  const info = section.querySelector<HTMLElement>(
    '[data-role="doc-selection-info"]'
  );
  const printBtn = section.querySelector<HTMLButtonElement>(
    '[data-action="print-selection"]'
  );
  const exportBtn = section.querySelector<HTMLButtonElement>(
    '[data-action="export-selection"]'
  );
  const deleteBtn = section.querySelector<HTMLButtonElement>(
    '[data-action="delete-selection"]'
  );
  const count = selectedEntryIds.size;
  if (info) {
    info.textContent = count
      ? `${count} Eintrag${count === 1 ? "" : "e"} ausgewählt`
      : "Keine Einträge ausgewählt";
  }
  const disabled = count === 0;
  if (printBtn) {
    printBtn.disabled = disabled;
  }
  if (exportBtn) {
    exportBtn.disabled = disabled;
  }
  if (deleteBtn) {
    deleteBtn.disabled = disabled;
  }
}

function markActiveListEntry(
  section: HTMLElement,
  entryId: string | null
): void {
  const containers = section.querySelectorAll<HTMLElement>(
    '[data-role="doc-list"] .doc-sidebar-entry'
  );
  containers.forEach((node) => {
    const isActive = Boolean(entryId && node.dataset.entryId === entryId);
    node.classList.toggle("active", isActive);
  });
}

function renderDetail(
  section: HTMLElement,
  payload: EntryDetailPayload | null,
  labels: AppState["fieldLabels"]
): void {
  const detailWrapper = section.querySelector<HTMLElement>("#doc-detail");
  const detailBody = section.querySelector<HTMLElement>("#doc-detail-body");
  const detailCard = section.querySelector<HTMLElement>(
    '[data-role="doc-detail-card"]'
  );
  const emptyState = section.querySelector<HTMLElement>(
    '[data-role="doc-detail-empty"]'
  );
  if (!detailWrapper || !detailBody || !detailCard || !emptyState) {
    return;
  }
  if (!payload) {
    detailWrapper.dataset.entryId = "";
    detailCard.classList.add("d-none");
    emptyState.classList.remove("d-none");
    detailBody.innerHTML = "";
    markActiveListEntry(section, null);
    return;
  }

  detailWrapper.dataset.entryId = payload.entry.id;
  detailCard.classList.remove("d-none");
  emptyState.classList.add("d-none");
  markActiveListEntry(section, payload.entry.id);

  const resolvedLabels = labels || getState().fieldLabels;
  const tableLabels = resolvedLabels.history?.tableColumns ?? {};
  const detailLabels = resolvedLabels.history?.detail ?? {};
  const detailEntry = payload.detail || payload.entry.entry;
  const snapshotTable = buildMediumTableHTML(
    detailEntry.items || [],
    resolvedLabels,
    "detail"
  );
  const mapUrl = detailEntry.gpsCoordinates
    ? buildGoogleMapsUrl(detailEntry.gpsCoordinates)
    : null;
  const gpsNote = resolveGpsNote(detailEntry);
  const gpsCoords = resolveGps(detailEntry);

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

  const gpsCoordsHtml = gpsCoords
    ? `${escapeHtml(gpsCoords)}$${
        mapUrl
          ? ` <a class="btn btn-link btn-sm p-0 ms-2 align-baseline" href="${escapeHtml(
              mapUrl
            )}" target="_blank" rel="noopener noreferrer">Google Maps</a>`
          : ""
      }`
    : "-";

  detailBody.innerHTML = `
    <p>
      <strong>${escapeHtml(tableLabels.date || "Datum")}:</strong> ${escapeHtml(
        resolveEntryDate(detailEntry)
      )}<br />
      <strong>${escapeHtml(
        detailLabels.creator || "Erstellt von"
      )}:</strong> ${escapeHtml(detailEntry.ersteller || "")}<br />
      <strong>${escapeHtml(
        detailLabels.location || "Standort"
      )}:</strong> ${escapeHtml(detailEntry.standort || "")}<br />
      <strong>${escapeHtml(
        detailLabels.crop || "Kultur"
      )}:</strong> ${escapeHtml(detailEntry.kultur || "")}<br />
      <strong>${escapeHtml(
        detailLabels.usageType || "Art der Verwendung"
      )}:</strong> ${escapeHtml(detailEntry.usageType || "")}<br />
      <strong>${escapeHtml(
        detailLabels.quantity || "Kisten"
      )}:</strong> ${escapeHtml(
        detailEntry.kisten != null ? String(detailEntry.kisten) : ""
      )}<br />
      <strong>${escapeHtml(
        detailLabels.eppoCode || "EPPO-Code"
      )}:</strong> ${escapeHtml(detailEntry.eppoCode || "")}<br />
      <strong>${escapeHtml(
        detailLabels.bbch || "BBCH"
      )}:</strong> ${escapeHtml(detailEntry.bbch || "")}<br />
      <strong>${escapeHtml(
        detailLabels.invekos || "InVeKoS"
      )}:</strong> ${escapeHtml(detailEntry.invekos || "")}<br />
      <strong>${escapeHtml(gpsNoteLabel)}:</strong> ${
        gpsNote ? escapeHtml(gpsNote) : "-"
      }<br />
      <strong>${escapeHtml(gpsCoordsLabel)}:</strong> ${gpsCoordsHtml}<br />
      <strong>${escapeHtml(
        detailLabels.time || "Uhrzeit"
      )}:</strong> ${escapeHtml(detailEntry.uhrzeit || "")}<br />
    </p>
    <div class="table-responsive">
      ${snapshotTable}
    </div>
  `;
}

function renderList(
  section: HTMLElement,
  labels: AppState["fieldLabels"]
): void {
  const listContainer = section.querySelector<HTMLElement>(
    '[data-role="doc-list"]'
  );
  if (!listContainer) {
    return;
  }
  const activeWrapper = section.querySelector<HTMLElement>("#doc-detail");
  const activeEntryId = activeWrapper?.dataset.entryId || null;

  if (!visibleEntries.length) {
    listContainer.innerHTML = isLoadingEntries
      ? '<div class="text-center text-muted py-4">Lädt ...</div>'
      : '<div class="text-center text-muted py-4">Noch keine Einträge</div>';
  } else {
    listContainer.innerHTML = "";
    const fragment = document.createDocumentFragment();
    const resolvedLabels = labels || getState().fieldLabels;
    const usageLabel =
      resolvedLabels.history?.detail?.usageType || "Art der Verwendung";

    visibleEntries.forEach((item) => {
      const row = document.createElement("div");
      row.className = "doc-sidebar-entry list-group-item";
      row.dataset.entryId = item.id;
      const dateValue = resolveEntryDate(item.entry) || "-";
      row.innerHTML = `
        <div
          class="doc-sidebar-entry__main"
          data-action="view-entry"
          data-entry-id="${item.id}"
        >
          <div class="d-flex justify-content-between gap-2">
            <span class="fw-bold">${escapeHtml(item.entry.kultur || "-")}</span>
            <small class="text-muted">${escapeHtml(dateValue)}</small>
          </div>
          <div class="text-muted small mb-1">
            ${escapeHtml(item.entry.ersteller || "-")} | ${escapeHtml(
              item.entry.standort || "-"
            )}
          </div>
          <div class="small">
            <div><strong>${escapeHtml(usageLabel)}:</strong> ${escapeHtml(
              item.entry.usageType || "-"
            )}</div>
            <div><strong>EPPO:</strong> ${escapeHtml(
              item.entry.eppoCode || "-"
            )}</div>
            <div><strong>Schlag:</strong> ${escapeHtml(
              item.entry.invekos || "-"
            )}</div>
          </div>
        </div>
        <div class="d-flex align-items-center justify-content-between mt-2 gap-2 no-print">
          <button class="btn btn-sm btn-outline-secondary" data-action="print-entry" data-entry-id="${item.id}">Drucken</button>
          <label class="form-check-label d-flex align-items-center gap-2 mb-0">
            <input type="checkbox" class="form-check-input" data-action="toggle-select" data-entry-id="${item.id}" ${
              selectedEntryIds.has(item.id) ? "checked" : ""
            } />
            <span class="small">Auswahl</span>
          </label>
        </div>
      `;
      fragment.appendChild(row);
    });

    listContainer.appendChild(fragment);
  }

  const loadMore = section.querySelector<HTMLButtonElement>(
    '[data-action="load-more"]'
  );
  if (loadMore) {
    const available = dataMode === "sqlite" ? totalEntries : allEntries.length;
    const hasMore = visibleEntries.length < available;
    loadMore.classList.toggle("d-none", !hasMore);
    loadMore.disabled = isLoadingEntries;
    if (hasMore) {
      const remaining = Math.max(available - visibleEntries.length, 0);
      loadMore.textContent = `Mehr laden (${remaining} weitere)`;
    }
  }

  markActiveListEntry(section, activeEntryId);
}

function updateInfo(
  section: HTMLElement,
  labels: AppState["fieldLabels"]
): void {
  const info = section.querySelector<HTMLElement>('[data-role="doc-info"]');
  if (!info) {
    return;
  }
  const total = totalEntries;
  const hasFilter = Object.values(currentFilters).some((value) => value);
  if (!total && !isLoadingEntries) {
    info.textContent = hasFilter
      ? "Keine Einträge für diese Filter"
      : "Keine Einträge";
    return;
  }
  if (!total && isLoadingEntries) {
    info.textContent = "Lade Einträge ...";
    return;
  }
  const dateLabel = labels?.reporting?.infoPrefix || "Auswahl";
  if (hasFilter && currentFilters.startDate && currentFilters.endDate) {
    info.textContent = `${dateLabel} ${currentFilters.startDate} - ${currentFilters.endDate} (${total})`;
    return;
  }
  info.textContent = `Alle Einträge (${total})`;
}

async function reopenDetailIfVisible(
  section: HTMLElement,
  labels: AppState["fieldLabels"]
): Promise<void> {
  const detailWrapper = section.querySelector<HTMLElement>("#doc-detail");
  const entryId = detailWrapper?.dataset.entryId;
  if (!entryId) {
    renderDetail(section, null, labels);
    return;
  }
  const entry = findEntryById(entryId);
  if (!entry) {
    renderDetail(section, null, labels);
    return;
  }
  const detail = await resolveEntryDetail(entry);
  if (detail) {
    renderDetail(section, { entry, detail }, labels);
  } else {
    renderDetail(section, null, labels);
  }
}

async function fetchSqlitePage(
  section: HTMLElement,
  labels: AppState["fieldLabels"],
  page: number,
  append: boolean
): Promise<void> {
  const token = Symbol("doc-load");
  currentLoadToken = token;
  isLoadingEntries = true;
  if (!append) {
    allEntries = [];
    visibleEntries = [];
    totalEntries = 0;
    renderList(section, labels);
    updateInfo(section, labels);
  }

  try {
    const result = await listHistoryEntries({
      page,
      pageSize: PAGE_SIZE,
      filters: toHistoryQueryFilters(currentFilters),
      sortDirection: "desc",
    });
    if (currentLoadToken !== token) {
      return;
    }
    const mapped = result.items.map((item) => mapSqliteHistoryEntry(item));
    allEntries = append ? [...allEntries, ...mapped] : mapped;
    visibleEntries = allEntries.slice();
    currentPage = page;
    totalEntries = result.totalCount;
  } catch (error) {
    if (currentLoadToken === token) {
      console.error("Dokumentation konnte nicht geladen werden", error);
      window.alert(
        "Dokumentation konnte nicht geladen werden. Bitte erneut versuchen."
      );
    }
  } finally {
    if (currentLoadToken === token) {
      isLoadingEntries = false;
      currentLoadToken = null;
      renderList(section, labels);
      updateInfo(section, labels);
    }
  }
}

async function loadMemoryEntries(
  section: HTMLElement,
  state: AppState
): Promise<void> {
  const entries = Array.isArray(state.history) ? state.history : [];
  allEntries = sortEntries(
    entries
      .map((entry, index) => mapStateHistoryEntry(entry as HistoryEntry, index))
      .filter((item) => matchesFilter(item.entry, currentFilters))
  );
  totalEntries = allEntries.length;
  paginateEntries();
  renderList(section, state.fieldLabels);
  updateInfo(section, state.fieldLabels);
  await reopenDetailIfVisible(section, state.fieldLabels);
}

async function applyFilters(
  section: HTMLElement,
  state: AppState
): Promise<void> {
  const driverKey = resolveStorageDriver(state);
  const hasDatabase = Boolean(state.app?.hasDatabase);
  const useSqlite = driverKey === "sqlite" && hasDatabase;
  dataMode = useSqlite ? "sqlite" : "memory";
  entryDetailCache.clear();
  currentPage = 1;
  resetSelection(section);

  if (useSqlite) {
    await fetchSqlitePage(section, state.fieldLabels, 1, false);
    await reopenDetailIfVisible(section, state.fieldLabels);
    return;
  }

  await loadMemoryEntries(section, state);
}

async function loadMoreEntries(
  section: HTMLElement,
  labels: AppState["fieldLabels"]
): Promise<void> {
  if (dataMode === "sqlite") {
    if (isLoadingEntries) {
      return;
    }
    const nextPage = currentPage + 1;
    await fetchSqlitePage(section, labels, nextPage, true);
    return;
  }
  currentPage += 1;
  paginateEntries();
  renderList(section, labels);
}

async function collectSelectedEntries(): Promise<HistoryEntry[]> {
  const entries: HistoryEntry[] = [];
  for (const id of selectedEntryIds) {
    const entry = findEntryById(id);
    if (!entry) {
      continue;
    }
    const detail = await resolveEntryDetail(entry);
    if (detail) {
      entries.push(detail);
    }
  }
  return entries;
}

async function deleteSelectedEntries(
  section: HTMLElement,
  services: Services
): Promise<void> {
  if (!selectedEntryIds.size) {
    return;
  }

  const sqliteEntries = Array.from(selectedEntryIds)
    .map((id) => findEntryById(id))
    .filter((entry): entry is DocumentationEntry => Boolean(entry))
    .filter((entry) => entry.source === "sqlite");

  if (sqliteEntries.length) {
    for (const entry of sqliteEntries) {
      await deleteHistoryEntryById(entry.ref);
    }
  }

  const memoryIndexes = new Set(
    Array.from(selectedEntryIds)
      .map((id) => findEntryById(id))
      .filter((entry): entry is DocumentationEntry => Boolean(entry))
      .filter((entry) => entry.source === "state")
      .map((entry) => entry.ref)
  );

  if (memoryIndexes.size) {
    updateSlice("history", (history) =>
      history.filter((_, idx) => !memoryIndexes.has(idx))
    );
    await persistHistoryChanges();
  }

  resetSelection(section);
  await applyFilters(section, services.state.getState());
}

async function handleDetailRequest(
  section: HTMLElement,
  entry: DocumentationEntry,
  labels: AppState["fieldLabels"]
): Promise<void> {
  const detail = await resolveEntryDetail(entry);
  if (!detail) {
    window.alert("Details konnten nicht geladen werden.");
    return;
  }
  renderDetail(section, { entry, detail }, labels);
}

async function handlePrintSingleEntry(
  entry: DocumentationEntry
): Promise<void> {
  const detail = await resolveEntryDetail(entry);
  if (detail) {
    await printEntries([detail]);
  } else {
    window.alert("Eintrag konnte nicht geladen werden.");
  }
}

async function persistHistoryChanges(): Promise<void> {
  const driverKey = getActiveDriverKey();
  if (!driverKey || driverKey === "memory" || driverKey === "sqlite") {
    return;
  }
  try {
    const snapshot = getDatabaseSnapshot();
    await saveDatabase(snapshot);
  } catch (error) {
    console.error("Persist history failed", error);
    window.alert(
      "Historie konnte nicht gespeichert werden. Bitte erneut versuchen."
    );
    throw error;
  }
}

async function printEntries(entries: HistoryEntry[]): Promise<void> {
  if (!entries.length) {
    window.alert("Keine Einträge ausgewählt.");
    return;
  }
  const labels = getState().fieldLabels;
  const headerHtml = buildCompanyPrintHeader(getState().company || null);
  await printEntriesChunked(entries, labels, {
    title: "Dokumentation",
    headerHtml,
    chunkSize: 25,
  });
}

function exportEntries(entries: HistoryEntry[]): void {
  if (!entries.length) {
    window.alert("Keine Einträge ausgewählt.");
    return;
  }
  const payload = entries.map((entry) => ({ ...entry }));
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  anchor.href = url;
  anchor.download = `pflanzenschutz-dokumentation-${timestamp}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function createSection(): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "section-inner";
  wrapper.innerHTML = `
    <h2 class="text-center mb-4">Dokumentation</h2>
    <div class="card card-dark mb-4 no-print">
      <div class="card-body">
        <form id="doc-filter" class="row g-3">
          <div class="col-md-3">
            <label class="form-label" for="doc-start">Startdatum</label>
            <input type="date" class="form-control" id="doc-start" name="doc-start" />
          </div>
          <div class="col-md-3">
            <label class="form-label" for="doc-end">Enddatum</label>
            <input type="date" class="form-control" id="doc-end" name="doc-end" />
          </div>
          <div class="col-md-3">
            <label class="form-label" for="doc-crop">Kultur</label>
            <input type="text" class="form-control" id="doc-crop" name="doc-crop" placeholder="z. B. Äpfel" />
          </div>
          <div class="col-md-3">
            <label class="form-label" for="doc-creator">Anwender</label>
            <input type="text" class="form-control" id="doc-creator" name="doc-creator" placeholder="Name" />
          </div>
          <div class="col-md-3">
            <label class="form-label" for="doc-usage">Art der Verwendung</label>
            <input type="text" class="form-control" id="doc-usage" name="doc-usage" placeholder="z. B. SUR" />
          </div>
          <div class="col-md-3">
            <label class="form-label" for="doc-eppo">EPPO-Code</label>
            <input type="text" class="form-control" id="doc-eppo" name="doc-eppo" placeholder="EPPO" />
          </div>
          <div class="col-md-3">
            <label class="form-label" for="doc-invekos">InVeKoS-Schlag</label>
            <input type="text" class="form-control" id="doc-invekos" name="doc-invekos" placeholder="Schlag" />
          </div>
          <div class="col-md-3">
            <label class="form-label" for="doc-search">Volltext</label>
            <input type="text" class="form-control" id="doc-search" name="doc-search" placeholder="Freitext" />
          </div>
          <div class="col-12 d-flex gap-2 justify-content-end">
            <button class="btn btn-outline-secondary" type="reset" data-action="reset-filters">Zurücksetzen</button>
            <button class="btn btn-success" type="submit">Filter anwenden</button>
          </div>
        </form>
      </div>
    </div>

    <div class="card card-dark">
      <div class="card-header d-flex flex-column flex-lg-row justify-content-between align-items-lg-center gap-3 no-print">
        <div class="small text-muted" data-role="doc-info">Keine Einträge</div>
        <div class="d-flex flex-wrap gap-2 align-items-center">
          <div class="small text-muted" data-role="doc-selection-info">Keine Einträge ausgewählt</div>
          <div class="btn-group">
            <button class="btn btn-outline-light btn-sm" data-action="print-selection" disabled>Drucken</button>
            <button class="btn btn-outline-light btn-sm" data-action="export-selection" disabled>Exportieren</button>
            <button class="btn btn-outline-light btn-sm" data-action="delete-selection" disabled>Löschen</button>
          </div>
        </div>
      </div>
      <div class="card-body p-0">
        <div class="row g-0">
          <div class="col-12 col-lg-4 border-end">
            <div class="d-flex flex-column h-100">
              <div data-role="doc-list" class="list-group list-group-flush flex-grow-1 overflow-auto"></div>
              <div class="p-3">
                <button class="btn btn-secondary w-100 d-none" data-action="load-more">Mehr laden</button>
              </div>
            </div>
          </div>
          <div class="col-12 col-lg-8">
            <div id="doc-detail" class="h-100 d-flex flex-column">
              <div data-role="doc-detail-empty" class="flex-grow-1 d-flex align-items-center justify-content-center text-muted text-center p-4">
                Bitte einen Eintrag in der Liste auswählen, um die Details zu sehen.
              </div>
              <div data-role="doc-detail-card" class="d-none h-100 d-flex flex-column">
                <div class="flex-grow-1 overflow-auto p-3" id="doc-detail-body"></div>
                <div class="border-top p-3 d-flex justify-content-end gap-2">
                  <button class="btn btn-outline-secondary" data-action="detail-print">Drucken / PDF</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  return wrapper;
}

function parseFilters(form: HTMLFormElement | null): DocumentationFilters {
  if (!form) {
    return {};
  }
  const data = new FormData(form);
  return {
    startDate: (data.get("doc-start") as string) || undefined,
    endDate: (data.get("doc-end") as string) || undefined,
    crop: (data.get("doc-crop") as string) || undefined,
    creator: (data.get("doc-creator") as string) || undefined,
    usageType: (data.get("doc-usage") as string) || undefined,
    eppoCode: (data.get("doc-eppo") as string) || undefined,
    invekos: (data.get("doc-invekos") as string) || undefined,
    search: (data.get("doc-search") as string) || undefined,
  };
}

function wireEventHandlers(section: HTMLElement, services: Services): void {
  section.addEventListener("submit", (event) => {
    if (
      !(event.target instanceof HTMLFormElement) ||
      event.target.id !== "doc-filter"
    ) {
      return;
    }
    event.preventDefault();
    currentFilters = parseFilters(event.target);
    resetSelection(section);
    void applyFilters(section, services.state.getState());
  });

  section.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }
    const action = target.dataset.action;
    if (!action) {
      const parentAction = target.closest<HTMLElement>("[data-action]");
      if (parentAction) {
        event.stopPropagation();
      }
      return;
    }

    if (action === "reset-filters") {
      const form = section.querySelector<HTMLFormElement>("#doc-filter");
      form?.reset();
      currentFilters = {};
      resetSelection(section);
      void applyFilters(section, services.state.getState());
      return;
    }

    if (action === "load-more") {
      void loadMoreEntries(section, services.state.getState().fieldLabels);
      return;
    }

    if (action === "print-selection") {
      void (async () => {
        const entries = await collectSelectedEntries();
        await printEntries(entries);
      })();
      return;
    }

    if (action === "export-selection") {
      void (async () => {
        const entries = await collectSelectedEntries();
        exportEntries(entries);
      })();
      return;
    }

    if (action === "delete-selection") {
      if (!selectedEntryIds.size) {
        return;
      }
      if (!window.confirm("Ausgewählte Einträge wirklich löschen?")) {
        return;
      }
      void deleteSelectedEntries(section, services);
      return;
    }

    if (action === "detail-print") {
      const detailWrapper = section.querySelector<HTMLElement>("#doc-detail");
      const entryId = detailWrapper?.dataset.entryId;
      if (!entryId) {
        window.alert("Kein Eintrag ausgewählt.");
        return;
      }
      const entry = findEntryById(entryId);
      if (!entry) {
        window.alert("Eintrag nicht verfügbar.");
        return;
      }
      void handlePrintSingleEntry(entry);
      return;
    }

    const entryId = target.dataset.entryId;
    if (!entryId) {
      return;
    }
    const entry = findEntryById(entryId);
    if (!entry) {
      window.alert("Eintrag nicht verfügbar.");
      return;
    }

    if (action === "view-entry") {
      void handleDetailRequest(
        section,
        entry,
        services.state.getState().fieldLabels
      );
      return;
    }

    if (action === "print-entry") {
      void handlePrintSingleEntry(entry);
      return;
    }
  });

  section.addEventListener("change", (event) => {
    const target = event.target as HTMLInputElement | null;
    if (!target || target.dataset.action !== "toggle-select") {
      return;
    }
    const entryId = target.dataset.entryId;
    if (!entryId) {
      return;
    }
    if (target.checked) {
      selectedEntryIds.add(entryId);
    } else {
      selectedEntryIds.delete(entryId);
    }
    updateSelectionInfo(section);
  });
}

export function initDocumentation(
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

  wireEventHandlers(section, services);

  const applyAndRender = () => {
    void applyFilters(section, services.state.getState());
  };

  lastHistoryLength = Array.isArray(services.state.getState().history)
    ? services.state.getState().history.length
    : 0;

  applyAndRender();

  services.state.subscribe((nextState) => {
    const nextLength = Array.isArray(nextState.history)
      ? nextState.history.length
      : 0;
    if (dataMode === "sqlite") {
      if (nextLength !== lastHistoryLength) {
        lastHistoryLength = nextLength;
        applyAndRender();
      }
      return;
    }
    lastHistoryLength = nextLength;
    applyAndRender();
  });

  initialized = true;
}
