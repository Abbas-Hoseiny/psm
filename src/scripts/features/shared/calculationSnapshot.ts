import {
  escapeHtml,
  formatGpsCoordinates,
  buildGoogleMapsUrl,
  formatDateFromIso,
  formatNumber,
} from "@scripts/core/utils";
import { buildMediumTableHTML } from "./mediumTable";

interface SnapshotOptions {
  showActions?: boolean;
  includeCheckbox?: boolean;
  index?: number;
  selected?: boolean;
  enableGpsActions?: boolean;
}

export interface CalculationSnapshotEntry {
  datum?: string;
  date?: string;
  dateIso?: string | null;
  ersteller?: string;
  standort?: string;
  kultur?: string;
  usageType?: string;
  areaHa?: number;
  areaAr?: number;
  areaSqm?: number;
  waterVolume?: number;
  kisten?: number;
  eppoCode?: string;
  bbch?: string;
  gps?: string;
  gpsCoordinates?: { latitude?: number; longitude?: number } | null;
  gpsPointId?: string | null;
  invekos?: string;
  uhrzeit?: string;
  items?: any[];
  // QS-GAP Dokumentationsfelder
  qsMaschine?: string | null;
  qsSchaderreger?: string | null;
  qsVerantwortlicher?: string | null;
  qsWetter?: string | null;
  qsBehandlungsart?: string | null;
  [key: string]: unknown;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function resolveEntryAreaHa(
  entry: CalculationSnapshotEntry | null
): number | null {
  if (!entry) {
    return null;
  }
  const direct = toNumber(entry.areaHa);
  if (direct !== null) {
    return direct;
  }
  const areaAr = toNumber(entry.areaAr);
  if (areaAr !== null) {
    return areaAr / 100;
  }
  const areaSqm = toNumber(entry.areaSqm);
  if (areaSqm !== null) {
    return areaSqm / 10000;
  }
  return null;
}

function formatAreaHa(entry: CalculationSnapshotEntry | null): string {
  const areaValue = resolveEntryAreaHa(entry);
  if (areaValue === null) {
    return "–";
  }
  return formatNumber(areaValue, 2, "0.00");
}

function resolveSnapshotDate(
  entry: CalculationSnapshotEntry | null | undefined
): string {
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

export interface CalculationSnapshotLabels {
  history?: {
    tableColumns?: Record<string, string>;
    detail?: Record<string, string>;
  };
}

/**
 * Resolve GPS coordinates for display.
 * Priority: gpsCoordinates object > gps string (fallback for manual input)
 */
function resolveSnapshotGps(entry: CalculationSnapshotEntry): string {
  // Zuerst: gpsCoordinates Objekt (von verknüpftem GPS-Punkt)
  if (entry?.gpsCoordinates) {
    const formatted = formatGpsCoordinates(entry.gpsCoordinates);
    if (formatted) {
      return formatted;
    }
  }
  // Fallback: gps String (manuelle Eingabe)
  // Wird als Koordinaten verwendet wenn kein GPS-Punkt verknüpft ist
  if (entry?.gps) {
    return entry.gps.trim();
  }
  return "";
}

/**
 * Resolve GPS note (only used when different from coordinates)
 */
function resolveSnapshotGpsNote(entry: CalculationSnapshotEntry): string {
  return entry?.gps || "";
}

/**
 * Check if GPS coordinates come from gpsCoordinates object (not manual gps string)
 */
function hasStructuredGpsCoordinates(entry: CalculationSnapshotEntry): boolean {
  if (!entry?.gpsCoordinates) return false;
  const formatted = formatGpsCoordinates(entry.gpsCoordinates);
  return Boolean(formatted);
}

/**
 * Determine if GPS note should be displayed separately.
 * Only show note if:
 * 1. There are structured gpsCoordinates AND
 * 2. The gps note string is different from the formatted coordinates
 */
function shouldDisplayGpsNote(entry: CalculationSnapshotEntry): boolean {
  // Nur wenn strukturierte Koordinaten existieren UND eine Notiz existiert
  if (!hasStructuredGpsCoordinates(entry)) {
    return false; // Keine Notiz zeigen - gps wird bereits als Koordinaten verwendet
  }
  const noteValue = (entry?.gps || "").trim();
  if (!noteValue) {
    return false;
  }
  const coordsValue = formatGpsCoordinates(entry.gpsCoordinates) || "";
  // Notiz nur zeigen wenn anders als Koordinaten
  return noteValue !== coordsValue;
}

export function renderCalculationSnapshot(
  entry: CalculationSnapshotEntry,
  labels: CalculationSnapshotLabels,
  options: SnapshotOptions = {}
): string {
  const {
    showActions = false,
    includeCheckbox = false,
    index,
    selected = false,
    enableGpsActions = false,
  } = options;

  const tableLabels = labels?.history?.tableColumns ?? {};
  const detailLabels = labels?.history?.detail ?? {};
  const usageLabel =
    detailLabels.usageType || tableLabels.usageType || "Art der Verwendung";
  const gpsNoteValue = resolveSnapshotGpsNote(entry);
  const gpsCoordinateValue = resolveSnapshotGps(entry);
  const showGpsNote = shouldDisplayGpsNote(entry);
  const gpsNoteHtml = showGpsNote ? escapeHtml(gpsNoteValue) : "–";
  const gpsMapUrl = entry?.gpsCoordinates
    ? buildGoogleMapsUrl(entry.gpsCoordinates)
    : null;
  const gpsCoordinatesHtml = gpsCoordinateValue
    ? gpsMapUrl
      ? `${escapeHtml(
          gpsCoordinateValue
        )} <a class="btn btn-link btn-sm p-0 ms-1 align-baseline" href="${escapeHtml(
          gpsMapUrl
        )}" target="_blank" rel="noopener noreferrer">Google Maps</a>`
      : escapeHtml(gpsCoordinateValue)
    : "–";
  const gpsNoteLabel =
    detailLabels.gpsNote ||
    tableLabels.gpsNote ||
    detailLabels.gps ||
    tableLabels.gps ||
    "GPS-Notiz";
  const gpsCoordinatesLabel =
    detailLabels.gpsCoordinates ||
    tableLabels.gpsCoordinates ||
    "GPS-Koordinaten";

  const selectedClass = selected ? " calc-snapshot-card--selected" : "";
  const dataIndex = typeof index === "number" ? ` data-index="${index}"` : "";

  const checkboxHtml =
    includeCheckbox && typeof index === "number"
      ? `<div class="calc-snapshot-card__checkbox no-print">
           <input type="checkbox"
                  class="form-check-input"
                  data-action="toggle-select"
                  data-index="${index}"
                  ${selected ? "checked" : ""}
                  aria-label="Eintrag auswählen" />
         </div>`
      : "";

  const actionsHtml = (() => {
    if (!showActions || typeof index !== "number") {
      return "";
    }
    const buttons: string[] = [
      `<button class="btn btn-sm btn-info"
               data-action="view"
               data-index="${index}">
         Ansehen
       </button>`,
      `<button class="btn btn-sm btn-danger"
               data-action="delete"
               data-index="${index}">
         Löschen
       </button>`,
    ];
    if (enableGpsActions && entry?.gpsPointId) {
      buttons.push(`
        <button class="btn btn-sm btn-outline-success"
                data-action="activate-gps"
                data-index="${index}">
          GPS aktivieren
        </button>
      `);
    }
    return `
      <div class="calc-snapshot-card__actions no-print">
        ${buttons.join("\n")}
      </div>
    `;
  })();

  const mediumTable = buildMediumTableHTML(
    entry.items || [],
    labels,
    "summary",
    {
      classes: "calc-snapshot-table",
    }
  );

  return `
    <div class="calc-snapshot-card${selectedClass}"${dataIndex}>
      ${checkboxHtml}
      <div class="calc-snapshot-card__header">
        <div class="calc-snapshot-card__meta">
          <div class="calc-snapshot-card__date">
            <strong>${escapeHtml(tableLabels.date || "Datum")}:</strong>
            ${escapeHtml(resolveSnapshotDate(entry) || "–")}
          </div>
          <div class="calc-snapshot-card__creator">
            <strong>${escapeHtml(
              detailLabels.creator || tableLabels.creator || "Erstellt von"
            )}:</strong>
            ${escapeHtml(entry?.ersteller || "–")}
          </div>
        </div>
      </div>
      <div class="calc-snapshot-card__body">
        <div class="calc-snapshot-card__info">
          <div class="calc-snapshot-card__info-item">
            <strong>${escapeHtml(
              detailLabels.location || tableLabels.location || "Standort"
            )}:</strong>
            ${escapeHtml(entry?.standort || "–")}
          </div>
          <div class="calc-snapshot-card__info-item">
            <strong>${escapeHtml(
              detailLabels.crop || tableLabels.crop || "Kultur"
            )}:</strong>
            ${escapeHtml(entry?.kultur || "–")}
          </div>
          <div class="calc-snapshot-card__info-item">
            <strong>${escapeHtml(usageLabel)}:</strong>
            ${escapeHtml(entry?.usageType || "–")}
          </div>
          <div class="calc-snapshot-card__info-item">
            <strong>${escapeHtml(
              detailLabels.eppoCode || tableLabels.eppoCode || "EPPO"
            )}:</strong>
            ${escapeHtml(entry?.eppoCode || "–")}
          </div>
          <div class="calc-snapshot-card__info-item">
            <strong>${escapeHtml(
              detailLabels.bbch || tableLabels.bbch || "BBCH"
            )}:</strong>
            ${escapeHtml(entry?.bbch || "–")}
          </div>
          <div class="calc-snapshot-card__info-item">
            <strong>${escapeHtml(
              detailLabels.invekos || tableLabels.invekos || "InVeKoS"
            )}:</strong>
            ${escapeHtml(entry?.invekos || "–")}
          </div>
          ${
            showGpsNote
              ? `<div class="calc-snapshot-card__info-item">
            <strong>${escapeHtml(gpsNoteLabel)}:</strong>
            ${gpsNoteHtml}
          </div>`
              : ""
          }
          <div class="calc-snapshot-card__info-item">
            <strong>${escapeHtml(gpsCoordinatesLabel)}:</strong>
            ${gpsCoordinatesHtml}
          </div>
          <div class="calc-snapshot-card__info-item">
            <strong>${escapeHtml(
              detailLabels.quantity || tableLabels.quantity || "Fläche"
            )}:</strong>
            ${escapeHtml(formatAreaHa(entry))}
          </div>
          <div class="calc-snapshot-card__info-item">
            <strong>${escapeHtml(
              detailLabels.time || tableLabels.time || "Uhrzeit"
            )}:</strong>
            ${escapeHtml(entry?.uhrzeit || "–")}
          </div>
          ${
            entry?.qsMaschine
              ? `<div class="calc-snapshot-card__info-item">
            <strong>Maschine / Gerät:</strong>
            ${escapeHtml(entry.qsMaschine)}
          </div>`
              : ""
          }
          ${
            entry?.qsSchaderreger
              ? `<div class="calc-snapshot-card__info-item">
            <strong>Schaderreger / Grund:</strong>
            ${escapeHtml(entry.qsSchaderreger)}
          </div>`
              : ""
          }
          ${
            entry?.qsVerantwortlicher
              ? `<div class="calc-snapshot-card__info-item">
            <strong>Verantwortliche Person:</strong>
            ${escapeHtml(entry.qsVerantwortlicher)}
          </div>`
              : ""
          }
          ${
            entry?.qsWetter
              ? `<div class="calc-snapshot-card__info-item">
            <strong>Wetterbedingungen:</strong>
            ${escapeHtml(entry.qsWetter)}
          </div>`
              : ""
          }
          ${
            entry?.qsBehandlungsart
              ? `<div class="calc-snapshot-card__info-item">
            <strong>Behandlungsart:</strong>
            ${escapeHtml(entry.qsBehandlungsart)}
          </div>`
              : ""
          }
        </div>
        <div class="calc-snapshot-card__mediums">
          ${mediumTable}
        </div>
      </div>
      ${actionsHtml}
    </div>
  `;
}

export function renderCalculationSnapshotForPrint(
  entry: CalculationSnapshotEntry,
  labels: CalculationSnapshotLabels
): string {
  const detailLabels = labels?.history?.detail ?? {};

  const mediumTable = buildMediumTableHTML(
    entry.items || [],
    labels,
    "detail",
    {
      classes: "history-detail-table",
    }
  );
  const gpsNoteValue = resolveSnapshotGpsNote(entry);
  const gpsCoordinateValue = resolveSnapshotGps(entry);
  const showGpsNote = shouldDisplayGpsNote(entry);
  const gpsMapUrl = entry?.gpsCoordinates
    ? buildGoogleMapsUrl(entry.gpsCoordinates)
    : null;
  const gpsNoteLabel = detailLabels.gpsNote || detailLabels.gps || "GPS-Notiz";
  const gpsCoordinatesLabel = detailLabels.gpsCoordinates || "GPS-Koordinaten";
  const gpsCoordinateHtml = gpsCoordinateValue
    ? gpsMapUrl
      ? `<a href="${escapeHtml(
          gpsMapUrl
        )}" target="_blank" rel="noopener noreferrer">${escapeHtml(
          gpsCoordinateValue
        )}</a>`
      : escapeHtml(gpsCoordinateValue)
    : "–";

  const metaItems: Array<{
    label: string;
    value: string | null;
    isHtml?: boolean;
  }> = [
    {
      label: detailLabels.creator || "Erstellt von",
      value: entry?.ersteller || null,
    },
    {
      label: detailLabels.location || "Standort",
      value: entry?.standort || null,
    },
    {
      label: detailLabels.crop || "Kultur",
      value: entry?.kultur || null,
    },
    {
      label: detailLabels.eppoCode || "EPPO-Code",
      value: entry?.eppoCode || null,
    },
    {
      label: detailLabels.bbch || "BBCH",
      value: entry?.bbch || null,
    },
    {
      label: detailLabels.invekos || "InVeKoS",
      value: entry?.invekos || null,
    },
    ...(showGpsNote
      ? [
          {
            label: gpsNoteLabel,
            value: gpsNoteValue || null,
          },
        ]
      : []),
    {
      label: gpsCoordinatesLabel,
      value: gpsCoordinateHtml,
      isHtml: true,
    },
    {
      label: detailLabels.quantity || "Fläche (ha)",
      value: formatAreaHa(entry),
    },
    {
      label: detailLabels.time || "Uhrzeit",
      value: entry?.uhrzeit || null,
    },
    // QS-GAP Dokumentationsfelder (nur anzeigen wenn ausgefüllt)
    ...(entry?.qsMaschine
      ? [{ label: "Maschine / Gerät", value: entry.qsMaschine }]
      : []),
    ...(entry?.qsSchaderreger
      ? [{ label: "Schaderreger / Grund", value: entry.qsSchaderreger }]
      : []),
    ...(entry?.qsVerantwortlicher
      ? [{ label: "Verantwortliche Person", value: entry.qsVerantwortlicher }]
      : []),
    ...(entry?.qsWetter
      ? [{ label: "Wetterbedingungen", value: entry.qsWetter }]
      : []),
    ...(entry?.qsBehandlungsart
      ? [{ label: "Behandlungsart", value: entry.qsBehandlungsart }]
      : []),
  ];

  const metaBlockHtml = metaItems
    .map(({ label, value, isHtml }) => {
      const normalizedValue = (() => {
        if (value === null || value === undefined) {
          return "";
        }
        if (typeof value === "string") {
          return value.trim();
        }
        return String(value);
      })();
      const displayValue = normalizedValue
        ? isHtml
          ? normalizedValue
          : escapeHtml(normalizedValue)
        : "–";
      return `<strong>${escapeHtml(label)}:</strong> ${displayValue}`;
    })
    .join("<br />");

  const entryDate = resolveSnapshotDate(entry);
  const headingHtml = entryDate
    ? `<div class="calc-snapshot-print__header"><h3>${escapeHtml(
        entryDate
      )}</h3></div>`
    : "";

  return `
    <div class="calc-snapshot-print">
      ${headingHtml}
      <div class="calc-snapshot-print__meta">
        <p>${metaBlockHtml}</p>
      </div>
      <div class="calc-snapshot-print__mediums">
        ${mediumTable}
      </div>
    </div>
  `;
}
