import {
  escapeHtml,
  formatGpsCoordinates,
  buildGoogleMapsUrl,
  formatDateFromIso,
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
  kisten?: number;
  eppoCode?: string;
  bbch?: string;
  gps?: string;
  gpsCoordinates?: { latitude?: number; longitude?: number } | null;
  gpsPointId?: string | null;
  invekos?: string;
  uhrzeit?: string;
  items?: any[];
  [key: string]: unknown;
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

function resolveSnapshotGps(entry: CalculationSnapshotEntry): string {
  if (entry?.gpsCoordinates) {
    const formatted = formatGpsCoordinates(entry.gpsCoordinates);
    if (formatted) {
      return formatted;
    }
  }
  return "";
}

function resolveSnapshotGpsNote(entry: CalculationSnapshotEntry): string {
  return entry?.gps || "";
}

function shouldDisplayGpsNote(note: string, coordinates: string): boolean {
  const normalizedNote = (note || "").trim();
  if (!normalizedNote) {
    return false;
  }
  const normalizedCoords = (coordinates || "").trim();
  if (!normalizedCoords) {
    return true;
  }
  return normalizedNote !== normalizedCoords;
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
  const showGpsNote = shouldDisplayGpsNote(gpsNoteValue, gpsCoordinateValue);
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
              detailLabels.quantity || tableLabels.quantity || "Kisten"
            )}:</strong>
            ${escapeHtml(
              entry?.kisten !== undefined && entry?.kisten !== null
                ? String(entry.kisten)
                : "–"
            )}
          </div>
          <div class="calc-snapshot-card__info-item">
            <strong>${escapeHtml(
              detailLabels.time || tableLabels.time || "Uhrzeit"
            )}:</strong>
            ${escapeHtml(entry?.uhrzeit || "–")}
          </div>
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
  const showGpsNote = shouldDisplayGpsNote(gpsNoteValue, gpsCoordinateValue);
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
      label: detailLabels.quantity || "Kisten",
      value:
        entry?.kisten !== undefined && entry?.kisten !== null
          ? String(entry.kisten)
          : null,
    },
    {
      label: detailLabels.time || "Uhrzeit",
      value: entry?.uhrzeit || null,
    },
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
