import {
  loadGpsPoints,
  saveGpsPoint,
  deleteGpsPoint,
  setActiveGpsPoint,
  syncGpsStateFromStorage,
} from "@scripts/core/database";
import {
  getState,
  extractSliceItems,
  subscribeState,
  type AppState,
  type GpsPoint,
  type GpsState,
} from "@scripts/core/state";
import { escapeHtml, buildGoogleMapsUrl } from "@scripts/core/utils";
import {
  createPagerWidget,
  type PagerWidget,
} from "@scripts/features/shared/pagerWidget";
import {
  registerAutoRefreshPolicy,
  type AutoRefreshStatus,
} from "@scripts/core/autoRefresh";

interface Services {
  state: {
    getState: typeof getState;
    subscribe: typeof subscribeState;
  };
  events?: {
    emit?: (eventName: string, payload?: unknown) => void;
    subscribe?: (
      eventName: string,
      handler: (payload: unknown) => void
    ) => (() => void) | void;
  };
}

type GpsTab = "list" | "capture" | "debug";
type AvailabilityStatus = "ok" | "no-db" | "wrong-driver";

const getGpsItems = (state: AppState): GpsPoint[] =>
  extractSliceItems<GpsPoint>(state.gps.points);
const getGpsSliceItems = (gpsState: GpsState): GpsPoint[] =>
  extractSliceItems<GpsPoint>(gpsState.points);

type Refs = {
  root: HTMLElement;
  message: HTMLElement | null;
  refreshIndicator: HTMLElement | null;
  availability: HTMLElement | null;
  tabButtons: HTMLButtonElement[];
  panels: HTMLElement[];
  listBody: HTMLElement | null;
  emptyState: HTMLElement | null;
  activeInfo: HTMLElement | null;
  summaryLabel: HTMLElement | null;
  statusBadge: HTMLElement | null;
  debugState: HTMLElement | null;
  lastAction: HTMLElement | null;
  form: HTMLFormElement | null;
  formFields: {
    name: HTMLInputElement | null;
    description: HTMLTextAreaElement | null;
    latitude: HTMLInputElement | null;
    longitude: HTMLInputElement | null;
    source: HTMLInputElement | null;
    activate: HTMLInputElement | null;
    rawCoordinates: HTMLInputElement | null;
  };
  disableTargets: HTMLElement[];
  geolocationBtn: HTMLButtonElement | null;
  mapButton: HTMLAnchorElement | null;
  verifyButton: HTMLButtonElement | null;
};

const coordinateFormatter = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 5,
  maximumFractionDigits: 5,
});
const dateTimeFormatter = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "short",
  timeStyle: "short",
});
const MAP_DEFAULT_QUERY = "Deutschland";

let initialized = false;
let activeTab: GpsTab = "list";
let messageTimeout: number | null = null;
let refs: Refs | null = null;
let geolocationPending = false;
let saveSubmissionPending = false;
let lastActionNote = "";
let lastActiveId: string | null = null;
let lastAvailability: AvailabilityStatus | null = null;
const GPS_PAGE_SIZE = 25;
const gpsNumberFormatter = new Intl.NumberFormat("de-DE");
let gpsPageIndex = 0;
let gpsPagerWidget: PagerWidget | null = null;
let gpsPagerTarget: HTMLElement | null = null;
let gpsAutoRefreshCleanup: (() => void) | null = null;

type HistoryActivationStatus = "success" | "error" | "pending";

function emitHistoryActivationResult(
  services: Services,
  payload: {
    status: HistoryActivationStatus;
    id: string;
    name?: string | null;
    message: string;
  }
): void {
  if (typeof services.events?.emit !== "function") {
    return;
  }
  services.events.emit("history:gps-activation-result", {
    ...payload,
    source: "gps",
    timestamp: Date.now(),
  });
}

function escapeAttr(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createSection(): HTMLElement {
  const wrapper = document.createElement("section");
  wrapper.className = "section-inner";
  wrapper.innerHTML = `
    <div class="d-flex flex-column flex-lg-row justify-content-between align-items-lg-end gap-3 mb-3">
      <div>
        <h2 class="mb-1">
          <i class="bi bi-geo-alt-fill text-success me-2"></i>
          GPS-Standorte
        </h2>
        <p class="text-muted mb-0">
          Erfassen, aktivieren und debuggen Sie gespeicherte Koordinatenpunkte.
        </p>
      </div>
      <div class="btn-group" role="group">
        <button class="btn btn-outline-light" data-action="reload-points" data-gps-disable>
          <i class="bi bi-arrow-clockwise me-1"></i>
          Aktualisieren
        </button>
        <button class="btn btn-outline-light" data-action="sync-active" data-gps-disable>
          <i class="bi bi-bullseye me-1"></i>
          Aktiven Punkt prüfen
        </button>
        <a class="btn btn-outline-success" data-role="gps-open-maps" href="https://www.google.com/maps" target="_blank" rel="noopener noreferrer">
          <i class="bi bi-map me-1"></i>
          Google Maps
        </a>
      </div>
    </div>

    <div class="alert d-none" data-role="gps-message"></div>
    <div class="alert alert-warning py-2 px-3 small d-none" data-role="gps-refresh-indicator">
      GPS-Daten wurden in einem anderen Bereich geändert. Ansicht aktualisiert sich beim Öffnen.
    </div>

    <div class="card card-dark">
      <div class="card-header border-secondary">
        <div class="btn-group btn-group-sm" role="tablist">
          <button class="btn btn-outline-light active" data-role="gps-tab" data-tab="list">
            <i class="bi bi-list-ul me-1"></i> Liste
          </button>
          <button class="btn btn-outline-light" data-role="gps-tab" data-tab="capture">
            <i class="bi bi-plus-circle me-1"></i> Neuer Punkt
          </button>
          <button class="btn btn-outline-light" data-role="gps-tab" data-tab="debug">
            <i class="bi bi-bug me-1"></i> Debug
          </button>
        </div>
      </div>
      <div class="card-body">
        <div class="alert alert-warning d-none" data-role="gps-availability"></div>
        <div data-role="gps-panel" data-panel="list">
          <div class="d-flex flex-column flex-xl-row justify-content-between align-items-start gap-2 mb-3">
            <div>
              <span class="badge bg-success" data-role="gps-status">Bereit</span>
              <span class="text-muted ms-2" data-role="gps-summary"></span>
            </div>
            <div class="text-muted">
              <i class="bi bi-pin-map"></i>
              <span data-role="gps-active-info">Kein aktiver Punkt ausgewählt.</span>
            </div>
          </div>
          <div class="table-responsive">
            <table class="table table-dark table-hover align-middle">
              <thead>
                <tr>
                  <th style="min-width: 180px;">Bezeichnung</th>
                  <th style="min-width: 160px;">Koordinaten</th>
                  <th style="min-width: 160px;">Quelle &amp; Aktualisiert</th>
                  <th class="text-end" style="width: 160px;">Aktionen</th>
                </tr>
              </thead>
              <tbody data-role="gps-list"></tbody>
            </table>
          </div>
          <div class="d-flex justify-content-end mt-3" data-role="gps-pager"></div>
          <div class="text-center text-muted py-4" data-role="gps-empty">
            <p class="mb-2">Noch keine GPS-Punkte vorhanden.</p>
            <p class="small text-muted mb-3">Nutzen Sie "Neuer Punkt" oder öffnen Sie Google Maps, um Koordinaten zu ermitteln.</p>
            <a class="btn btn-outline-info btn-sm" data-role="gps-empty-map-link" href="https://www.google.com/maps" target="_blank" rel="noopener noreferrer">
              <i class="bi bi-box-arrow-up-right me-1"></i>
              Google Maps öffnen
            </a>
          </div>
        </div>

        <div class="d-none" data-role="gps-panel" data-panel="capture">
          <form data-role="gps-form" class="gps-form">
            <div class="row g-3">
              <div class="col-12">
                <label class="form-label">Koordinaten aus Google Maps</label>
                <div class="input-group">
                  <input type="text" class="form-control" name="gps-raw-coordinates" placeholder="z. B. 47.68952, 9.12091" />
                  <button type="button" class="btn btn-outline-info" data-action="apply-raw-coords" data-gps-disable>
                    <i class="bi bi-clipboard2-check me-1"></i>
                    Einfügen &amp; aufteilen
                  </button>
                </div>
                <small class="form-text text-muted">
                  Tipp: In Google Maps auf die gewünschte Stelle klicken, beide Zahlen kopieren und hier einfügen. Die Felder unten werden automatisch gefüllt.
                </small>
              </div>
              <div class="col-md-6">
                <label class="form-label">Name *</label>
                <input type="text" class="form-control" name="gps-name" required data-gps-disable />
              </div>
              <div class="col-md-6">
                <label class="form-label">Quelle / Hinweis</label>
                <input type="text" class="form-control" name="gps-source" placeholder="z. B. Feld A oder Browser" data-gps-disable />
              </div>
              <div class="col-12">
                <label class="form-label">Beschreibung</label>
                <textarea class="form-control" rows="2" name="gps-description" data-gps-disable></textarea>
              </div>
              <div class="col-md-6">
                <label class="form-label">Breitengrad (Latitude) *</label>
                <input type="number" step="0.000001" class="form-control" name="gps-latitude" required data-gps-disable />
              </div>
              <div class="col-md-6">
                <label class="form-label">Längengrad (Longitude) *</label>
                <input type="number" step="0.000001" class="form-control" name="gps-longitude" required data-gps-disable />
              </div>
              <div class="col-12 d-flex flex-column flex-md-row gap-2">
                <button type="button" class="btn btn-outline-info btn-sm" data-action="verify-coords" data-gps-disable disabled>
                  <i class="bi bi-box-arrow-up-right me-1"></i>
                  Koordinaten in Google Maps prüfen
                </button>
              </div>
              <div class="col-12 d-flex flex-column flex-lg-row align-items-lg-center gap-3">
                <div class="form-check">
                  <input class="form-check-input" type="checkbox" id="gps-activate" name="gps-activate" data-gps-disable />
                  <label class="form-check-label" for="gps-activate">Punkt nach dem Speichern sofort aktiv setzen</label>
                </div>
                <div class="ms-lg-auto">
                  <button type="button" class="btn btn-outline-info btn-sm" data-action="use-geolocation" data-gps-disable>
                    <i class="bi bi-crosshair me-1"></i>
                    Browser-Position übernehmen
                  </button>
                </div>
              </div>
              <div class="col-12 d-flex flex-column flex-md-row gap-2">
                <button type="submit" class="btn btn-success" data-gps-disable>
                  <i class="bi bi-save me-1"></i>
                  Speichern
                </button>
                <button type="reset" class="btn btn-outline-light">
                  Formular leeren
                </button>
              </div>
            </div>
          </form>
          <p class="small text-muted mt-3">
            Hinweis: Koordinaten werden lokal in der SQLite-Datenbank gespeichert. Für Browser-Geolocation
            muss der Benutzer den Zugriff erlauben.
          </p>
        </div>

        <div class="d-none" data-role="gps-panel" data-panel="debug">
          <div class="d-flex flex-column flex-lg-row justify-content-between align-items-lg-center gap-2 mb-3">
            <div class="text-muted">
              Rohdaten des GPS-State zur Fehlersuche.
            </div>
            <div class="btn-group btn-group-sm">
              <button class="btn btn-outline-light" data-action="copy-debug">
                <i class="bi bi-clipboard me-1"></i>
                JSON kopieren
              </button>
              <button class="btn btn-outline-light" data-action="reload-points" data-gps-disable>
                <i class="bi bi-arrow-clockwise me-1"></i>
                Neu synchronisieren
              </button>
            </div>
          </div>
          <pre class="bg-black text-success rounded p-3 small" style="min-height: 200px; overflow:auto;" data-role="gps-debug"></pre>
          <p class="small text-muted mt-2">
            Letzte Aktion: <span data-role="gps-last-action">Noch keine Aktion aufgezeichnet.</span>
          </p>
        </div>
      </div>
    </div>
  `;
  return wrapper;
}

function collectRefs(section: HTMLElement): Refs {
  return {
    root: section,
    message: section.querySelector('[data-role="gps-message"]'),
    refreshIndicator: section.querySelector(
      '[data-role="gps-refresh-indicator"]'
    ),
    availability: section.querySelector('[data-role="gps-availability"]'),
    tabButtons: Array.from(
      section.querySelectorAll<HTMLButtonElement>('[data-role="gps-tab"]')
    ),
    panels: Array.from(
      section.querySelectorAll<HTMLElement>('[data-role="gps-panel"]')
    ),
    listBody: section.querySelector('[data-role="gps-list"]'),
    emptyState: section.querySelector('[data-role="gps-empty"]'),
    activeInfo: section.querySelector('[data-role="gps-active-info"]'),
    summaryLabel: section.querySelector('[data-role="gps-summary"]'),
    statusBadge: section.querySelector('[data-role="gps-status"]'),
    debugState: section.querySelector('[data-role="gps-debug"]'),
    lastAction: section.querySelector('[data-role="gps-last-action"]'),
    form: section.querySelector('[data-role="gps-form"]'),
    formFields: {
      name: section.querySelector('[name="gps-name"]'),
      description: section.querySelector('[name="gps-description"]'),
      latitude: section.querySelector('[name="gps-latitude"]'),
      longitude: section.querySelector('[name="gps-longitude"]'),
      source: section.querySelector('[name="gps-source"]'),
      activate: section.querySelector('[name="gps-activate"]'),
      rawCoordinates: section.querySelector('[name="gps-raw-coordinates"]'),
    },
    disableTargets: Array.from(
      section.querySelectorAll<HTMLElement>("[data-gps-disable]")
    ),
    geolocationBtn: section.querySelector('[data-action="use-geolocation"]'),
    mapButton: section.querySelector('[data-role="gps-open-maps"]'),
    verifyButton: section.querySelector('[data-action="verify-coords"]'),
  };
}

function buildGoogleMapsSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    query
  )}`;
}

function resolvePreferredMapTarget(state: AppState): {
  url: string;
  label: string;
} {
  const gpsState = state.gps;
  const gpsPoints = getGpsSliceItems(gpsState);
  const resolveFromPoint = (
    point: GpsPoint | null
  ): { url: string; label: string } | null => {
    if (!point) {
      return null;
    }
    const url =
      buildGoogleMapsUrl(point) ||
      buildGoogleMapsSearchUrl(`${point.latitude},${point.longitude}`);
    const label = point.name
      ? `${point.name}`
      : `${formatCoordinate(point.latitude)}, ${formatCoordinate(point.longitude)}`;
    return { url, label };
  };

  if (gpsState.activePointId) {
    const activePoint = gpsPoints.find(
      (entry) => entry.id === gpsState.activePointId
    );
    const resolved = resolveFromPoint(activePoint || null);
    if (resolved) {
      return resolved;
    }
  }

  if (gpsPoints.length > 0) {
    const resolved = resolveFromPoint(gpsPoints[0]);
    if (resolved) {
      return resolved;
    }
  }

  const companyAddress = state.company?.address?.trim();
  if (companyAddress) {
    return {
      url: buildGoogleMapsSearchUrl(companyAddress.replace(/\n/g, ", ")),
      label: companyAddress,
    };
  }

  const companyName = state.company?.name?.trim();
  if (companyName) {
    return {
      url: buildGoogleMapsSearchUrl(companyName),
      label: companyName,
    };
  }

  return {
    url: buildGoogleMapsSearchUrl(MAP_DEFAULT_QUERY),
    label: MAP_DEFAULT_QUERY,
  };
}

function updateMapEntryPoints(state: AppState): void {
  if (!refs) {
    return;
  }
  const target = resolvePreferredMapTarget(state);
  if (refs.mapButton) {
    refs.mapButton.href = target.url;
    refs.mapButton.title = `Google Maps öffnen (${target.label})`;
  }
  const emptyStateLink = refs.root.querySelector<HTMLAnchorElement>(
    '[data-role="gps-empty-map-link"]'
  );
  if (emptyStateLink) {
    emptyStateLink.href = target.url;
  }
}

function parseCoordinatePair(
  raw: string
): { latitude: number; longitude: number } | null {
  if (!raw) {
    return null;
  }
  const sanitized = raw.trim().replace(/\s+/g, " ").replace(/[,;]/g, " ");
  const matches = sanitized.match(/-?\d+(?:[.,]\d+)?/g);
  if (!matches || matches.length < 2) {
    return null;
  }
  const normalize = (value: string) => Number(value.replace(/,/g, "."));
  const latitude = normalize(matches[0]);
  const longitude = normalize(matches[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return null;
  }
  return { latitude, longitude };
}

function getFormCoordinates(): { latitude: number; longitude: number } | null {
  if (!refs?.formFields) {
    return null;
  }
  const rawLatitude = refs.formFields.latitude?.value ?? "";
  const rawLongitude = refs.formFields.longitude?.value ?? "";
  if (!rawLatitude.trim() || !rawLongitude.trim()) {
    return null;
  }
  const latitude = Number(rawLatitude);
  const longitude = Number(rawLongitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return null;
  }
  return { latitude, longitude };
}

function normalizeCoordinateValue(value: number): string {
  return Number(value).toFixed(6);
}

function hasDuplicateCoordinates(latitude: number, longitude: number): boolean {
  const normalizedLat = normalizeCoordinateValue(latitude);
  const normalizedLng = normalizeCoordinateValue(longitude);
  return getGpsItems(getState()).some((point) => {
    return (
      normalizeCoordinateValue(point.latitude) === normalizedLat &&
      normalizeCoordinateValue(point.longitude) === normalizedLng
    );
  });
}

function updateVerifyButtonState(): void {
  if (!refs?.verifyButton) {
    return;
  }
  const coords = getFormCoordinates();
  const enabled = Boolean(coords);
  refs.verifyButton.disabled = !enabled;
  if (coords) {
    const directUrl = buildGoogleMapsUrl({
      latitude: coords.latitude,
      longitude: coords.longitude,
    });
    refs.verifyButton.dataset.targetUrl = directUrl
      ? directUrl
      : buildGoogleMapsSearchUrl(`${coords.latitude},${coords.longitude}`);
  } else {
    delete refs.verifyButton.dataset.targetUrl;
  }
}

function formatCoordinate(value: number | string | null | undefined): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return "–";
  }
  return `${coordinateFormatter.format(parsed)}°`;
}

function formatTimestamp(
  value: string | number | Date | null | undefined
): string {
  if (!value) {
    return "–";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "–";
  }
  return dateTimeFormatter.format(date);
}

function setMessage(
  text?: string,
  variant: "info" | "success" | "warning" | "danger" = "info",
  autoHideMs = 4500
): void {
  if (!refs?.message) {
    return;
  }
  if (messageTimeout) {
    window.clearTimeout(messageTimeout);
    messageTimeout = null;
  }
  if (!text) {
    refs.message.classList.add("d-none");
    refs.message.textContent = "";
    return;
  }
  refs.message.className = `alert alert-${variant}`;
  refs.message.textContent = text;
  refs.message.classList.remove("d-none");
  if (autoHideMs > 0) {
    messageTimeout = window.setTimeout(() => {
      refs?.message?.classList.add("d-none");
    }, autoHideMs);
  }
}

function updateGpsRefreshIndicator(status: AutoRefreshStatus): void {
  const indicator = refs?.refreshIndicator;
  if (!indicator) {
    return;
  }
  indicator.classList.remove("alert-warning", "alert-info");
  if (status === "idle") {
    indicator.classList.add("d-none");
    return;
  }
  indicator.classList.remove("d-none");
  if (status === "stale") {
    indicator.classList.add("alert-warning");
    indicator.textContent =
      "GPS-Daten wurden geändert. Ansicht aktualisiert sich beim Öffnen.";
  } else {
    indicator.classList.add("alert-info");
    indicator.textContent = "GPS-Daten werden aktualisiert...";
  }
}

function setActiveTab(tab: GpsTab): void {
  if (!refs) {
    return;
  }
  activeTab = tab;
  refs.tabButtons.forEach((button) => {
    const match = button.dataset.tab === tab;
    button.classList.toggle("active", match);
  });
  refs.panels.forEach((panel) => {
    const match = panel.getAttribute("data-panel") === tab;
    panel.classList.toggle("d-none", !match);
  });
}

function evaluateAvailability(app: AppState["app"]): AvailabilityStatus {
  if (!app?.hasDatabase) {
    return "no-db";
  }
  if (app.storageDriver !== "sqlite") {
    return "wrong-driver";
  }
  return "ok";
}

function updateAvailabilityUi(status: AvailabilityStatus): void {
  if (!refs?.availability) {
    return;
  }
  if (status === "ok") {
    refs.availability.classList.add("d-none");
    refs.availability.textContent = "";
    return;
  }
  refs.availability.classList.remove("d-none");
  refs.availability.textContent =
    status === "no-db"
      ? "Bitte verbinden Sie zuerst eine Datenbank, um GPS-Punkte zu verwalten."
      : "GPS-Funktionen benötigen eine aktive SQLite-Datenbank. Bitte den SQLite-Treiber in den Einstellungen auswählen.";
}

function updateBusyUi(
  gpsState: GpsState,
  availability: AvailabilityStatus
): void {
  if (!refs) {
    return;
  }
  const shouldDisable =
    availability !== "ok" ||
    gpsState.pending ||
    geolocationPending ||
    saveSubmissionPending;
  refs.disableTargets.forEach((element) => {
    if (
      element instanceof HTMLButtonElement ||
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
    ) {
      element.disabled = shouldDisable;
    }
  });
  if (refs.statusBadge) {
    let badgeClass = "badge bg-success";
    let text = "Bereit";
    if (availability === "no-db") {
      badgeClass = "badge bg-secondary";
      text = "Keine Datenbank";
    } else if (availability === "wrong-driver") {
      badgeClass = "badge bg-warning text-dark";
      text = "Nur mit SQLite";
    } else if (gpsState.pending) {
      badgeClass = "badge bg-info text-dark";
      text = "Wird gespeichert";
    } else if (geolocationPending) {
      badgeClass = "badge bg-info text-dark";
      text = "Position wird ermittelt";
    }
    refs.statusBadge.className = badgeClass;
    refs.statusBadge.textContent = text;
  }
}

function getGpsPageMeta(points: GpsPoint[]): {
  total: number;
  start: number;
  end: number;
  items: GpsPoint[];
} {
  const total = points.length;
  if (!total) {
    gpsPageIndex = 0;
    return { total: 0, start: 0, end: 0, items: [] };
  }
  const totalPages = Math.max(Math.ceil(total / GPS_PAGE_SIZE), 1);
  if (gpsPageIndex >= totalPages) {
    gpsPageIndex = totalPages - 1;
  }
  if (gpsPageIndex < 0) {
    gpsPageIndex = 0;
  }
  const start = gpsPageIndex * GPS_PAGE_SIZE;
  const end = Math.min(start + GPS_PAGE_SIZE, total);
  return { total, start, end, items: points.slice(start, end) };
}

function ensureGpsPager(): PagerWidget | null {
  if (!refs?.root) {
    return null;
  }
  const target = refs.root.querySelector<HTMLElement>(
    '[data-role="gps-pager"]'
  );
  if (!target) {
    return null;
  }
  if (!gpsPagerWidget || gpsPagerTarget !== target) {
    gpsPagerWidget?.destroy();
    gpsPagerWidget = createPagerWidget(target, {
      onPrev: () => goToPrevGpsPage(),
      onNext: () => goToNextGpsPage(),
      labels: {
        prev: "Zurück",
        next: "Weiter",
        loading: "GPS-Punkte werden geladen...",
        empty: "Keine GPS-Punkte verfügbar",
      },
    });
    gpsPagerTarget = target;
  }
  return gpsPagerWidget;
}

function updateGpsPager(
  state: AppState,
  availability: AvailabilityStatus
): void {
  const widget = ensureGpsPager();
  if (!widget) {
    return;
  }
  if (availability !== "ok") {
    gpsPageIndex = 0;
    const info =
      availability === "no-db"
        ? "Keine Datenbank verbunden."
        : "Nur mit SQLite verfügbar.";
    widget.update({ status: "disabled", info });
    return;
  }
  const total = getGpsItems(state).length;
  if (!total) {
    gpsPageIndex = 0;
    const info = state.gps.initialized
      ? "Noch keine GPS-Punkte vorhanden."
      : "GPS-Punkte werden geladen...";
    widget.update({ status: "disabled", info });
    return;
  }
  const { start, end } = getGpsPageMeta(getGpsItems(state));
  widget.update({
    status: "ready",
    info: `Einträge ${gpsNumberFormatter.format(start + 1)}–${gpsNumberFormatter.format(
      end
    )} von ${gpsNumberFormatter.format(total)}`,
    canPrev: gpsPageIndex > 0,
    canNext: end < total,
  });
}

function renderPointRows(points: GpsPoint[], activeId: string | null): string {
  if (!points.length) {
    return "";
  }
  return points
    .map((point) => {
      const isActive = point.id === activeId;
      const description = point.description
        ? `<div class="text-muted small">${escapeHtml(point.description)}</div>`
        : "";
      const source = point.source
        ? `<span class="badge bg-dark border border-secondary">${escapeHtml(point.source)}</span>`
        : '<span class="text-muted">–</span>';
      const activeBadge = isActive
        ? '<span class="badge bg-success ms-2">Aktiv</span>'
        : "";
      const mapsUrl = buildGoogleMapsUrl(point);
      const mapsLink = mapsUrl
        ? `<a class="btn btn-outline-info" href="${escapeAttr(
            mapsUrl
          )}" target="_blank" rel="noopener noreferrer">
              Karte
            </a>`
        : "";
      return `
        <tr data-point-id="${escapeAttr(point.id)}">
          <td>
            <div class="fw-semibold">${escapeHtml(point.name || "Ohne Namen")}${activeBadge}</div>
            ${description}
          </td>
          <td class="font-monospace">
            <div>${formatCoordinate(point.latitude)}</div>
            <div>${formatCoordinate(point.longitude)}</div>
          </td>
          <td>
            <div>${source}</div>
            <div class="text-muted small">${formatTimestamp(point.updatedAt)}</div>
          </td>
          <td class="text-end">
            <div class="btn-group btn-group-sm">
              <button class="btn btn-outline-success" data-action="set-active" ${
                isActive ? "disabled" : ""
              }>
                Aktivieren
              </button>
              ${mapsLink}
              <button class="btn btn-outline-light" data-action="copy-coords">
                Kopieren
              </button>
              <button class="btn btn-outline-danger" data-action="delete-point">
                Löschen
              </button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("\n");
}

function updateListUi(state: AppState, availability: AvailabilityStatus): void {
  if (!refs) {
    return;
  }
  const gpsState = state.gps;
  const mapTarget = resolvePreferredMapTarget(state);
  const canDisplay = availability === "ok";
  if (refs.summaryLabel) {
    const count = getGpsSliceItems(gpsState).length;
    refs.summaryLabel.textContent = canDisplay
      ? `${count} Punkt${count === 1 ? "" : "e"} gespeichert`
      : "Funktion derzeit nicht verfügbar";
  }
  if (!canDisplay) {
    if (refs.listBody) {
      refs.listBody.innerHTML = "";
    }
    if (refs.emptyState) {
      refs.emptyState.textContent =
        availability === "no-db"
          ? "Keine Datenbank verbunden."
          : "Bitte SQLite als Speicher-Treiber aktivieren.";
      refs.emptyState.classList.remove("d-none");
    }
    if (refs.activeInfo) {
      refs.activeInfo.textContent =
        availability === "no-db"
          ? "Wartet auf Datenbank."
          : "Nur mit SQLite verfügbar.";
    }
    updateGpsPager(state, availability);
    return;
  }

  if (refs.listBody) {
    const { items } = getGpsPageMeta(getGpsSliceItems(gpsState));
    refs.listBody.innerHTML = renderPointRows(items, gpsState.activePointId);
  }
  if (refs.emptyState) {
    const hasPoints = getGpsSliceItems(gpsState).length > 0;
    refs.emptyState.classList.toggle("d-none", hasPoints);
    if (!hasPoints && gpsState.initialized) {
      refs.emptyState.innerHTML = `
        <p class="mb-2">Noch keine GPS-Punkte vorhanden.</p>
        <p class="small text-muted mb-3">
          Nutzen Sie "Neuer Punkt" oder öffnen Sie Google Maps, um Koordinaten zu ermitteln.
        </p>
        <a class="btn btn-outline-info btn-sm" data-role="gps-empty-map-link" href="${escapeAttr(
          mapTarget.url
        )}" target="_blank" rel="noopener noreferrer">
          <i class="bi bi-box-arrow-up-right me-1"></i>
          Google Maps öffnen
        </a>
      `;
    } else if (!gpsState.initialized) {
      refs.emptyState.textContent = "GPS-Punkte werden geladen...";
    }
  }
  if (refs.activeInfo) {
    if (gpsState.activePointId) {
      const point = getGpsSliceItems(gpsState).find(
        (entry) => entry.id === gpsState.activePointId
      );
      if (point) {
        const label = `${point.name || "Ohne Namen"} (${formatCoordinate(
          point.latitude
        )}, ${formatCoordinate(point.longitude)})`;
        const mapsUrl = buildGoogleMapsUrl(point);
        if (mapsUrl) {
          refs.activeInfo.innerHTML = `${escapeHtml(
            label
          )} <a class="btn btn-link btn-sm p-0 ms-2 align-baseline" href="${escapeAttr(
            mapsUrl
          )}" target="_blank" rel="noopener noreferrer">Google Maps</a>`;
        } else {
          refs.activeInfo.textContent = label;
        }
      } else {
        refs.activeInfo.textContent = "Aktiver Punkt nicht gefunden.";
      }
    } else {
      refs.activeInfo.innerHTML = `Kein aktiver Punkt ausgewählt. <a class="btn btn-link btn-sm p-0 ms-2 align-baseline" href="${escapeAttr(
        mapTarget.url
      )}" target="_blank" rel="noopener noreferrer">Google Maps öffnen</a>`;
    }
  }
  updateGpsPager(state, availability);
}

function goToPrevGpsPage(): void {
  if (gpsPageIndex === 0) {
    return;
  }
  gpsPageIndex = Math.max(gpsPageIndex - 1, 0);
  const state = getState();
  const availability = evaluateAvailability(state.app);
  updateListUi(state, availability);
}

function goToNextGpsPage(): void {
  const state = getState();
  const total = getGpsItems(state).length;
  if (!total) {
    return;
  }
  const maxPage = Math.max(Math.ceil(total / GPS_PAGE_SIZE) - 1, 0);
  if (gpsPageIndex >= maxPage) {
    return;
  }
  gpsPageIndex = Math.min(gpsPageIndex + 1, maxPage);
  const availability = evaluateAvailability(state.app);
  updateListUi(state, availability);
}

function updateDebugPanel(gpsState: GpsState): void {
  if (!refs) {
    return;
  }
  if (refs.debugState) {
    refs.debugState.textContent = JSON.stringify(gpsState, null, 2);
  }
  if (refs.lastAction) {
    refs.lastAction.textContent =
      lastActionNote || "Noch keine Aktion aufgezeichnet.";
  }
}

function recordAction(note: string): void {
  lastActionNote = `${new Date().toLocaleString("de-DE")}: ${note}`;
  if (refs?.lastAction) {
    refs.lastAction.textContent = lastActionNote;
  }
}

function getPointById(id: string | null): GpsPoint | null {
  if (!id) {
    return null;
  }
  const state = getState();
  return getGpsItems(state).find((point) => point.id === id) || null;
}

async function copyToClipboard(payload: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(payload);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = payload;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function handleApplyRawCoordinates(): void {
  if (!refs?.formFields?.rawCoordinates) {
    return;
  }
  const rawValue = refs.formFields.rawCoordinates.value;
  const parsed = parseCoordinatePair(rawValue);
  if (!parsed) {
    setMessage(
      "Koordinaten konnten nicht erkannt werden. Bitte Format 47.68952, 9.12091 verwenden.",
      "warning",
      6000
    );
    return;
  }
  const latValue = parsed.latitude.toFixed(6);
  const lngValue = parsed.longitude.toFixed(6);
  if (refs.formFields.latitude) {
    refs.formFields.latitude.value = latValue;
  }
  if (refs.formFields.longitude) {
    refs.formFields.longitude.value = lngValue;
  }
  setMessage("Koordinaten übernommen.", "success");
  updateVerifyButtonState();
}

function handleVerifyCoordinates(): void {
  if (!refs?.verifyButton) {
    return;
  }
  const targetUrl = refs.verifyButton.dataset.targetUrl;
  if (!targetUrl) {
    setMessage(
      "Bitte zuerst gültige Koordinaten eintragen, bevor die Prüfung geöffnet wird.",
      "warning",
      6000
    );
    return;
  }
  window.open(targetUrl, "_blank", "noopener,noreferrer");
}

async function refreshPoints(
  options: { notify?: boolean; reason?: "manual" | "auto" | "init" } = {}
): Promise<void> {
  const { notify = false } = options;
  if (!refs || evaluateAvailability(getState().app) !== "ok") {
    return;
  }
  const gpsState = getState().gps;
  if (gpsState.pending) {
    return;
  }
  try {
    await loadGpsPoints();
    if (notify) {
      setMessage("GPS-Punkte aktualisiert.", "success");
    }
    recordAction("GPS-Punkte synchronisiert.");
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "GPS-Punkte konnten nicht geladen werden.";
    setMessage(message, "danger", 7000);
    recordAction(`Fehler beim Laden: ${message}`);
  }
}

async function handleSetActive(id: string): Promise<void> {
  if (!id) {
    return;
  }
  const point = getPointById(id);
  if (!point) {
    setMessage("Ausgewählter GPS-Punkt wurde nicht gefunden.", "warning");
    return;
  }
  try {
    await setActiveGpsPoint(point.id);
    setMessage(`"${point.name}" ist nun aktiv.`, "success");
    recordAction(`Aktiver GPS-Punkt: ${point.name}`);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "GPS-Punkt konnte nicht aktiviert werden.";
    setMessage(message, "danger", 7000);
    recordAction(`Fehler beim Aktivieren: ${message}`);
  }
}

async function handleDeletePoint(id: string): Promise<void> {
  if (!id) {
    return;
  }
  const point = getPointById(id);
  if (!point) {
    setMessage("GPS-Punkt existiert nicht mehr.", "warning");
    return;
  }
  const confirmDelete = window.confirm(
    `"${point.name}" wirklich löschen? Dieser Schritt kann nicht rückgängig gemacht werden.`
  );
  if (!confirmDelete) {
    return;
  }
  try {
    await deleteGpsPoint(point.id);
    setMessage(`"${point.name}" wurde gelöscht.`, "success");
    recordAction(`GPS-Punkt gelöscht: ${point.name}`);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "GPS-Punkt konnte nicht gelöscht werden.";
    setMessage(message, "danger", 7000);
    recordAction(`Löschen fehlgeschlagen: ${message}`);
  }
}

async function handleCopyCoords(id: string): Promise<void> {
  if (!id) {
    return;
  }
  const point = getPointById(id);
  if (!point) {
    setMessage("GPS-Punkt nicht gefunden.", "warning");
    return;
  }
  const payload = `${point.latitude}, ${point.longitude}`;
  try {
    await copyToClipboard(payload);
    setMessage("Koordinaten in die Zwischenablage kopiert.", "success");
  } catch (error) {
    console.error("clipboard error", error);
    setMessage("Koordinaten konnten nicht kopiert werden.", "danger", 7000);
  }
}

async function activatePointFromHistoryRequest(
  id: string,
  services: Services
): Promise<void> {
  const trimmedId = (id || "").trim();
  if (!trimmedId) {
    emitHistoryActivationResult(services, {
      status: "error",
      id: "",
      message: "Ungültige GPS-Anfrage ohne ID.",
    });
    return;
  }
  const availability = evaluateAvailability(getState().app);
  if (availability !== "ok") {
    setMessage(
      "GPS-Modul ist ohne aktive SQLite-Datenbank nicht verfügbar.",
      "warning",
      6000
    );
    emitHistoryActivationResult(services, {
      status: "error",
      id: trimmedId,
      message: "GPS-Modul ist derzeit nicht verfügbar.",
    });
    return;
  }
  const point = getPointById(trimmedId);
  if (!point) {
    setMessage("Verknüpfter GPS-Punkt wurde nicht gefunden.", "warning", 6000);
    emitHistoryActivationResult(services, {
      status: "error",
      id: trimmedId,
      message: "Verknüpfter GPS-Punkt wurde nicht gefunden.",
    });
    return;
  }
  emitHistoryActivationResult(services, {
    status: "pending",
    id: point.id,
    name: point.name,
    message: `"${point.name || "Ohne Namen"}" wird aktiviert...`,
  });
  try {
    await setActiveGpsPoint(point.id);
    setMessage(
      `"${point.name || "Ohne Namen"}" wurde aus der Historie aktiviert.`,
      "success"
    );
    recordAction(`Aus Historie aktiviert: ${point.name || point.id}`);
    emitHistoryActivationResult(services, {
      status: "success",
      id: point.id,
      name: point.name,
      message: `"${point.name || "Ohne Namen"}" wurde aktiviert.`,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "GPS-Punkt konnte nicht aktiviert werden.";
    setMessage(message, "danger", 7000);
    recordAction(`Aktivierung aus Historie fehlgeschlagen: ${message}`);
    emitHistoryActivationResult(services, {
      status: "error",
      id: point.id,
      name: point.name,
      message,
    });
  }
}

async function handleSyncActive(): Promise<void> {
  try {
    await syncGpsStateFromStorage();
    recordAction("Aktiver GPS-Punkt synchronisiert.");
    setMessage("Aktiver GPS-Punkt wurde synchronisiert.", "success");
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Aktiver GPS-Punkt konnte nicht ermittelt werden.";
    setMessage(message, "danger", 7000);
    recordAction(`Sync fehlgeschlagen: ${message}`);
  }
}

function readFormValues(): {
  name: string;
  description: string;
  latitude: number;
  longitude: number;
  source: string;
  activate: boolean;
} {
  if (!refs?.formFields) {
    throw new Error("Formular nicht initialisiert");
  }
  const name = refs.formFields.name?.value.trim() || "";
  const description = refs.formFields.description?.value.trim() || "";
  const source = refs.formFields.source?.value.trim() || "";
  const latitude = Number(refs.formFields.latitude?.value);
  const longitude = Number(refs.formFields.longitude?.value);
  const activate = Boolean(refs.formFields.activate?.checked);
  if (!name) {
    throw new Error("Name darf nicht leer sein.");
  }
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error("Koordinaten sind ungültig.");
  }
  return { name, description, latitude, longitude, source, activate };
}

async function handleFormSubmit(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (saveSubmissionPending) {
    setMessage("Speichern läuft bereits ...", "info");
    return;
  }
  try {
    const values = readFormValues();
    if (hasDuplicateCoordinates(values.latitude, values.longitude)) {
      setMessage(
        "Ein GPS-Punkt mit identischen Koordinaten ist bereits vorhanden.",
        "warning",
        6000
      );
      return;
    }
    saveSubmissionPending = true;
    updateBusyUi(getState().gps, evaluateAvailability(getState().app));
    await saveGpsPoint(
      {
        name: values.name,
        description: values.description || null,
        latitude: values.latitude,
        longitude: values.longitude,
        source: values.source || null,
      },
      { activate: values.activate }
    );
    setMessage(`GPS-Punkt "${values.name}" gespeichert.`, "success");
    recordAction(
      `GPS-Punkt gespeichert${values.activate ? " und aktiv gesetzt" : ""}: ${values.name}`
    );
    refs?.form?.reset();
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "GPS-Punkt konnte nicht gespeichert werden.";
    setMessage(message, "danger", 7000);
    recordAction(`Speichern fehlgeschlagen: ${message}`);
  } finally {
    saveSubmissionPending = false;
    updateBusyUi(getState().gps, evaluateAvailability(getState().app));
  }
}

function fillCurrentPosition(): void {
  if (!refs?.formFields) {
    return;
  }
  if (!navigator.geolocation) {
    setMessage(
      "Geolocation wird von diesem Browser nicht unterstützt.",
      "warning",
      6000
    );
    return;
  }
  geolocationPending = true;
  updateBusyUi(getState().gps, evaluateAvailability(getState().app));
  navigator.geolocation.getCurrentPosition(
    (position) => {
      geolocationPending = false;
      const { latitude, longitude } = position.coords;
      if (refs?.formFields.latitude) {
        refs.formFields.latitude.value = latitude.toFixed(6);
      }
      if (refs?.formFields.longitude) {
        refs.formFields.longitude.value = longitude.toFixed(6);
      }
      if (refs?.formFields.source && !refs.formFields.source.value.trim()) {
        refs.formFields.source.value = "Browser";
      }
      setMessage("Koordinaten aus Browser-Position übernommen.", "success");
      recordAction("Browser-Geolocation übernommen");
      updateVerifyButtonState();
      updateBusyUi(getState().gps, evaluateAvailability(getState().app));
    },
    (error) => {
      geolocationPending = false;
      const message =
        error.code === error.PERMISSION_DENIED
          ? "Zugriff auf Standort wurde verweigert."
          : "Geolocation konnte nicht ermittelt werden.";
      setMessage(message, "warning", 7000);
      recordAction(`Geolocation fehlgeschlagen: ${message}`);
      updateBusyUi(getState().gps, evaluateAvailability(getState().app));
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    }
  );
}

function attachEventListeners(): void {
  if (!refs) {
    return;
  }
  refs.root.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }
    const tabButton = target.closest<HTMLButtonElement>(
      '[data-role="gps-tab"]'
    );
    if (tabButton && tabButton.dataset.tab) {
      setActiveTab(tabButton.dataset.tab as GpsTab);
      return;
    }
    const actionNode = target.closest<HTMLElement>("[data-action]");
    if (!actionNode || actionNode.dataset.action === "") {
      return;
    }
    const pointRow = actionNode.closest<HTMLElement>("[data-point-id]");
    const pointId = pointRow?.getAttribute("data-point-id") || "";
    switch (actionNode.dataset.action) {
      case "reload-points":
        void refreshPoints({ notify: true, reason: "manual" });
        break;
      case "sync-active":
        void handleSyncActive();
        break;
      case "set-active":
        void handleSetActive(pointId);
        break;
      case "delete-point":
        void handleDeletePoint(pointId);
        break;
      case "copy-coords":
        void handleCopyCoords(pointId);
        break;
      case "use-geolocation":
        fillCurrentPosition();
        break;
      case "apply-raw-coords":
        handleApplyRawCoordinates();
        break;
      case "verify-coords":
        handleVerifyCoordinates();
        break;
      case "copy-debug":
        if (refs?.debugState?.textContent) {
          void copyToClipboard(refs.debugState.textContent)
            .then(() => setMessage("Debug-Daten kopiert.", "success"))
            .catch(() =>
              setMessage(
                "Debug-Daten konnten nicht kopiert werden.",
                "danger",
                6000
              )
            );
        }
        break;
      default:
        break;
    }
  });

  refs.form?.addEventListener("submit", (event) => {
    void handleFormSubmit(event);
  });

  refs.form?.addEventListener("reset", () => {
    window.setTimeout(() => {
      updateVerifyButtonState();
    }, 0);
  });

  refs.formFields.latitude?.addEventListener("input", () => {
    updateVerifyButtonState();
  });
  refs.formFields.longitude?.addEventListener("input", () => {
    updateVerifyButtonState();
  });
}

export function initGps(container: Element | null, services: Services): void {
  if (!container || initialized) {
    return;
  }
  initialized = true;
  const host = container as HTMLElement;
  host.innerHTML = "";
  const section = createSection();
  host.appendChild(section);
  refs = collectRefs(section);
  gpsAutoRefreshCleanup?.();
  gpsAutoRefreshCleanup = registerAutoRefreshPolicy({
    section: "gps",
    event: "gps:data-changed",
    shouldHandleEvent: () =>
      evaluateAvailability(services.state.getState().app) === "ok",
    shouldRefresh: () =>
      evaluateAvailability(services.state.getState().app) === "ok",
    onRefresh: () => refreshPoints({ notify: false, reason: "auto" }),
    onStatusChange: (status) => updateGpsRefreshIndicator(status),
  });
  gpsPageIndex = 0;
  gpsPagerWidget?.destroy();
  gpsPagerWidget = null;
  gpsPagerTarget = null;
  attachEventListeners();
  setActiveTab(activeTab);

  if (typeof services.events?.subscribe === "function") {
    services.events.subscribe(
      "gps:set-active-from-history",
      (payload: unknown) => {
        let requestedId = "";
        if (payload && typeof payload === "object") {
          requestedId = String((payload as any).id || "").trim();
        }
        if (!requestedId) {
          setMessage(
            "Historische GPS-Anfrage ohne gültige ID erhalten.",
            "warning",
            6000
          );
          return;
        }
        void activatePointFromHistoryRequest(requestedId, services);
      }
    );
  }

  const initialState = services.state.getState();
  lastActiveId = initialState.gps.activePointId;

  const handleStateChange = (state: AppState, prevState: AppState): void => {
    const availability = evaluateAvailability(state.app);
    const gpsState = state.gps;
    updateAvailabilityUi(availability);
    updateListUi(state, availability);
    updateBusyUi(gpsState, availability);
    updateDebugPanel(gpsState);
    updateMapEntryPoints(state);

    if (availability === "ok" && !gpsState.initialized && !gpsState.pending) {
      void refreshPoints({ notify: false, reason: "auto" });
    }
    if (
      availability === "ok" &&
      lastAvailability !== "ok" &&
      gpsState.initialized
    ) {
      setMessage("GPS-Bereich ist wieder verfügbar.", "success");
    }
    lastAvailability = availability;

    if (state.gps.activePointId !== lastActiveId) {
      lastActiveId = state.gps.activePointId;
      if (typeof services.events?.emit === "function") {
        const activePoint = getPointById(lastActiveId);
        services.events.emit("gps:active-point-changed", {
          id: lastActiveId,
          point: activePoint,
        });
      }
    }

    if (
      state.gps.lastError &&
      state.gps.lastError !== prevState.gps.lastError
    ) {
      setMessage(state.gps.lastError, "danger", 7000);
      recordAction(`Fehler: ${state.gps.lastError}`);
    }
  };

  services.state.subscribe(handleStateChange);
  handleStateChange(initialState, initialState);
}
