/**
 * QS-GAP Dokumentationsfelder UI-Komponenten
 *
 * Zusätzliche Formularfelder gemäß QS-GAP-Leitfaden 3.6.2
 * für vollständige Pflanzenschutz-Dokumentation.
 *
 * WICHTIG: Diese Felder sind standardmäßig AUSGEBLENDET für eine
 * übersichtliche Benutzeroberfläche. Nur bei Bedarf per Checkbox aktivierbar.
 */

import { escapeHtml } from "@scripts/core/utils";
import {
  getQsLabels,
  type QsFieldValues,
  type QsFieldLabels,
  QS_CSS_CLASSES,
  isQsFieldsVisible,
  setQsFieldsVisible,
} from "@scripts/core/qsMode";

/**
 * Erzeugt das HTML für die QS-Zusatzfelder
 * Standardmäßig ausgeblendet - per Checkbox aktivierbar
 * Einheitliches Design wie die restlichen Formularfelder
 */
export function renderQsFieldsHtml(
  formDefaults: Partial<QsFieldValues> = {}
): string {
  const labels = getQsLabels();
  const isVisible = isQsFieldsVisible();

  return `
    <fieldset class="${QS_CSS_CLASSES.container} qs-fields-section calc-fieldset mt-4" style="border-top: 1px solid var(--border-1); padding-top: var(--sp-4);">
      <div class="d-flex align-items-center mb-3">
        <div class="form-check">
          <input 
            type="checkbox" 
            class="form-check-input" 
            id="qs-fields-toggle" 
            ${isVisible ? "checked" : ""}
          />
          <label class="form-check-label text-muted" style="font-size: 0.85rem;" for="qs-fields-toggle">
            QS-Zertifizierungsfelder anzeigen
          </label>
        </div>
      </div>
      <div class="qs-fields-content" style="display: ${isVisible ? "block" : "none"};">
        <small class="text-muted d-block mb-3">Zusätzliche Dokumentationsfelder gemäß QS-GAP-Leitfaden 3.6.2 (optional)</small>
        <div class="row g-3 mb-3">
          <div class="col-md-3 ${QS_CSS_CLASSES.field}">
            <label class="form-label calc-label" for="calc-qs-maschine">${escapeHtml(labels.maschine.label)}</label>
            <input type="text" class="form-control calc-input"
              id="calc-qs-maschine" name="calc-qs-maschine" 
              placeholder="${escapeHtml(labels.maschine.placeholder)}"
              title="${escapeHtml(labels.maschine.hint)}"
              value="${escapeHtml(formDefaults.maschine || "")}"
              list="calc-qs-maschine-list" />
            <datalist id="calc-qs-maschine-list">
              <option value="Anhängespritze">
              <option value="Anbauspritze">
              <option value="Selbstfahrspritze">
              <option value="Rückenspritze">
              <option value="Drohne">
              <option value="Nebelgerät">
              <option value="Granulatstreuer">
            </datalist>
          </div>
          <div class="col-md-3 ${QS_CSS_CLASSES.field}">
            <label class="form-label calc-label" for="calc-qs-schaderreger">${escapeHtml(labels.schaderreger.label)}</label>
            <input type="text" class="form-control calc-input"
              id="calc-qs-schaderreger" name="calc-qs-schaderreger" 
              placeholder="${escapeHtml(labels.schaderreger.placeholder)}"
              title="${escapeHtml(labels.schaderreger.hint)}"
              value="${escapeHtml(formDefaults.schaderreger || "")}" />
          </div>
          <div class="col-md-3 ${QS_CSS_CLASSES.field}">
            <label class="form-label calc-label" for="calc-qs-verantwortlicher">${escapeHtml(labels.verantwortlicher.label)}</label>
            <input type="text" class="form-control calc-input"
              id="calc-qs-verantwortlicher" name="calc-qs-verantwortlicher" 
              placeholder="${escapeHtml(labels.verantwortlicher.placeholder)}"
              title="${escapeHtml(labels.verantwortlicher.hint)}"
              value="${escapeHtml(formDefaults.verantwortlicher || "")}" />
          </div>
          <div class="col-md-3 ${QS_CSS_CLASSES.field}">
            <label class="form-label calc-label" for="calc-qs-wetter">${escapeHtml(labels.wetter.label)}</label>
            <input type="text" class="form-control calc-input"
              id="calc-qs-wetter" name="calc-qs-wetter" 
              placeholder="${escapeHtml(labels.wetter.placeholder)}"
              title="${escapeHtml(labels.wetter.hint)}"
              value="${escapeHtml(formDefaults.wetter || "")}"
              list="calc-qs-wetter-list" />
            <datalist id="calc-qs-wetter-list">
              ${(labels.wetter.options || []).map((opt) => `<option value="${escapeHtml(opt)}">`).join("")}
            </datalist>
          </div>
        </div>
        <div class="row g-3">
          <div class="col-md-3 ${QS_CSS_CLASSES.field}">
            <label class="form-label calc-label" for="calc-qs-behandlungsart">${escapeHtml(labels.behandlungsart.label)}</label>
            <input type="text" class="form-control calc-input"
              id="calc-qs-behandlungsart" name="calc-qs-behandlungsart" 
              placeholder="${escapeHtml(labels.behandlungsart.placeholder)}"
              title="${escapeHtml(labels.behandlungsart.hint)}"
              value="${escapeHtml(formDefaults.behandlungsart || "")}"
              list="calc-qs-behandlungsart-list" />
            <datalist id="calc-qs-behandlungsart-list">
              ${(labels.behandlungsart.options || []).map((opt) => `<option value="${escapeHtml(opt)}">`).join("")}
            </datalist>
          </div>
        </div>
      </div>
    </fieldset>
  `;
}

/**
 * Initialisiert die Toggle-Logik für QS-Felder
 * Muss nach dem Rendern aufgerufen werden
 */
export function initQsFieldsToggle(): void {
  const toggle = document.getElementById(
    "qs-fields-toggle"
  ) as HTMLInputElement | null;
  const content = document.querySelector(
    ".qs-fields-content"
  ) as HTMLElement | null;

  if (!toggle || !content) return;

  toggle.addEventListener("change", () => {
    const isVisible = toggle.checked;
    content.style.display = isVisible ? "block" : "none";
    setQsFieldsVisible(isVisible);

    // Wenn ausgeblendet, Felder leeren (optional - für saubere Daten)
    if (!isVisible) {
      clearQsFields();
    }
  });
}

/**
 * Leert alle QS-Felder
 */
function clearQsFields(): void {
  const fields = [
    "calc-qs-maschine",
    "calc-qs-schaderreger",
    "calc-qs-verantwortlicher",
    "calc-qs-wetter",
    "calc-qs-behandlungsart",
  ];

  fields.forEach((id) => {
    const field = document.getElementById(id) as
      | HTMLInputElement
      | HTMLSelectElement
      | null;
    if (field) {
      field.value = "";
    }
  });
}

function renderMaschineField(
  labels: QsFieldLabels["maschine"],
  value = ""
): string {
  return `
    <div class="col-md-3 ${QS_CSS_CLASSES.field}">
      <label class="form-label small text-muted mb-1">
        ${escapeHtml(labels.label)}
      </label>
      <input 
        type="text" 
        class="form-control" 
        id="calc-qs-maschine" 
        name="calc-qs-maschine" 
        placeholder="${escapeHtml(labels.placeholder)}"
        title="${escapeHtml(labels.hint)}"
        value="${escapeHtml(value)}"
        list="calc-qs-maschine-list"
      />
      <datalist id="calc-qs-maschine-list">
        <option value="Anhängespritze">
        <option value="Anbauspritze">
        <option value="Selbstfahrspritze">
        <option value="Rückenspritze">
        <option value="Drohne">
        <option value="Nebelgerät">
        <option value="Granulatstreuer">
      </datalist>
    </div>
  `;
}

function renderSchaderregerField(
  labels: QsFieldLabels["schaderreger"],
  value = ""
): string {
  return `
    <div class="col-md-3 ${QS_CSS_CLASSES.field}">
      <label class="form-label small text-muted mb-1">
        ${escapeHtml(labels.label)}
      </label>
      <input 
        type="text" 
        class="form-control" 
        id="calc-qs-schaderreger" 
        name="calc-qs-schaderreger" 
        placeholder="${escapeHtml(labels.placeholder)}"
        title="${escapeHtml(labels.hint)}"
        value="${escapeHtml(value)}"
      />
    </div>
  `;
}

function renderVerantwortlicherField(
  labels: QsFieldLabels["verantwortlicher"],
  value = ""
): string {
  return `
    <div class="col-md-3 ${QS_CSS_CLASSES.field}">
      <label class="form-label small text-muted mb-1">
        ${escapeHtml(labels.label)}
      </label>
      <input 
        type="text" 
        class="form-control" 
        id="calc-qs-verantwortlicher" 
        name="calc-qs-verantwortlicher" 
        placeholder="${escapeHtml(labels.placeholder)}"
        title="${escapeHtml(labels.hint)}"
        value="${escapeHtml(value)}"
      />
    </div>
  `;
}

function renderWetterField(
  labels: QsFieldLabels["wetter"],
  value = ""
): string {
  const options = labels.options || [];
  const optionsHtml = options
    .map((opt) => `<option value="${escapeHtml(opt)}">`)
    .join("");

  return `
    <div class="col-md-3 ${QS_CSS_CLASSES.field}">
      <label class="form-label small text-muted mb-1">
        ${escapeHtml(labels.label)}
      </label>
      <input 
        type="text" 
        class="form-control" 
        id="calc-qs-wetter" 
        name="calc-qs-wetter" 
        placeholder="${escapeHtml(labels.placeholder)}"
        title="${escapeHtml(labels.hint)}"
        value="${escapeHtml(value)}"
        list="calc-qs-wetter-list"
      />
      <datalist id="calc-qs-wetter-list">
        ${optionsHtml}
      </datalist>
    </div>
  `;
}

function renderBehandlungsartField(
  labels: QsFieldLabels["behandlungsart"],
  value = ""
): string {
  const options = labels.options || [];
  const optionsHtml = options
    .map((opt) => `<option value="${escapeHtml(opt)}">`)
    .join("");

  return `
    <div class="col-md-3 ${QS_CSS_CLASSES.field}">
      <label class="form-label small text-muted mb-1">
        ${escapeHtml(labels.label)}
      </label>
      <input 
        type="text" 
        class="form-control" 
        id="calc-qs-behandlungsart" 
        name="calc-qs-behandlungsart" 
        placeholder="${escapeHtml(labels.placeholder)}"
        title="${escapeHtml(labels.hint)}"
        value="${escapeHtml(value)}"
        list="calc-qs-behandlungsart-list"
      />
      <datalist id="calc-qs-behandlungsart-list">
        ${optionsHtml}
      </datalist>
    </div>
  `;
}

/**
 * Prüft ob die QS-Felder Checkbox aktiviert ist
 */
export function isQsFieldsToggleChecked(): boolean {
  const toggle = document.getElementById(
    "qs-fields-toggle"
  ) as HTMLInputElement | null;
  return toggle?.checked ?? false;
}

/**
 * Liest QS-Feldwerte aus einem Formular
 * Gibt nur Werte zurück wenn die Checkbox aktiviert ist
 */
export function extractQsFieldsFromForm(form: HTMLFormElement): QsFieldValues {
  // Nur Werte extrahieren wenn QS-Felder aktiviert sind
  if (!isQsFieldsToggleChecked()) {
    return {
      maschine: "",
      schaderreger: "",
      verantwortlicher: "",
      wetter: "",
      behandlungsart: "",
    };
  }

  const formData = new FormData(form);
  return {
    maschine: (formData.get("calc-qs-maschine") || "").toString().trim(),
    schaderreger: (formData.get("calc-qs-schaderreger") || "")
      .toString()
      .trim(),
    verantwortlicher: (formData.get("calc-qs-verantwortlicher") || "")
      .toString()
      .trim(),
    wetter: (formData.get("calc-qs-wetter") || "").toString().trim(),
    behandlungsart: (formData.get("calc-qs-behandlungsart") || "")
      .toString()
      .trim(),
  };
}

/**
 * Rendert QS-Felder für die Zusammenfassung/Anzeige
 */
export function renderQsSummaryHtml(fields: Partial<QsFieldValues>): string {
  const labels = getQsLabels();
  const rows: string[] = [];

  if (fields.maschine) {
    rows.push(renderSummaryRow(labels.maschine.label, fields.maschine));
  }
  if (fields.schaderreger) {
    rows.push(renderSummaryRow(labels.schaderreger.label, fields.schaderreger));
  }
  if (fields.verantwortlicher) {
    rows.push(
      renderSummaryRow(labels.verantwortlicher.label, fields.verantwortlicher)
    );
  }
  if (fields.wetter) {
    rows.push(renderSummaryRow(labels.wetter.label, fields.wetter));
  }
  if (fields.behandlungsart) {
    rows.push(
      renderSummaryRow(labels.behandlungsart.label, fields.behandlungsart)
    );
  }

  if (!rows.length) {
    return "";
  }

  return `
    <div class="calc-summary-column calc-summary-qs">
      <div class="calc-summary-row">
        <span class="badge bg-secondary mb-2">QS-Dokumentation</span>
      </div>
      ${rows.join("")}
    </div>
  `;
}

function renderSummaryRow(label: string, value: string): string {
  return `
    <div class="calc-summary-row">
      <span class="calc-summary-label">${escapeHtml(label)}</span>
      <span class="calc-summary-value">${escapeHtml(value)}</span>
    </div>
  `;
}

/**
 * Rendert QS-Felder für die Detail-Ansicht (Dokumentation)
 */
export function renderQsDetailHtml(fields: Partial<QsFieldValues>): string {
  if (!hasAnyQsField(fields)) {
    return "";
  }

  const labels = getQsLabels();
  const items: string[] = [];

  if (fields.maschine) {
    items.push(
      `<dt>${escapeHtml(labels.maschine.label)}</dt><dd>${escapeHtml(fields.maschine)}</dd>`
    );
  }
  if (fields.schaderreger) {
    items.push(
      `<dt>${escapeHtml(labels.schaderreger.label)}</dt><dd>${escapeHtml(fields.schaderreger)}</dd>`
    );
  }
  if (fields.verantwortlicher) {
    items.push(
      `<dt>${escapeHtml(labels.verantwortlicher.label)}</dt><dd>${escapeHtml(fields.verantwortlicher)}</dd>`
    );
  }
  if (fields.wetter) {
    items.push(
      `<dt>${escapeHtml(labels.wetter.label)}</dt><dd>${escapeHtml(fields.wetter)}</dd>`
    );
  }
  if (fields.behandlungsart) {
    items.push(
      `<dt>${escapeHtml(labels.behandlungsart.label)}</dt><dd>${escapeHtml(fields.behandlungsart)}</dd>`
    );
  }

  if (!items.length) {
    return "";
  }

  return `
    <div class="qs-detail-section mt-3 pt-3 border-top">
      <h6 class="d-flex align-items-center">
        QS-Dokumentation
      </h6>
      <dl class="row mb-0">
        ${items.join("")}
      </dl>
    </div>
  `;
}

/**
 * Prüft ob mindestens ein QS-Feld ausgefüllt ist
 */
export function hasAnyQsField(
  fields: Partial<QsFieldValues> | null | undefined
): boolean {
  if (!fields) return false;
  return !!(
    fields.maschine ||
    fields.schaderreger ||
    fields.verantwortlicher ||
    fields.wetter ||
    fields.behandlungsart
  );
}
