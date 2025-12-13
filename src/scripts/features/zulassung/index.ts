import {
  getState,
  subscribeState,
  updateSlice,
  type AppState,
} from "@scripts/core/state";
import { syncBvlData } from "@scripts/core/bvlSync";
import { checkForUpdates } from "@scripts/core/bvlDataset";
import * as storage from "@scripts/core/storage/sqlite";
import { saveDatabase } from "@scripts/core/storage";
import { getDatabaseSnapshot } from "@scripts/core/database";
import { escapeHtml, debounce } from "@scripts/core/utils";
import {
  createPagerWidget,
  type PagerDirection,
  type PagerWidget,
} from "@scripts/features/shared/pagerWidget";
import {
  searchEppoSuggestions,
  searchBbchSuggestions,
} from "@scripts/core/lookups";
import { emit as emitEvent } from "@scripts/core/eventBus";

// Saved EPPO/BBCH state for the codes manager
let savedEppoList: storage.SavedEppoRecord[] = [];
let savedBbchList: storage.SavedBbchRecord[] = [];
let codesManagerInitialized = false;

declare const bootstrap:
  | {
      Collapse: new (
        element: Element,
        options?: unknown
      ) => {
        toggle?: () => void;
        show?: () => void;
        hide?: () => void;
      };
      Modal: new (
        element: Element,
        options?: unknown
      ) => {
        show?: () => void;
        hide?: () => void;
      } & {
        getInstance?: (element: Element) => { hide?: () => void } | null;
      };
    }
  | undefined;

interface Services {
  state: {
    getState: typeof getState;
    subscribe: typeof subscribeState;
    updateSlice: typeof updateSlice;
  };
  events: {
    emit: (eventName: string, payload?: unknown) => void;
    subscribe?: <T = unknown>(
      eventName: string,
      handler: (payload: T) => void
    ) => () => void;
  };
}

type ZulassungState = AppState["zulassung"];

type ReportingResult = {
  status_json?: string;
  extras?: Record<string, any> | null;
  wirkstoffe?: Array<Record<string, any>> | null;
  vertrieb?: Array<Record<string, any>> | null;
  gefahrhinweise?: Array<Record<string, any>> | null;
  kulturen?: Array<Record<string, any>> | null;
  schadorganismen?: Array<Record<string, any>> | null;
  aufwaende?: Array<Record<string, any>> | null;
  wartezeiten?: Array<Record<string, any>> | null;
  [key: string]: any;
};

type ProgressInfo = ZulassungState["progress"];

type FiltersSnapshot = {
  culture: string | null;
  pest: string | null;
  text: string;
  includeExpired: boolean;
};

type SyncLogEntry = {
  synced_at: string;
  ok: number;
  message: string;
};

const numberFormatter = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});
const RESULTS_PAGE_SIZE = 25;
const pagerNumberFormatter = new Intl.NumberFormat("de-DE");

let initialized = false;
let embeddedMode = false;
let container: HTMLElement | null = null;
let services: Services | null = null;
let isSectionVisible = false;
let resultsPagerWidget: PagerWidget | null = null;
let resultsPagerTarget: HTMLElement | null = null;
let resultsPagerLoadingDirection: PagerDirection | null = null;
let activeSearchToken = 0;
let appliedFiltersSnapshot: FiltersSnapshot | null = null;

function safeParseJson<T = any>(value: unknown): T | null {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(String(value)) as T;
  } catch (error) {
    console.warn("Failed to parse JSON payload in Zulassung view", error);
    return null;
  }
}

function firstNonEmpty<T>(...values: Array<T | null | undefined>): T | null {
  for (const value of values) {
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value === "string" && value.trim() === "") {
      continue;
    }
    return value;
  }
  return null;
}

function coerceNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") {
      return null;
    }

    let normalized = trimmed.replace(/\s+/g, "");
    if (normalized.includes(",")) {
      normalized = normalized.replace(/\./g, "").replace(/,/g, ".");
    }

    const parsed = Number(normalized);
    return Number.isNaN(parsed) ? null : parsed;
  }

  return null;
}

function formatAmount(value: unknown, unit: unknown): string | null {
  const trimmedUnit = typeof unit === "string" ? unit.trim() : "";
  const numeric = coerceNumber(value);

  if (numeric !== null) {
    const formatted = numberFormatter.format(numeric);
    return trimmedUnit ? `${formatted} ${trimmedUnit}` : formatted;
  }

  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  if (text === "") {
    return null;
  }

  return trimmedUnit ? `${text} ${trimmedUnit}` : text;
}

function formatDateHtml(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const raw = String(value).trim();
  if (!raw) {
    return null;
  }

  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) {
    return escapeHtml(raw);
  }

  const formatted = new Date(parsed).toLocaleDateString("de-DE");
  if (formatted === raw) {
    return escapeHtml(formatted);
  }

  return `<span title="${escapeHtml(raw)}">${escapeHtml(formatted)}</span>`;
}

function normalizeText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function formatAddressDetails(
  adresse: Record<string, any> | null | undefined
): string {
  if (!adresse || typeof adresse !== "object") {
    return "";
  }

  const lines: string[] = [];
  for (let index = 1; index <= 6; index += 1) {
    const key = `anschrift_${index}`;
    const value = adresse[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) {
        lines.push(escapeHtml(trimmed));
      }
    }
  }

  if (adresse.land) {
    lines.push(escapeHtml(String(adresse.land)));
  }

  const contactParts: string[] = [];
  if (adresse.telefon) {
    contactParts.push(`Tel: ${escapeHtml(String(adresse.telefon))}`);
  }
  if (adresse.fax) {
    contactParts.push(`Fax: ${escapeHtml(String(adresse.fax))}`);
  }
  if (adresse.e_mail) {
    const email = String(adresse.e_mail).trim();
    if (email) {
      contactParts.push(
        `E-Mail: <a href="mailto:${encodeURIComponent(
          email
        )}" class="text-decoration-none">${escapeHtml(email)}</a>`
      );
    }
  }

  const website = firstNonEmpty(adresse.website, adresse.homepage);
  if (website) {
    const url = String(website).trim();
    if (url) {
      contactParts.push(
        `<a href="${escapeHtml(
          url
        )}" target="_blank" rel="noopener" class="text-decoration-none"><i class="bi bi-box-arrow-up-right me-1"></i>Website</a>`
      );
    }
  }

  const reference =
    adresse.__meta && adresse.__meta.primary_ref
      ? String(adresse.__meta.primary_ref)
      : null;

  const linesHtml = lines.length ? `<div>${lines.join("<br>")}</div>` : "";
  const contactsHtml = contactParts.length
    ? `<div>${contactParts.join(" · ")}</div>`
    : "";
  const referenceHtml = reference
    ? `<div>Nr.: ${escapeHtml(reference)}</div>`
    : "";

  const content = `${linesHtml}${contactsHtml}${referenceHtml}`;
  return content ? `<div class="text-muted small mt-1">${content}</div>` : "";
}

function renderIfVisible(): void {
  if (isSectionVisible) {
    render();
  }
}

function renderAufwandRow(aufwand: Record<string, any>): string {
  const payload =
    safeParseJson<Record<string, any>>(aufwand.payload_json) || {};

  // Official API field names: m_aufwand, m_aufwand_einheit
  const mittelUnit = firstNonEmpty(
    aufwand.m_aufwand_einheit,
    payload.m_aufwand_einheit,
    payload.aufwandmenge_einheit,
    payload.max_aufwandmenge_einheit
  );

  const mittelValue = firstNonEmpty(
    aufwand.m_aufwand,
    payload.m_aufwand,
    payload.max_aufwandmenge,
    payload.m_aufwand_bis,
    payload.m_aufwand_von,
    payload.aufwandmenge
  );

  const mittelFrom = firstNonEmpty(
    payload.m_aufwand_von,
    payload.max_aufwandmenge_von
  );
  const mittelTo = firstNonEmpty(
    payload.m_aufwand_bis,
    payload.max_aufwandmenge_bis
  );

  let mittelDisplay = formatAmount(mittelValue, mittelUnit);
  if (!mittelDisplay && (mittelFrom || mittelTo)) {
    const fromDisplay = formatAmount(mittelFrom, mittelUnit);
    const toDisplay = formatAmount(mittelTo, mittelUnit);
    if (fromDisplay && toDisplay && fromDisplay !== toDisplay) {
      mittelDisplay = `${fromDisplay} – ${toDisplay}`;
    } else if (fromDisplay) {
      mittelDisplay = fromDisplay;
    } else if (toDisplay) {
      mittelDisplay = toDisplay;
    }
  }
  if (!mittelDisplay) {
    mittelDisplay = "keine Angabe";
  }

  // Official API field names: w_aufwand_von, w_aufwand_bis, w_aufwand_einheit
  const wasserUnit = firstNonEmpty(
    aufwand.w_aufwand_einheit,
    payload.w_aufwand_einheit,
    payload.wassermenge_einheit,
    payload.w_aufwand_von_einheit,
    payload.w_aufwand_bis_einheit
  );

  const wasserValue = firstNonEmpty(
    aufwand.w_aufwand_von,
    aufwand.w_aufwand_bis,
    payload.w_aufwand_von,
    payload.w_aufwand_bis,
    payload.wassermenge,
    payload.wasseraufwand
  );

  const wasserFrom = firstNonEmpty(
    aufwand.w_aufwand_von,
    payload.w_aufwand_von,
    payload.wassermenge_von
  );
  const wasserTo = firstNonEmpty(
    aufwand.w_aufwand_bis,
    payload.w_aufwand_bis,
    payload.wassermenge_bis
  );

  let wasserDisplay = formatAmount(wasserValue, wasserUnit);
  if (!wasserDisplay && (wasserFrom || wasserTo)) {
    const fromDisplay = formatAmount(wasserFrom, wasserUnit);
    const toDisplay = formatAmount(wasserTo, wasserUnit);
    if (fromDisplay && toDisplay && fromDisplay !== toDisplay) {
      wasserDisplay = `${fromDisplay} – ${toDisplay}`;
    } else if (fromDisplay) {
      wasserDisplay = fromDisplay;
    } else if (toDisplay) {
      wasserDisplay = toDisplay;
    }
  }

  const wasserText = wasserDisplay
    ? `, Wasser: ${escapeHtml(wasserDisplay)}`
    : "";

  return `${escapeHtml(
    aufwand.aufwand_bedingung || "Standard"
  )}: Mittel: ${escapeHtml(mittelDisplay)}${wasserText}`;
}

async function performAutoUpdateCheck(): Promise<void> {
  if (!services) {
    return;
  }
  try {
    const state = services.state.getState();
    const currentHash = state.zulassung.lastSyncHash;

    if (!currentHash) {
      return;
    }

    const updateCheck = await checkForUpdates(currentHash);
    const checkTime = new Date().toISOString();

    services.state.updateSlice("zulassung", (prev) => ({
      ...prev,
      autoUpdateAvailable: updateCheck.available,
      autoUpdateVersion: updateCheck.newVersion,
      debug: {
        ...prev.debug,
        lastAutoUpdateCheck: {
          time: checkTime,
          result: updateCheck.available
            ? `Update verfügbar: ${updateCheck.newVersion}`
            : "Keine Updates",
        },
      },
    }));

    if (updateCheck.available) {
      renderIfVisible();
    }
  } catch (error) {
    console.warn("Auto-update check failed:", error);
  }
}

function toggleVisibility(state: AppState): void {
  if (!container) {
    return;
  }

  const section = container.querySelector<HTMLElement>(
    '[data-section="zulassung"]'
  );
  if (!section) {
    return;
  }

  // In embedded mode, always show when container is visible
  // Otherwise, check for activeSection
  const shouldShow = embeddedMode
    ? true
    : state.app.activeSection === "zulassung" && state.app.hasDatabase;
  section.classList.toggle("d-none", !shouldShow);

  if (shouldShow && !isSectionVisible) {
    isSectionVisible = true;
    render();
  } else if (!shouldShow && isSectionVisible) {
    isSectionVisible = false;
  }
}

async function loadInitialData(): Promise<void> {
  if (!services) {
    return;
  }

  try {
    if (!storage.isSupported || !storage.isSupported()) {
      return;
    }

    const [
      lastSync,
      lastSyncCounts,
      dataSource,
      apiStand,
      manifestVersion,
      lastSyncHash,
      manifestJson,
    ] = await Promise.all([
      storage.getBvlMeta("lastSyncIso"),
      storage.getBvlMeta("lastSyncCounts"),
      storage.getBvlMeta("dataSource"),
      storage.getBvlMeta("apiStand"),
      storage.getBvlMeta("manifestVersion"),
      storage.getBvlMeta("lastSyncHash"),
      storage.getBvlMeta("manifest"),
    ]);

    services.state.updateSlice("zulassung", (prev) => ({
      ...prev,
      lastSync: lastSync || null,
      lastResultCounts: lastSyncCounts
        ? JSON.parse(String(lastSyncCounts))
        : null,
      dataSource: dataSource || null,
      apiStand: apiStand || null,
      manifestVersion: manifestVersion || null,
      lastSyncHash: lastSyncHash || null,
      debug: {
        ...prev.debug,
        manifest: manifestJson ? JSON.parse(String(manifestJson)) : null,
      },
    }));

    const [cultures, pests] = await Promise.all([
      storage.listBvlCultures(),
      storage.listBvlSchadorg(),
    ]);

    services.state.updateSlice("zulassung", (prev) => ({
      ...prev,
      lookups: { cultures, pests },
    }));

    renderIfVisible();
  } catch (error) {
    console.error("Failed to load initial Zulassung data:", error);
  }
}

function render(): void {
  if (!container || !services) {
    return;
  }

  let section = container.querySelector<HTMLElement>(
    '[data-section="zulassung"]'
  );

  if (!section) {
    section = document.createElement("div");
    section.setAttribute("data-section", "zulassung");
    section.className = "section-content";
    container.appendChild(section);
  }

  const state = services.state.getState();
  const zulassungState = state.zulassung;
  const hasDatabase = state.app.hasDatabase;
  const activeTab =
    (section.dataset.activeTab as "zulassung" | "codes") || "zulassung";

  // Show helpful intro for users without database
  const noDatabaseHint = !hasDatabase
    ? `
    <div class="alert alert-warning mb-4">
      <div class="d-flex align-items-start">
        <i class="bi bi-exclamation-triangle-fill me-3 fs-4"></i>
        <div>
          <strong>Keine Datenbank verbunden</strong>
          <p class="mb-2 mt-1">Um BVL-Daten herunterzuladen und zu durchsuchen, verbinde zuerst eine Datenbank.</p>
          <small class="text-muted">
            <i class="bi bi-lightbulb me-1"></i>
            Gehe zu <strong>Berechnung</strong> und klicke auf "Neue DB erstellen" oder "Datenbank öffnen".
          </small>
        </div>
      </div>
    </div>
  `
    : "";

  section.innerHTML = `
    <div class="${embeddedMode ? "" : "container"} py-3">
      ${
        !embeddedMode
          ? `
        <h2 class="mb-4">
          <i class="bi bi-database me-2"></i>
          BVL & Codes
        </h2>
      `
          : ""
      }

      ${noDatabaseHint}
      
      <!-- Tab Navigation - Konsistente Karten -->
      <div class="row g-3 mb-4">
        <div class="col-md-6">
          <div class="bvl-tab-card ${activeTab === "zulassung" ? "active" : ""}" data-tab="zulassung">
            <div class="bvl-tab-icon">
              <i class="bi bi-search"></i>
            </div>
            <div class="bvl-tab-content">
              <h5>Pflanzenschutzmittel suchen</h5>
              <p>Offizielle BVL-Zulassungsdaten durchsuchen und Mittel zu deiner Liste hinzufügen</p>
            </div>
          </div>
        </div>
        <div class="col-md-6">
          <div class="bvl-tab-card ${activeTab === "codes" ? "active" : ""}" data-tab="codes">
            <div class="bvl-tab-icon">
              <i class="bi bi-bookmark-star"></i>
            </div>
            <div class="bvl-tab-content">
              <h5>EPPO & BBCH Codes</h5>
              <p>Kultur- und Wachstumsstadium-Codes für die Dokumentation verwalten</p>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Tab Content -->
      <div class="tab-content">
        <div class="tab-pane ${
          activeTab === "zulassung" ? "show active" : "d-none"
        }" data-tab-content="zulassung">
          ${renderStatusSection(zulassungState)}
          ${renderSyncSection(zulassungState)}
          ${hasDatabase ? renderFilterSection(zulassungState) : ""}
          ${hasDatabase ? renderResultsSection(zulassungState) : ""}
          ${renderDebugSection(zulassungState)}
        </div>
        
        <!-- EPPO/BBCH Codes Tab Content -->
        <div class="tab-pane ${
          activeTab === "codes" ? "show active" : "d-none"
        }" data-tab-content="codes">
          ${renderCodesManagerSection()}
        </div>
      </div>
    </div>
  `;

  attachEventHandlers(section);
  attachCodesManagerHandlers(section);
  updateResultsPager(section);
}

function renderStatusSection(zulassungState: ZulassungState): string {
  if (!zulassungState.lastSync) {
    return `
      <div class="bvl-card bvl-section" style="border-left: 3px solid var(--info-500);">
        <div class="bvl-card-body">
          <div class="bvl-status-header">
            <div class="bvl-status-icon" style="background: var(--info-500);">
              <i class="bi bi-cloud-download"></i>
            </div>
            <div>
              <h5 class="bvl-status-title" style="color: var(--text);">BVL-Daten herunterladen</h5>
              <p style="color: var(--text-muted); margin: 0; font-size: var(--font-size-sm);">
                Lade die offizielle Pflanzenschutzmittel-Datenbank vom Bundesamt für Verbraucherschutz (BVL).
              </p>
            </div>
          </div>
          <ul style="list-style: none; padding: 0; margin: 0; font-size: var(--font-size-sm); color: var(--text-muted);">
            <li style="margin-bottom: var(--sp-1);"><i class="bi bi-check-circle text-success me-2"></i>Über 2.000 zugelassene Pflanzenschutzmittel</li>
            <li style="margin-bottom: var(--sp-1);"><i class="bi bi-check-circle text-success me-2"></i>Kulturen, Schadorganismen & Wartezeiten</li>
            <li><i class="bi bi-check-circle text-success me-2"></i>Automatische Updates verfügbar</li>
          </ul>
        </div>
      </div>
    `;
  }

  const lastSyncDate = new Date(zulassungState.lastSync).toLocaleString(
    "de-DE"
  );
  const counts = zulassungState.lastResultCounts || {};
  const totalMittel = counts.mittel || counts.bvl_mittel || 0;
  const totalAwg = counts.awg || counts.bvl_awg || 0;

  return `
    <div class="bvl-status-card bvl-section">
      <div class="bvl-status-header">
        <div class="bvl-status-icon">
          <i class="bi bi-check"></i>
        </div>
        <h5 class="bvl-status-title">Daten geladen</h5>
      </div>
      <div class="bvl-stats-grid">
        <div class="bvl-stat-box">
          <div class="bvl-stat-value success">${totalMittel.toLocaleString("de-DE")}</div>
          <div class="bvl-stat-label">Mittel</div>
        </div>
        <div class="bvl-stat-box">
          <div class="bvl-stat-value info">${totalAwg.toLocaleString("de-DE")}</div>
          <div class="bvl-stat-label">Anwendungen</div>
        </div>
        <div class="bvl-stat-box">
          <div class="bvl-stat-value warning">${(counts.awg_kultur || counts.bvl_awg_kultur || 0).toLocaleString("de-DE")}</div>
          <div class="bvl-stat-label">Kulturen</div>
        </div>
        <div class="bvl-stat-box">
          <div class="bvl-stat-value danger">${(counts.awg_schadorg || counts.bvl_awg_schadorg || 0).toLocaleString("de-DE")}</div>
          <div class="bvl-stat-label">Schädlinge</div>
        </div>
      </div>
      <div class="bvl-status-meta">
        <i class="bi bi-clock"></i>
        Letzte Aktualisierung: ${escapeHtml(lastSyncDate)}
      </div>
    </div>
  `;
}

function renderSyncSection(zulassungState: ZulassungState): string {
  const isBusy = zulassungState.busy;
  const progress = zulassungState.progress;
  const error = zulassungState.error;
  const hasData = Boolean(zulassungState.lastSync);

  const stepInfo: Record<
    string,
    { icon: string; color: string; label: string; description: string }
  > = {
    manifest: {
      icon: "bi-cloud-download",
      color: "bg-info",
      label: "Manifest laden",
      description: "Prüfe verfügbare Daten...",
    },
    download: {
      icon: "bi-cloud-arrow-down",
      color: "bg-info",
      label: "Herunterladen",
      description: "Lade BVL-Datenbank herunter...",
    },
    decompress: {
      icon: "bi-archive",
      color: "bg-primary",
      label: "Entpacken",
      description: "Entpacke Datenbank...",
    },
    import: {
      icon: "bi-cpu",
      color: "bg-warning",
      label: "Importieren",
      description: "Importiere Daten in lokale Datenbank...",
    },
    verify: {
      icon: "bi-check2",
      color: "bg-success",
      label: "Prüfen",
      description: "Überprüfe importierte Daten...",
    },
    done: {
      icon: "bi-check-circle-fill",
      color: "bg-success",
      label: "Fertig",
      description: "Import abgeschlossen!",
    },
  };

  const currentStep = progress.step
    ? stepInfo[progress.step] || stepInfo.done
    : null;

  // Show different button text based on state
  const buttonText = hasData ? "Aktualisieren" : "Jetzt herunterladen";
  const buttonIcon = hasData ? "bi-arrow-clockwise" : "bi-cloud-download";

  return `
    <div class="bvl-sync-card bvl-section">
      ${
        zulassungState.autoUpdateAvailable
          ? `
        <div class="bvl-alert">
          <i class="bi bi-bell-fill bvl-alert-icon"></i>
          <div class="bvl-alert-content">
            <strong>Neue Daten verfügbar!</strong>
            <small>Version ${escapeHtml(
              zulassungState.autoUpdateVersion || "unbekannt"
            )} steht zum Download bereit.</small>
          </div>
          <button class="btn btn-warning" id="btn-apply-update">
            <i class="bi bi-download me-1"></i>Jetzt aktualisieren
          </button>
        </div>
      `
          : ""
      }
      
      ${
        isBusy
          ? `
        <div class="bvl-progress-card">
          <div class="bvl-progress-spinner"></div>
          <h5 class="bvl-progress-title">
            <i class="${currentStep?.icon || "bi-arrow-repeat"} me-2"></i>
            ${escapeHtml(currentStep?.label || "Verarbeite...")}
          </h5>
          <p class="bvl-progress-desc">${escapeHtml(currentStep?.description || progress.message)}</p>
          <div class="bvl-progress-bar">
            <div class="bvl-progress-fill" style="width: ${progress.percent}%"></div>
          </div>
          <p class="bvl-progress-hint">
            <i class="bi bi-hourglass-split me-1"></i>
            Bitte warten – dies kann einige Minuten dauern...
          </p>
        </div>
      `
          : `
        <div class="bvl-sync-row">
          <div class="bvl-sync-info">
            <h5>
              <i class="bi bi-cloud-arrow-down"></i>
              BVL-Daten ${hasData ? "aktualisieren" : "herunterladen"}
            </h5>
            <p>
              ${
                hasData
                  ? "Prüfe auf neue Pflanzenschutzmittel-Daten vom BVL"
                  : "Lade die komplette Zulassungsdatenbank herunter (~15 MB)"
              }
            </p>
          </div>
          <button id="btn-sync" class="btn ${hasData ? "btn-outline-success" : "btn-success"} btn-lg">
            <i class="${buttonIcon} me-2"></i>
            ${buttonText}
          </button>
        </div>
      `
      }
      
      ${
        error
          ? `
        <div class="bvl-alert" style="border-color: var(--danger-500); margin-top: var(--sp-4);">
          <i class="bi bi-exclamation-triangle-fill bvl-alert-icon" style="color: var(--danger-500);"></i>
          <div class="bvl-alert-content">
            <strong>Download fehlgeschlagen</strong>
            <small>${escapeHtml(error)}</small>
          </div>
          <button class="btn btn-sm btn-outline-danger" id="btn-show-debug">
            <i class="bi bi-bug me-1"></i>Details
          </button>
        </div>
      `
          : ""
      }
    </div>
  `;
}

function renderFilterSection(zulassungState: ZulassungState): string {
  const { filters, lookups } = zulassungState;
  const disableSearch =
    zulassungState.busy || zulassungState.resultStatus === "loading";
  const cultures = Array.isArray(lookups.cultures) ? lookups.cultures : [];
  const pests = Array.isArray(lookups.pests) ? lookups.pests : [];
  const hasCultures = cultures.length > 0;
  const hasPests = pests.length > 0;

  return `
    <div class="bvl-search-card bvl-section">
      <h5>
        <i class="bi bi-search"></i>
        Pflanzenschutzmittel suchen
      </h5>
      
      <!-- Schnellsuche - prominent -->
      <div class="bvl-search-input-group">
        <input type="search" id="filter-text" 
               placeholder="Mittelname eingeben, z.B. 'Neem', 'Kupfer', 'Rapsöl'..." 
               value="${escapeHtml(filters.text || "")}"
               autofocus>
        <button id="btn-search" class="btn btn-success btn-lg" ${disableSearch ? "disabled" : ""}>
          ${
            disableSearch
              ? '<span class="spinner-border spinner-border-sm me-2"></span>Suche...'
              : '<i class="bi bi-search me-2"></i>Suchen'
          }
        </button>
      </div>
      <p class="bvl-search-hint">
        <i class="bi bi-lightbulb me-1"></i>
        Tipp: Du kannst auch nach Zulassungsnummer oder Wirkstoff suchen
      </p>

      <!-- Erweiterte Filter - einklappbar -->
      <div style="border-top: 1px solid var(--border-1); padding-top: var(--sp-3); margin-top: var(--sp-4);">
        <button class="btn btn-sm btn-link text-decoration-none p-0 mb-3" type="button" 
                data-bs-toggle="collapse" data-bs-target="#advanced-filters" 
                aria-expanded="false" aria-controls="advanced-filters"
                style="color: var(--text-muted);">
          <i class="bi bi-sliders me-1"></i>
          Erweiterte Filter anzeigen
          <i class="bi bi-chevron-down ms-1"></i>
        </button>
        
        <div class="collapse" id="advanced-filters">
          <div class="row g-3">
            ${
              hasCultures
                ? `
              <div class="col-md-6">
                <label for="filter-culture" class="form-label" style="color: var(--text-muted); font-size: var(--font-size-sm);">
                  <i class="bi bi-flower1 me-1 text-success"></i>Kultur
                </label>
                <select id="filter-culture" class="form-select">
                  <option value="">Alle Kulturen</option>
                  ${cultures
                    .map(
                      (culture: any) =>
                        `<option value="${escapeHtml(culture.code)}" ${
                          filters.culture === culture.code ? "selected" : ""
                        }>${escapeHtml(culture.label || culture.code)}</option>`
                    )
                    .join("")}
                </select>
              </div>
            `
                : `
              <div class="col-md-6">
                <label class="form-label" style="color: var(--text-dim); font-size: var(--font-size-sm);">
                  <i class="bi bi-flower1 me-1"></i>Kultur
                </label>
                <p style="color: var(--text-dim); font-size: var(--font-size-sm); margin: 0;">
                  <i class="bi bi-info-circle me-1"></i>
                  Lade zuerst BVL-Daten herunter
                </p>
              </div>
            `
            }
            ${
              hasPests
                ? `
              <div class="col-md-6">
                <label for="filter-pest" class="form-label" style="color: var(--text-muted); font-size: var(--font-size-sm);">
                  <i class="bi bi-bug me-1 text-danger"></i>Schadorganismus
                </label>
                <select id="filter-pest" class="form-select">
                  <option value="">Alle Schadorganismen</option>
                  ${pests
                    .map(
                      (pest: any) =>
                        `<option value="${escapeHtml(pest.code)}" ${
                          filters.pest === pest.code ? "selected" : ""
                        }>${escapeHtml(pest.label || pest.code)}</option>`
                    )
                    .join("")}
                </select>
              </div>
            `
                : ""
            }
            <div class="col-12">
              <div class="form-check">
                <input class="form-check-input" type="checkbox" id="filter-expired" ${
                  filters.includeExpired ? "checked" : ""
                }>
                <label class="form-check-label" for="filter-expired" style="color: var(--text-muted);">
                  <i class="bi bi-clock-history me-1"></i>
                  Auch abgelaufene Zulassungen anzeigen
                </label>
              </div>
            </div>
          </div>
          <div class="mt-3">
            <button id="btn-clear-filters" class="btn btn-outline-secondary btn-sm">
              <i class="bi bi-x-circle me-1"></i>Alle Filter zurücksetzen
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderResultsSection(zulassungState: ZulassungState): string {
  const { results, resultStatus, resultError } = zulassungState;
  const items = Array.isArray(results.items) ? results.items : [];
  const hasItems = items.length > 0;
  let content = "";

  if (resultStatus === "error") {
    content = `
      <div class="alert alert-danger mb-0">
        <i class="bi bi-exclamation-triangle-fill me-2"></i>
        ${escapeHtml(
          resultError || "Suche fehlgeschlagen. Bitte erneut versuchen."
        )}
      </div>
    `;
  } else if (resultStatus === "loading" && !hasItems) {
    content = `
      <div class="text-center py-5">
        <div class="spinner-border text-success mb-3" role="status">
          <span class="visually-hidden">Suche läuft...</span>
        </div>
        <p class="text-muted mb-0">Suche in der Datenbank...</p>
      </div>
    `;
  } else if (!hasItems) {
    const isIdle = resultStatus === "idle";
    content = isIdle
      ? `
      <div class="text-center py-5">
        <div class="rounded-circle bg-secondary bg-opacity-25 p-4 d-inline-block mb-3">
          <i class="bi bi-search fs-1 text-muted"></i>
        </div>
        <h5 class="text-muted mb-2">Bereit zum Suchen</h5>
        <p class="text-muted mb-0">
          Gib oben einen Suchbegriff ein, um Pflanzenschutzmittel zu finden.
        </p>
      </div>
    `
      : `
      <div class="text-center py-5">
        <div class="rounded-circle bg-warning bg-opacity-25 p-4 d-inline-block mb-3">
          <i class="bi bi-emoji-frown fs-1 text-warning"></i>
        </div>
        <h5 class="text-muted mb-2">Keine Treffer gefunden</h5>
        <p class="text-muted mb-3">
          Versuche es mit einem anderen Suchbegriff oder weniger Filtern.
        </p>
        <button id="btn-clear-filters-inline" class="btn btn-outline-secondary btn-sm">
          <i class="bi bi-x-circle me-1"></i>Filter zurücksetzen
        </button>
      </div>
    `;
  } else {
    content = `
      <div class="list-group list-group-flush">
        ${items
          .map((result) => renderResultItem(result as ReportingResult))
          .join("")}
      </div>
    `;
  }

  const summary = hasItems ? formatResultRange(results) : null;

  return `
    <div class="card mb-3" style="background: #2d2d2d;">
      <div class="card-header d-flex flex-column flex-md-row justify-content-between align-items-md-center gap-2" style="background: #252525;">
        <h5 class="mb-0">
          <i class="bi bi-list-ul me-2"></i>
          Suchergebnisse
        </h5>
        ${summary ? `<span class="badge bg-success">${summary}</span>` : ""}
      </div>
      <div class="card-body p-0">
        ${content}
      </div>
      ${
        hasItems
          ? `
        <div class="card-footer bg-dark d-flex justify-content-end" data-role="zulassung-pager"></div>
      `
          : ""
      }
    </div>
  `;
}

function formatResultRange(results: ZulassungState["results"]): string | null {
  const items = Array.isArray(results.items) ? results.items : [];
  if (!items.length) {
    return null;
  }
  const startIndex = results.page * results.pageSize + 1;
  const endIndex = startIndex + items.length - 1;
  const totalText =
    typeof results.totalCount === "number"
      ? ` von ${pagerNumberFormatter.format(results.totalCount)}`
      : "";
  return `Einträge ${pagerNumberFormatter.format(
    startIndex
  )}–${pagerNumberFormatter.format(endIndex)}${totalText}`;
}

function ensureResultsPager(section: HTMLElement): PagerWidget | null {
  const target = section.querySelector<HTMLElement>(
    '[data-role="zulassung-pager"]'
  );
  if (!target) {
    resultsPagerWidget?.destroy();
    resultsPagerWidget = null;
    resultsPagerTarget = null;
    return null;
  }
  if (!resultsPagerWidget || resultsPagerTarget !== target) {
    resultsPagerWidget?.destroy();
    resultsPagerWidget = createPagerWidget(target, {
      onPrev: () => goToPrevResultsPage(),
      onNext: () => goToNextResultsPage(),
      labels: {
        prev: "Zurück",
        next: "Weiter",
        loading: "Suche läuft...",
        empty: "Noch keine Suche",
      },
    });
    resultsPagerTarget = target;
  }
  return resultsPagerWidget;
}

function updateResultsPager(section: HTMLElement): void {
  if (!services) {
    return;
  }
  const widget = ensureResultsPager(section);
  if (!widget) {
    return;
  }
  const state = services.state.getState();
  if (!state.app.hasDatabase) {
    widget.update({ status: "disabled", info: "Keine aktive Datenbank." });
    return;
  }

  const { results, resultStatus, resultError } = state.zulassung;
  if (resultStatus === "error") {
    widget.update({
      status: "error",
      message: resultError || "Suche fehlgeschlagen",
    });
    return;
  }

  if (resultStatus === "idle") {
    widget.update({ status: "disabled", info: "Noch keine Suche." });
    return;
  }

  const isLoading = resultStatus === "loading";
  const items = Array.isArray(results.items) ? results.items : [];
  if (!items.length) {
    widget.update({
      status: "disabled",
      info: isLoading ? "Suche läuft..." : "Keine Treffer.",
    });
    return;
  }

  const rangeText = formatResultRange(results) ?? "";
  const canPrev = !isLoading && results.page > 0;
  const hasMore = Boolean(results.hasMore);
  const totalCount =
    typeof results.totalCount === "number" ? results.totalCount : null;
  const lastIndex = results.page * results.pageSize + items.length;
  const canAdvanceByTotal =
    totalCount !== null ? lastIndex < totalCount : hasMore;
  widget.update({
    status: "ready",
    info: rangeText,
    canPrev,
    canNext: !isLoading && (hasMore || canAdvanceByTotal),
    loadingDirection: isLoading ? resultsPagerLoadingDirection : null,
  });
}

function goToPrevResultsPage(): void {
  if (!services) {
    return;
  }
  const { zulassung } = services.state.getState();
  if (zulassung.resultStatus === "loading" || zulassung.results.page === 0) {
    return;
  }
  loadResultsPage(zulassung.results.page - 1, "prev");
}

function goToNextResultsPage(): void {
  if (!services) {
    return;
  }
  const { zulassung } = services.state.getState();
  if (zulassung.resultStatus === "loading") {
    return;
  }
  if (
    !zulassung.results.hasMore &&
    typeof zulassung.results.totalCount === "number"
  ) {
    const lastIndex =
      zulassung.results.page * zulassung.results.pageSize +
      zulassung.results.items.length;
    if (lastIndex >= zulassung.results.totalCount) {
      return;
    }
  } else if (!zulassung.results.hasMore) {
    return;
  }
  loadResultsPage(zulassung.results.page + 1, "next");
}

function renderResultItem(result: ReportingResult): string {
  const status = result.status_json
    ? safeParseJson<Record<string, any>>(result.status_json) || {}
    : {};

  // Daten für "Zu Mitteln hinzufügen" Button vorbereiten
  // ALLE Wirkstoffe kombinieren (nicht nur der erste)
  const wirkstoff =
    Array.isArray(result.wirkstoffe) && result.wirkstoffe.length > 0
      ? result.wirkstoffe
          .map((w) => {
            const name =
              w.wirkstoff_name ||
              w.wirkstoffname ||
              w.WIRKSTOFFNAME ||
              w.wirkstoff ||
              w.wirknr ||
              w.WIRKNR ||
              "";
            return name;
          })
          .filter((name) => name) // Leere Einträge entfernen
          .join(", ") // Mit Komma verbinden
      : "";

  // Wartezeit aus BVL: Kombiniere Tage und Anwendungsbereich-Code
  // Official API field name: gesetzt_wartezeit
  const wartezeit =
    Array.isArray(result.wartezeiten) && result.wartezeiten.length > 0
      ? (() => {
          const w = result.wartezeiten[0];
          const tage = w.gesetzt_wartezeit || "";
          const code = w.anwendungsbereich || "";
          if (tage && code) return `${tage} Tage (${code})`;
          if (tage) return `${tage} Tage`;
          if (code) return code;
          return "-";
        })()
      : "-";

  // JSON für data-Attribut - Base64 encodiert um Escaping-Probleme zu vermeiden
  const addToMediumDataObj = {
    name: result.name || "",
    kennr: result.kennr || "",
    wirkstoff: wirkstoff,
    wartezeit: wartezeit,
  };
  const addToMediumData = btoa(
    encodeURIComponent(JSON.stringify(addToMediumDataObj))
  );

  return `
    <div class="list-group-item">
      <div class="d-flex w-100 justify-content-between align-items-start">
        <h6 class="mb-1">${escapeHtml(result.name)}</h6>
        <div class="d-flex align-items-center gap-2">
          <button class="btn btn-success btn-sm" data-action="add-to-mediums" data-medium-info="${addToMediumData}" title="Zu Mitteln hinzufügen">
            <i class="bi bi-plus-lg"></i>
          </button>
          <small class="text-muted">AWG: ${escapeHtml(
            result.awg_id || "-"
          )}</small>
        </div>
      </div>
      <div class="mb-2">
        <strong>Zulassungsnummer:</strong> ${escapeHtml(
          result.kennr || "-"
        )}<br>
        <strong>Formulierung:</strong> ${escapeHtml(
          result.formulierung || "-"
        )}<br>
        <strong>Status:</strong> ${escapeHtml(status.status || "-")}
      </div>
      <div class="mb-2">
        ${
          result.geringes_risiko
            ? '<span class="badge bg-success me-1"><i class="bi bi-shield-check me-1"></i>Geringes Risiko</span>'
            : ""
        }
        ${
          result.zul_ende
            ? `<span class="badge bg-warning text-dark me-1"><i class="bi bi-calendar-event me-1"></i>Gültig bis: ${escapeHtml(
                result.zul_ende
              )}</span>`
            : ""
        }
        ${
          result.zulassungsende
            ? `<span class="badge bg-info text-dark me-1"><i class="bi bi-calendar-range me-1"></i>Anwendung gültig bis: ${escapeHtml(
                result.zulassungsende
              )}</span>`
            : ""
        }
      </div>
      ${renderResultWirkstoffe(result)}
      ${renderResultWirkstoffGehalt(result)}
      ${renderResultZusatzstoffe(result)}
      ${renderResultStaerkung(result)}
      ${renderResultAntraege(result)}
      ${renderResultHinweise(result)}
      ${renderResultGefahrhinweise(result)}
      ${renderResultGefahrensymbole(result)}
      ${renderResultSicherheitshinweise(result)}
      ${renderResultSignalwoerter(result)}
      ${renderResultParallelimporte(result)}
      ${renderResultVertrieb(result)}
      ${renderResultZusatzstoffVertrieb(result)}
      ${renderResultStaerkungVertrieb(result)}
      ${renderResultKulturen(result)}
      ${renderResultSchadorganismen(result)}
      ${renderResultAufwaende(result)}
      ${renderResultAuflagen(result)}
      ${renderResultAwgPartner(result)}
      ${renderResultAwgPartnerAufwand(result)}
      ${renderResultAwgBemerkungen(result)}
      ${renderResultAwgVerwendungszwecke(result)}
      ${renderResultWartezeiten(result)}
      ${renderResultAwgWartezeitAusnahmen(result)}
      ${renderResultAwgZeitpunkte(result)}
      ${renderResultAwgZulassung(result)}
    </div>
  `;
}

function renderResultWirkstoffe(result: ReportingResult): string {
  if (!Array.isArray(result.wirkstoffe) || result.wirkstoffe.length === 0) {
    return "";
  }

  const list = result.wirkstoffe
    .map((entry) => {
      // BVL API liefert gehalt_rein_grundstruktur und gehalt_einheit
      const gehalt =
        coerceNumber(entry.gehalt_rein_grundstruktur) ??
        coerceNumber(entry.gehalt_rein) ??
        coerceNumber(entry.gehalt);
      const gehaltStr =
        gehalt !== null
          ? numberFormatter.format(gehalt)
          : String(entry.gehalt_rein_grundstruktur || entry.gehalt || "");
      const einheit = entry.gehalt_einheit || entry.einheit || "";
      return `
        <li>
          ${escapeHtml(entry.wirkstoff_name || entry.wirkstoff || entry.wirknr || "-")}
          ${
            gehalt !== null
              ? ` - ${escapeHtml(gehaltStr)} ${escapeHtml(einheit)}`
              : ""
          }
        </li>
      `;
    })
    .join("");

  return `
    <div class="mt-2">
      <strong><i class="bi bi-droplet me-1"></i>Wirkstoffe:</strong>
      <ul class="small mb-0">${list}</ul>
    </div>
  `;
}

function renderResultVertrieb(result: ReportingResult): string {
  if (!Array.isArray(result.vertrieb) || result.vertrieb.length === 0) {
    return "";
  }

  const dedupe = new Set<string>();
  const entries = result.vertrieb
    .map((entry) => {
      const adresse = (entry as Record<string, any>).adresse || null;
      const keyCandidate =
        (adresse && adresse.__meta && adresse.__meta.primary_ref) ||
        entry.adresse_nr ||
        entry.vertriebsfirma_nr ||
        entry.hersteller_nr ||
        entry.vertriebsfirma ||
        null;
      const key = keyCandidate ? String(keyCandidate) : JSON.stringify(entry);
      if (dedupe.has(key)) {
        return null;
      }
      dedupe.add(key);

      const displayName =
        firstNonEmpty(
          entry.hersteller_name,
          entry.hersteller,
          entry.firmenname,
          entry.firma,
          entry.vertriebsfirma_name,
          entry.vertriebsfirma,
          adresse?.firmenname,
          adresse?.firma
        ) || "-";

      const websiteSource = firstNonEmpty(
        entry.website,
        adresse?.website,
        adresse?.homepage
      );
      const websiteLink =
        websiteSource && String(websiteSource).trim()
          ? ` <a href="${escapeHtml(
              String(websiteSource).trim()
            )}" target="_blank" rel="noopener" class="text-decoration-none"><i class="bi bi-box-arrow-up-right"></i></a>`
          : "";

      const addressDetails = formatAddressDetails(adresse);
      const fallbackReference =
        !addressDetails && keyCandidate
          ? `<div class="text-muted small mt-1">Nr.: ${escapeHtml(
              String(keyCandidate)
            )}</div>`
          : "";

      return `<div class="mb-2"><div class="small fw-semibold">${escapeHtml(
        displayName
      )}${websiteLink}</div>${addressDetails || fallbackReference}</div>`;
    })
    .filter((entry): entry is string => Boolean(entry))
    .join("");

  if (!entries) {
    return "";
  }

  return `
    <div class="mt-2">
      <strong><i class="bi bi-building me-1"></i>Hersteller/Vertrieb:</strong>
      <div>${entries}</div>
    </div>
  `;
}

function renderResultGefahrhinweise(result: ReportingResult): string {
  if (
    !Array.isArray(result.gefahrhinweise) ||
    result.gefahrhinweise.length === 0
  ) {
    return "";
  }

  const badges = result.gefahrhinweise
    .map((hint) => {
      const code = hint.hinweis_kode || hint.h_code || hint.h_saetze || "";
      const text = hint.hinweis_text || hint.text || "";
      return `
        <span class="badge bg-danger" title="${escapeHtml(
          text
        )}" data-bs-toggle="tooltip">
          ${escapeHtml(code)}${
            text ? ' <i class="bi bi-info-circle-fill ms-1"></i>' : ""
          }
        </span>
      `;
    })
    .join("");

  return `
    <div class="mt-2">
      <strong><i class="bi bi-exclamation-triangle me-1"></i>Gefahrenhinweise:</strong>
      <div class="d-flex flex-wrap gap-1">${badges}</div>
    </div>
  `;
}

function renderResultWirkstoffGehalt(result: ReportingResult): string {
  if (
    !Array.isArray(result.wirkstoff_gehalt) ||
    result.wirkstoff_gehalt.length === 0
  ) {
    return "";
  }
  const entries = result.wirkstoff_gehalt
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const wirknr = normalizeText(
        entry.wirknr ?? entry.wirkstoffnr ?? entry.wirk_nr
      );
      const variant = normalizeText(entry.wirkvar ?? entry.variante);
      const gehaltPrim = firstNonEmpty(
        entry.gehalt_rein_grundstruktur,
        entry.gehalt_rein,
        entry.gehalt
      );
      const gehaltEinheit = firstNonEmpty(
        entry.gehalt_einheit,
        entry.einheit,
        entry.gehalt_einheit
      );
      const gehalt =
        gehaltPrim !== null ? formatAmount(gehaltPrim, gehaltEinheit) : null;
      const bio = formatAmount(entry.gehalt_bio, entry.gehalt_bio_einheit);

      const detailParts: string[] = [];
      if (gehalt) {
        detailParts.push(`Gehalt: ${escapeHtml(gehalt)}`);
      }
      if (bio) {
        detailParts.push(`Bio: ${escapeHtml(bio)}`);
      }
      if (variant) {
        detailParts.push(`Variante: ${escapeHtml(variant)}`);
      }

      const header = wirknr
        ? `<span class="fw-semibold">${escapeHtml(wirknr)}</span>`
        : "";

      if (!header && detailParts.length === 0) {
        return null;
      }

      const details = detailParts.join(" · ");
      return `<li>${header}${header && details ? " – " : ""}${details}</li>`;
    })
    .filter((entry): entry is string => Boolean(entry))
    .join("");

  if (!entries) {
    return "";
  }

  return `
    <div class="mt-2">
      <strong><i class="bi bi-beaker me-1"></i>Wirkstoffgehalte:</strong>
      <ul class="small mb-0">${entries}</ul>
    </div>
  `;
}

function renderResultZusatzstoffe(result: ReportingResult): string {
  if (!Array.isArray(result.zusatzstoffe) || result.zusatzstoffe.length === 0) {
    return "";
  }

  const list = result.zusatzstoffe
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const name = normalizeText(
        entry.mittelname ?? entry.mittel ?? entry.name ?? "-"
      );
      const start = formatDateHtml(entry.genehmigung_am);
      const end = formatDateHtml(entry.genehmigungsende);
      const applicant = normalizeText(
        entry.antragsteller ?? entry.antragsteller_name
      );
      const applicantNr = normalizeText(entry.antragsteller_nr);

      const metaParts: string[] = [];
      if (start) {
        metaParts.push(`ab ${start}`);
      }
      if (end) {
        metaParts.push(`bis ${end}`);
      }
      if (applicant) {
        metaParts.push(`Antragsteller: ${escapeHtml(applicant)}`);
      }
      if (applicantNr) {
        metaParts.push(`Nr.: ${escapeHtml(applicantNr)}`);
      }

      return `<li><span class="fw-semibold">${escapeHtml(name || "-")}</span>${
        metaParts.length ? ` – ${metaParts.join(" · ")}` : ""
      }</li>`;
    })
    .filter((entry): entry is string => Boolean(entry))
    .join("");

  if (!list) {
    return "";
  }

  return `
    <div class="mt-2">
      <strong><i class="bi bi-puzzle me-1"></i>Zusatzstoffe:</strong>
      <ul class="small mb-0">${list}</ul>
    </div>
  `;
}

function renderResultZusatzstoffVertrieb(result: ReportingResult): string {
  if (
    !Array.isArray(result.zusatzstoff_vertrieb) ||
    result.zusatzstoff_vertrieb.length === 0
  ) {
    return "";
  }

  const list = result.zusatzstoff_vertrieb
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const name = normalizeText(
        entry.vertriebsfirma_name ??
          entry.vertriebsfirma ??
          entry.firma ??
          entry.hersteller
      );
      const number = normalizeText(entry.vertriebsfirma_nr ?? entry.nr);

      if (!name && !number) {
        return null;
      }

      const parts: string[] = [];
      if (name) {
        parts.push(escapeHtml(name));
      }
      if (number) {
        parts.push(
          `<span class="text-muted">Nr.: ${escapeHtml(number)}</span>`
        );
      }

      return `<li>${parts.join(" · ")}</li>`;
    })
    .filter((entry): entry is string => Boolean(entry))
    .join("");

  if (!list) {
    return "";
  }

  return `
    <div class="mt-2">
      <strong><i class="bi bi-diagram-2 me-1"></i>Zusatzstoff-Vertrieb:</strong>
      <ul class="small mb-0">${list}</ul>
    </div>
  `;
}

function renderResultStaerkung(result: ReportingResult): string {
  if (!Array.isArray(result.staerkung) || result.staerkung.length === 0) {
    return "";
  }

  const list = result.staerkung
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const name = normalizeText(entry.mittelname ?? entry.mittel ?? "-");
      const start = formatDateHtml(entry.genehmigung_am);
      const applicant = normalizeText(entry.antragsteller);
      const applicantNr = normalizeText(entry.antragsteller_nr);

      const metaParts: string[] = [];
      if (start) {
        metaParts.push(`Genehmigt am ${start}`);
      }
      if (applicant) {
        metaParts.push(`Antragsteller: ${escapeHtml(applicant)}`);
      }
      if (applicantNr) {
        metaParts.push(`Nr.: ${escapeHtml(applicantNr)}`);
      }

      return `<li><span class="fw-semibold">${escapeHtml(name || "-")}</span>${
        metaParts.length ? ` – ${metaParts.join(" · ")}` : ""
      }</li>`;
    })
    .filter((entry): entry is string => Boolean(entry))
    .join("");

  if (!list) {
    return "";
  }

  return `
    <div class="mt-2">
      <strong><i class="bi bi-leaf me-1"></i>Stärkungsmittel:</strong>
      <ul class="small mb-0">${list}</ul>
    </div>
  `;
}

function renderResultStaerkungVertrieb(result: ReportingResult): string {
  if (
    !Array.isArray(result.staerkung_vertrieb) ||
    result.staerkung_vertrieb.length === 0
  ) {
    return "";
  }

  const list = result.staerkung_vertrieb
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const company = normalizeText(
        entry.vertriebsfirma_name ??
          entry.vertriebsfirma ??
          entry.firma ??
          entry.hersteller
      );
      const number = normalizeText(entry.vertriebsfirma_nr ?? entry.nr);

      if (!company && !number) {
        return null;
      }

      const parts: string[] = [];
      if (company) {
        parts.push(escapeHtml(company));
      }
      if (number) {
        parts.push(
          `<span class="text-muted">Nr.: ${escapeHtml(number)}</span>`
        );
      }

      return `<li>${parts.join(" · ")}</li>`;
    })
    .filter((entry): entry is string => Boolean(entry))
    .join("");

  if (!list) {
    return "";
  }

  return `
    <div class="mt-2">
      <strong><i class="bi bi-diagram-2-fill me-1"></i>Stärkungsmittel-Vertrieb:</strong>
      <ul class="small mb-0">${list}</ul>
    </div>
  `;
}

function renderResultAntraege(result: ReportingResult): string {
  if (!Array.isArray(result.antraege) || result.antraege.length === 0) {
    return "";
  }

  const list = result.antraege
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const number = normalizeText(entry.antragnr ?? entry.nr);
      const applicant = normalizeText(
        entry.antragsteller ?? entry.antragsteller_name
      );
      const applicantNr = normalizeText(entry.antragsteller_nr);

      if (!number && !applicant && !applicantNr) {
        return null;
      }

      const parts: string[] = [];
      if (number) {
        parts.push(`Antrag ${escapeHtml(number)}`);
      }
      if (applicant) {
        parts.push(`von ${escapeHtml(applicant)}`);
      }
      if (applicantNr) {
        parts.push(
          `<span class="text-muted">Nr.: ${escapeHtml(applicantNr)}</span>`
        );
      }

      return `<li>${parts.join(" · ")}</li>`;
    })
    .filter((entry): entry is string => Boolean(entry))
    .join("");

  if (!list) {
    return "";
  }

  return `
    <div class="mt-2">
      <strong><i class="bi bi-inbox me-1"></i>Anträge:</strong>
      <ul class="small mb-0">${list}</ul>
    </div>
  `;
}

function renderResultHinweise(result: ReportingResult): string {
  if (!Array.isArray(result.hinweise) || result.hinweise.length === 0) {
    return "";
  }

  const hintMap = new Map<string, string[]>();

  for (const entry of result.hinweise) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const code = normalizeText(entry.hinweis ?? entry.code);
    if (!code) {
      continue;
    }

    const level = normalizeText(entry.ebene ?? result.kennr ?? "-") || "-";
    if (!hintMap.has(level)) {
      hintMap.set(level, []);
    }
    hintMap.get(level)!.push(code);
  }

  if (!hintMap.size) {
    return "";
  }

  const rows = Array.from(hintMap.entries())
    .map(([level, codes]) => {
      const uniqueCodes = Array.from(new Set(codes.filter(Boolean)));
      if (!uniqueCodes.length) {
        return null;
      }
      const badges = uniqueCodes
        .map(
          (code) =>
            `<span class="badge bg-secondary">${escapeHtml(code)}</span>`
        )
        .join(" ");
      return `<li><span class="fw-semibold">${escapeHtml(
        level
      )}</span>: ${badges}</li>`;
    })
    .filter((entry): entry is string => Boolean(entry))
    .join("");

  if (!rows) {
    return "";
  }

  return `
    <div class="mt-2">
      <strong><i class="bi bi-info-circle me-1"></i>Hinweise:</strong>
      <ul class="small mb-0 d-flex flex-column gap-1">${rows}</ul>
    </div>
  `;
}

function renderResultGefahrensymbole(result: ReportingResult): string {
  if (
    !Array.isArray(result.gefahrensymbole) ||
    result.gefahrensymbole.length === 0
  ) {
    return "";
  }

  const unique = Array.from(
    new Set(
      result.gefahrensymbole
        .map((entry) =>
          entry && typeof entry === "object"
            ? normalizeText(entry.gefahrensymbol ?? entry.symbol ?? entry.code)
            : ""
        )
        .filter((code) => code)
    )
  );

  if (!unique.length) {
    return "";
  }

  const badges = unique
    .map(
      (code) =>
        `<span class="badge bg-dark text-light border border-light">${escapeHtml(
          code
        )}</span>`
    )
    .join(" ");

  return `
    <div class="mt-2">
      <strong><i class="bi bi-sign-stop me-1"></i>Gefahrensymbole:</strong>
      <div class="d-flex flex-wrap gap-1">${badges}</div>
    </div>
  `;
}

function renderResultSicherheitshinweise(result: ReportingResult): string {
  if (
    !Array.isArray(result.sicherheitshinweise) ||
    result.sicherheitshinweise.length === 0
  ) {
    return "";
  }

  const unique = Array.from(
    new Set(
      result.sicherheitshinweise
        .map((entry) =>
          entry && typeof entry === "object"
            ? normalizeText(
                entry.sicherheitshinweis ??
                  entry.p_code ??
                  entry.p_satz ??
                  entry.code
              )
            : ""
        )
        .filter((code) => code)
    )
  );

  if (!unique.length) {
    return "";
  }

  const badges = unique
    .map(
      (code) =>
        `<span class="badge bg-warning text-dark">${escapeHtml(code)}</span>`
    )
    .join(" ");

  return `
    <div class="mt-2">
      <strong><i class="bi bi-shield-exclamation me-1"></i>Sicherheitshinweise:</strong>
      <div class="d-flex flex-wrap gap-1">${badges}</div>
    </div>
  `;
}

function renderResultSignalwoerter(result: ReportingResult): string {
  if (
    !Array.isArray(result.signalwoerter) ||
    result.signalwoerter.length === 0
  ) {
    return "";
  }

  const unique = Array.from(
    new Set(
      result.signalwoerter
        .map((entry) =>
          entry && typeof entry === "object"
            ? normalizeText(entry.signalwort ?? entry.signal_word ?? entry.code)
            : ""
        )
        .filter((code) => code)
    )
  );

  if (!unique.length) {
    return "";
  }

  const badges = unique
    .map(
      (value) => `<span class="badge bg-secondary">${escapeHtml(value)}</span>`
    )
    .join(" ");

  return `
    <div class="mt-2">
      <strong><i class="bi bi-signpost me-1"></i>Signalwörter:</strong>
      <div class="d-flex flex-wrap gap-1">${badges}</div>
    </div>
  `;
}

function renderResultParallelimporte(result: ReportingResult): string {
  const sections: string[] = [];

  const buildList = (
    entries: Array<Record<string, any>> | null | undefined,
    title: string,
    variant: "valid" | "expired"
  ) => {
    if (!Array.isArray(entries) || entries.length === 0) {
      return;
    }

    const items = entries
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return null;
        }

        const name = normalizeText(
          entry.pi_mittelname ?? entry.mittelname ?? "-"
        );
        const importer = normalizeText(
          entry.importeur_txt ?? entry.importeur_name ?? entry.importeur
        );
        const importerCode = normalizeText(entry.importeur);
        const importerNr = normalizeText(entry.importeur_nr);
        const reference = normalizeText(
          entry.pi_referenz_kennr ?? entry.referenz_kennr
        );
        const kennziffer = normalizeText(
          entry.pi_kennziffer ?? entry.kennziffer
        );
        const status = normalizeText(entry.pi_status ?? entry.status);
        const gueltig = formatDateHtml(entry.gueltig);
        const bescheidNr = normalizeText(
          entry.pi_bescheidnr ?? entry.bescheid_nr
        );
        const bescheidDatum = formatDateHtml(entry.bescheid_datum);
        const bescheinigung = normalizeText(entry.bescheinigung);

        const headline = `<span class="fw-semibold">${escapeHtml(
          name || "-"
        )}</span>`;

        const metaParts: string[] = [];
        if (importer) {
          const suffix =
            importerCode && importerCode !== importer
              ? ` (${escapeHtml(importerCode)})`
              : "";
          metaParts.push(`Importeur: ${escapeHtml(importer)}${suffix}`);
        }
        if (importerNr) {
          metaParts.push(`Nr.: ${escapeHtml(importerNr)}`);
        }
        if (reference) {
          metaParts.push(`Referenz: ${escapeHtml(reference)}`);
        }
        if (kennziffer) {
          metaParts.push(`Kennziffer: ${escapeHtml(kennziffer)}`);
        }
        if (status) {
          metaParts.push(`Status: ${escapeHtml(status)}`);
        }
        if (gueltig) {
          const label = variant === "expired" ? "Ausgelaufen am" : "Gültig bis";
          metaParts.push(`${label} ${gueltig}`);
        }
        if (bescheidNr) {
          metaParts.push(`Bescheid ${escapeHtml(bescheidNr)}`);
        }
        if (bescheidDatum) {
          metaParts.push(`vom ${bescheidDatum}`);
        }
        if (bescheinigung) {
          metaParts.push(`Bescheinigung: ${escapeHtml(bescheinigung)}`);
        }

        const meta =
          metaParts.length > 0
            ? `<div class="small text-muted">${metaParts.join(" · ")}</div>`
            : "";

        return `<li>${headline}${meta}</li>`;
      })
      .filter((entry): entry is string => Boolean(entry))
      .join("");

    if (!items) {
      return;
    }

    sections.push(`
      <div class="mt-2">
        <em class="d-block">${escapeHtml(title)}:</em>
        <ul class="small mb-0">${items}</ul>
      </div>
    `);
  };

  buildList(result.parallelimporte_gueltig, "Gültige Parallelimporte", "valid");
  buildList(
    result.parallelimporte_abgelaufen,
    "Abgelaufene Parallelimporte",
    "expired"
  );

  if (!sections.length) {
    return "";
  }

  return `
    <div class="mt-2">
      <strong><i class="bi bi-arrow-left-right me-1"></i>Parallelimporte:</strong>
      ${sections.join("")}
    </div>
  `;
}

function renderResultAuflagen(result: ReportingResult): string {
  if (!Array.isArray(result.auflagen) || result.auflagen.length === 0) {
    return "";
  }

  const list = result.auflagen
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const code = normalizeText(entry.auflage ?? entry.code);
      const level = normalizeText(entry.ebene);
      const culture = normalizeText(entry.kultur);
      const condition = normalizeText(entry.weitere_bedingung);
      const technique = normalizeText(entry.anwendungstechnik);
      const distance = normalizeText(entry.abstand);
      const reducedDistance = normalizeText(entry.redu_abstand);
      const requirement = normalizeText(entry.anwendbest);

      const metaParts: string[] = [];
      if (level) {
        metaParts.push(`Ebene: ${escapeHtml(level)}`);
      }
      if (culture) {
        metaParts.push(`Kultur: ${escapeHtml(culture)}`);
      }
      if (condition) {
        metaParts.push(escapeHtml(condition));
      }
      if (technique) {
        metaParts.push(`Technik: ${escapeHtml(technique)}`);
      }
      if (distance) {
        metaParts.push(`Abstand: ${escapeHtml(distance)}`);
      }
      if (reducedDistance) {
        metaParts.push(`reduz. Abstand: ${escapeHtml(reducedDistance)}`);
      }

      const reductions =
        Array.isArray((entry as any).reduzierung) &&
        (entry as any).reduzierung.length > 0
          ? (entry as any).reduzierung
              .map((redu: Record<string, any>) => {
                if (!redu || typeof redu !== "object") {
                  return null;
                }
                const category = normalizeText(redu.kategorie);
                const value = normalizeText(redu.redu_abstand ?? redu.wert);
                const parts: string[] = [];
                if (category) {
                  parts.push(escapeHtml(category));
                }
                if (value) {
                  parts.push(escapeHtml(value));
                }
                if (!parts.length) {
                  return null;
                }
                return `<span class="badge bg-light text-dark border">${parts.join(
                  " – "
                )}</span>`;
              })
              .filter((redu: string | null): redu is string => Boolean(redu))
              .join(" ")
          : "";

      const header = code
        ? `<span class="fw-semibold">${escapeHtml(code)}</span>`
        : `<span class="fw-semibold">Auflage</span>`;
      const requirementBadge = requirement
        ? ` <span class="badge bg-secondary">${escapeHtml(requirement)}</span>`
        : "";
      const metaHtml =
        metaParts.length > 0
          ? `<div class="small text-muted">${metaParts.join(" · ")}</div>`
          : "";
      const reductionHtml = reductions
        ? `<div class="mt-1 d-flex flex-wrap gap-1">${reductions}</div>`
        : "";

      return `<li>${header}${requirementBadge}${metaHtml}${reductionHtml}</li>`;
    })
    .filter((entry): entry is string => Boolean(entry))
    .join("");

  if (!list) {
    return "";
  }

  return `
    <div class="mt-2">
      <strong><i class="bi bi-clipboard-check me-1"></i>Auflagen:</strong>
      <ul class="small mb-0">${list}</ul>
    </div>
  `;
}

function renderResultAwgPartner(result: ReportingResult): string {
  if (!Array.isArray(result.awg_partner) || result.awg_partner.length === 0) {
    return "";
  }

  const list = result.awg_partner
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const partnerKennr = normalizeText(entry.partner_kennr ?? entry.kennr);
      const art = normalizeText(entry.mischung_art ?? entry.art);

      if (!partnerKennr && !art) {
        return null;
      }

      const parts: string[] = [];
      if (partnerKennr) {
        parts.push(`Partner: ${escapeHtml(partnerKennr)}`);
      }
      if (art) {
        parts.push(`Art: ${escapeHtml(art)}`);
      }

      return `<li>${parts.join(" · ")}</li>`;
    })
    .filter((entry): entry is string => Boolean(entry))
    .join("");

  if (!list) {
    return "";
  }

  return `
    <div class="mt-2">
      <strong><i class="bi bi-diagram-3 me-1"></i>Mischpartner:</strong>
      <ul class="small mb-0">${list}</ul>
    </div>
  `;
}

function renderResultAwgPartnerAufwand(result: ReportingResult): string {
  if (
    !Array.isArray(result.awg_partner_aufwand) ||
    result.awg_partner_aufwand.length === 0
  ) {
    return "";
  }

  const list = result.awg_partner_aufwand
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const partnerKennr = normalizeText(entry.partner_kennr ?? entry.kennr);
      const condition = normalizeText(
        entry.aufwandbedingung ?? entry.aufwand_bedingung
      );
      // Official API field names: m_aufwand, m_aufwand_einheit
      const amount = formatAmount(entry.m_aufwand, entry.m_aufwand_einheit);

      const parts: string[] = [];
      if (partnerKennr) {
        parts.push(`Partner: ${escapeHtml(partnerKennr)}`);
      }
      if (condition) {
        parts.push(`Bedingung: ${escapeHtml(condition)}`);
      }
      if (amount) {
        parts.push(`Menge: ${escapeHtml(amount)}`);
      }

      if (!parts.length) {
        return null;
      }

      return `<li>${parts.join(" · ")}</li>`;
    })
    .filter((entry): entry is string => Boolean(entry))
    .join("");

  if (!list) {
    return "";
  }

  return `
    <div class="mt-2">
      <strong><i class="bi bi-droplet-half me-1"></i>Mischpartner-Aufwand:</strong>
      <ul class="small mb-0">${list}</ul>
    </div>
  `;
}

function renderResultAwgBemerkungen(result: ReportingResult): string {
  if (
    !Array.isArray(result.awg_bemerkungen) ||
    result.awg_bemerkungen.length === 0
  ) {
    return "";
  }

  const list = result.awg_bemerkungen
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const note = normalizeText(entry.auflage_bem ?? entry.bemerkung);
      const area = normalizeText(entry.auflage_bereich ?? entry.bereich);

      if (!note && !area) {
        return null;
      }

      const parts: string[] = [];
      if (note) {
        parts.push(escapeHtml(note));
      }
      if (area) {
        parts.push(
          `<span class="text-muted">Bereich: ${escapeHtml(area)}</span>`
        );
      }

      return `<li>${parts.join(" · ")}</li>`;
    })
    .filter((entry): entry is string => Boolean(entry))
    .join("");

  if (!list) {
    return "";
  }

  return `
    <div class="mt-2">
      <strong><i class="bi bi-chat-left-text me-1"></i>AWG-Bemerkungen:</strong>
      <ul class="small mb-0">${list}</ul>
    </div>
  `;
}

function renderResultAwgVerwendungszwecke(result: ReportingResult): string {
  if (
    !Array.isArray(result.awg_verwendungszwecke) ||
    result.awg_verwendungszwecke.length === 0
  ) {
    return "";
  }

  const unique = Array.from(
    new Set(
      result.awg_verwendungszwecke
        .map((entry) =>
          entry && typeof entry === "object"
            ? normalizeText(entry.verwendungszweck ?? entry.code)
            : ""
        )
        .filter((code) => code)
    )
  );

  if (!unique.length) {
    return "";
  }

  const badges = unique
    .map((code) => `<span class="badge bg-primary">${escapeHtml(code)}</span>`)
    .join(" ");

  return `
    <div class="mt-2">
      <strong><i class="bi bi-list-task me-1"></i>Verwendungszwecke:</strong>
      <div class="d-flex flex-wrap gap-1">${badges}</div>
    </div>
  `;
}

function renderResultAwgWartezeitAusnahmen(result: ReportingResult): string {
  if (
    !Array.isArray(result.awg_wartezeit_ausnahmen) ||
    result.awg_wartezeit_ausnahmen.length === 0
  ) {
    return "";
  }

  const labelMap = new Map<string, string>();
  if (Array.isArray(result.kulturen)) {
    for (const entry of result.kulturen) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const code = normalizeText((entry as any).kultur);
      const label = normalizeText((entry as any).label);
      if (code && label) {
        labelMap.set(code, label);
      }
    }
  }
  if (Array.isArray(result.wartezeiten)) {
    for (const entry of result.wartezeiten) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const code = normalizeText((entry as any).kultur);
      const label = normalizeText((entry as any).kultur_label);
      if (code && label && !labelMap.has(code)) {
        labelMap.set(code, label);
      }
    }
  }

  const list = result.awg_wartezeit_ausnahmen
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const wartezeitNr = normalizeText(entry.awg_wartezeit_nr);
      const kulturCode = normalizeText(entry.kultur);

      if (!wartezeitNr && !kulturCode) {
        return null;
      }

      const displayLabel = kulturCode
        ? labelMap.get(kulturCode) || kulturCode
        : "";

      const parts: string[] = [];
      if (displayLabel) {
        parts.push(escapeHtml(displayLabel));
      }
      if (wartezeitNr) {
        parts.push(
          `<span class="text-muted">Nr.: ${escapeHtml(wartezeitNr)}</span>`
        );
      }

      return `<li>${parts.join(" · ")}</li>`;
    })
    .filter((entry): entry is string => Boolean(entry))
    .join("");

  if (!list) {
    return "";
  }

  return `
    <div class="mt-2">
      <strong><i class="bi bi-hourglass-split me-1"></i>Wartezeit-Ausnahmen:</strong>
      <ul class="small mb-0">${list}</ul>
    </div>
  `;
}

function renderResultAwgZeitpunkte(result: ReportingResult): string {
  if (
    !Array.isArray(result.awg_zeitpunkte) ||
    result.awg_zeitpunkte.length === 0
  ) {
    return "";
  }

  const list = result.awg_zeitpunkte
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const zeitpunkt = normalizeText(entry.zeitpunkt ?? entry.code);
      const sortierNr = normalizeText(entry.sortier_nr);
      const operand = normalizeText(entry.operand_zu_vorher ?? entry.operand);

      if (!zeitpunkt && !sortierNr && !operand) {
        return null;
      }

      const parts: string[] = [];
      if (zeitpunkt) {
        parts.push(escapeHtml(zeitpunkt));
      }
      if (sortierNr) {
        parts.push(
          `<span class="text-muted">Pos.: ${escapeHtml(sortierNr)}</span>`
        );
      }
      if (operand) {
        parts.push(
          `<span class="text-muted">Operand: ${escapeHtml(operand)}</span>`
        );
      }

      return `<li>${parts.join(" · ")}</li>`;
    })
    .filter((entry): entry is string => Boolean(entry))
    .join("");

  if (!list) {
    return "";
  }

  return `
    <div class="mt-2">
      <strong><i class="bi bi-calendar-week me-1"></i>Anwendungszeitpunkte:</strong>
      <ul class="small mb-0">${list}</ul>
    </div>
  `;
}

function renderResultAwgZulassung(result: ReportingResult): string {
  if (
    !Array.isArray(result.awg_zulassung) ||
    result.awg_zulassung.length === 0
  ) {
    return "";
  }

  const list = result.awg_zulassung
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const end = formatDateHtml(entry.zul_ende ?? entry.gueltig_bis);
      if (!end) {
        return null;
      }

      return `<li>Gültig bis ${end}</li>`;
    })
    .filter((entry): entry is string => Boolean(entry))
    .join("");

  if (!list) {
    return "";
  }

  return `
    <div class="mt-2">
      <strong><i class="bi bi-calendar-check me-1"></i>AWG-Zulassung:</strong>
      <ul class="small mb-0">${list}</ul>
    </div>
  `;
}

function renderResultKulturen(result: ReportingResult): string {
  if (!Array.isArray(result.kulturen) || result.kulturen.length === 0) {
    return "";
  }

  const badges = result.kulturen
    .map(
      (entry) =>
        `<span class="badge ${
          entry.ausgenommen ? "bg-danger" : "bg-info"
        }" title="${escapeHtml(entry.kultur)}">${escapeHtml(
          entry.label || entry.kultur
        )}${entry.ausgenommen ? " (ausgenommen)" : ""}</span>`
    )
    .join(" ");

  return `
    <div class="mt-2">
      <strong><i class="bi bi-flower1 me-1"></i>Kulturen:</strong>
      <div class="d-flex flex-wrap gap-1">${badges}</div>
    </div>
  `;
}

function renderResultSchadorganismen(result: ReportingResult): string {
  if (
    !Array.isArray(result.schadorganismen) ||
    result.schadorganismen.length === 0
  ) {
    return "";
  }

  const badges = result.schadorganismen
    .map(
      (entry) =>
        `<span class="badge ${
          entry.ausgenommen ? "bg-danger" : "bg-secondary"
        }" title="${escapeHtml(entry.schadorg)}">${escapeHtml(
          entry.label || entry.schadorg
        )}${entry.ausgenommen ? " (ausgenommen)" : ""}</span>`
    )
    .join(" ");

  return `
    <div class="mt-2">
      <strong><i class="bi bi-bug me-1"></i>Schadorganismen:</strong>
      <div class="d-flex flex-wrap gap-1">${badges}</div>
    </div>
  `;
}

function renderResultAufwaende(result: ReportingResult): string {
  if (!Array.isArray(result.aufwaende) || result.aufwaende.length === 0) {
    return "";
  }

  const list = result.aufwaende
    .map((entry) => `<li>${renderAufwandRow(entry)}</li>`)
    .join("");

  return `
    <div class="mt-2">
      <strong><i class="bi bi-activity me-1"></i>Aufwände:</strong>
      <ul class="small mb-0">${list}</ul>
    </div>
  `;
}

function renderResultWartezeiten(result: ReportingResult): string {
  if (!Array.isArray(result.wartezeiten) || result.wartezeiten.length === 0) {
    return "";
  }

  const list = result.wartezeiten
    .map((entry) => {
      const anwendungsbereich = entry.anwendungsbereich
        ? ` (${escapeHtml(entry.anwendungsbereich)})`
        : "";
      // Official API field name: gesetzt_wartezeit
      return `
        <li>
          ${escapeHtml(entry.kultur_label || entry.kultur)}: ${escapeHtml(
            entry.gesetzt_wartezeit || "-"
          )} Tage${anwendungsbereich}
        </li>
      `;
    })
    .join("");

  return `
    <div class="mt-2">
      <strong><i class="bi bi-clock me-1"></i>Wartezeiten:</strong>
      <ul class="small mb-0">${list}</ul>
    </div>
  `;
}

function renderDebugSection(zulassungState: ZulassungState): string {
  const { debug, logs } = zulassungState;
  const manifestHtml = debug.manifest
    ? `
      <div class="mt-3">
        <h6><i class="bi bi-file-code me-1"></i>Manifest</h6>
        <details>
          <summary class="btn btn-sm btn-outline-secondary">JSON anzeigen</summary>
          <pre class="bg-dark text-light p-2 mt-2" style="font-size: 11px; max-height: 300px; overflow-y: auto;">${escapeHtml(
            JSON.stringify(debug.manifest, null, 2)
          )}</pre>
        </details>
      </div>
    `
    : "";

  const autoUpdateHtml = debug.lastAutoUpdateCheck
    ? `
      <div class="mt-3">
        <h6><i class="bi bi-clock-history me-1"></i>Letzter Auto-Update-Check</h6>
        <p class="small mb-0">
          <strong>Zeit:</strong> ${escapeHtml(
            new Date(debug.lastAutoUpdateCheck.time).toLocaleString("de-DE")
          )}<br>
          <strong>Ergebnis:</strong> ${escapeHtml(
            debug.lastAutoUpdateCheck.result || "OK"
          )}
        </p>
      </div>
    `
    : "";

  const syncLogHtml =
    Array.isArray(debug.lastSyncLog) && debug.lastSyncLog.length > 0
      ? debug.lastSyncLog
          .map(
            (log: SyncLogEntry) => `
            <tr>
              <td><small>${escapeHtml(
                new Date(log.synced_at).toLocaleString("de-DE")
              )}</small></td>
              <td>${
                log.ok
                  ? '<span class="badge bg-success"><i class="bi bi-check-lg"></i> OK</span>'
                  : '<span class="badge bg-danger"><i class="bi bi-x-lg"></i> Fehler</span>'
              }</td>
              <td><small>${escapeHtml(log.message)}</small></td>
            </tr>
          `
          )
          .join("")
      : '<tr><td colspan="3" class="text-muted">Keine Logs vorhanden</td></tr>';

  const sessionLogsHtml = logs.length
    ? logs
        .slice(-50)
        .map((log) => {
          const badgeClass =
            log.level === "error"
              ? "bg-danger"
              : log.level === "warn"
                ? "bg-warning"
                : log.level === "debug"
                  ? "bg-secondary"
                  : "bg-primary";
          return `<div><span class="badge ${badgeClass} me-1">${escapeHtml(
            log.level.toUpperCase()
          )}</span> ${escapeHtml(log.message)}</div>`;
        })
        .join("")
    : "";

  const schemaHtml = debug.schema
    ? `
      <div class="mt-3">
        <h6><i class="bi bi-diagram-3 me-1"></i>Schema-Informationen</h6>
        <p><strong>User Version:</strong> ${escapeHtml(
          debug.schema.user_version
        )}</p>
        <details>
          <summary class="btn btn-sm btn-outline-secondary">Tabellen anzeigen</summary>
          <pre class="bg-dark text-light p-2 mt-2" style="font-size: 11px; max-height: 400px; overflow-y: auto;">${escapeHtml(
            JSON.stringify(debug.schema.tables, null, 2)
          )}</pre>
        </details>
      </div>
    `
    : "";

  return `
    <div class="card mb-3" style="background: #2a2a2a;">
      <div class="card-body">
        <h5 class="card-title">
          <button class="btn btn-sm btn-link text-decoration-none p-0" type="button" data-bs-toggle="collapse" data-bs-target="#debug-panel">
            <i class="bi bi-tools me-2"></i>Debug-Informationen ▼
          </button>
        </h5>
        <div class="collapse" id="debug-panel">
          ${manifestHtml}
          ${autoUpdateHtml}
          <div class="mt-3">
            <h6><i class="bi bi-list-ul me-1"></i>Sync-Logs (letzte 10)</h6>
            <div class="table-responsive">
              <table class="table table-sm">
                <thead>
                  <tr>
                    <th>Zeit</th>
                    <th>Status</th>
                    <th>Nachricht</th>
                  </tr>
                </thead>
                <tbody>${syncLogHtml}</tbody>
              </table>
            </div>
          </div>
          ${
            sessionLogsHtml
              ? `
            <div class="mt-3">
              <h6><i class="bi bi-terminal me-1"></i>Aktuelle Session Logs</h6>
              <div class="bg-dark text-light p-2" style="max-height: 200px; overflow-y: auto; font-family: monospace; font-size: 12px;">
                ${sessionLogsHtml}
              </div>
            </div>
          `
              : ""
          }
          ${schemaHtml}
        </div>
      </div>
    </div>
  `;
}

// Dialog für "Zu Mitteln hinzufügen"
let addMediumDialog: HTMLElement | null = null;

function createAddMediumDialog(): HTMLElement {
  if (addMediumDialog && document.body.contains(addMediumDialog)) {
    return addMediumDialog;
  }

  const overlay = document.createElement("div");
  overlay.id = "addMediumDialog";
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
  `;

  overlay.innerHTML = `
    <div style="background: #2d2d2d; border-radius: 8px; width: 100%; max-width: 450px; margin: 20px; box-shadow: 0 10px 40px rgba(0,0,0,0.5);">
      <div style="padding: 16px 20px; border-bottom: 1px solid #444; display: flex; justify-content: space-between; align-items: center;">
        <h5 style="margin: 0; color: #fff; font-size: 18px;">
          <i class="bi bi-plus-circle text-success me-2"></i>Mittel hinzufügen
        </h5>
        <button type="button" id="btn-close-dialog" style="background: none; border: none; color: #888; font-size: 24px; cursor: pointer; padding: 0; line-height: 1;">&times;</button>
      </div>
      <div style="padding: 20px;">
        <form id="add-medium-modal-form">
          <!-- Feste Werte aus BVL (nicht editierbar) -->
          <div style="margin-bottom: 12px; padding: 12px; background: #3a3a3a; border-radius: 6px; border-left: 3px solid #666;">
            <label style="display: block; margin-bottom: 6px; color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Name</label>
            <input type="text" name="modal-name" readonly style="width: 100%; padding: 6px 0; border: none; background: transparent; color: #ccc; font-size: 14px; cursor: not-allowed;" />
          </div>
          <div style="margin-bottom: 12px; padding: 12px; background: #3a3a3a; border-radius: 6px; border-left: 3px solid #666;">
            <label style="display: block; margin-bottom: 6px; color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Zulassungsnummer</label>
            <input type="text" name="modal-approval" readonly style="width: 100%; padding: 6px 0; border: none; background: transparent; color: #ccc; font-size: 14px; cursor: not-allowed;" />
          </div>
          <div style="margin-bottom: 12px; padding: 12px; background: #3a3a3a; border-radius: 6px; border-left: 3px solid #666;">
            <label style="display: block; margin-bottom: 6px; color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Wirkstoff</label>
            <input type="text" name="modal-wirkstoff" readonly style="width: 100%; padding: 6px 0; border: none; background: transparent; color: #ccc; font-size: 14px; cursor: not-allowed;" />
          </div>
          
          <div style="margin: 20px 0; padding: 10px 0; border-top: 1px dashed #555;">
            <span style="color: #28a745; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">
              <i class="bi bi-pencil-square me-1"></i>Editierbares Feld
            </span>
          </div>
          
          <!-- Editierbares Feld (grün umrandet) -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <div>
              <label style="display: block; margin-bottom: 6px; color: #28a745; font-size: 14px; font-weight: 500;">Wert (ml/ha) *</label>
              <input type="number" step="any" name="modal-value" placeholder="z.B. 500" required style="width: 100%; padding: 10px 12px; border: 2px solid #28a745; border-radius: 4px; background: #2a3a2a; color: #fff; font-size: 14px;" />
            </div>
            <div>
              <label style="display: block; margin-bottom: 6px; color: #888; font-size: 14px;">Einheit</label>
              <input type="text" name="modal-unit" value="ml" readonly style="width: 100%; padding: 10px 12px; border: 1px solid #555; border-radius: 4px; background: #3a3a3a; color: #ccc; font-size: 14px; cursor: not-allowed;" />
            </div>
          </div>
          
          <div style="margin: 16px 0; padding: 10px 0; border-top: 1px dashed #555;">
            <span style="color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">
              <i class="bi bi-lock me-1"></i>Automatisch befüllt
            </span>
          </div>
          
          <!-- Feste Standardwerte (readonly aber mit Werten) -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <div>
              <label style="display: block; margin-bottom: 6px; color: #888; font-size: 14px;">Methode</label>
              <input type="text" name="modal-method" value="perHektar" readonly style="width: 100%; padding: 10px 12px; border: 1px solid #555; border-radius: 4px; background: #3a3a3a; color: #ccc; font-size: 14px; cursor: not-allowed;" />
            </div>
            <div>
              <label style="display: block; margin-bottom: 6px; color: #888; font-size: 14px;">Wartezeit (BVL)</label>
              <input type="text" name="modal-wartezeit" readonly style="width: 100%; padding: 10px 12px; border: 1px solid #555; border-radius: 4px; background: #3a3a3a; color: #ccc; font-size: 14px; cursor: not-allowed;" />
            </div>
          </div>
        </form>
      </div>
      <div style="padding: 16px 20px; border-top: 1px solid #444; display: flex; justify-content: flex-end; gap: 10px;">
        <button type="button" id="btn-cancel-dialog" style="padding: 8px 16px; border: 1px solid #666; border-radius: 4px; background: transparent; color: #aaa; cursor: pointer; font-size: 14px;">Abbrechen</button>
        <button type="button" id="btn-save-medium" style="padding: 8px 16px; border: none; border-radius: 4px; background: #28a745; color: #fff; cursor: pointer; font-size: 14px;">
          <i class="bi bi-save me-1"></i>Speichern
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  addMediumDialog = overlay;

  // Event-Listener
  overlay
    .querySelector("#btn-close-dialog")
    ?.addEventListener("click", closeAddMediumDialog);
  overlay
    .querySelector("#btn-cancel-dialog")
    ?.addEventListener("click", closeAddMediumDialog);
  overlay
    .querySelector("#btn-save-medium")
    ?.addEventListener("click", () => void handleSaveMediumFromModal());

  // Klick außerhalb schließt Dialog
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      closeAddMediumDialog();
    }
  });

  return overlay;
}

function closeAddMediumDialog(): void {
  if (addMediumDialog) {
    addMediumDialog.remove();
    addMediumDialog = null;
  }
}

function showAddMediumModal(data: {
  name: string;
  kennr: string;
  wirkstoff: string;
  wartezeit: string;
}): void {
  const dialog = createAddMediumDialog();
  const form = dialog.querySelector<HTMLFormElement>("#add-medium-modal-form");

  if (form) {
    (form.querySelector('[name="modal-name"]') as HTMLInputElement).value =
      data.name;
    (form.querySelector('[name="modal-approval"]') as HTMLInputElement).value =
      data.kennr;
    (form.querySelector('[name="modal-wirkstoff"]') as HTMLInputElement).value =
      data.wirkstoff;
    (form.querySelector('[name="modal-wartezeit"]') as HTMLInputElement).value =
      data.wartezeit || "-";
    (form.querySelector('[name="modal-unit"]') as HTMLInputElement).value =
      "ml";
    (form.querySelector('[name="modal-method"]') as HTMLInputElement).value =
      "perHektar";
    (form.querySelector('[name="modal-value"]') as HTMLInputElement).value = "";

    // Fokus auf Wert-Feld (einziges editierbares Feld)
    setTimeout(() => {
      (form.querySelector('[name="modal-value"]') as HTMLInputElement)?.focus();
    }, 100);
  }
}

async function handleSaveMediumFromModal(): Promise<void> {
  const dialog = addMediumDialog;
  if (!dialog || !services) return;

  const form = dialog.querySelector<HTMLFormElement>("#add-medium-modal-form");
  if (!form) return;

  const name = (
    form.querySelector('[name="modal-name"]') as HTMLInputElement
  ).value.trim();
  const unit = (
    form.querySelector('[name="modal-unit"]') as HTMLInputElement
  ).value.trim();
  const method = (
    form.querySelector('[name="modal-method"]') as HTMLInputElement
  ).value.trim();
  const valueStr = (
    form.querySelector('[name="modal-value"]') as HTMLInputElement
  ).value.trim();
  const approval = (
    form.querySelector('[name="modal-approval"]') as HTMLInputElement
  ).value.trim();
  const wartezeitStr = (
    form.querySelector('[name="modal-wartezeit"]') as HTMLInputElement
  ).value.trim();
  const wirkstoff = (
    form.querySelector('[name="modal-wirkstoff"]') as HTMLInputElement
  ).value.trim();

  if (!name || !unit || !method || !valueStr) {
    alert("Bitte alle Pflichtfelder ausfüllen");
    return;
  }

  const value = parseFloat(valueStr);
  if (isNaN(value)) {
    alert("Wert muss eine Zahl sein");
    return;
  }

  // Wartezeit als String speichern (z.B. "28 Tage (FX)" oder "FX")
  const wartezeit = wartezeitStr && wartezeitStr !== "-" ? wartezeitStr : null;

  // Neues Mittel erstellen
  const newMedium = {
    id: `medium-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    name,
    unit,
    method,
    methodId: method, // Für Kompatibilität mit Settings
    value,
    approval: approval || null,
    zulassungsnummer: approval || null, // Für Kompatibilität mit Settings
    wartezeit: wartezeit,
    wirkstoff: wirkstoff || null,
  };

  // Zum State hinzufügen
  services.state.updateSlice("mediums", (prev) => {
    const items = Array.isArray(prev.items) ? prev.items : [];
    return {
      ...prev,
      items: [...items, newMedium],
      totalCount: items.length + 1,
      lastUpdatedAt: new Date().toISOString(),
    };
  });

  // In Datenbank persistieren
  try {
    const snapshot = getDatabaseSnapshot();
    await saveDatabase(snapshot);
    console.log("Mittel in Datenbank gespeichert:", newMedium.name);
  } catch (err) {
    console.error("Fehler beim Speichern in Datenbank:", err);
  }

  // Dialog schließen
  closeAddMediumDialog();

  // Erfolgs-Feedback
  alert(`"${name}" wurde zu deinen Mitteln hinzugefügt!`);
}

function attachEventHandlers(section: HTMLElement): void {
  const btnSync = section.querySelector<HTMLButtonElement>("#btn-sync");
  const btnSearch = section.querySelector<HTMLButtonElement>("#btn-search");
  const btnClearFilters =
    section.querySelector<HTMLButtonElement>("#btn-clear-filters");
  const btnClearFiltersInline = section.querySelector<HTMLButtonElement>(
    "#btn-clear-filters-inline"
  );
  const btnShowDebug =
    section.querySelector<HTMLButtonElement>("#btn-show-debug");

  if (btnSync) {
    btnSync.addEventListener("click", handleSync);
  }

  if (btnSearch) {
    btnSearch.addEventListener("click", handleSearch);
  }

  if (btnClearFilters) {
    btnClearFilters.addEventListener("click", handleClearFilters);
  }

  if (btnClearFiltersInline) {
    btnClearFiltersInline.addEventListener("click", handleClearFilters);
  }

  if (btnShowDebug) {
    btnShowDebug.addEventListener("click", () => {
      const debugPanel = section.querySelector<HTMLElement>("#debug-panel");
      if (
        debugPanel &&
        typeof bootstrap !== "undefined" &&
        bootstrap?.Collapse
      ) {
        // eslint-disable-next-line new-cap
        new bootstrap.Collapse(debugPanel, { toggle: true });
      }
    });
  }

  // Tab-Wechsel für die Karten-Navigation
  section.querySelectorAll<HTMLElement>("[data-tab]").forEach((card) => {
    card.addEventListener("click", () => {
      const tabName = card.dataset.tab;
      if (tabName && (tabName === "zulassung" || tabName === "codes")) {
        section.dataset.activeTab = tabName;
        render();
      }
    });
  });

  // Event-Delegation für "Zu Mitteln hinzufügen" Buttons
  section.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const btn = target.closest<HTMLButtonElement>(
      '[data-action="add-to-mediums"]'
    );
    if (btn) {
      const dataStr = btn.dataset.mediumInfo;
      if (dataStr) {
        try {
          // Base64 + URI-encoded JSON decodieren
          const data = JSON.parse(decodeURIComponent(atob(dataStr)));
          showAddMediumModal(data);
        } catch (e) {
          console.error("Failed to parse medium data", e);
        }
      }
    }
  });

  const filterCulture =
    section.querySelector<HTMLSelectElement>("#filter-culture");
  const filterPest = section.querySelector<HTMLSelectElement>("#filter-pest");
  const filterText = section.querySelector<HTMLInputElement>("#filter-text");
  const filterExpired =
    section.querySelector<HTMLInputElement>("#filter-expired");
  const btnApplyUpdate =
    section.querySelector<HTMLButtonElement>("#btn-apply-update");

  if (filterCulture && services) {
    filterCulture.addEventListener("change", (event) => {
      const target = event.target as HTMLSelectElement;
      services!.state.updateSlice("zulassung", (prev) => ({
        ...prev,
        filters: { ...prev.filters, culture: target.value || null },
      }));
    });
  }

  if (filterPest && services) {
    filterPest.addEventListener("change", (event) => {
      const target = event.target as HTMLSelectElement;
      services!.state.updateSlice("zulassung", (prev) => ({
        ...prev,
        filters: { ...prev.filters, pest: target.value || null },
      }));
    });
  }

  if (filterText && services) {
    filterText.addEventListener("input", (event) => {
      const target = event.target as HTMLInputElement;
      services!.state.updateSlice("zulassung", (prev) => ({
        ...prev,
        filters: { ...prev.filters, text: target.value },
      }));
    });

    filterText.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && services) {
        const zulassungState = services.state.getState().zulassung;
        if (!zulassungState.busy && zulassungState.resultStatus !== "loading") {
          handleSearch();
        }
      }
    });
  }

  if (filterExpired && services) {
    filterExpired.addEventListener("change", (event) => {
      const target = event.target as HTMLInputElement;
      services!.state.updateSlice("zulassung", (prev) => ({
        ...prev,
        filters: { ...prev.filters, includeExpired: target.checked },
      }));
    });
  }

  if (btnApplyUpdate) {
    btnApplyUpdate.addEventListener("click", () => {
      handleSync();
    });
  }
}

function normalizeFilters(filters: ZulassungState["filters"]): FiltersSnapshot {
  return {
    culture: filters.culture || null,
    pest: filters.pest || null,
    text: filters.text ? filters.text.trim() : "",
    includeExpired: Boolean(filters.includeExpired),
  };
}

function resetSearchResults(): void {
  appliedFiltersSnapshot = null;
  activeSearchToken += 1;
  resultsPagerLoadingDirection = null;
  if (!services) {
    return;
  }
  services.state.updateSlice("zulassung", (prev) => ({
    ...prev,
    results: {
      items: [],
      page: 0,
      pageSize: RESULTS_PAGE_SIZE,
      totalCount: null,
      hasMore: false,
    },
    resultStatus: "idle" as ZulassungState["resultStatus"],
    resultError: null,
  }));
  renderIfVisible();
}

function loadResultsPage(
  page: number,
  direction: PagerDirection | null,
  options: { filters?: FiltersSnapshot; reset?: boolean } = {}
): void {
  if (!services) {
    return;
  }
  const normalizedPage = Math.max(0, page);
  const filters = options.filters ?? appliedFiltersSnapshot;
  if (!filters) {
    return;
  }

  const currentState = services.state.getState();
  const hasTotal =
    typeof currentState.zulassung.results.totalCount === "number";
  const requestToken = ++activeSearchToken;
  resultsPagerLoadingDirection = direction;
  if (options.reset) {
    appliedFiltersSnapshot = filters;
  }

  services.state.updateSlice("zulassung", (prev) => ({
    ...prev,
    resultStatus: "loading" as ZulassungState["resultStatus"],
    resultError: null,
    results: {
      ...prev.results,
      items: [],
      page: normalizedPage,
      pageSize: RESULTS_PAGE_SIZE,
      totalCount: options.reset ? null : prev.results.totalCount,
      hasMore: prev.results.hasMore,
    },
  }));
  renderIfVisible();

  void (async () => {
    try {
      const response = await storage.queryZulassung({
        ...filters,
        page: normalizedPage,
        pageSize: RESULTS_PAGE_SIZE,
        includeTotal: options.reset || !hasTotal,
      });

      if (requestToken !== activeSearchToken) {
        return;
      }

      services!.state.updateSlice("zulassung", (prev) => ({
        ...prev,
        filters: options.reset
          ? { ...prev.filters, text: filters.text }
          : prev.filters,
        results: {
          items: Array.isArray(response.items) ? response.items : [],
          page:
            typeof response.page === "number" ? response.page : normalizedPage,
          pageSize:
            typeof response.pageSize === "number"
              ? response.pageSize
              : RESULTS_PAGE_SIZE,
          totalCount:
            typeof response.totalCount === "number"
              ? response.totalCount
              : prev.results.totalCount,
          hasMore: Boolean(response.hasMore),
        },
        resultStatus: "ready" as ZulassungState["resultStatus"],
        resultError: null,
      }));
    } catch (error: any) {
      if (requestToken !== activeSearchToken) {
        return;
      }
      services!.state.updateSlice("zulassung", (prev) => ({
        ...prev,
        resultStatus: "error" as ZulassungState["resultStatus"],
        resultError: error?.message || "Unbekannter Fehler",
      }));
    } finally {
      if (requestToken === activeSearchToken) {
        resultsPagerLoadingDirection = null;
        renderIfVisible();
      }
    }
  })();
}

async function handleSync(): Promise<void> {
  if (!services) {
    return;
  }

  services.state.updateSlice("zulassung", (prev) => ({
    ...prev,
    busy: true,
    error: null,
    logs: [],
    progress: { step: "start", percent: 0, message: "Starte..." },
  }));

  render();

  try {
    const result = await syncBvlData(storage, {
      onProgress: (progress: ProgressInfo) => {
        services!.state.updateSlice("zulassung", (prev) => ({
          ...prev,
          progress,
        }));
        render();
      },
      onLog: (log: any) => {
        services!.state.updateSlice("zulassung", (prev) => ({
          ...prev,
          logs: [...prev.logs, log],
        }));
      },
    });

    const meta = result.meta as Record<string, any>;

    services.state.updateSlice("zulassung", (prev) => ({
      ...prev,
      busy: false,
      lastSync: meta.lastSyncIso ?? prev.lastSync,
      lastResultCounts: meta.lastSyncCounts ?? prev.lastResultCounts,
      dataSource: meta.dataSource ?? prev.dataSource,
      apiStand: meta.apiStand ?? prev.apiStand,
      manifestVersion: meta.manifestVersion ?? prev.manifestVersion,
      lastSyncHash: meta.lastSyncHash ?? prev.lastSyncHash,
      progress: { step: null, percent: 0, message: "" },
      autoUpdateAvailable: false,
      autoUpdateVersion: null,
    }));

    await loadInitialData();
    resetSearchResults();

    const [syncLog, schema] = await Promise.all([
      storage.listBvlSyncLog({ limit: 10 }),
      storage.diagnoseBvlSchema(),
    ]);

    services.state.updateSlice("zulassung", (prev) => ({
      ...prev,
      debug: {
        ...prev.debug,
        schema,
        lastSyncLog: syncLog,
      },
    }));

    render();
  } catch (error: any) {
    services.state.updateSlice("zulassung", (prev) => ({
      ...prev,
      busy: false,
      error: error?.message || "Unbekannter Fehler",
      progress: { step: null, percent: 0, message: "" },
    }));
    render();
  }
}

function handleSearch(): void {
  if (!services) {
    return;
  }
  const state = services.state.getState();
  const filters = normalizeFilters(state.zulassung.filters);
  loadResultsPage(0, null, { filters, reset: true });
}

function handleClearFilters(): void {
  if (!services) {
    return;
  }

  services.state.updateSlice("zulassung", (prev) => ({
    ...prev,
    filters: {
      culture: null,
      pest: null,
      text: "",
      includeExpired: false,
    },
  }));
  resetSearchResults();
}

// ============================================
// EPPO/BBCH Codes Manager Section
// ============================================

async function loadSavedCodes(): Promise<void> {
  try {
    const [eppoResult, bbchResult] = await Promise.all([
      storage.listSavedEppo({ limit: 100 }),
      storage.listSavedBbch({ limit: 100 }),
    ]);
    savedEppoList = eppoResult.items || [];
    savedBbchList = bbchResult.items || [];

    // Emit event DIRECTLY via EventBus to notify other components (e.g., Calculation form quick select)
    // This ensures the event is always sent, even when embedded in Settings
    emitEvent("savedCodes:changed", {
      eppoCount: savedEppoList.length,
      bbchCount: savedBbchList.length,
    });
  } catch (error) {
    console.error("Failed to load saved codes:", error);
    savedEppoList = [];
    savedBbchList = [];
  }
}

function renderCodesManagerSection(): string {
  const hasEppo = savedEppoList.length > 0;
  const hasBbch = savedBbchList.length > 0;

  return `
    <div class="row g-4">
      <!-- EPPO Codes Section -->
      <div class="col-lg-6">
        <div class="card card-dark codes-card h-100">
          <div class="card-header codes-card-header d-flex justify-content-between align-items-center">
            <h5 class="mb-0">
              <i class="bi bi-flower1 me-2 text-success"></i>
              Kulturen (EPPO-Codes)
            </h5>
            <span class="badge badge-psm-neutral">${savedEppoList.length} gespeichert</span>
          </div>
          <div class="card-body">
            <!-- Suchfeld für EPPO - prominent -->
            <div class="mb-3">
              <label class="form-label">
                <i class="bi bi-search me-1"></i>
                Kultur suchen und speichern
              </label>
              <input type="text" class="form-control form-control-lg" 
                     data-input="eppo-search" 
                     placeholder="z.B. Tomate, Apfel, Salat, Gurke..."
                     autocomplete="off" />
              <small class="form-text text-muted">Tippe mindestens 2 Buchstaben – Klick speichert direkt</small>
              <div data-role="eppo-search-results" class="list-group mt-2" style="max-height: 250px; overflow-y: auto;"></div>
            </div>
            
            <!-- Saved EPPO List - MOVED UP for visibility -->
            <div class="border-top pt-3 mb-3" style="border-color: var(--border-1) !important;">
              ${
                hasEppo
                  ? `
                <h6 class="mb-2 text-muted small text-uppercase d-flex align-items-center">
                  <i class="bi bi-bookmark-star me-1"></i>
                  Meine Kulturen
                  <span class="badge bg-success ms-2">${savedEppoList.length}</span>
                </h6>
                <div data-role="saved-eppo-list" class="list-group list-group-flush mb-3" style="max-height: 300px; overflow-y: auto;">
                  ${renderSavedEppoList()}
                </div>
              `
                  : `
                <div class="text-center py-3 text-muted">
                  <i class="bi bi-inbox fs-3 d-block mb-2 opacity-50"></i>
                  <p class="mb-0 small">Noch keine Kulturen gespeichert</p>
                  <small>Suche oben und klicke zum Speichern</small>
                </div>
              `
              }
            </div>
            
            <!-- Manuell eingeben - Collapsed by default -->
            <div class="border-top pt-2" style="border-color: var(--border-1) !important;">
              <button class="btn btn-sm btn-link text-decoration-none p-0 text-muted" type="button" 
                      data-bs-toggle="collapse" data-bs-target="#eppo-manual-form" 
                      aria-expanded="false">
                <i class="bi bi-pencil me-1"></i>
                Manuell eingeben
                <i class="bi bi-chevron-down ms-1"></i>
              </button>
              
              <div class="collapse mt-3" id="eppo-manual-form">
                <form data-form="add-eppo" class="row g-2">
                  <div class="col-5">
                    <input type="text" class="form-control form-control-sm" data-input="eppo-code" placeholder="Code (z.B. SOLLY)" />
                  </div>
                  <div class="col-5">
                    <input type="text" class="form-control form-control-sm" data-input="eppo-name" placeholder="Name (z.B. Tomate)" />
                  </div>
                  <div class="col-2">
                    <button type="submit" class="btn btn-psm-primary btn-sm w-100">
                      <i class="bi bi-plus-lg"></i>
                    </button>
                  </div>
                  <div class="col-12">
                    <div class="form-check form-check-inline">
                      <input type="checkbox" class="form-check-input" data-input="eppo-favorite" id="eppo-favorite" />
                      <label class="form-check-label small" for="eppo-favorite">
                        <i class="bi bi-star text-warning me-1"></i>Favorit
                      </label>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- BBCH Codes Section -->
      <div class="col-lg-6">
        <div class="card card-dark codes-card h-100">
          <div class="card-header codes-card-header d-flex justify-content-between align-items-center">
            <h5 class="mb-0">
              <i class="bi bi-bar-chart-steps me-2 text-info"></i>
              Wachstumsstadien (BBCH)
            </h5>
            <span class="badge badge-psm-neutral">${savedBbchList.length} gespeichert</span>
          </div>
          <div class="card-body">
            <!-- Suchfeld für BBCH - prominent -->
            <div class="mb-3">
              <label class="form-label">
                <i class="bi bi-search me-1"></i>
                Stadium suchen und speichern
              </label>
              <input type="text" class="form-control form-control-lg" 
                     data-input="bbch-search" 
                     placeholder="z.B. Blüte, Ernte, 65, Keimung..."
                     autocomplete="off" />
              <small class="form-text text-muted">Tippe einen Begriff oder eine Nummer – Klick speichert direkt</small>
              <div data-role="bbch-search-results" class="list-group mt-2" style="max-height: 250px; overflow-y: auto;"></div>
            </div>
            
            <!-- Saved BBCH List - MOVED UP for visibility -->
            <div class="border-top pt-3 mb-3" style="border-color: var(--border-1) !important;">
              ${
                hasBbch
                  ? `
                <h6 class="mb-2 text-muted small text-uppercase d-flex align-items-center">
                  <i class="bi bi-bookmark-star me-1"></i>
                  Meine Stadien
                  <span class="badge bg-info ms-2">${savedBbchList.length}</span>
                </h6>
                <div data-role="saved-bbch-list" class="list-group list-group-flush mb-3" style="max-height: 300px; overflow-y: auto;">
                  ${renderSavedBbchList()}
                </div>
              `
                  : `
                <div class="text-center py-3 text-muted">
                  <i class="bi bi-inbox fs-3 d-block mb-2 opacity-50"></i>
                  <p class="mb-0 small">Noch keine Stadien gespeichert</p>
                  <small>Suche oben und klicke zum Speichern</small>
                </div>
              `
              }
            </div>
            
            <!-- Manuell eingeben - Collapsed by default -->
            <div class="border-top pt-2" style="border-color: var(--border-1) !important;">
              <button class="btn btn-sm btn-link text-decoration-none p-0 text-muted" type="button" 
                      data-bs-toggle="collapse" data-bs-target="#bbch-manual-form" 
                      aria-expanded="false">
                <i class="bi bi-pencil me-1"></i>
                Manuell eingeben
                <i class="bi bi-chevron-down ms-1"></i>
              </button>
              
              <div class="collapse mt-3" id="bbch-manual-form">
                <form data-form="add-bbch" class="row g-2">
                  <div class="col-3">
                    <input type="text" class="form-control form-control-sm" data-input="bbch-code" placeholder="Code" />
                  </div>
                  <div class="col-7">
                    <input type="text" class="form-control form-control-sm" data-input="bbch-label" placeholder="Bezeichnung" />
                  </div>
                  <div class="col-2">
                    <button type="submit" class="btn btn-psm-primary btn-sm w-100">
                      <i class="bi bi-plus-lg"></i>
                    </button>
                  </div>
                  <div class="col-12">
                    <div class="form-check form-check-inline">
                      <input type="checkbox" class="form-check-input" data-input="bbch-favorite" id="bbch-favorite" />
                      <label class="form-check-label small" for="bbch-favorite">
                        <i class="bi bi-star text-warning me-1"></i>Favorit
                      </label>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderSavedEppoList(): string {
  if (!savedEppoList.length) {
    return `
      <div class="list-group-item list-group-item-action text-muted text-center py-4">
        <i class="bi bi-inbox fs-2 d-block mb-2"></i>
        Noch keine EPPO-Codes gespeichert
      </div>
    `;
  }

  return savedEppoList
    .map(
      (item) => `
    <div class="list-group-item list-group-item-action d-flex justify-content-between align-items-center" data-eppo-id="${escapeHtml(
      item.id
    )}">
      <div class="flex-grow-1">
        ${
          item.isFavorite
            ? '<i class="bi bi-star-fill text-warning me-2"></i>'
            : ""
        }
        <strong class="text-success">${escapeHtml(item.code)}</strong>
        <span class="ms-2">${escapeHtml(item.name)}</span>
        ${
          item.usageCount > 0
            ? `<span class="badge bg-secondary ms-2">${item.usageCount}x</span>`
            : ""
        }
      </div>
      <div class="btn-group btn-group-sm">
        <button type="button" class="btn btn-outline-warning" data-action="toggle-favorite-eppo" data-id="${escapeHtml(
          item.id
        )}" title="Favorit umschalten">
          <i class="bi bi-star${item.isFavorite ? "-fill" : ""}"></i>
        </button>
        <button type="button" class="btn btn-outline-danger" data-action="delete-eppo" data-id="${escapeHtml(
          item.id
        )}" title="Löschen">
          <i class="bi bi-trash"></i>
        </button>
      </div>
    </div>
  `
    )
    .join("");
}

function renderSavedBbchList(): string {
  if (!savedBbchList.length) {
    return `
      <div class="list-group-item list-group-item-action text-muted text-center py-4">
        <i class="bi bi-inbox fs-2 d-block mb-2"></i>
        Noch keine BBCH-Stadien gespeichert
      </div>
    `;
  }

  return savedBbchList
    .map(
      (item) => `
    <div class="list-group-item list-group-item-action d-flex justify-content-between align-items-center" data-bbch-id="${escapeHtml(
      item.id
    )}">
      <div class="flex-grow-1">
        ${
          item.isFavorite
            ? '<i class="bi bi-star-fill text-warning me-2"></i>'
            : ""
        }
        <strong class="text-info">${escapeHtml(item.code)}</strong>
        <span class="ms-2">${escapeHtml(item.label)}</span>
        ${
          item.usageCount > 0
            ? `<span class="badge bg-secondary ms-2">${item.usageCount}x</span>`
            : ""
        }
      </div>
      <div class="btn-group btn-group-sm">
        <button type="button" class="btn btn-outline-warning" data-action="toggle-favorite-bbch" data-id="${escapeHtml(
          item.id
        )}" title="Favorit umschalten">
          <i class="bi bi-star${item.isFavorite ? "-fill" : ""}"></i>
        </button>
        <button type="button" class="btn btn-outline-danger" data-action="delete-bbch" data-id="${escapeHtml(
          item.id
        )}" title="Löschen">
          <i class="bi bi-trash"></i>
        </button>
      </div>
    </div>
  `
    )
    .join("");
}

function updateCodesLists(section: HTMLElement): void {
  // Update EPPO section
  const eppoListEl = section.querySelector<HTMLElement>(
    '[data-role="saved-eppo-list"]'
  );
  const hasEppo = savedEppoList.length > 0;

  if (eppoListEl) {
    // Find the parent container that holds either the list or empty placeholder
    const eppoContainer = eppoListEl.closest(".border-top");
    if (eppoContainer) {
      if (hasEppo) {
        eppoContainer.innerHTML = `
          <h6 class="mb-2 text-muted small text-uppercase d-flex align-items-center">
            <i class="bi bi-bookmark-star me-1"></i>
            Meine Kulturen
            <span class="badge bg-success ms-2">${savedEppoList.length}</span>
          </h6>
          <div data-role="saved-eppo-list" class="list-group list-group-flush mb-3" style="max-height: 300px; overflow-y: auto;">
            ${renderSavedEppoList()}
          </div>
        `;
      }
    }
  } else if (hasEppo) {
    // Need to replace empty placeholder with list
    const emptyPlaceholder = section.querySelector(
      ".codes-card:first-child .border-top.pt-3.mb-3"
    );
    if (emptyPlaceholder) {
      emptyPlaceholder.innerHTML = `
        <h6 class="mb-2 text-muted small text-uppercase d-flex align-items-center">
          <i class="bi bi-bookmark-star me-1"></i>
          Meine Kulturen
          <span class="badge bg-success ms-2">${savedEppoList.length}</span>
        </h6>
        <div data-role="saved-eppo-list" class="list-group list-group-flush mb-3" style="max-height: 300px; overflow-y: auto;">
          ${renderSavedEppoList()}
        </div>
      `;
    }
  }

  // Update BBCH section
  const bbchListEl = section.querySelector<HTMLElement>(
    '[data-role="saved-bbch-list"]'
  );
  const hasBbch = savedBbchList.length > 0;

  if (bbchListEl) {
    // Find the parent container that holds either the list or empty placeholder
    const bbchContainer = bbchListEl.closest(".border-top");
    if (bbchContainer) {
      if (hasBbch) {
        bbchContainer.innerHTML = `
          <h6 class="mb-2 text-muted small text-uppercase d-flex align-items-center">
            <i class="bi bi-bookmark-star me-1"></i>
            Meine Stadien
            <span class="badge bg-info ms-2">${savedBbchList.length}</span>
          </h6>
          <div data-role="saved-bbch-list" class="list-group list-group-flush mb-3" style="max-height: 300px; overflow-y: auto;">
            ${renderSavedBbchList()}
          </div>
        `;
      }
    }
  } else if (hasBbch) {
    // Need to replace empty placeholder with list - find the second card (BBCH)
    const bbchCards = section.querySelectorAll(".codes-card");
    const bbchCard = bbchCards[1];
    if (bbchCard) {
      const emptyPlaceholder = bbchCard.querySelector(".border-top.pt-3.mb-3");
      if (emptyPlaceholder) {
        emptyPlaceholder.innerHTML = `
          <h6 class="mb-2 text-muted small text-uppercase d-flex align-items-center">
            <i class="bi bi-bookmark-star me-1"></i>
            Meine Stadien
            <span class="badge bg-info ms-2">${savedBbchList.length}</span>
          </h6>
          <div data-role="saved-bbch-list" class="list-group list-group-flush mb-3" style="max-height: 300px; overflow-y: auto;">
            ${renderSavedBbchList()}
          </div>
        `;
      }
    }
  }

  // Update badge counts in card headers
  const eppoCountBadge = section.querySelector(
    ".codes-card:first-child .card-header .badge"
  );
  const bbchCountBadge = section.querySelector(
    ".codes-card:last-child .card-header .badge"
  );
  if (eppoCountBadge)
    eppoCountBadge.textContent = `${savedEppoList.length} gespeichert`;
  if (bbchCountBadge)
    bbchCountBadge.textContent = `${savedBbchList.length} gespeichert`;
}

function attachCodesManagerHandlers(section: HTMLElement): void {
  // Tab switching
  section.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab as "zulassung" | "codes";
      section.dataset.activeTab = tab;

      // Update tab buttons
      section
        .querySelectorAll("[data-tab]")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      // Update tab content
      section.querySelectorAll("[data-tab-content]").forEach((content) => {
        content.classList.toggle(
          "d-none",
          content.getAttribute("data-tab-content") !== tab
        );
        content.classList.toggle(
          "show",
          content.getAttribute("data-tab-content") === tab
        );
        content.classList.toggle(
          "active",
          content.getAttribute("data-tab-content") === tab
        );
      });

      // Load codes if switching to codes tab
      if (tab === "codes" && !codesManagerInitialized) {
        codesManagerInitialized = true;
        void loadSavedCodes().then(() => updateCodesLists(section));
      }
    });
  });

  // EPPO Search
  const eppoSearchInput = section.querySelector<HTMLInputElement>(
    '[data-input="eppo-search"]'
  );
  const eppoSearchResults = section.querySelector<HTMLElement>(
    '[data-role="eppo-search-results"]'
  );

  if (eppoSearchInput && eppoSearchResults) {
    const searchEppo = debounce(async () => {
      const term = eppoSearchInput.value.trim();
      if (term.length < 2) {
        eppoSearchResults.innerHTML = "";
        return;
      }

      try {
        const results = await searchEppoSuggestions(term, 10);
        if (!results.length) {
          eppoSearchResults.innerHTML = `
            <div class="list-group-item text-muted">Keine Ergebnisse für "${escapeHtml(
              term
            )}"</div>
          `;
          return;
        }

        eppoSearchResults.innerHTML = results
          .map(
            (r) => `
          <button type="button" class="list-group-item list-group-item-action" 
                  data-action="select-eppo" 
                  data-code="${escapeHtml(r.code)}" 
                  data-name="${escapeHtml(r.name)}"
                  data-language="${escapeHtml(r.language || "")}"
                  data-dtcode="${escapeHtml(r.dtcode || "")}">
            <strong class="text-success">${escapeHtml(r.code)}</strong>
            <span class="ms-2">${escapeHtml(r.name)}</span>
            ${
              r.dtcode
                ? `<small class="text-muted ms-2">(${escapeHtml(
                    r.dtcode
                  )})</small>`
                : ""
            }
          </button>
        `
          )
          .join("");
      } catch (error) {
        console.error("EPPO search failed:", error);
        eppoSearchResults.innerHTML = `
          <div class="list-group-item text-danger">Suche fehlgeschlagen</div>
        `;
      }
    }, 300);

    eppoSearchInput.addEventListener("input", searchEppo);
  }

  // BBCH Search
  const bbchSearchInput = section.querySelector<HTMLInputElement>(
    '[data-input="bbch-search"]'
  );
  const bbchSearchResults = section.querySelector<HTMLElement>(
    '[data-role="bbch-search-results"]'
  );

  if (bbchSearchInput && bbchSearchResults) {
    const searchBbch = debounce(async () => {
      const term = bbchSearchInput.value.trim();
      if (term.length < 1) {
        bbchSearchResults.innerHTML = "";
        return;
      }

      try {
        const results = await searchBbchSuggestions(term, 10);
        if (!results.length) {
          bbchSearchResults.innerHTML = `
            <div class="list-group-item text-muted">Keine Ergebnisse für "${escapeHtml(
              term
            )}"</div>
          `;
          return;
        }

        bbchSearchResults.innerHTML = results
          .map(
            (r) => `
          <button type="button" class="list-group-item list-group-item-action d-flex align-items-start gap-2 py-2" 
                  data-action="select-bbch" 
                  data-code="${escapeHtml(r.code)}" 
                  data-label="${escapeHtml(r.label)}"
                  data-principal="${r.principalStage ?? ""}"
                  data-secondary="${r.secondaryStage ?? ""}">
            <strong class="text-info flex-shrink-0" style="min-width: 35px;">${escapeHtml(r.code)}</strong>
            <span class="text-break" style="line-height: 1.4;">${escapeHtml(r.label)}</span>
          </button>
        `
          )
          .join("");
      } catch (error) {
        console.error("BBCH search failed:", error);
        bbchSearchResults.innerHTML = `
          <div class="list-group-item text-danger">Suche fehlgeschlagen</div>
        `;
      }
    }, 300);

    bbchSearchInput.addEventListener("input", searchBbch);
  }

  // Event delegation for dynamic elements
  section.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement;
    const actionBtn = target.closest<HTMLElement>("[data-action]");
    if (!actionBtn) return;

    const action = actionBtn.dataset.action;

    // Select EPPO from search results - DIRECTLY SAVE to SQLite
    if (action === "select-eppo") {
      const code = actionBtn.dataset.code || "";
      const name = actionBtn.dataset.name || "";
      const language = actionBtn.dataset.language || "";
      const dtcode = actionBtn.dataset.dtcode || "";

      if (!code || !name) {
        console.warn("EPPO selection missing code or name");
        return;
      }

      // Clear search UI immediately for feedback
      if (eppoSearchResults) eppoSearchResults.innerHTML = "";
      if (eppoSearchInput) eppoSearchInput.value = "";

      // Check if already saved
      const existing = savedEppoList.find(
        (e) => e.code.toUpperCase() === code.toUpperCase()
      );
      if (existing) {
        // Show a visual hint that it's already saved
        const listItem = section.querySelector<HTMLElement>(
          `[data-eppo-id="${existing.id}"]`
        );
        if (listItem) {
          listItem.classList.add("flash-highlight");
          setTimeout(() => listItem.classList.remove("flash-highlight"), 800);
        }
        return;
      }

      try {
        // Directly save to SQLite
        await storage.upsertSavedEppo({
          code,
          name,
          language: language || undefined,
          dtcode: dtcode || undefined,
          isFavorite: false,
        });
        // Persist to database file
        const snapshot = getDatabaseSnapshot();
        await saveDatabase(snapshot);
        await loadSavedCodes();
        updateCodesLists(section);
      } catch (error) {
        console.error("Failed to save EPPO from search:", error);
        alert("Speichern fehlgeschlagen");
      }
    }

    // Select BBCH from search results - DIRECTLY SAVE to SQLite
    if (action === "select-bbch") {
      const code = actionBtn.dataset.code || "";
      const label = actionBtn.dataset.label || "";
      const principalStageStr = actionBtn.dataset.principal;
      const secondaryStageStr = actionBtn.dataset.secondary;
      const principalStage = principalStageStr
        ? parseInt(principalStageStr, 10)
        : undefined;
      const secondaryStage = secondaryStageStr
        ? parseInt(secondaryStageStr, 10)
        : undefined;

      if (!code || !label) {
        console.warn("BBCH selection missing code or label");
        return;
      }

      // Clear search UI immediately for feedback
      if (bbchSearchResults) bbchSearchResults.innerHTML = "";
      if (bbchSearchInput) bbchSearchInput.value = "";

      // Check if already saved
      const existing = savedBbchList.find((b) => b.code === code);
      if (existing) {
        // Show a visual hint that it's already saved
        const listItem = section.querySelector<HTMLElement>(
          `[data-bbch-id="${existing.id}"]`
        );
        if (listItem) {
          listItem.classList.add("flash-highlight");
          setTimeout(() => listItem.classList.remove("flash-highlight"), 800);
        }
        return;
      }

      try {
        // Directly save to SQLite
        await storage.upsertSavedBbch({
          code,
          label,
          principalStage: Number.isNaN(principalStage)
            ? undefined
            : principalStage,
          secondaryStage: Number.isNaN(secondaryStage)
            ? undefined
            : secondaryStage,
          isFavorite: false,
        });
        // Persist to database file
        const snapshot = getDatabaseSnapshot();
        await saveDatabase(snapshot);
        await loadSavedCodes();
        updateCodesLists(section);
      } catch (error) {
        console.error("Failed to save BBCH from search:", error);
        alert("Speichern fehlgeschlagen");
      }
    }

    // Toggle EPPO favorite
    if (action === "toggle-favorite-eppo") {
      const id = actionBtn.dataset.id;
      if (!id) return;
      const item = savedEppoList.find((e) => e.id === id);
      if (!item) return;
      try {
        await storage.upsertSavedEppo({
          id: item.id,
          code: item.code,
          name: item.name,
          language: item.language,
          dtcode: item.dtcode,
          isFavorite: !item.isFavorite,
        });
        // Persistiere in Datenbank
        const snapshot = getDatabaseSnapshot();
        await saveDatabase(snapshot);
        await loadSavedCodes();
        updateCodesLists(section);
      } catch (error) {
        console.error("Failed to toggle EPPO favorite:", error);
      }
    }

    // Toggle BBCH favorite
    if (action === "toggle-favorite-bbch") {
      const id = actionBtn.dataset.id;
      if (!id) return;
      const item = savedBbchList.find((b) => b.id === id);
      if (!item) return;
      try {
        await storage.upsertSavedBbch({
          id: item.id,
          code: item.code,
          label: item.label,
          principalStage: item.principalStage,
          secondaryStage: item.secondaryStage,
          isFavorite: !item.isFavorite,
        });
        // Persistiere in Datenbank
        const snapshot = getDatabaseSnapshot();
        await saveDatabase(snapshot);
        await loadSavedCodes();
        updateCodesLists(section);
      } catch (error) {
        console.error("Failed to toggle BBCH favorite:", error);
      }
    }

    // Delete EPPO
    if (action === "delete-eppo") {
      const id = actionBtn.dataset.id;
      if (!id) return;
      if (!confirm("EPPO-Code wirklich löschen?")) return;
      try {
        await storage.deleteSavedEppo({ id });
        // Persistiere in Datenbank
        const snapshot = getDatabaseSnapshot();
        await saveDatabase(snapshot);
        await loadSavedCodes();
        updateCodesLists(section);
      } catch (error) {
        console.error("Failed to delete EPPO:", error);
      }
    }

    // Delete BBCH
    if (action === "delete-bbch") {
      const id = actionBtn.dataset.id;
      if (!id) return;
      if (!confirm("BBCH-Stadium wirklich löschen?")) return;
      try {
        await storage.deleteSavedBbch({ id });
        // Persistiere in Datenbank
        const snapshot = getDatabaseSnapshot();
        await saveDatabase(snapshot);
        await loadSavedCodes();
        updateCodesLists(section);
      } catch (error) {
        console.error("Failed to delete BBCH:", error);
      }
    }
  });

  // Form submissions
  const eppoForm = section.querySelector<HTMLFormElement>(
    '[data-form="add-eppo"]'
  );
  if (eppoForm) {
    eppoForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const codeInput = section.querySelector<HTMLInputElement>(
        '[data-input="eppo-code"]'
      );
      const nameInput = section.querySelector<HTMLInputElement>(
        '[data-input="eppo-name"]'
      );
      const favoriteInput = section.querySelector<HTMLInputElement>(
        '[data-input="eppo-favorite"]'
      );

      const code = codeInput?.value.trim();
      const name = nameInput?.value.trim();
      if (!code || !name) {
        alert("Bitte Code und Name eingeben");
        return;
      }

      try {
        await storage.upsertSavedEppo({
          code,
          name,
          isFavorite: favoriteInput?.checked || false,
        });
        // Persistiere in Datenbank
        const snapshot = getDatabaseSnapshot();
        await saveDatabase(snapshot);
        await loadSavedCodes();
        updateCodesLists(section);
        // Clear form
        if (codeInput) codeInput.value = "";
        if (nameInput) nameInput.value = "";
        if (favoriteInput) favoriteInput.checked = false;
      } catch (error) {
        console.error("Failed to save EPPO:", error);
        alert("Speichern fehlgeschlagen");
      }
    });
  }

  const bbchForm = section.querySelector<HTMLFormElement>(
    '[data-form="add-bbch"]'
  );
  if (bbchForm) {
    bbchForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const codeInput = section.querySelector<HTMLInputElement>(
        '[data-input="bbch-code"]'
      );
      const labelInput = section.querySelector<HTMLInputElement>(
        '[data-input="bbch-label"]'
      );
      const favoriteInput = section.querySelector<HTMLInputElement>(
        '[data-input="bbch-favorite"]'
      );

      const code = codeInput?.value.trim();
      const label = labelInput?.value.trim();
      if (!code || !label) {
        alert("Bitte Code und Bezeichnung eingeben");
        return;
      }

      try {
        await storage.upsertSavedBbch({
          code,
          label,
          isFavorite: favoriteInput?.checked || false,
        });
        // Persistiere in Datenbank
        const snapshot = getDatabaseSnapshot();
        await saveDatabase(snapshot);
        await loadSavedCodes();
        updateCodesLists(section);
        // Clear form
        if (codeInput) codeInput.value = "";
        if (labelInput) labelInput.value = "";
        if (favoriteInput) favoriteInput.checked = false;
      } catch (error) {
        console.error("Failed to save BBCH:", error);
        alert("Speichern fehlgeschlagen");
      }
    });
  }
}

// ============================================

export interface InitZulassungOptions {
  embedded?: boolean;
}

export function initZulassung(
  target: Element | null,
  providedServices: Services,
  options: InitZulassungOptions = {}
): void {
  if (!target || initialized) {
    return;
  }

  container = target as HTMLElement;
  services = providedServices;
  initialized = true;
  embeddedMode = options.embedded === true;

  // Force visibility in embedded mode
  isSectionVisible = embeddedMode;

  render();

  services.state.subscribe((state) => {
    toggleVisibility(state);
  });

  services.events.subscribe?.("database:connected", async () => {
    await loadInitialData();
    setTimeout(() => {
      void performAutoUpdateCheck();
    }, 2000);
  });

  const initialState = services.state.getState();
  toggleVisibility(initialState);

  if (initialState.app.hasDatabase) {
    void (async () => {
      await loadInitialData();
      setTimeout(() => {
        void performAutoUpdateCheck();
      }, 2000);
    })();
  }
}

/**
 * Reset the initialized state to allow re-initialization in a different container.
 * Use with caution - primarily for embedding in settings tabs.
 */
export function resetZulassungInit(): void {
  initialized = false;
  embeddedMode = false;
  container = null;
  services = null;
}
