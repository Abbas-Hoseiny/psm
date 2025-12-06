/**
 * QS-GAP Dokumentationsfelder UI-Komponenten
 *
 * Zusätzliche Formularfelder gemäß QS-GAP-Leitfaden 3.6.2
 * für vollständige Pflanzenschutz-Dokumentation.
 * Diese Felder sind immer sichtbar und optional.
 */

import { escapeHtml } from "@scripts/core/utils";
import {
  getQsLabels,
  type QsFieldValues,
  type QsFieldLabels,
  QS_CSS_CLASSES,
} from "@scripts/core/qsMode";

/**
 * Erzeugt das HTML für die QS-Zusatzfelder
 * Diese Felder sind immer sichtbar und optional
 */
export function renderQsFieldsHtml(
  formDefaults: Partial<QsFieldValues> = {}
): string {
  const labels = getQsLabels();

  return `
    <div class="${QS_CSS_CLASSES.container} qs-fields-section mt-3 pt-3 border-top">
      <div class="d-flex align-items-center mb-3">
        <small class="text-muted">Zusätzliche Dokumentationsfelder gemäß QS-GAP-Leitfaden 3.6.2 (optional)</small>
      </div>
      <div class="row g-3">
        ${renderMaschineField(labels.maschine, formDefaults.maschine)}
        ${renderSchaderregerField(labels.schaderreger, formDefaults.schaderreger)}
        ${renderVerantwortlicherField(labels.verantwortlicher, formDefaults.verantwortlicher)}
        ${renderWetterField(labels.wetter, formDefaults.wetter)}
        ${renderBehandlungsartField(labels.behandlungsart, formDefaults.behandlungsart)}
      </div>
    </div>
  `;
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
 * Liest QS-Feldwerte aus einem Formular
 */
export function extractQsFieldsFromForm(form: HTMLFormElement): QsFieldValues {
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
