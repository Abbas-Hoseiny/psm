import { escapeHtml, debounce } from "@scripts/core/utils";
import { getState } from "@scripts/core/state";
import { setFieldLabelByPath } from "@scripts/core/labels";
import { getDatabaseSnapshot } from "@scripts/core/database";
import { saveDatabase, getActiveDriverKey } from "@scripts/core/storage";
import {
  buildMediumTableHead,
  buildMediumTableRows,
} from "../shared/mediumTable";
import {
  searchEppoSuggestions,
  searchBbchSuggestions,
} from "@scripts/core/lookups";

interface Services {
  state: {
    getState: typeof getState;
    updateSlice: typeof import("@scripts/core/state").updateSlice;
    subscribe: typeof import("@scripts/core/state").subscribeState;
  };
  events: {
    emit: typeof import("@scripts/core/eventBus").emit;
  };
}

type Labels = ReturnType<typeof getState>["fieldLabels"];

type DefaultsState = ReturnType<typeof getState>["defaults"];

export type CalculationItem = {
  id: string;
  name: string;
  unit: string;
  methodLabel: string;
  methodId: string;
  value: number;
  total: number;
  inputs: Record<string, number>;
  zulassungsnummer?: string | null;
};

export type CalculationResult = {
  header: Record<string, any>;
  items: CalculationItem[];
};

let initialized = false;

function escapeAttr(value: unknown): string {
  return escapeHtml(value);
}

function createSection(
  labels: Labels,
  defaultsState: DefaultsState
): HTMLElement {
  const formDefaults = defaultsState?.form || {
    creator: "",
    location: "",
    crop: "",
    quantity: "",
    eppoCode: "",
    bbch: "",
    gps: "",
    invekos: "",
    time: "",
  };
  const section = document.createElement("section");
  section.className = "section-inner";
  section.innerHTML = `
    <div class="card card-dark mb-4 no-print">
      <div class="card-body">
        <form id="calculationForm" class="row g-3 no-print">
          <div class="col-md-3">
            <input type="text" class="form-control form-control-sm label-editor mb-2" data-label-editor="calculation.fields.creator.label" data-default-label="${escapeAttr(labels.calculation.fields.creator.label)}" value="${escapeAttr(labels.calculation.fields.creator.label)}" placeholder="${escapeAttr(labels.calculation.fields.creator.label)}" aria-label="Bezeichnung für Feld" />
            <input type="text" class="form-control" id="calc-ersteller" name="calc-ersteller" required data-placeholder-id="calc-form-creator" placeholder="${escapeAttr(labels.calculation.fields.creator.placeholder)}" aria-label="${escapeAttr(labels.calculation.fields.creator.label)}" value="${escapeAttr(formDefaults.creator || "")}" />
          </div>
          <div class="col-md-3">
            <input type="text" class="form-control form-control-sm label-editor mb-2" data-label-editor="calculation.fields.location.label" data-default-label="${escapeAttr(labels.calculation.fields.location.label)}" value="${escapeAttr(labels.calculation.fields.location.label)}" placeholder="${escapeAttr(labels.calculation.fields.location.label)}" aria-label="Bezeichnung für Feld" />
            <input type="text" class="form-control" id="calc-standort" name="calc-standort" data-placeholder-id="calc-form-location" placeholder="${escapeAttr(labels.calculation.fields.location.placeholder)}" aria-label="${escapeAttr(labels.calculation.fields.location.label)}" value="${escapeAttr(formDefaults.location || "")}" />
          </div>
          <div class="col-md-3">
            <input type="text" class="form-control form-control-sm label-editor mb-2" data-label-editor="calculation.fields.crop.label" data-default-label="${escapeAttr(labels.calculation.fields.crop.label)}" value="${escapeAttr(labels.calculation.fields.crop.label)}" placeholder="${escapeAttr(labels.calculation.fields.crop.label)}" aria-label="Bezeichnung für Feld" />
            <input type="text" class="form-control" id="calc-kultur" name="calc-kultur" data-placeholder-id="calc-form-crop" placeholder="${escapeAttr(labels.calculation.fields.crop.placeholder)}" aria-label="${escapeAttr(labels.calculation.fields.crop.label)}" value="${escapeAttr(formDefaults.crop || "")}" />
          </div>
          <div class="col-md-3">
            <input type="text" class="form-control form-control-sm label-editor mb-2" data-label-editor="calculation.fields.quantity.label" data-default-label="${escapeAttr(labels.calculation.fields.quantity.label)}" value="${escapeAttr(labels.calculation.fields.quantity.label)}" placeholder="${escapeAttr(labels.calculation.fields.quantity.label)}" aria-label="Bezeichnung für Feld" />
            <input type="number" min="0" step="any" class="form-control" id="calc-kisten" name="calc-kisten" required data-placeholder-id="calc-form-quantity" placeholder="${escapeAttr(labels.calculation.fields.quantity.placeholder)}" aria-label="${escapeAttr(labels.calculation.fields.quantity.label)}" value="${escapeAttr(formDefaults.quantity || "")}" />
          </div>
          <div class="col-md-3">
            <input type="text" class="form-control form-control-sm label-editor mb-2" data-label-editor="calculation.fields.eppoCode.label" data-default-label="${escapeAttr(labels.calculation.fields.eppoCode.label)}" value="${escapeAttr(labels.calculation.fields.eppoCode.label)}" placeholder="${escapeAttr(labels.calculation.fields.eppoCode.label)}" aria-label="Bezeichnung für Feld" />
            <input type="text" class="form-control" id="calc-eppo" name="calc-eppo" list="calc-eppo-options" autocomplete="off" data-placeholder-id="calc-form-eppo" placeholder="${escapeAttr(labels.calculation.fields.eppoCode.placeholder)}" aria-label="${escapeAttr(labels.calculation.fields.eppoCode.label)}" value="${escapeAttr(formDefaults.eppoCode || "")}" />
            <datalist id="calc-eppo-options"></datalist>
          </div>
          <div class="col-md-3">
            <input type="text" class="form-control form-control-sm label-editor mb-2" data-label-editor="calculation.fields.bbch.label" data-default-label="${escapeAttr(labels.calculation.fields.bbch.label)}" value="${escapeAttr(labels.calculation.fields.bbch.label)}" placeholder="${escapeAttr(labels.calculation.fields.bbch.label)}" aria-label="Bezeichnung für Feld" />
            <input type="text" class="form-control" id="calc-bbch" name="calc-bbch" list="calc-bbch-options" autocomplete="off" data-placeholder-id="calc-form-bbch" placeholder="${escapeAttr(labels.calculation.fields.bbch.placeholder)}" aria-label="${escapeAttr(labels.calculation.fields.bbch.label)}" value="${escapeAttr(formDefaults.bbch || "")}" />
            <datalist id="calc-bbch-options"></datalist>
          </div>
          <div class="col-md-3">
            <input type="text" class="form-control form-control-sm label-editor mb-2" data-label-editor="calculation.fields.invekos.label" data-default-label="${escapeAttr(labels.calculation.fields.invekos.label)}" value="${escapeAttr(labels.calculation.fields.invekos.label)}" placeholder="${escapeAttr(labels.calculation.fields.invekos.label)}" aria-label="Bezeichnung für Feld" />
            <input type="text" class="form-control" id="calc-invekos" name="calc-invekos" data-placeholder-id="calc-form-invekos" placeholder="${escapeAttr(labels.calculation.fields.invekos.placeholder)}" aria-label="${escapeAttr(labels.calculation.fields.invekos.label)}" value="${escapeAttr(formDefaults.invekos || "")}" />
          </div>
          <div class="col-md-3">
            <input type="text" class="form-control form-control-sm label-editor mb-2" data-label-editor="calculation.fields.gps.label" data-default-label="${escapeAttr(labels.calculation.fields.gps.label)}" value="${escapeAttr(labels.calculation.fields.gps.label)}" placeholder="${escapeAttr(labels.calculation.fields.gps.label)}" aria-label="Bezeichnung für Feld" />
            <input type="text" class="form-control" id="calc-gps" name="calc-gps" data-placeholder-id="calc-form-gps" placeholder="${escapeAttr(labels.calculation.fields.gps.placeholder)}" aria-label="${escapeAttr(labels.calculation.fields.gps.label)}" value="${escapeAttr(formDefaults.gps || "")}" />
          </div>
          <div class="col-md-3">
            <input type="text" class="form-control form-control-sm label-editor mb-2" data-label-editor="calculation.fields.time.label" data-default-label="${escapeAttr(labels.calculation.fields.time.label)}" value="${escapeAttr(labels.calculation.fields.time.label)}" placeholder="${escapeAttr(labels.calculation.fields.time.label)}" aria-label="Bezeichnung für Feld" />
            <input type="time" class="form-control" id="calc-uhrzeit" name="calc-uhrzeit" data-placeholder-id="calc-form-time" placeholder="${escapeAttr(labels.calculation.fields.time.placeholder)}" aria-label="${escapeAttr(labels.calculation.fields.time.label)}" value="${escapeAttr(formDefaults.time || "")}" />
          </div>
          <div class="col-12 text-center">
            <button type="submit" class="btn btn-success px-4">Berechnen</button>
          </div>
        </form>
      </div>
    </div>
    <div id="calc-result" class="card card-dark d-none">
      <div class="card-body">
        <div class="calc-summary mb-3">
          <div class="calc-summary-columns">
            <div class="calc-summary-column calc-summary-main">
              <div class="calc-summary-row">
                <span class="calc-summary-label" data-label-id="calc-summary-creator">${escapeHtml(labels.calculation.fields.creator.label)}</span>
                <span class="calc-summary-value" data-field="ersteller"></span>
              </div>
              <div class="calc-summary-row">
                <span class="calc-summary-label" data-label-id="calc-summary-location">${escapeHtml(labels.calculation.fields.location.label)}</span>
                <span class="calc-summary-value" data-field="standort"></span>
              </div>
              <div class="calc-summary-row">
                <span class="calc-summary-label" data-label-id="calc-summary-crop">${escapeHtml(labels.calculation.fields.crop.label)}</span>
                <span class="calc-summary-value" data-field="kultur"></span>
              </div>
              <div class="calc-summary-row">
                <span class="calc-summary-label" data-label-id="calc-summary-date">${escapeHtml(labels.calculation.summary.dateLabel || "Datum")}</span>
                <span class="calc-summary-value" data-field="datum"></span>
              </div>
            </div>
            <div class="calc-summary-column calc-summary-meta">
              <div class="calc-summary-row">
                <span class="calc-summary-label" data-label-id="calc-summary-eppo">${escapeHtml(labels.calculation.fields.eppoCode.label)}</span>
                <span class="calc-summary-value" data-field="eppoCode"></span>
              </div>
              <div class="calc-summary-row">
                <span class="calc-summary-label" data-label-id="calc-summary-bbch">${escapeHtml(labels.calculation.fields.bbch.label)}</span>
                <span class="calc-summary-value" data-field="bbch"></span>
              </div>
              <div class="calc-summary-row">
                <span class="calc-summary-label" data-label-id="calc-summary-invekos">${escapeHtml(labels.calculation.fields.invekos.label)}</span>
                <span class="calc-summary-value" data-field="invekos"></span>
              </div>
              <div class="calc-summary-row">
                <span class="calc-summary-label" data-label-id="calc-summary-gps">${escapeHtml(labels.calculation.fields.gps.label)}</span>
                <span class="calc-summary-value" data-field="gps"></span>
              </div>
              <div class="calc-summary-row">
                <span class="calc-summary-label" data-label-id="calc-summary-time">${escapeHtml(labels.calculation.fields.time.label)}</span>
                <span class="calc-summary-value" data-field="uhrzeit"></span>
              </div>
            </div>
            <div class="calc-summary-column calc-summary-company">
              <div class="calc-summary-row d-none" data-company-row="headline">
                <span class="calc-summary-label">Claim</span>
                <span class="calc-summary-value" data-field="company-headline"></span>
              </div>
              <div class="calc-summary-row d-none" data-company-row="address">
                <span class="calc-summary-label">Anschrift</span>
                <span class="calc-summary-value calc-summary-value--multiline" data-field="company-address"></span>
              </div>
              <div class="calc-summary-row d-none" data-company-row="email">
                <span class="calc-summary-label">E-Mail</span>
                <a class="calc-summary-value" data-field="company-email"></a>
              </div>
            </div>
          </div>
        </div>
        <div class="calc-table-wrapper">
          <table class="table table-dark table-striped align-middle calc-medium-table" id="calc-results-table">
            <thead></thead>
            <tbody></tbody>
          </table>
        </div>
        <div class="mt-3 no-print">
          <button class="btn btn-outline-secondary" data-action="print">Drucken / PDF</button>
          <button class="btn btn-primary ms-2" data-action="save">Aktuelle Berechnung speichern</button>
        </div>
      </div>
    </div>
  `;
  return section;
}

type LookupOptionItem = {
  value: string;
  label: string;
  hint?: string;
};

interface LookupAutocompleteConfig<T> {
  minChars?: number;
  emptyLabel?: string;
  search: (term: string) => Promise<T[]>;
  format: (item: T, term: string) => LookupOptionItem | null;
}

function attachLookupAutocomplete<T>(
  input: HTMLInputElement,
  datalist: HTMLDataListElement,
  config: LookupAutocompleteConfig<T>
): void {
  let requestId = 0;
  const minChars = config.minChars ?? 1;

  const renderOptions = (options: LookupOptionItem[]): void => {
    if (!options.length) {
      datalist.innerHTML = "";
      return;
    }
    datalist.innerHTML = options
      .map((option) => {
        const value = escapeHtml(option.value);
        const label = escapeHtml(option.label);
        const hint = option.hint ? escapeHtml(option.hint) : "";
        return `<option value="${value}" label="${label}">${hint}</option>`;
      })
      .join("");
  };

  const renderEmptyHint = (text?: string): void => {
    datalist.innerHTML = text
      ? `<option value="" disabled>${escapeHtml(text)}</option>`
      : "";
  };

  const updateOptions = async () => {
    const term = input.value.trim();
    if (term.length < minChars) {
      datalist.innerHTML = "";
      return;
    }
    const currentId = ++requestId;
    renderEmptyHint("Lade Vorschläge ...");
    try {
      const results = await config.search(term);
      if (currentId !== requestId) {
        return;
      }
      const formatted = (results || [])
        .map((item) => config.format(item, term))
        .filter((item): item is LookupOptionItem => Boolean(item));
      if (!formatted.length) {
        renderEmptyHint(config.emptyLabel || "Keine Treffer");
        return;
      }
      renderOptions(formatted);
    } catch (error) {
      console.error("Lookup-Autocomplete fehlgeschlagen", error);
      if (currentId === requestId) {
        renderEmptyHint("Fehler bei der Suche");
      }
    }
  };

  const debouncedUpdate = debounce(() => {
    void updateOptions();
  }, 250);

  input.addEventListener("input", () => {
    debouncedUpdate();
  });
  input.addEventListener("focus", () => {
    void updateOptions();
  });
}

function setupLookupAutocompletes(section: HTMLElement): void {
  const eppoInput = section.querySelector<HTMLInputElement>("#calc-eppo");
  const eppoDatalist =
    section.querySelector<HTMLDataListElement>("#calc-eppo-options");
  if (eppoInput && eppoDatalist) {
    attachLookupAutocomplete(eppoInput, eppoDatalist, {
      minChars: 2,
      emptyLabel: "Keine EPPO-Treffer",
      search: (term) => searchEppoSuggestions(term, 15),
      format: (item) => {
        if (!item.code) {
          return null;
        }
        const summary = item.dtcode ? `DT-Code ${item.dtcode}` : item.name;
        return {
          value: item.code,
          label: `${item.code} · ${item.name}`.trim(),
          hint: summary,
        };
      },
    });
  }

  const bbchInput = section.querySelector<HTMLInputElement>("#calc-bbch");
  const bbchDatalist =
    section.querySelector<HTMLDataListElement>("#calc-bbch-options");
  if (bbchInput && bbchDatalist) {
    attachLookupAutocomplete(bbchInput, bbchDatalist, {
      minChars: 1,
      emptyLabel: "Keine BBCH-Treffer",
      search: (term) => searchBbchSuggestions(term, 15),
      format: (item) => {
        if (!item.code) {
          return null;
        }
        const stageParts: string[] = [];
        if (item.principalStage != null) {
          let stageLabel = `${item.principalStage}`;
          if (item.secondaryStage != null) {
            stageLabel += `.${item.secondaryStage}`;
          }
          stageParts.push(`Stadium ${stageLabel}`);
        }
        return {
          value: item.code,
          label: `${item.code} · ${item.label}`.trim(),
          hint: stageParts.join(" ") || item.label,
        };
      },
    });
  }
}

function applyFieldLabels(section: HTMLElement, labels: Labels): void {
  const labelMap: Record<string, string> = {
    "calc-form-creator": labels.calculation.fields.creator.label,
    "calc-form-location": labels.calculation.fields.location.label,
    "calc-form-crop": labels.calculation.fields.crop.label,
    "calc-form-quantity": labels.calculation.fields.quantity.label,
    "calc-form-eppo": labels.calculation.fields.eppoCode.label,
    "calc-form-bbch": labels.calculation.fields.bbch.label,
    "calc-form-invekos": labels.calculation.fields.invekos.label,
    "calc-form-gps": labels.calculation.fields.gps.label,
    "calc-form-time": labels.calculation.fields.time.label,
    "calc-summary-creator": labels.calculation.fields.creator.label,
    "calc-summary-location": labels.calculation.fields.location.label,
    "calc-summary-crop": labels.calculation.fields.crop.label,
    "calc-summary-date": labels.calculation.summary.dateLabel || "Datum",
    "calc-summary-eppo": labels.calculation.fields.eppoCode.label,
    "calc-summary-bbch": labels.calculation.fields.bbch.label,
    "calc-summary-invekos": labels.calculation.fields.invekos.label,
    "calc-summary-gps": labels.calculation.fields.gps.label,
    "calc-summary-time": labels.calculation.fields.time.label,
  };

  Object.entries(labelMap).forEach(([key, text]) => {
    const element = section.querySelector(`[data-label-id="${key}"]`);
    if (element) {
      element.textContent = typeof text === "string" ? text : "";
    }
  });

  section
    .querySelectorAll<HTMLInputElement>(".label-editor")
    .forEach((input) => {
      const path = input.dataset.labelEditor;
      if (!path) {
        return;
      }
      const value = path
        .split(".")
        .reduce<any>(
          (acc, segment) =>
            acc && acc[segment] !== undefined ? acc[segment] : null,
          labels
        );
      if (typeof value === "string") {
        input.placeholder = value;
        input.dataset.defaultLabel = value;
        if (!input.matches(":focus")) {
          input.value = value;
        }
      }
    });

  const placeholderMap: Record<string, string> = {
    "calc-form-creator": labels.calculation.fields.creator.placeholder,
    "calc-form-location": labels.calculation.fields.location.placeholder,
    "calc-form-crop": labels.calculation.fields.crop.placeholder,
    "calc-form-quantity": labels.calculation.fields.quantity.placeholder,
    "calc-form-eppo": labels.calculation.fields.eppoCode.placeholder,
    "calc-form-bbch": labels.calculation.fields.bbch.placeholder,
    "calc-form-invekos": labels.calculation.fields.invekos.placeholder,
    "calc-form-gps": labels.calculation.fields.gps.placeholder,
    "calc-form-time": labels.calculation.fields.time.placeholder,
  };

  Object.entries(placeholderMap).forEach(([key, text]) => {
    const element = section.querySelector<HTMLInputElement>(
      `[data-placeholder-id="${key}"]`
    );
    if (element) {
      element.setAttribute("placeholder", typeof text === "string" ? text : "");
    }
  });

  const tableHead = section.querySelector("#calc-results-table thead");
  if (tableHead) {
    tableHead.innerHTML = buildMediumTableHead(labels, "calculation");
  }
}

async function persistHistory(services: Services): Promise<void> {
  const driverKey = getActiveDriverKey();
  if (!driverKey || driverKey === "memory") {
    return;
  }
  try {
    const snapshot = getDatabaseSnapshot();
    await saveDatabase(snapshot);
    services.events.emit("database:saved", {
      scope: "history",
      driver: driverKey,
    });
  } catch (err) {
    console.error("Automatisches Speichern der Historie fehlgeschlagen", err);
    services.events.emit("database:error", { scope: "history", error: err });
    window.alert(
      "Berechnung gespeichert, aber die Datei konnte nicht aktualisiert werden. Bitte manuell sichern."
    );
  }
}

function getWaterVolume(kisten: number, defaults: DefaultsState): number {
  const arValue = kisten / (defaults.kistenProAr || 1);
  return arValue * (defaults.waterPerKisteL || 0);
}

function executeFormula(
  medium: any,
  method: any,
  inputs: Record<string, number>
): number {
  if (!method) {
    return 0;
  }
  const value = Number(medium.value) || 0;
  switch (method.type) {
    case "factor": {
      const base = inputs[method.config?.sourceField || "kisten"] || 0;
      return value * base;
    }
    case "percentOf": {
      const base = inputs[method.config?.baseField || "waterVolume"] || 0;
      return (base * value) / 100;
    }
    case "fixed":
      return value;
    default:
      console.warn("Unbekannter Methodentyp", method.type);
      return value;
  }
}

function renderResults(
  section: HTMLElement,
  calculation: CalculationResult | null,
  labels: Labels
): void {
  const resultCard = section.querySelector<HTMLDivElement>("#calc-result");
  if (!resultCard) {
    return;
  }
  const resultsTable = resultCard.querySelector<HTMLTableElement>(
    "#calc-results-table"
  );
  const resultsHead = resultsTable?.querySelector("thead");
  const resultsBody = resultsTable?.querySelector("tbody");
  const stateSnapshot = getState();
  const companyData = stateSnapshot.company || {};

  if (!calculation) {
    resultCard.classList.add("d-none");
    if (resultsBody) {
      resultsBody.innerHTML = "";
    }
    return;
  }

  const { header, items } = calculation;

  const setFieldText = (key: string, value: string): void => {
    const el = resultCard.querySelector<HTMLElement>(`[data-field="${key}"]`);
    if (el) {
      el.textContent = value ?? "";
    }
  };

  setFieldText("ersteller", header.ersteller);
  setFieldText("standort", header.standort);
  setFieldText("kultur", header.kultur);
  setFieldText("datum", header.datum);
  setFieldText("eppoCode", header.eppoCode || "");
  setFieldText("bbch", header.bbch || "");
  setFieldText("gps", header.gps || "");
  setFieldText("invekos", header.invekos || "");
  setFieldText("uhrzeit", header.uhrzeit || "");

  const updateCompanyRowVisibility = (rowKey: string, visible: boolean) => {
    const row = resultCard.querySelector<HTMLElement>(
      `[data-company-row="${rowKey}"]`
    );
    if (row) {
      row.classList.toggle("d-none", !visible);
    }
  };

  const headlineValue = companyData.headline?.trim() || "";
  setFieldText("company-headline", headlineValue);
  updateCompanyRowVisibility("headline", Boolean(headlineValue));

  const addressValue = companyData.address?.trim() || "";
  const addressEl = resultCard.querySelector<HTMLElement>(
    '[data-field="company-address"]'
  );
  if (addressEl) {
    addressEl.textContent = addressValue;
  }
  updateCompanyRowVisibility("address", Boolean(addressValue));

  const emailEl = resultCard.querySelector<HTMLAnchorElement>(
    '[data-field="company-email"]'
  );
  const emailValue = companyData.contactEmail?.trim() || "";
  if (emailEl) {
    if (emailValue) {
      emailEl.textContent = emailValue;
      emailEl.setAttribute("href", `mailto:${emailValue}`);
    } else {
      emailEl.textContent = "";
      emailEl.removeAttribute("href");
    }
  }
  updateCompanyRowVisibility("email", Boolean(emailValue));

  const companyColumn = resultCard.querySelector<HTMLElement>(
    ".calc-summary-company"
  );
  if (companyColumn) {
    const hasVisibleRow = Array.from(
      companyColumn.querySelectorAll<HTMLElement>("[data-company-row]")
    ).some((row) => !row.classList.contains("d-none"));
    companyColumn.classList.toggle("d-none", !hasVisibleRow);
  }

  if (resultsHead) {
    resultsHead.innerHTML = buildMediumTableHead(labels, "calculation");
  }
  if (resultsBody) {
    resultsBody.innerHTML = buildMediumTableRows(items, "calculation");
  }

  resultCard.classList.remove("d-none");
}

export function initCalculation(
  container: Element | null,
  services: Services
): void {
  if (!container || initialized) {
    return;
  }

  const host = container as HTMLElement;
  const initialState = services.state.getState();

  host.innerHTML = "";
  const section = createSection(
    initialState.fieldLabels,
    initialState.defaults
  );
  host.appendChild(section);

  applyFieldLabels(section, initialState.fieldLabels);
  setupLookupAutocompletes(section);

  const form = section.querySelector<HTMLFormElement>("#calculationForm");
  const resultCard = section.querySelector<HTMLDivElement>("#calc-result");
  const resultsTable = section.querySelector<HTMLTableElement>(
    "#calc-results-table"
  );
  const resultsHead = resultsTable?.querySelector("thead");
  const resultsBody = resultsTable?.querySelector("tbody");

  if (!form || !resultCard || !resultsTable || !resultsHead || !resultsBody) {
    console.warn("Berechnungsbereich konnte nicht initialisiert werden");
    return;
  }

  const setCalcContext = (calculation: CalculationResult | null) => {
    renderResults(section, calculation, services.state.getState().fieldLabels);
  };

  services.state.subscribe((nextState) => {
    applyFieldLabels(section, nextState.fieldLabels);
    setCalcContext(nextState.calcContext as CalculationResult | null);
  });

  section
    .querySelectorAll<HTMLInputElement>(".label-editor")
    .forEach((input) => {
      input.addEventListener("change", (event) => {
        const target = event.currentTarget as HTMLInputElement;
        const path = target.dataset.labelEditor;
        if (!path) {
          return;
        }
        const trimmed = target.value.trim();
        const fallback =
          target.dataset.defaultLabel ||
          target.getAttribute("placeholder") ||
          target.value;
        const nextValue = trimmed || fallback || "";
        if (!trimmed) {
          target.value = nextValue;
        }
        services.state.updateSlice("fieldLabels", (currentLabels) =>
          setFieldLabelByPath(currentLabels, path, nextValue)
        );
      });
    });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const rawErsteller = (formData.get("calc-ersteller") || "")
      .toString()
      .trim();
    const rawStandort = (formData.get("calc-standort") || "").toString().trim();
    const rawKultur = (formData.get("calc-kultur") || "").toString().trim();
    const rawKisten = (formData.get("calc-kisten") || "").toString().trim();
    const rawEppo = (formData.get("calc-eppo") || "").toString().trim();
    const rawBbch = (formData.get("calc-bbch") || "").toString().trim();
    const rawInvekos = (formData.get("calc-invekos") || "").toString().trim();
    const rawGps = (formData.get("calc-gps") || "").toString().trim();
    const rawTime = (formData.get("calc-uhrzeit") || "").toString().trim();
    const ersteller = rawErsteller;
    const standort = rawStandort || "-";
    const kultur = rawKultur || "-";
    const eppoCode = rawEppo;
    const bbch = rawBbch;
    const invekos = rawInvekos;
    const gps = rawGps;
    const uhrzeit = rawTime
      ? rawTime
      : new Date().toLocaleTimeString("de-DE", {
          hour: "2-digit",
          minute: "2-digit",
        });
    const kisten = Number(rawKisten);
    if (!ersteller || Number.isNaN(kisten)) {
      window.alert("Bitte Felder korrekt ausfüllen!");
      return;
    }

    const state = services.state.getState();
    const defaults = state.defaults;
    const measurementMethods = state.measurementMethods;
    const waterVolume = getWaterVolume(kisten, defaults);
    const areaAr = defaults.kistenProAr ? kisten / defaults.kistenProAr : 0;
    const areaSqm = areaAr * 100;

    const inputs = {
      kisten,
      waterVolume,
      areaAr,
      areaSqm,
    };

    const items = state.mediums.map((medium: any) => {
      const method = measurementMethods.find(
        (m: any) => m.id === medium.methodId
      );
      const total = executeFormula(medium, method, inputs);
      return {
        id: medium.id,
        name: medium.name,
        unit: medium.unit,
        methodLabel: method ? method.label : medium.methodId,
        methodId: medium.methodId,
        value: medium.value,
        total,
        inputs,
        zulassungsnummer: medium.zulassungsnummer ?? null,
      };
    });

    const header = {
      ersteller,
      standort,
      kultur,
      eppoCode,
      bbch,
      gps,
      invekos,
      uhrzeit,
      kisten,
      datum: new Date().toLocaleDateString("de-DE", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }),
      waterVolume,
      areaAr,
      areaSqm,
    };

    const calculation: CalculationResult = {
      header,
      items,
    };

    services.state.updateSlice("defaults", (defaultsState) => ({
      ...defaultsState,
      form: {
        ...(defaultsState.form || {
          creator: "",
          location: "",
          crop: "",
          quantity: "",
          eppoCode: "",
          bbch: "",
          gps: "",
          invekos: "",
          time: "",
        }),
        creator: rawErsteller,
        location: rawStandort,
        crop: rawKultur,
        quantity: rawKisten,
        eppoCode: rawEppo,
        bbch: rawBbch,
        gps: rawGps,
        invekos: rawInvekos,
        time: rawTime,
      },
    }));

    services.state.updateSlice("calcContext", () => calculation);
  });

  resultCard.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const action = target?.dataset?.action;
    if (!action) {
      return;
    }
    if (action === "print") {
      window.print();
    } else if (action === "save") {
      const calc = services.state.getState()
        .calcContext as CalculationResult | null;
      if (!calc) {
        window.alert("Keine Berechnung vorhanden.");
        return;
      }
      services.state.updateSlice("history", (history) => {
        const entry = {
          ...calc.header,
          items: calc.items,
          savedAt: new Date().toISOString(),
        };
        return [...history, entry];
      });
      void persistHistory(services).catch((err) => {
        console.error("Persist history promise error", err);
      });
      window.alert("Berechnung gespeichert! (Siehe Historie)");
    }
  });

  setCalcContext(initialState.calcContext as CalculationResult | null);

  initialized = true;
}
