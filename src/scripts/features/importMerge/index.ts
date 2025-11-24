import { getDatabaseSnapshot } from "@scripts/core/database";
import { getActiveDriverKey, saveDatabase } from "@scripts/core/storage";
import {
  appendHistoryEntry,
  listHistoryEntries,
  persistSqliteDatabaseFile,
  type HistoryQueryFilters,
} from "@scripts/core/storage/sqlite";
import { updateSlice, type AppState } from "@scripts/core/state";
import { escapeHtml, formatDateFromIso } from "@scripts/core/utils";
import { strFromU8, unzipSync } from "fflate";

type HistoryEntry = {
  savedAt?: string;
  createdAt?: string;
  dateIso?: string | null;
  datum?: string;
  date?: string;
  ersteller?: string;
  standort?: string;
  kultur?: string;
  usageType?: string;
  invekos?: string;
  items?: any[];
  [key: string]: unknown;
};

type DocumentationFocusEntryRef =
  | string
  | number
  | {
      source?: "sqlite" | "state";
      ref: string | number;
    };

interface ImportSessionStats {
  startDateLabel: string;
  endDateLabel: string;
  startDateRaw: string | null;
  endDateRaw: string | null;
  entryCount: number;
  importableCount: number;
  duplicateCount: number;
  creators: string[];
  crops: string[];
}

interface ImportSession {
  filename: string;
  entries: HistoryEntry[];
  importableEntries: HistoryEntry[];
  metadata: Record<string, any> | null;
  stats: ImportSessionStats;
  warnings: string[];
  lastImportRefs: DocumentationFocusEntryRef[];
}

interface ImportRange {
  startIso: string | null;
  endIso: string | null;
}

interface Services {
  state: {
    getState: () => AppState;
    updateSlice?: typeof updateSlice;
  };
  events?: {
    emit?: (eventName: string, payload?: unknown) => void;
  };
}

const SUPPORTED_ZIP_FILES = [
  "pflanzenschutz.json",
  "history.json",
  "entries.json",
];
let initialized = false;
let currentSession: ImportSession | null = null;
let isProcessing = false;

function createSection(): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "section-inner";
  wrapper.innerHTML = `
    <h2 class="text-center mb-4">Import & Merge</h2>
    <div class="card card-dark mb-4">
      <div class="card-body">
        <p class="text-muted mb-3">
          Lade hier ZIP- oder JSON-Backups hoch, prüfe die Inhalte und führe sie in deine lokale Datenbank zusammen.
          Du kannst nach erfolgreichem Import automatisch zur passenden Stelle in der Dokumentation springen.
        </p>
        <div class="mb-3">
          <label class="form-label">Backup-Datei (ZIP oder JSON)</label>
          <input type="file" class="form-control" accept=".zip,.json,application/zip,application/json" data-role="import-file" />
        </div>
        <div class="d-flex gap-2 flex-wrap">
          <button class="btn btn-outline-secondary" data-action="clear-import" disabled>Zurücksetzen</button>
        </div>
        <div class="alert alert-info small mt-3 d-none" data-role="import-hint"></div>
      </div>
    </div>

    <div class="card card-dark d-none" data-role="import-summary-card">
      <div class="card-header d-flex flex-column flex-lg-row justify-content-between gap-3">
        <div>
          <strong>Datei:</strong> <span data-role="import-file-name">-</span>
        </div>
        <div class="small text-muted" data-role="import-summary-subline"></div>
      </div>
      <div class="card-body">
        <div class="row g-3" data-role="import-stats"></div>
        <div class="mt-3" data-role="import-warnings"></div>
        <div class="table-responsive mt-3">
          <table class="table table-dark table-sm mb-0">
            <thead>
              <tr>
                <th>Datum</th>
                <th>Kultur</th>
                <th>Anwender</th>
                <th>Standort</th>
                <th>Gespeichert</th>
              </tr>
            </thead>
            <tbody data-role="import-preview-table"></tbody>
          </table>
        </div>
        <div class="d-flex flex-wrap gap-2 mt-3">
          <button class="btn btn-outline-info" data-action="focus-import" disabled>Dokumentation markieren</button>
          <button class="btn btn-success" data-action="run-import" disabled>Import starten</button>
        </div>
        <p class="small text-muted mt-2" data-role="import-feedback"></p>
      </div>
    </div>
  `;
  return wrapper;
}

function setHint(
  section: HTMLElement,
  message: string,
  variant: "info" | "warning" | "danger" | "success" = "info"
): void {
  const hint = section.querySelector<HTMLElement>('[data-role="import-hint"]');
  if (!hint) {
    return;
  }
  if (!message) {
    hint.classList.add("d-none");
    hint.textContent = "";
    return;
  }
  hint.className = `alert alert-${variant} small mt-3`;
  hint.textContent = message;
}

function setFeedback(section: HTMLElement, message: string): void {
  const target = section.querySelector<HTMLElement>(
    '[data-role="import-feedback"]'
  );
  if (target) {
    target.textContent = message;
  }
}

function updateActionButtons(section: HTMLElement): void {
  const clearBtn = section.querySelector<HTMLButtonElement>(
    '[data-action="clear-import"]'
  );
  const focusBtn = section.querySelector<HTMLButtonElement>(
    '[data-action="focus-import"]'
  );
  const importBtn = section.querySelector<HTMLButtonElement>(
    '[data-action="run-import"]'
  );
  const hasSession = Boolean(currentSession);
  if (clearBtn) {
    clearBtn.disabled = !hasSession || isProcessing;
  }
  if (focusBtn) {
    focusBtn.disabled = !hasSession || isProcessing;
  }
  if (importBtn) {
    const hasImportable = Boolean(
      currentSession?.importableEntries?.length && currentSession.stats
    );
    importBtn.disabled = !hasSession || !hasImportable || isProcessing;
  }
}

function resetSession(section: HTMLElement): void {
  currentSession = null;
  const summaryCard = section.querySelector<HTMLElement>(
    '[data-role="import-summary-card"]'
  );
  const fileInput = section.querySelector<HTMLInputElement>(
    '[data-role="import-file"]'
  );
  if (summaryCard) {
    summaryCard.classList.add("d-none");
  }
  if (fileInput) {
    fileInput.value = "";
  }
  setFeedback(section, "");
  setHint(section, "Bereit für eine neue Importdatei.");
  updateActionButtons(section);
}

function resolveEntryDateIso(entry: HistoryEntry): string | null {
  if (entry.dateIso) {
    return entry.dateIso;
  }
  if (entry.datum) {
    const iso = new Date(entry.datum);
    if (!Number.isNaN(iso.getTime())) {
      return iso.toISOString();
    }
  }
  if (entry.date) {
    const iso = new Date(entry.date);
    if (!Number.isNaN(iso.getTime())) {
      return iso.toISOString();
    }
  }
  if (entry.savedAt) {
    const iso = new Date(entry.savedAt);
    if (!Number.isNaN(iso.getTime())) {
      return iso.toISOString();
    }
  }
  return null;
}

function formatDisplayDate(value: string | null): string {
  if (!value) {
    return "-";
  }
  return formatDateFromIso(value) || value.slice(0, 10);
}

function ensureSavedAt(entry: HistoryEntry): HistoryEntry {
  if (!entry.savedAt) {
    entry.savedAt =
      entry.createdAt || entry.dateIso || new Date().toISOString();
  }
  return entry;
}

function toDateBoundaryIso(
  value: string | null,
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

function normalizeEntry(raw: any): HistoryEntry | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const entry: HistoryEntry = { ...raw };
  if (!Array.isArray(entry.items)) {
    const rawItems = (raw as { items?: unknown }).items;
    entry.items = Array.isArray(rawItems) ? [...(rawItems as any[])] : [];
  }
  ensureSavedAt(entry);
  return entry;
}

function resolveImportRange(
  entries: HistoryEntry[],
  metadata: Record<string, any> | null
): ImportRange {
  const isoDates = entries
    .map((entry) => resolveEntryDateIso(entry))
    .filter((value): value is string => Boolean(value))
    .sort();
  return {
    startIso: isoDates[0] || metadata?.filters?.startDate || null,
    endIso: isoDates[isoDates.length - 1] || metadata?.filters?.endDate || null,
  };
}

function buildRangeFilters(
  range: ImportRange | null
): HistoryQueryFilters | undefined {
  if (!range) {
    return undefined;
  }
  const startDate = toDateBoundaryIso(range.startIso, "start");
  const endDate = toDateBoundaryIso(range.endIso, "end");
  if (!startDate && !endDate) {
    return undefined;
  }
  const filters: HistoryQueryFilters = {};
  if (startDate) {
    filters.startDate = startDate;
  }
  if (endDate) {
    filters.endDate = endDate;
  }
  return filters;
}

async function loadExistingDuplicateKeys(
  state: AppState,
  range: ImportRange | null
): Promise<Set<string>> {
  const driverKey = getActiveDriverKey();
  if (driverKey !== "sqlite") {
    const existingHistory = Array.isArray(state.history) ? state.history : [];
    return new Set(
      existingHistory
        .map((entry: any) => buildDuplicateKey(entry))
        .filter((key): key is string => Boolean(key))
    );
  }
  const filters = buildRangeFilters(range);
  if (!filters) {
    return new Set();
  }
  const keys = new Set<string>();
  let page = 1;
  const pageSize = 500;
  try {
    while (true) {
      const result = await listHistoryEntries({
        page,
        pageSize,
        filters,
        sortDirection: "asc",
      });
      result.items.forEach((item) => {
        const key = buildDuplicateKey(item as HistoryEntry);
        if (key) {
          keys.add(key);
        }
      });
      if (page * pageSize >= result.totalCount) {
        break;
      }
      page += 1;
    }
  } catch (error) {
    console.warn(
      "Konnte vorhandene Einträge für Duplikatprüfung nicht laden",
      error
    );
    return new Set();
  }
  return keys;
}

function buildDuplicateKey(entry: HistoryEntry): string {
  const base =
    entry.savedAt || entry.dateIso || entry.createdAt || entry.datum || "";
  const creator = entry.ersteller || "";
  const crop = entry.kultur || "";
  const field = entry.invekos || entry.standort || "";
  return [base, creator, crop, field].join("|");
}

function computeStats(
  entries: HistoryEntry[],
  importable: HistoryEntry[],
  metadata: Record<string, any> | null,
  range?: ImportRange
): ImportSessionStats {
  const effectiveRange = range || resolveImportRange(entries, metadata);
  const startIso = effectiveRange.startIso;
  const endIso = effectiveRange.endIso;

  const uniqueCreators = new Set<string>();
  const uniqueCrops = new Set<string>();
  importable.forEach((entry) => {
    if (entry.ersteller) {
      uniqueCreators.add(entry.ersteller);
    }
    if (entry.kultur) {
      uniqueCrops.add(entry.kultur);
    }
  });

  return {
    startDateLabel: formatDisplayDate(startIso),
    endDateLabel: formatDisplayDate(endIso),
    startDateRaw: startIso,
    endDateRaw: endIso,
    entryCount: entries.length,
    importableCount: importable.length,
    duplicateCount: entries.length - importable.length,
    creators: Array.from(uniqueCreators).slice(0, 5),
    crops: Array.from(uniqueCrops).slice(0, 5),
  };
}

function renderStats(section: HTMLElement, session: ImportSession): void {
  const container = section.querySelector<HTMLElement>(
    '[data-role="import-stats"]'
  );
  if (!container) {
    return;
  }
  if (!session) {
    container.innerHTML = "";
    return;
  }
  const stats = session.stats;
  const filters = session.metadata?.filters;
  container.innerHTML = `
    <div class="col-12 col-md-4">
      <div class="border rounded p-3 h-100">
        <div class="text-muted small">Zeitraum</div>
        <div class="fw-bold">${escapeHtml(stats.startDateLabel)} – ${escapeHtml(stats.endDateLabel)}</div>
      </div>
    </div>
    <div class="col-12 col-md-4">
      <div class="border rounded p-3 h-100">
        <div class="text-muted small">Einträge</div>
        <div class="fw-bold">${stats.importableCount} / ${stats.entryCount}</div>
        <div class="text-muted small">${stats.duplicateCount} Duplikat(e) übersprungen</div>
      </div>
    </div>
    <div class="col-12 col-md-4">
      <div class="border rounded p-3 h-100">
        <div class="text-muted small">Filter aus Backup</div>
        <div class="fw-bold">${escapeHtml(
          filters?.label || filters?.scope || "—"
        )}</div>
        <div class="text-muted small">${escapeHtml(
          filters
            ? [filters.creator, filters.crop].filter(Boolean).join(" · ") ||
                "Keine zusätzlichen Filter"
            : "Keine Angaben"
        )}</div>
      </div>
    </div>
  `;
}

function renderWarnings(section: HTMLElement, session: ImportSession): void {
  const target = section.querySelector<HTMLElement>(
    '[data-role="import-warnings"]'
  );
  if (!target) {
    return;
  }
  if (!session || !session.warnings.length) {
    target.innerHTML = "";
    return;
  }
  const list = session.warnings
    .map((warning) => `<li>${escapeHtml(warning)}</li>`)
    .join("");
  target.innerHTML = `
    <div class="alert alert-warning">
      <strong>Hinweise:</strong>
      <ul class="mb-0">${list}</ul>
    </div>
  `;
}

function renderPreview(
  section: HTMLElement,
  session: ImportSession | null
): void {
  const tableBody = section.querySelector<HTMLElement>(
    '[data-role="import-preview-table"]'
  );
  if (!tableBody) {
    return;
  }
  if (!session) {
    tableBody.innerHTML = "";
    return;
  }
  const rows = session.entries.slice(0, 5);
  if (!rows.length) {
    tableBody.innerHTML =
      '<tr><td colspan="5" class="text-center text-muted">Keine Einträge</td></tr>';
    return;
  }
  const html = rows
    .map((entry) => {
      const date = formatDisplayDate(resolveEntryDateIso(entry));
      return `
        <tr>
          <td>${escapeHtml(date)}</td>
          <td>${escapeHtml(entry.kultur || "-")}</td>
          <td>${escapeHtml(entry.ersteller || "-")}</td>
          <td>${escapeHtml(entry.standort || entry.invekos || "-")}</td>
          <td>${escapeHtml(entry.savedAt ? formatDisplayDate(entry.savedAt) : "-")}</td>
        </tr>
      `;
    })
    .join("");
  tableBody.innerHTML = html;
}

async function readZipPayload(buffer: Uint8Array): Promise<{
  entries: any[];
  metadata: Record<string, any> | null;
}> {
  const archive = unzipSync(buffer);
  const availableNames = Object.keys(archive);
  const payloadFile = availableNames.find((name) => {
    return SUPPORTED_ZIP_FILES.some((candidate) =>
      name.toLowerCase().endsWith(candidate)
    );
  });
  if (!payloadFile) {
    throw new Error("ZIP enthält keine 'pflanzenschutz.json'.");
  }
  const payload = JSON.parse(strFromU8(archive[payloadFile]!));
  const metadataFile = availableNames.find((name) =>
    name.toLowerCase().endsWith("metadata.json")
  );
  const metadata = metadataFile
    ? JSON.parse(strFromU8(archive[metadataFile]!))
    : null;
  const entries = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.entries)
      ? payload.entries
      : [];
  return { entries, metadata };
}

async function readJsonPayload(buffer: Uint8Array): Promise<{
  entries: any[];
  metadata: Record<string, any> | null;
}> {
  const text = strFromU8(buffer);
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) {
    return { entries: parsed, metadata: null };
  }
  if (Array.isArray(parsed.entries)) {
    return { entries: parsed.entries, metadata: parsed.metadata || null };
  }
  throw new Error("JSON enthält keine Eintragsliste.");
}

async function buildSession(
  file: File,
  state: AppState
): Promise<ImportSession> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  const isZip = /\.zip$/i.test(file.name) || file.type === "application/zip";
  const { entries: rawEntries, metadata } = isZip
    ? await readZipPayload(buffer)
    : await readJsonPayload(buffer);
  if (!Array.isArray(rawEntries) || !rawEntries.length) {
    throw new Error("Keine Einträge in der Datei gefunden.");
  }
  const normalized = rawEntries
    .map((entry) => normalizeEntry(entry))
    .filter((entry): entry is HistoryEntry => Boolean(entry));
  if (!normalized.length) {
    throw new Error("Die Datei enthielt keine verwertbaren Einträge.");
  }
  const range = resolveImportRange(normalized, metadata);
  const existingKeys = await loadExistingDuplicateKeys(state, range);
  const seenKeys = new Set<string>();
  const importable: HistoryEntry[] = [];
  let duplicates = 0;
  normalized.forEach((entry) => {
    const key = buildDuplicateKey(entry);
    if (!key) {
      importable.push(entry);
      return;
    }
    if (existingKeys.has(key) || seenKeys.has(key)) {
      duplicates += 1;
      return;
    }
    seenKeys.add(key);
    importable.push(entry);
  });

  const stats = computeStats(normalized, importable, metadata, range);
  const warnings: string[] = [];
  if (duplicates) {
    warnings.push(
      `${duplicates} Datensätze wurden wegen gleicher Kennung übersprungen.`
    );
  }
  if (!stats.startDateRaw || !stats.endDateRaw) {
    warnings.push("Zeitraum konnte nicht eindeutig ermittelt werden.");
  }

  return {
    filename: file.name,
    entries: normalized,
    importableEntries: importable,
    metadata,
    stats,
    warnings,
    lastImportRefs: [],
  };
}

function renderSession(section: HTMLElement): void {
  const summaryCard = section.querySelector<HTMLElement>(
    '[data-role="import-summary-card"]'
  );
  if (!summaryCard) {
    return;
  }
  if (!currentSession) {
    summaryCard.classList.add("d-none");
    updateActionButtons(section);
    return;
  }
  summaryCard.classList.remove("d-none");
  const nameNode = summaryCard.querySelector<HTMLElement>(
    '[data-role="import-file-name"]'
  );
  const subline = summaryCard.querySelector<HTMLElement>(
    '[data-role="import-summary-subline"]'
  );
  if (nameNode) {
    nameNode.textContent = currentSession.filename;
  }
  if (subline) {
    subline.textContent = `${currentSession.stats.importableCount} von ${currentSession.stats.entryCount} Einträgen importierbar`;
  }
  renderStats(section, currentSession);
  renderWarnings(section, currentSession);
  renderPreview(section, currentSession);
  updateActionButtons(section);
}

async function persistNonSqliteSnapshot(): Promise<void> {
  const driverKey = getActiveDriverKey();
  if (!driverKey || driverKey === "memory" || driverKey === "sqlite") {
    return;
  }
  const snapshot = getDatabaseSnapshot();
  await saveDatabase(snapshot);
}

function appendEntriesToStateHistory(
  services: Services,
  entries: HistoryEntry[]
): number[] {
  if (!entries.length) {
    return [];
  }
  const updateStateSlice =
    typeof services.state.updateSlice === "function"
      ? services.state.updateSlice
      : updateSlice;
  const refs: number[] = [];
  updateStateSlice("history", (history = []) => {
    const baseLength = Array.isArray(history) ? history.length : 0;
    entries.forEach((_, idx) => {
      refs.push(baseLength + idx);
    });
    return Array.isArray(history) ? [...history, ...entries] : [...entries];
  });
  return refs;
}

async function runImport(
  section: HTMLElement,
  services: Services
): Promise<void> {
  if (!currentSession) {
    window.alert("Bitte zuerst eine Importdatei laden.");
    return;
  }
  if (!currentSession.importableEntries.length) {
    window.alert(
      "Alle Einträge wurden bereits importiert oder als Duplikat erkannt."
    );
    return;
  }
  isProcessing = true;
  updateActionButtons(section);
  setFeedback(section, "Import läuft ...");

  const driverKey = getActiveDriverKey();
  const importedRefs: DocumentationFocusEntryRef[] = [];
  const failed: string[] = [];
  const entriesToImport = currentSession.importableEntries.map((entry) =>
    ensureSavedAt({ ...entry })
  );

  try {
    if (driverKey === "sqlite") {
      for (const entry of entriesToImport) {
        try {
          const result = await appendHistoryEntry(entry);
          if (result?.id != null) {
            importedRefs.push({ source: "sqlite", ref: result.id });
          }
        } catch (error) {
          console.error("appendHistoryEntry failed", error);
          failed.push(entry.savedAt || "Unbekannter Eintrag");
        }
      }
      appendEntriesToStateHistory(services, entriesToImport);
      try {
        await persistSqliteDatabaseFile();
      } catch (error) {
        console.warn(
          "SQLite-Datei konnte nach dem Import nicht gespeichert werden",
          error
        );
      }
    } else {
      const stateRefs = appendEntriesToStateHistory(services, entriesToImport);
      stateRefs.forEach((ref) => {
        importedRefs.push({ source: "state", ref });
      });
      await persistNonSqliteSnapshot();
    }

    const successCount = importedRefs.length;
    if (successCount) {
      setFeedback(
        section,
        `${successCount} Einträge importiert. ${failed.length ? `${failed.length} Einträge konnten nicht übernommen werden.` : ""}`.trim()
      );
      currentSession.lastImportRefs = importedRefs;
      emitDocumentationFocus(services, currentSession, importedRefs);
    } else {
      setFeedback(section, "Keine Einträge wurden importiert.");
    }
    if (failed.length) {
      setHint(
        section,
        `${failed.length} Einträge konnten nicht gespeichert werden. Details siehe Konsole.`,
        "warning"
      );
    } else {
      setHint(section, "Import abgeschlossen.", "success");
    }
  } catch (error) {
    console.error("Import fehlgeschlagen", error);
    setFeedback(section, "Import fehlgeschlagen. Siehe Konsole für Details.");
    setHint(
      section,
      "Import fehlgeschlagen. Bitte erneut versuchen.",
      "danger"
    );
  } finally {
    isProcessing = false;
    updateActionButtons(section);
  }
}

function emitDocumentationFocus(
  services: Services,
  session: ImportSession,
  refs: DocumentationFocusEntryRef[]
): void {
  if (!services.events?.emit) {
    return;
  }
  const label =
    session.metadata?.label ||
    session.metadata?.filters?.label ||
    `Import ${session.filename}`;
  services.events.emit("documentation:focus-range", {
    startDate: session.stats.startDateRaw || undefined,
    endDate: session.stats.endDateRaw || undefined,
    label,
    reason: "import",
    entryIds: refs,
    autoSelectFirst: Boolean(refs.length),
  });
}

function handleFocusRequest(section: HTMLElement, services: Services): void {
  if (!currentSession) {
    window.alert("Bitte zuerst eine Importdatei laden.");
    return;
  }
  if (!currentSession.stats.startDateRaw || !currentSession.stats.endDateRaw) {
    window.alert("Zeitraum konnte nicht bestimmt werden.");
    return;
  }
  emitDocumentationFocus(
    services,
    currentSession,
    currentSession.lastImportRefs
  );
  setHint(section, "Dokumentation wurde auf den Importzeitraum fokussiert.");
}

function wireEventHandlers(section: HTMLElement, services: Services): void {
  const fileInput = section.querySelector<HTMLInputElement>(
    '[data-role="import-file"]'
  );
  if (fileInput) {
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (!file) {
        return;
      }
      isProcessing = true;
      setHint(section, "Datei wird analysiert ...");
      updateActionButtons(section);
      setFeedback(section, "");
      void buildSession(file, services.state.getState())
        .then((session) => {
          currentSession = session;
          renderSession(section);
          setHint(
            section,
            `${session.importableEntries.length} Einträge bereit zum Import.`
          );
        })
        .catch((error) => {
          console.error("Importdatei konnte nicht gelesen werden", error);
          setHint(
            section,
            error?.message || "Importdatei konnte nicht gelesen werden.",
            "danger"
          );
          currentSession = null;
          renderSession(section);
        })
        .finally(() => {
          isProcessing = false;
          updateActionButtons(section);
        });
    });
  }

  section.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      "[data-action]"
    );
    if (!target) {
      return;
    }
    const action = target.dataset.action;
    if (!action) {
      return;
    }
    if (action === "clear-import") {
      resetSession(section);
      return;
    }
    if (action === "focus-import") {
      handleFocusRequest(section, services);
      return;
    }
    if (action === "run-import") {
      void runImport(section, services);
    }
  });
}

export function initImportMerge(
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
  setHint(section, "Wähle eine Datei aus, um den Import zu starten.");
  initialized = true;
}
