import {
  getState,
  subscribeState,
  updateSlice,
  type AppState,
  type ArchiveLogEntry,
} from "@scripts/core/state";
import { getDatabaseSnapshot } from "@scripts/core/database";
import { getActiveDriverKey, saveDatabase } from "@scripts/core/storage";
import {
  deleteHistoryEntryById,
  getHistoryEntryById,
  listHistoryEntriesPaged,
  exportHistoryRange,
  deleteHistoryRange,
  vacuumDatabase,
  persistSqliteDatabaseFile,
  listArchiveLogs,
  insertArchiveLog,
  type HistoryQueryFilters,
  type ArchiveLogInput,
  type HistoryCursor,
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
import { strToU8, zipSync } from "fflate";
import {
  createPagerWidget,
  type PagerWidget,
} from "@scripts/features/shared/pagerWidget";

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
    emit?: (eventName: string, payload?: unknown) => void;
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
  crop?: string;
}

type EntryDetailPayload = { entry: DocumentationEntry; detail: HistoryEntry };

const ARCHIVE_ENTRY_LIMIT = 5000;
const ARCHIVE_HIGHLIGHT_LIMIT = 50;
const ARCHIVE_LOG_LIMIT = 50;

function formatDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function normalizeDateInput(value?: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return formatDateInputValue(parsed);
}

function toDateBoundaryIso(
  value: string | undefined,
  boundary: "start" | "end"
): string | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  if (boundary === "start") {
    date.setHours(0, 0, 0, 0);
  } else {
    date.setHours(23, 59, 59, 999);
  }
  return date.toISOString();
}

function getDefaultFilters(): DocumentationFilters {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 30);
  return {
    startDate: formatDateInputValue(start),
    endDate: formatDateInputValue(end),
  };
}

function applyDateFiltersToForm(
  form: HTMLFormElement | null,
  filters: DocumentationFilters
): void {
  if (!form) {
    return;
  }
  const startInput = form.querySelector<HTMLInputElement>("#doc-start");
  const endInput = form.querySelector<HTMLInputElement>("#doc-end");
  if (startInput && filters.startDate) {
    startInput.value = filters.startDate;
  }
  if (endInput && filters.endDate) {
    endInput.value = filters.endDate;
  }
}

function buildEntryIdFromRef(
  ref: DocumentationFocusEntryRef,
  defaultSource: DocumentationEntrySource = "sqlite"
): string | null {
  if (typeof ref === "string") {
    if (ref.includes(":")) {
      return ref;
    }
    if (/^\d+$/.test(ref)) {
      return createEntryId(defaultSource, Number(ref));
    }
    return ref;
  }
  if (typeof ref === "number") {
    return createEntryId(defaultSource, ref);
  }
  if (ref && typeof ref === "object") {
    const source = ref.source || defaultSource;
    if (typeof ref.ref === "string" && ref.ref.includes(":")) {
      return ref.ref;
    }
    const numeric = Number(ref.ref);
    if (!Number.isNaN(numeric)) {
      return createEntryId(source, numeric);
    }
  }
  return null;
}

function normalizeFocusEntryIds(
  refs: DocumentationFocusEntryRef[] | undefined
): Set<string> {
  const ids = new Set<string>();
  if (!refs?.length) {
    return ids;
  }
  refs.forEach((ref) => {
    const entryId = buildEntryIdFromRef(ref);
    if (entryId) {
      ids.add(entryId);
    }
  });
  return ids;
}

function updateFocusBanner(section: HTMLElement): void {
  const banner = section.querySelector<HTMLElement>(
    '[data-role="doc-focus-banner"]'
  );
  const textNode = section.querySelector<HTMLElement>(
    '[data-role="doc-focus-text"]'
  );
  if (!banner || !textNode) {
    return;
  }
  if (!focusContext) {
    banner.classList.add("d-none");
    return;
  }
  const rangeText =
    currentFilters.startDate && currentFilters.endDate
      ? `${currentFilters.startDate} - ${currentFilters.endDate}`
      : "Aktuelle Filter";
  const label = focusContext.label || "Importierter Zeitraum";
  const count = focusContext.highlightEntryIds.size;
  const countText = count ? ` (${count} markiert)` : "";
  textNode.textContent = `${label}: ${rangeText}${countText}`;
  banner.classList.remove("d-none");
}

function clearFocusContext(
  section: HTMLElement,
  services: Services,
  options: { refreshList?: boolean } = {}
): void {
  if (!focusContext) {
    return;
  }
  focusContext = null;
  pendingEntrySelectionId = null;
  updateFocusBanner(section);
  if (options.refreshList) {
    renderList(section, services.state.getState().fieldLabels);
  }
}

function attemptPendingSelection(
  section: HTMLElement,
  labels: AppState["fieldLabels"]
): void {
  if (!pendingEntrySelectionId) {
    return;
  }
  const entry = findEntryById(pendingEntrySelectionId);
  if (!entry) {
    return;
  }
  pendingEntrySelectionId = null;
  void handleDetailRequest(section, entry, labels);
}

function handleFocusRangeEvent(
  section: HTMLElement,
  services: Services,
  payload: DocumentationFocusPayload | undefined
): void {
  if (!payload) {
    return;
  }
  const normalizedStart = normalizeDateInput(payload.startDate);
  const normalizedEnd = normalizeDateInput(payload.endDate);
  const hasEntryRefs = Boolean(payload.entryIds?.length);
  if (!normalizedStart && !normalizedEnd && !hasEntryRefs) {
    return;
  }
  currentFilters = {
    ...currentFilters,
    ...(normalizedStart ? { startDate: normalizedStart } : {}),
    ...(normalizedEnd ? { endDate: normalizedEnd } : {}),
  };
  if (payload.creator !== undefined) {
    currentFilters = {
      ...currentFilters,
      creator: payload.creator || undefined,
    };
  }
  if (payload.crop !== undefined) {
    currentFilters = {
      ...currentFilters,
      crop: payload.crop || undefined,
    };
  }
  const highlightEntryIds = normalizeFocusEntryIds(payload.entryIds);
  focusContext = {
    label: payload.label,
    reason: payload.reason,
    startDate: currentFilters.startDate,
    endDate: currentFilters.endDate,
    highlightEntryIds,
  };
  pendingEntrySelectionId =
    payload.autoSelectFirst && highlightEntryIds.size
      ? (highlightEntryIds.values().next().value ?? null)
      : null;
  const form = section.querySelector<HTMLFormElement>("#doc-filter");
  applyDateFiltersToForm(form, currentFilters);
  updateFocusBanner(section);
  focusLock = true;
  void applyFilters(section, services.state.getState()).finally(() => {
    focusLock = false;
  });
}

type DocumentationFocusEntryRef =
  | string
  | number
  | {
      source?: DocumentationEntrySource;
      ref: string | number;
    };

interface DocumentationFocusPayload {
  startDate?: string;
  endDate?: string;
  creator?: string;
  crop?: string;
  label?: string;
  reason?: string;
  entryIds?: DocumentationFocusEntryRef[];
  autoSelectFirst?: boolean;
}

interface DocumentationFocusContext {
  label?: string;
  reason?: string;
  startDate?: string;
  endDate?: string;
  highlightEntryIds: Set<string>;
}

const PAGE_SIZE = 25;
const DOC_PAGE_CACHE_LIMIT = 4;
const numberFormatter = new Intl.NumberFormat("de-DE");
let initialized = false;
let dataMode: DataMode = "memory";
let currentFilters: DocumentationFilters = getDefaultFilters();
let totalEntries = 0;
let allEntries: DocumentationEntry[] = [];
let visibleEntries: DocumentationEntry[] = [];
let docPageIndex = 0;
const docPageCache = new Map<number, DocumentationEntry[]>();
const docPageCursors = new Map<number, HistoryCursor | null>([[0, null]]);
const selectedEntryIds = new Set<string>();
const entryDetailCache = new Map<string, HistoryEntry>();
let isLoadingEntries = false;
let currentLoadToken: symbol | null = null;
let lastHistoryLength = 0;
let focusContext: DocumentationFocusContext | null = null;
let focusLock = false;
let pendingEntrySelectionId: string | null = null;
let isArchiving = false;
let lastArchiveLogSignature = "";
let archiveLogsLoaded = false;
let archiveLogsLoading: Promise<void> | null = null;
let docPagerWidget: PagerWidget | null = null;
let docPagerTarget: HTMLElement | null = null;
let docLoadError: string | null = null;

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
  const startBoundary = toDateBoundaryIso(filters.startDate, "start");
  const endBoundary = toDateBoundaryIso(filters.endDate, "end");
  if (startBoundary) {
    query.startDate = startBoundary;
  }
  if (endBoundary) {
    query.endDate = endBoundary;
  }
  if (filters.creator) {
    query.creator = filters.creator;
  }
  if (filters.crop) {
    query.crop = filters.crop;
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

interface ArchiveFormValues {
  startDate: string;
  endDate: string;
  storageHint?: string;
  note?: string;
  removeAfterExport: boolean;
}

function updateArchiveFormDefaults(section: HTMLElement): void {
  const form = section.querySelector<HTMLFormElement>(
    '[data-role="archive-form"]'
  );
  if (!form) {
    return;
  }
  const startInput = form.querySelector<HTMLInputElement>(
    'input[name="archive-start"]'
  );
  const endInput = form.querySelector<HTMLInputElement>(
    'input[name="archive-end"]'
  );
  if (startInput) {
    startInput.value = currentFilters.startDate || "";
  }
  if (endInput) {
    endInput.value = currentFilters.endDate || "";
  }
}

function setArchiveStatus(
  section: HTMLElement,
  message: string,
  variant: "info" | "success" | "warning" | "danger" = "info"
): void {
  const status = section.querySelector<HTMLElement>(
    '[data-role="archive-status"]'
  );
  if (!status) {
    return;
  }
  if (!message) {
    status.classList.add("d-none");
    status.textContent = "";
    return;
  }
  status.className = `alert alert-${variant}`;
  status.textContent = message;
  status.classList.remove("d-none");
}

function toggleArchiveForm(section: HTMLElement, visible?: boolean): void {
  const form = section.querySelector<HTMLElement>('[data-role="archive-form"]');
  const toggleBtn = section.querySelector<HTMLButtonElement>(
    '[data-action="archive-toggle"]'
  );
  if (!form) {
    return;
  }
  const isVisible = !form.classList.contains("d-none");
  const nextVisible = typeof visible === "boolean" ? visible : !isVisible;
  form.classList.toggle("d-none", !nextVisible);
  if (toggleBtn) {
    toggleBtn.textContent = nextVisible
      ? "Archiv-Eingaben ausblenden"
      : "Archiv erstellen";
  }
  if (nextVisible) {
    updateArchiveFormDefaults(section);
  }
}

function readArchiveFormValues(
  form: HTMLFormElement
): ArchiveFormValues | null {
  const startInput = form.querySelector<HTMLInputElement>(
    'input[name="archive-start"]'
  );
  const endInput = form.querySelector<HTMLInputElement>(
    'input[name="archive-end"]'
  );
  if (!startInput?.value || !endInput?.value) {
    return null;
  }
  const storageInput = form.querySelector<HTMLInputElement>(
    'input[name="archive-storage"]'
  );
  const noteInput = form.querySelector<HTMLTextAreaElement>(
    'textarea[name="archive-note"]'
  );
  const removeCheckbox = form.querySelector<HTMLInputElement>(
    'input[name="archive-remove"]'
  );
  return {
    startDate: startInput.value,
    endDate: endInput.value,
    storageHint: storageInput?.value.trim() || undefined,
    note: noteInput?.value.trim() || undefined,
    removeAfterExport: removeCheckbox ? removeCheckbox.checked : true,
  };
}

function updateArchiveAvailability(
  section: HTMLElement,
  state: AppState
): void {
  const toggleBtn = section.querySelector<HTMLButtonElement>(
    '[data-action="archive-toggle"]'
  );
  const submitBtn = section.querySelector<HTMLButtonElement>(
    '[data-action="archive-submit"]'
  );
  const form = section.querySelector<HTMLElement>('[data-role="archive-form"]');
  const driverHint = section.querySelector<HTMLElement>(
    '[data-role="archive-driver-hint"]'
  );
  const isSqlite =
    resolveStorageDriver(state) === "sqlite" && Boolean(state.app?.hasDatabase);
  if (toggleBtn) {
    toggleBtn.disabled = !isSqlite || isArchiving;
  }
  if (submitBtn) {
    submitBtn.disabled = !isSqlite || isArchiving;
  }
  if (!isSqlite && form) {
    form.classList.add("d-none");
  }
  if (driverHint) {
    driverHint.textContent = isSqlite
      ? "Lokale SQLite-Datenbank aktiv"
      : "Nur mit SQLite verfügbar";
    driverHint.className = `badge ${isSqlite ? "bg-success" : "bg-secondary"}`;
  }

  if (isSqlite) {
    void ensureArchiveLogsLoaded();
  } else {
    archiveLogsLoaded = false;
  }
}

function setArchiveBusy(section: HTMLElement, busy: boolean): void {
  isArchiving = busy;
  const form = section.querySelector<HTMLFormElement>(
    '[data-role="archive-form"]'
  );
  const toggleBtn = section.querySelector<HTMLButtonElement>(
    '[data-action="archive-toggle"]'
  );
  if (form) {
    form
      .querySelectorAll<
        HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement
      >("input, textarea, button")
      .forEach((element) => {
        if (element.dataset.action === "archive-cancel" && busy) {
          element.setAttribute("disabled", "disabled");
          return;
        }
        if (busy) {
          element.setAttribute("disabled", "disabled");
        } else {
          element.removeAttribute("disabled");
        }
      });
  }
  if (toggleBtn) {
    toggleBtn.disabled = busy || toggleBtn.disabled;
    if (!busy) {
      const state = getState();
      toggleBtn.disabled =
        resolveStorageDriver(state) !== "sqlite" || !state.app?.hasDatabase;
    }
  }
}

function buildArchiveFilename(startDate: string, endDate: string): string {
  const sanitize = (value: string) =>
    value ? value.replace(/[^0-9-]/g, "") : "unbekannt";
  return `pflanzenschutz-archiv-${sanitize(startDate)}_${sanitize(endDate)}.zip`;
}

function pushArchiveLogToState(entry: ArchiveLogEntry): ArchiveLogEntry[] {
  let nextLogs: ArchiveLogEntry[] = [];
  updateSlice("archives", (archives) => {
    const currentLogs = Array.isArray(archives?.logs) ? archives.logs : [];
    nextLogs = [entry, ...currentLogs].slice(0, ARCHIVE_LOG_LIMIT);
    return { ...(archives || { logs: [] }), logs: nextLogs };
  });
  return nextLogs;
}

async function ensureArchiveLogsLoaded({
  force = false,
}: { force?: boolean } = {}): Promise<void> {
  if (archiveLogsLoading) {
    await archiveLogsLoading;
    if (!force) {
      return;
    }
  } else if (archiveLogsLoaded && !force) {
    return;
  }

  const state = getState();
  const driverKey = resolveStorageDriver(state);
  if (driverKey !== "sqlite" || !state.app?.hasDatabase) {
    return;
  }

  const loader = (async () => {
    try {
      const result = await listArchiveLogs({ limit: ARCHIVE_LOG_LIMIT });
      updateSlice("archives", (archives) => {
        const base =
          archives && typeof archives === "object" ? archives : { logs: [] };
        return { ...base, logs: result.items };
      });
      archiveLogsLoaded = true;
    } catch (error) {
      console.warn("Archive logs could not be loaded", error);
    }
  })();

  archiveLogsLoading = loader;
  try {
    await loader;
  } finally {
    archiveLogsLoading = null;
  }
}

async function recordArchiveLog(
  entry: ArchiveLogEntry,
  metadata?: Record<string, unknown>
): Promise<void> {
  const driverKey = resolveStorageDriver(getState());
  pushArchiveLogToState(entry);

  if (driverKey !== "sqlite") {
    console.warn("Archive logs require SQLite. Changes stored in memory only.");
    return;
  }

  try {
    const payload: ArchiveLogInput = {
      ...entry,
      metadata: metadata ?? undefined,
    };
    await insertArchiveLog(payload);
    await persistSqliteDatabaseFile();
  } catch (error) {
    console.error("Archive log could not be persisted", error);
    archiveLogsLoaded = false;
  } finally {
    await ensureArchiveLogsLoaded({ force: true });
  }
}

function computeArchiveLogSignature(
  logs: ArchiveLogEntry[] | undefined | null
): string {
  if (!Array.isArray(logs) || !logs.length) {
    return "[]";
  }
  return logs
    .map((log) => `${log.id}:${log.archivedAt}:${log.entryCount}`)
    .join("|");
}

function formatArchiveLogDate(value: string | undefined): string {
  if (!value) {
    return "-";
  }
  return formatDateFromIso(value) || value.slice(0, 16).replace("T", " ");
}

function renderArchiveLogs(
  section: HTMLElement,
  logs: ArchiveLogEntry[] | undefined | null
): void {
  const target = section.querySelector<HTMLElement>(
    '[data-role="archive-log-list"]'
  );
  if (!target) {
    return;
  }
  const list = Array.isArray(logs) ? logs : [];
  if (!list.length) {
    target.innerHTML =
      '<div class="text-muted small">Noch keine Archive erstellt.</div>';
    return;
  }
  const items = list
    .map((log) => {
      const dateLabel = formatArchiveLogDate(log.archivedAt);
      const rangeLabel = `${log.startDate || "-"} – ${log.endDate || "-"}`;
      const entryLabel = log.entryCount === 1 ? "Eintrag" : "Einträge";
      const storage = log.storageHint
        ? `<div class="small">Ablage: ${escapeHtml(log.storageHint)}</div>`
        : "";
      const note = log.note
        ? `<div class="small text-muted">Notiz: ${escapeHtml(log.note)}</div>`
        : "";
      const copyButton = log.storageHint
        ? `<button class="btn btn-sm btn-outline-secondary" data-action="archive-log-copy-hint" data-log-id="${log.id}">Hinweis kopieren</button>`
        : "";
      return `
        <div class="list-group-item border rounded mb-2">
          <div class="d-flex flex-column flex-md-row justify-content-between gap-3">
            <div>
              <div class="fw-bold">${escapeHtml(dateLabel)}</div>
              <div class="small text-muted">${escapeHtml(rangeLabel)} · ${log.entryCount} ${entryLabel}</div>
              <div class="small">Datei: ${escapeHtml(log.fileName || "unbenannt")}</div>
              ${storage}
              ${note}
            </div>
            <div class="d-flex flex-wrap gap-2 align-items-start">
              <button class="btn btn-sm btn-outline-primary" data-action="archive-log-focus" data-log-id="${log.id}">Dokumentation anzeigen</button>
              ${copyButton}
            </div>
          </div>
        </div>
      `;
    })
    .join("");
  target.innerHTML = `<div class="list-group list-group-flush">${items}</div>`;
}

function getArchiveLogById(
  state: AppState,
  logId: string
): ArchiveLogEntry | undefined {
  const logs = state.archives?.logs;
  if (!Array.isArray(logs)) {
    return undefined;
  }
  return logs.find((entry) => entry.id === logId);
}

async function copyText(value: string): Promise<void> {
  if (!value) {
    return;
  }
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === "function"
  ) {
    await navigator.clipboard.writeText(value);
    return;
  }
  if (typeof document !== "undefined") {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }
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
    ["crop", entry.kultur],
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

  return true;
}

function buildHistorySignature(entry: HistoryEntry | null | undefined): string {
  if (!entry) {
    return "";
  }
  const normalize = (value: unknown): string =>
    value == null ? "" : String(value);
  const items = Array.isArray(entry.items) ? entry.items : [];
  const itemHashes = items
    .map((item) => {
      const sortedEntries = Object.keys(item)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = (item as Record<string, unknown>)[key];
          return acc;
        }, {});
      return JSON.stringify(sortedEntries);
    })
    .sort();
  return JSON.stringify({
    savedAt: normalize(entry.savedAt),
    dateIso: normalize(entry.dateIso),
    datum: normalize(entry.datum),
    ersteller: normalize(entry.ersteller),
    standort: normalize(entry.standort),
    kultur: normalize(entry.kultur),
    usageType: normalize(entry.usageType),
    eppoCode: normalize(entry.eppoCode),
    invekos: normalize(entry.invekos),
    bbch: normalize(entry.bbch),
    gps: normalize(entry.gps),
    gpsPointId: normalize(entry.gpsPointId),
    kisten: entry.kisten ?? null,
    itemHashes,
  });
}

function pruneStateHistoryBySignatures(signatures: Set<string>): void {
  if (!signatures.size) {
    return;
  }
  updateSlice("history", (history = []) => {
    if (!Array.isArray(history) || history.length === 0) {
      return history;
    }
    let changed = false;
    const next = history.filter((entry) => {
      const signature = buildHistorySignature(entry as HistoryEntry);
      if (signatures.has(signature)) {
        changed = true;
        return false;
      }
      return true;
    });
    return changed ? next : history;
  });
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

function getLoadedPageCount(): number {
  if (dataMode === "sqlite") {
    if (totalEntries > 0) {
      return Math.max(Math.ceil(totalEntries / PAGE_SIZE), 1);
    }
    return Math.max(docPageIndex + 1, docPageCache.size || 0);
  }
  if (!allEntries.length) {
    return 0;
  }
  return Math.max(Math.ceil(allEntries.length / PAGE_SIZE), 1);
}

function getPageOffset(): number {
  if (dataMode === "sqlite") {
    const maxPage = Math.max(getLoadedPageCount() - 1, 0);
    if (docPageIndex > maxPage) {
      docPageIndex = maxPage;
    }
    if (docPageIndex < 0) {
      docPageIndex = 0;
    }
    return docPageIndex * PAGE_SIZE;
  }
  if (!allEntries.length) {
    docPageIndex = 0;
    return 0;
  }
  const maxPage = Math.max(getLoadedPageCount() - 1, 0);
  if (docPageIndex > maxPage) {
    docPageIndex = maxPage;
  }
  if (docPageIndex < 0) {
    docPageIndex = 0;
  }
  return docPageIndex * PAGE_SIZE;
}

function updateVisibleEntries(): void {
  if (!allEntries.length) {
    visibleEntries = [];
    return;
  }
  if (dataMode === "sqlite") {
    visibleEntries = allEntries.slice();
    return;
  }
  const start = getPageOffset();
  const end = Math.min(start + PAGE_SIZE, allEntries.length);
  visibleEntries = allEntries.slice(start, end);
}

function pruneDocPageCache(currentPage: number): void {
  if (docPageCache.size <= DOC_PAGE_CACHE_LIMIT) {
    return;
  }
  const pages = Array.from(docPageCache.keys()).sort((a, b) => {
    const diffA = Math.abs(a - currentPage);
    const diffB = Math.abs(b - currentPage);
    return diffB - diffA;
  });
  while (docPageCache.size > DOC_PAGE_CACHE_LIMIT && pages.length) {
    const pageToRemove = pages.shift();
    if (pageToRemove == null || pageToRemove === currentPage) {
      continue;
    }
    docPageCache.delete(pageToRemove);
  }
}

function ensurePagerWidget(section: HTMLElement): PagerWidget | null {
  const target = section.querySelector<HTMLElement>('[data-role="doc-pager"]');
  if (!target) {
    return null;
  }
  if (!docPagerWidget || docPagerTarget !== target) {
    docPagerWidget?.destroy();
    const widget = createPagerWidget(target, {
      onPrev: () => goToPrevPage(section),
      onNext: () => goToNextPage(section),
      labels: {
        prev: "Zurück",
        next: "Weiter",
        loading: "Lade Dokumentation...",
        empty: "Keine Einträge",
      },
    });
    docPagerWidget = widget;
    docPagerTarget = target;
  }
  return docPagerWidget;
}

function updatePagerWidget(section: HTMLElement): void {
  const widget = ensurePagerWidget(section);
  if (!widget) {
    return;
  }

  if (docLoadError) {
    widget.update({ status: "error", message: docLoadError });
    return;
  }

  const totalKnown = dataMode === "memory" ? allEntries.length : totalEntries;
  const visibleCount = visibleEntries.length;

  if (!visibleCount) {
    const infoMessage = isLoadingEntries
      ? "Lade Dokumentation..."
      : "Keine Einträge vorhanden.";
    widget.update({ status: "disabled", info: infoMessage });
    return;
  }

  const pageOffset =
    dataMode === "sqlite" ? docPageIndex * PAGE_SIZE : getPageOffset();
  const info = `Einträge ${numberFormatter.format(pageOffset + 1)}–${numberFormatter.format(
    pageOffset + visibleCount
  )}${totalKnown ? ` von ${numberFormatter.format(totalKnown)}` : ""}`;
  const hasNextPage =
    dataMode === "memory"
      ? pageOffset + visibleCount < allEntries.length
      : Boolean(docPageCursors.get(docPageIndex + 1));
  const canNext = !isLoadingEntries && hasNextPage;
  const canPrev = docPageIndex > 0 && !isLoadingEntries;

  widget.update({
    status: "ready",
    info,
    canPrev,
    canNext,
    loadingDirection: isLoadingEntries && hasNextPage ? "next" : null,
  });
}

function goToPrevPage(section: HTMLElement): void {
  if (docPageIndex === 0 || isLoadingEntries) {
    return;
  }
  const targetPage = Math.max(docPageIndex - 1, 0);
  if (dataMode === "sqlite") {
    resetSelection(section);
    void loadSqlitePage(section, getState().fieldLabels, targetPage);
    return;
  }
  docPageIndex = targetPage;
  updateVisibleEntries();
  renderList(section, getState().fieldLabels);
  updateInfo(section, getState().fieldLabels);
}

function goToNextPage(section: HTMLElement): void {
  if (isLoadingEntries) {
    return;
  }
  const targetPage = docPageIndex + 1;
  if (dataMode === "sqlite") {
    const hasCachedPage = docPageCache.has(targetPage);
    const cursor = docPageCursors.get(targetPage);
    if (!hasCachedPage && !cursor) {
      return;
    }
    resetSelection(section);
    void loadSqlitePage(section, getState().fieldLabels, targetPage);
    return;
  }
  const hasBufferedNext = targetPage * PAGE_SIZE < allEntries.length;
  if (!hasBufferedNext) {
    return;
  }
  docPageIndex = targetPage;
  updateVisibleEntries();
  renderList(section, getState().fieldLabels);
  updateInfo(section, getState().fieldLabels);
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
  const exportZipBtn = section.querySelector<HTMLButtonElement>(
    '[data-action="export-zip"]'
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
  if (exportZipBtn) {
    exportZipBtn.disabled = disabled;
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
    ? `${escapeHtml(gpsCoords)}${
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
  updateVisibleEntries();
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
      const isHighlighted = Boolean(
        focusContext?.highlightEntryIds?.has(item.id)
      );
      row.className = `doc-sidebar-entry list-group-item${
        isHighlighted ? " doc-sidebar-entry--highlight" : ""
      }`;
      row.dataset.entryId = item.id;
      const dateValue = resolveEntryDate(item.entry) || "-";
      const importBadge = isHighlighted
        ? '<span class="badge bg-warning-subtle text-warning-emphasis badge-import">Import</span>'
        : "";
      row.innerHTML = `
        <div
          class="doc-sidebar-entry__main"
          data-action="view-entry"
          data-entry-id="${item.id}"
        >
          <div class="d-flex justify-content-between gap-2">
            <span class="fw-bold d-flex align-items-center gap-2">
              ${escapeHtml(item.entry.kultur || "-")}
              ${importBadge}
            </span>
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

  markActiveListEntry(section, activeEntryId);
  attemptPendingSelection(section, labels);
  updatePagerWidget(section);
}

function updateInfo(
  section: HTMLElement,
  _labels: AppState["fieldLabels"]
): void {
  const info = section.querySelector<HTMLElement>('[data-role="doc-info"]');
  if (!info) {
    return;
  }
  const total = totalEntries;
  const hasOptionalFilters = Boolean(
    currentFilters.crop || currentFilters.creator
  );
  if (!total && !isLoadingEntries) {
    info.textContent = hasOptionalFilters
      ? "Keine Einträge für diese Filter im Zeitraum"
      : "Keine Einträge im ausgewählten Zeitraum";
    return;
  }
  if (!total && isLoadingEntries) {
    info.textContent = "Lade Einträge ...";
    return;
  }
  if (currentFilters.startDate && currentFilters.endDate) {
    const base = `Zeitraum ${currentFilters.startDate} - ${currentFilters.endDate} (${total})`;
    info.textContent = hasOptionalFilters ? `${base} – Filter aktiv` : base;
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

async function loadSqlitePage(
  section: HTMLElement,
  labels: AppState["fieldLabels"],
  requestedPage = docPageIndex,
  options: { forceReload?: boolean } = {}
): Promise<void> {
  const page = Math.max(0, requestedPage);
  const forceReload = Boolean(options.forceReload);

  if (forceReload) {
    docPageCache.clear();
    docPageCursors.clear();
    docPageCursors.set(0, null);
    totalEntries = 0;
    allEntries = [];
    visibleEntries = [];
    docPageIndex = 0;
    docLoadError = null;
  }

  const cachedEntries = !forceReload ? docPageCache.get(page) : undefined;
  if (cachedEntries && !options.forceReload) {
    docPageIndex = page;
    allEntries = cachedEntries;
    docLoadError = null;
    renderList(section, labels);
    updateInfo(section, labels);
    updatePagerWidget(section);
    return;
  }

  const cursor = docPageCursors.has(page)
    ? (docPageCursors.get(page) ?? null)
    : null;
  const token = Symbol("doc-load");
  currentLoadToken = token;
  isLoadingEntries = true;
  docLoadError = null;
  updatePagerWidget(section);

  try {
    const result = await listHistoryEntriesPaged({
      cursor,
      pageSize: PAGE_SIZE,
      filters: toHistoryQueryFilters(currentFilters),
      sortDirection: "desc",
      includeTotal: forceReload || page === 0 || totalEntries === 0,
    });
    if (currentLoadToken !== token) {
      return;
    }
    const mapped = result.items.map((item: Record<string, unknown>) =>
      mapSqliteHistoryEntry(item)
    );
    docPageCache.set(page, mapped);
    pruneDocPageCache(page);
    docPageCursors.set(page, cursor);
    docPageCursors.set(page + 1, result.nextCursor ?? null);

    if (typeof result.totalCount === "number") {
      totalEntries = result.totalCount;
    } else {
      const derived = page * PAGE_SIZE + mapped.length;
      totalEntries = Math.max(totalEntries, derived);
    }

    docPageIndex = page;
    allEntries = mapped;
    docLoadError = null;
    renderList(section, labels);
    updateInfo(section, labels);
  } catch (error) {
    if (currentLoadToken === token) {
      console.error("Dokumentation konnte nicht geladen werden", error);
      docLoadError =
        "Dokumentation konnte nicht geladen werden. Bitte erneut versuchen.";
      window.alert(
        "Dokumentation konnte nicht geladen werden. Bitte erneut versuchen."
      );
    }
  } finally {
    if (currentLoadToken === token) {
      isLoadingEntries = false;
      currentLoadToken = null;
      updatePagerWidget(section);
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
  docPageIndex = 0;
  docLoadError = null;
  updateVisibleEntries();
  renderList(section, state.fieldLabels);
  updateInfo(section, state.fieldLabels);
  await reopenDetailIfVisible(section, state.fieldLabels);
}

async function applyFilters(
  section: HTMLElement,
  state: AppState
): Promise<void> {
  if (!currentFilters.startDate || !currentFilters.endDate) {
    currentFilters = {
      ...currentFilters,
      ...getDefaultFilters(),
    };
    const form = section.querySelector<HTMLFormElement>("#doc-filter");
    applyDateFiltersToForm(form, currentFilters);
  }
  const driverKey = resolveStorageDriver(state);
  const hasDatabase = Boolean(state.app?.hasDatabase);
  const useSqlite = driverKey === "sqlite" && hasDatabase;
  dataMode = useSqlite ? "sqlite" : "memory";
  entryDetailCache.clear();
  docPageIndex = 0;
  docLoadError = null;
  totalEntries = 0;
  allEntries = [];
  visibleEntries = [];
  docPageCache.clear();
  docPageCursors.clear();
  docPageCursors.set(0, null);
  resetSelection(section);
  updateArchiveAvailability(section, state);
  updateArchiveFormDefaults(section);
  renderArchiveLogs(section, state.archives?.logs ?? []);
  lastArchiveLogSignature = computeArchiveLogSignature(state.archives?.logs);

  if (useSqlite) {
    await loadSqlitePage(section, state.fieldLabels, 0, { forceReload: true });
    await reopenDetailIfVisible(section, state.fieldLabels);
    return;
  }

  await loadMemoryEntries(section, state);
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

  const selectedEntries = Array.from(selectedEntryIds)
    .map((id) => findEntryById(id))
    .filter((entry): entry is DocumentationEntry => Boolean(entry));

  const entriesForRemoval: HistoryEntry[] = [];
  for (const entry of selectedEntries) {
    const detail = await resolveEntryDetail(entry);
    if (detail) {
      entriesForRemoval.push(detail);
    }
  }

  const sqliteEntries = selectedEntries.filter(
    (entry) => entry.source === "sqlite"
  );

  const removedFromSqlite = Boolean(sqliteEntries.length);
  if (removedFromSqlite) {
    for (const entry of sqliteEntries) {
      await deleteHistoryEntryById(entry.ref);
    }
  }

  const memoryIndexes = new Set(
    selectedEntries
      .filter((entry) => entry.source === "state")
      .map((entry) => entry.ref)
  );

  if (memoryIndexes.size) {
    updateSlice("history", (history) =>
      history.filter((_, idx) => !memoryIndexes.has(idx))
    );
    await persistHistoryChanges();
  }

  if (entriesForRemoval.length) {
    const signatures = new Set(
      entriesForRemoval.map((entry) => buildHistorySignature(entry))
    );
    pruneStateHistoryBySignatures(signatures);
  }

  if (removedFromSqlite) {
    try {
      await persistSqliteDatabaseFile();
    } catch (error) {
      console.warn(
        "SQLite-Datei konnte nach dem Löschen nicht gespeichert werden",
        error
      );
    }
    services.events?.emit?.("history:data-changed", {
      type: "deleted",
      ids: sqliteEntries.map((entry) => entry.ref),
    });
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

async function handleArchiveSubmit(
  section: HTMLElement,
  services: Services,
  form: HTMLFormElement
): Promise<void> {
  if (isArchiving) {
    return;
  }
  const state = services.state.getState();
  const driverKey = resolveStorageDriver(state);
  if (driverKey !== "sqlite" || !state.app?.hasDatabase) {
    setArchiveStatus(
      section,
      "Archivieren ist nur mit einer lokalen SQLite-Datenbank möglich.",
      "warning"
    );
    return;
  }
  const values = readArchiveFormValues(form);
  if (!values?.startDate || !values.endDate) {
    setArchiveStatus(
      section,
      "Bitte Start- und Enddatum für das Archiv wählen.",
      "warning"
    );
    return;
  }
  const startDate = normalizeDateInput(values.startDate);
  const endDate = normalizeDateInput(values.endDate);
  if (!startDate || !endDate) {
    setArchiveStatus(section, "Die angegebenen Daten sind ungültig.", "danger");
    return;
  }
  if (new Date(startDate) > new Date(endDate)) {
    setArchiveStatus(
      section,
      "Startdatum darf nicht nach dem Enddatum liegen.",
      "danger"
    );
    return;
  }

  const archiveFilters: DocumentationFilters = {
    startDate,
    endDate,
    creator: currentFilters.creator,
    crop: currentFilters.crop,
  };
  const queryFilters = toHistoryQueryFilters(archiveFilters);

  setArchiveBusy(section, true);
  setArchiveStatus(section, "Prüfe Zeitraum und Eintragsmenge...", "info");

  try {
    const preview = await listHistoryEntriesPaged({
      cursor: null,
      pageSize: 1,
      filters: queryFilters,
      sortDirection: "asc",
      includeTotal: true,
    });
    const targetCount = preview.totalCount ?? preview.items.length ?? 0;
    if (!targetCount) {
      setArchiveStatus(
        section,
        "Im angegebenen Zeitraum wurden keine Einträge gefunden.",
        "warning"
      );
      return;
    }
    if (targetCount > ARCHIVE_ENTRY_LIMIT) {
      setArchiveStatus(
        section,
        `Maximal ${ARCHIVE_ENTRY_LIMIT} Einträge pro Archiv erlaubt. Bitte Zeitraum verkürzen.`,
        "warning"
      );
      return;
    }

    setArchiveStatus(
      section,
      `Exportiere ${targetCount} Einträge in ein ZIP-Archiv...`,
      "info"
    );
    const exportResult = await exportHistoryRange({
      filters: queryFilters,
      limit: targetCount,
      sortDirection: "asc",
    });
    const exportedEntries = exportResult?.entries ?? [];
    if (!exportedEntries.length) {
      setArchiveStatus(
        section,
        "Archiv konnte nicht erstellt werden – Export lieferte keine Einträge.",
        "danger"
      );
      return;
    }

    const payloadEntries = exportedEntries.map((entry) => ({ ...entry }));
    const metadata = {
      format: "pflanzenschutz-archive",
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      entryCount: payloadEntries.length,
      filters: {
        startDate,
        endDate,
        creator: archiveFilters.creator || null,
        crop: archiveFilters.crop || null,
      },
      archive: {
        removeFromDatabase: values.removeAfterExport,
        storageHint: values.storageHint || null,
        note: values.note || null,
      },
    };
    const archiveZip = zipSync({
      "pflanzenschutz.json": strToU8(JSON.stringify(payloadEntries, null, 2)),
      "metadata.json": strToU8(JSON.stringify(metadata, null, 2)),
    });
    const archiveBuffer = new ArrayBuffer(archiveZip.byteLength);
    new Uint8Array(archiveBuffer).set(archiveZip);
    const archiveBlob = new Blob([archiveBuffer], { type: "application/zip" });
    const filename = buildArchiveFilename(startDate, endDate);
    triggerDownload(archiveBlob, filename);

    let vacuumFailed = false;
    if (values.removeAfterExport) {
      setArchiveStatus(
        section,
        "Export abgeschlossen. Entferne Einträge und bereinige Datenbank...",
        "info"
      );
      await deleteHistoryRange({ filters: queryFilters });
      const removedSignatures = new Set(
        payloadEntries.map((entry) => buildHistorySignature(entry))
      );
      pruneStateHistoryBySignatures(removedSignatures);
      try {
        await persistSqliteDatabaseFile();
      } catch (error) {
        console.error(
          "SQLite-Datei konnte nach dem Archivieren nicht gespeichert werden",
          error
        );
      }
      services.events?.emit?.("history:data-changed", {
        type: "deleted-range",
        filters: queryFilters,
      });
      try {
        await vacuumDatabase();
      } catch (vacuumError) {
        vacuumFailed = true;
        console.error("VACUUM fehlgeschlagen", vacuumError);
      }
    }

    const now = new Date().toISOString();
    const logEntry: ArchiveLogEntry = {
      id: `archive-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      archivedAt: now,
      startDate,
      endDate,
      entryCount: payloadEntries.length,
      fileName: filename,
      storageHint: values.storageHint || undefined,
      note: values.note || undefined,
    };
    if (vacuumFailed) {
      logEntry.note = logEntry.note
        ? `${logEntry.note} | VACUUM fehlgeschlagen`
        : "VACUUM fehlgeschlagen";
    }

    const logMetadata = {
      filters: { ...archiveFilters },
      removeAfterExport: Boolean(values.removeAfterExport),
      historyIdSample: exportResult?.historyIds?.slice(
        0,
        ARCHIVE_HIGHLIGHT_LIMIT
      ),
    } as Record<string, unknown>;
    await recordArchiveLog(logEntry, logMetadata);

    if (!values.removeAfterExport && exportResult?.historyIds?.length) {
      const refs = exportResult.historyIds
        .slice(0, ARCHIVE_HIGHLIGHT_LIMIT)
        .map((ref) => ({ source: "sqlite" as DocumentationEntrySource, ref }));
      services.events?.emit?.("documentation:focus-range", {
        startDate,
        endDate,
        label: "Archiviert",
        reason: "archive",
        entryIds: refs,
      });
    }

    toggleArchiveForm(section, false);
    form.reset();
    updateArchiveFormDefaults(section);
    await applyFilters(section, services.state.getState());
    const archiveMessage = values.removeAfterExport
      ? `Archiv ${filename} erstellt und ${payloadEntries.length} Einträge entfernt.`
      : `Archiv ${filename} erstellt. ${payloadEntries.length} Einträge bleiben in der Datenbank.`;
    setArchiveStatus(
      section,
      archiveMessage,
      vacuumFailed ? "warning" : "success"
    );
  } catch (error) {
    console.error("Archivieren fehlgeschlagen", error);
    const message =
      error instanceof Error
        ? error.message
        : "Archiv konnte nicht erstellt werden.";
    setArchiveStatus(section, message, "danger");
  } finally {
    setArchiveBusy(section, false);
    updateArchiveAvailability(section, services.state.getState());
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

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
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
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  triggerDownload(blob, `pflanzenschutz-dokumentation-${timestamp}.json`);
}

async function exportEntriesAsZip(
  entries: HistoryEntry[],
  filters: DocumentationFilters
): Promise<void> {
  if (!entries.length) {
    window.alert("Keine Einträge ausgewählt.");
    return;
  }
  const payload = entries.map((entry) => ({ ...entry }));
  const metadata = {
    format: "pflanzenschutz-export",
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    entryCount: payload.length,
    filters: {
      startDate: filters.startDate || null,
      endDate: filters.endDate || null,
      creator: filters.creator || null,
      crop: filters.crop || null,
    },
  };
  const archive = zipSync({
    "pflanzenschutz.json": strToU8(JSON.stringify(payload, null, 2)),
    "metadata.json": strToU8(JSON.stringify(metadata, null, 2)),
  });
  const archiveBuffer = new ArrayBuffer(archive.byteLength);
  new Uint8Array(archiveBuffer).set(archive);
  const blob = new Blob([archiveBuffer], { type: "application/zip" });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  triggerDownload(blob, `pflanzenschutz-dokumentation-${timestamp}.zip`);
}

function createSection(): HTMLElement {
  const wrapper = document.createElement("div");
  const defaultFilters = getDefaultFilters();
  const startValue = currentFilters.startDate || defaultFilters.startDate || "";
  const endValue = currentFilters.endDate || defaultFilters.endDate || "";
  currentFilters = {
    ...currentFilters,
    startDate: startValue,
    endDate: endValue,
  };
  wrapper.className = "section-inner";
  wrapper.innerHTML = `
    <h2 class="text-center mb-4">Dokumentation</h2>
    <div class="card card-dark mb-4 no-print">
      <div class="card-body">
        <form id="doc-filter" class="row g-3">
          <div class="col-md-3">
            <label class="form-label" for="doc-start">Startdatum*</label>
            <input type="date" class="form-control" id="doc-start" name="doc-start" required value="${startValue}" />
          </div>
          <div class="col-md-3">
            <label class="form-label" for="doc-end">Enddatum*</label>
            <input type="date" class="form-control" id="doc-end" name="doc-end" required value="${endValue}" />
          </div>
          <div class="col-md-3">
            <label class="form-label" for="doc-crop">Kultur (optional)</label>
            <input type="text" class="form-control" id="doc-crop" name="doc-crop" placeholder="z. B. Äpfel" value="${currentFilters.crop || ""}" />
          </div>
          <div class="col-md-3">
            <label class="form-label" for="doc-creator">Anwender (optional)</label>
            <input type="text" class="form-control" id="doc-creator" name="doc-creator" placeholder="Name" value="${currentFilters.creator || ""}" />
          </div>
          <div class="col-12 d-flex gap-2 justify-content-end">
            <span class="text-muted small me-auto">* Pflichtfelder</span>
            <button class="btn btn-outline-secondary" type="reset" data-action="reset-filters">Zurücksetzen</button>
            <button class="btn btn-success" type="submit">Filter anwenden</button>
          </div>
        </form>
      </div>
    </div>

    <div class="card card-dark mt-4" data-role="archive-card">
      <div class="card-header d-flex flex-column flex-lg-row justify-content-between align-items-lg-center gap-2">
        <div>Archiv & Bereinigung</div>
        <span class="badge bg-secondary" data-role="archive-driver-hint">Nur mit SQLite verfügbar</span>
      </div>
      <div class="card-body">
        <p class="text-muted small mb-3">
          Exportiere einen Zeitraum als ZIP-Backup und lösche die Einträge optional endgültig aus der Datenbank.
        </p>
        <div class="alert alert-info d-none" data-role="archive-status"></div>
        <form class="row g-3 d-none" data-role="archive-form">
          <div class="col-md-3">
            <label class="form-label" for="archive-start">Startdatum</label>
            <input type="date" class="form-control" id="archive-start" name="archive-start" required value="${startValue}" />
          </div>
          <div class="col-md-3">
            <label class="form-label" for="archive-end">Enddatum</label>
            <input type="date" class="form-control" id="archive-end" name="archive-end" required value="${endValue}" />
          </div>
          <div class="col-md-3">
            <label class="form-label" for="archive-storage">Speicherort / Hinweis (optional)</label>
            <input type="text" class="form-control" id="archive-storage" name="archive-storage" placeholder="z. B. NAS-Ordner" />
          </div>
          <div class="col-12">
            <label class="form-label" for="archive-note">Notiz (optional)</label>
            <textarea class="form-control" id="archive-note" name="archive-note" rows="2" placeholder="Zusätzliche Hinweise"></textarea>
          </div>
          <div class="col-12">
            <div class="form-check">
              <input class="form-check-input" type="checkbox" id="archive-remove" name="archive-remove" checked />
              <label class="form-check-label" for="archive-remove">
                Nach erfolgreichem Export aus Datenbank entfernen (inkl. VACUUM)
              </label>
            </div>
          </div>
          <div class="col-12 d-flex flex-wrap gap-2">
            <button class="btn btn-outline-secondary" type="button" data-action="archive-cancel">Abbrechen</button>
            <button class="btn btn-primary" type="submit" data-action="archive-submit">Archiv jetzt erstellen</button>
          </div>
        </form>
        <div class="d-flex flex-wrap gap-2">
          <button class="btn btn-outline-warning" type="button" data-action="archive-toggle">Archiv erstellen</button>
        </div>
        <div class="mt-4">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <h5 class="h6 mb-0">Archiv-Historie</h5>
            <small class="text-muted">Letzte ${ARCHIVE_LOG_LIMIT}</small>
          </div>
          <div data-role="archive-log-list"></div>
        </div>
      </div>
    </div>

    <div class="card card-dark mt-4">
      <div class="card-header d-flex flex-column flex-lg-row justify-content-between align-items-lg-center gap-3 no-print">
        <div class="small text-muted" data-role="doc-info">Keine Einträge</div>
        <div class="d-flex flex-wrap gap-2 align-items-center">
          <div class="small text-muted" data-role="doc-selection-info">Keine Einträge ausgewählt</div>
          <div class="btn-group">
            <button class="btn btn-outline-light btn-sm" data-action="print-selection" disabled>Drucken</button>
            <button class="btn btn-outline-light btn-sm" data-action="export-selection" disabled>JSON-Export</button>
            <button class="btn btn-outline-light btn-sm" data-action="export-zip" disabled>ZIP-Export</button>
            <button class="btn btn-outline-light btn-sm" data-action="delete-selection" disabled>Löschen</button>
          </div>
        </div>
      </div>
      <div class="doc-focus-banner d-none no-print" data-role="doc-focus-banner">
        <div class="d-flex flex-column flex-lg-row align-items-lg-center gap-2">
          <span data-role="doc-focus-text">Importierter Zeitraum aktiv.</span>
          <button class="btn btn-sm btn-outline-warning" data-action="doc-focus-clear">Markierung entfernen</button>
        </div>
      </div>
      <div class="card-body p-0">
        <div class="row g-0">
          <div class="col-12 col-lg-4 border-end">
            <div class="d-flex flex-column h-100">
              <div data-role="doc-list" class="list-group list-group-flush flex-grow-1 overflow-auto"></div>
              <div class="p-3">
                <div data-role="doc-pager"></div>
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
  const readDate = (name: string): string | undefined => {
    const value = data.get(name);
    return typeof value === "string" && value ? value : undefined;
  };
  const readText = (name: string): string | undefined => {
    const value = data.get(name);
    if (typeof value !== "string") {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  };
  return {
    startDate: readDate("doc-start"),
    endDate: readDate("doc-end"),
    crop: readText("doc-crop"),
    creator: readText("doc-creator"),
  };
}

function wireEventHandlers(section: HTMLElement, services: Services): void {
  section.addEventListener("submit", (event) => {
    if (!(event.target instanceof HTMLFormElement)) {
      return;
    }
    if (event.target.id === "doc-filter") {
      event.preventDefault();
      clearFocusContext(section, services, { refreshList: true });
      const nextFilters = parseFilters(event.target);
      if (!nextFilters.startDate || !nextFilters.endDate) {
        window.alert("Bitte Start- und Enddatum auswählen.");
        return;
      }
      currentFilters = nextFilters;
      resetSelection(section);
      void applyFilters(section, services.state.getState());
      return;
    }
    if (event.target.dataset.role === "archive-form") {
      event.preventDefault();
      void handleArchiveSubmit(section, services, event.target);
    }
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
      currentFilters = getDefaultFilters();
      applyDateFiltersToForm(form ?? null, currentFilters);
      clearFocusContext(section, services, { refreshList: true });
      resetSelection(section);
      void applyFilters(section, services.state.getState());
      return;
    }

    if (action === "archive-toggle") {
      toggleArchiveForm(section);
      setArchiveStatus(section, "");
      return;
    }

    if (action === "archive-cancel") {
      toggleArchiveForm(section, false);
      setArchiveStatus(section, "");
      return;
    }

    if (action === "archive-log-focus") {
      const logId = target.dataset.logId;
      if (!logId) {
        return;
      }
      const log = getArchiveLogById(services.state.getState(), logId);
      if (!log) {
        window.alert("Archiv-Eintrag nicht gefunden.");
        return;
      }
      const label = log.fileName
        ? `Archiv ${log.fileName}`
        : "Archivierter Zeitraum";
      if (typeof services.events?.emit === "function") {
        services.events.emit("documentation:focus-range", {
          startDate: log.startDate,
          endDate: log.endDate,
          label,
          reason: "archive-log",
        });
      } else {
        currentFilters = {
          ...currentFilters,
          startDate: log.startDate,
          endDate: log.endDate,
        };
        void applyFilters(section, services.state.getState());
      }
      setArchiveStatus(
        section,
        `Dokumentation auf Archiv ${log.startDate} – ${log.endDate} fokussiert.`,
        "success"
      );
      return;
    }

    if (action === "archive-log-copy-hint") {
      const logId = target.dataset.logId;
      if (!logId) {
        return;
      }
      const log = getArchiveLogById(services.state.getState(), logId);
      if (!log || !log.storageHint) {
        window.alert("Kein Speicherhinweis vorhanden.");
        return;
      }
      const storageHint = log.storageHint;
      void (async () => {
        try {
          await copyText(storageHint);
          setArchiveStatus(section, "Speicherhinweis kopiert.", "success");
        } catch (error) {
          console.error("Hinweis konnte nicht kopiert werden", error);
          window.alert("Hinweis konnte nicht kopiert werden.");
        }
      })();
      return;
    }

    if (action === "doc-focus-clear") {
      clearFocusContext(section, services, { refreshList: true });
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

    if (action === "export-zip") {
      void (async () => {
        const entries = await collectSelectedEntries();
        await exportEntriesAsZip(entries, currentFilters);
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
  updateArchiveAvailability(section, services.state.getState());
  updateArchiveFormDefaults(section);
  const initialLogs = services.state.getState().archives?.logs ?? [];
  renderArchiveLogs(section, initialLogs);
  lastArchiveLogSignature = computeArchiveLogSignature(initialLogs);
  void ensureArchiveLogsLoaded();

  if (typeof services.events?.subscribe === "function") {
    services.events.subscribe(
      "documentation:focus-range",
      (payload: unknown) => {
        if (!payload || typeof payload !== "object") {
          return;
        }
        handleFocusRangeEvent(
          section,
          services,
          payload as DocumentationFocusPayload
        );
      }
    );

    services.events.subscribe("history:data-changed", () => {
      if (dataMode !== "sqlite" || focusLock) {
        return;
      }
      applyAndRender();
    });
  }

  const applyAndRender = () => {
    void applyFilters(section, services.state.getState());
  };

  lastHistoryLength = Array.isArray(services.state.getState().history)
    ? services.state.getState().history.length
    : 0;

  applyAndRender();

  services.state.subscribe((nextState) => {
    const nextLogSignature = computeArchiveLogSignature(
      nextState.archives?.logs
    );
    if (nextLogSignature !== lastArchiveLogSignature) {
      lastArchiveLogSignature = nextLogSignature;
      renderArchiveLogs(section, nextState.archives?.logs ?? []);
    }
    const nextLength = Array.isArray(nextState.history)
      ? nextState.history.length
      : 0;
    if (focusLock) {
      lastHistoryLength = nextLength;
      return;
    }
    if (dataMode === "sqlite") {
      lastHistoryLength = nextLength;
      return;
    }
    if (nextLength !== lastHistoryLength) {
      lastHistoryLength = nextLength;
      applyAndRender();
    }
  });

  initialized = true;
}
