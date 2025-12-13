/**
 * BVL Field Icons & Formatters
 * Zentrale Icon-Definitionen und Formatierungsfunktionen für alle BVL API-Felder
 */

import { escapeHtml } from "./utils";

// ══════════════════════════════════════════════════════════════════════
// ICON MAPPING - Bootstrap Icons für alle BVL-Felder
// ══════════════════════════════════════════════════════════════════════

export const BVL_ICONS = {
  // Kern-Daten
  mittel: "bi-prescription2",
  awg: "bi-list-check",
  kultur: "bi-flower1",
  schadorg: "bi-bug",
  aufwand: "bi-speedometer2",
  wartezeit: "bi-hourglass-split",
  wirkstoff: "bi-capsule",
  wirkstoffGehalt: "bi-percent",

  // Referenz-Daten
  adresse: "bi-building",
  antrag: "bi-file-text",
  auflagen: "bi-exclamation-triangle",
  auflageRedu: "bi-check-circle",
  bemerkung: "bi-chat-text",
  partner: "bi-people",
  verwendungszweck: "bi-bullseye",
  zeitpunkt: "bi-calendar-event",
  zulassung: "bi-shield-check",

  // GHS Gefahren
  ghsGefahr: "bi-exclamation-diamond",
  ghsSymbol: "bi-diamond-half",
  ghsSicherheit: "bi-shield",
  ghsSignal: "bi-megaphone",

  // Kodelisten
  kodeliste: "bi-journal-code",
  kulturGruppe: "bi-tree",
  schadorgGruppe: "bi-virus",
  hinweis: "bi-info-circle",

  // Vertrieb
  vertrieb: "bi-truck",
  abpackung: "bi-box",
  wirkbereich: "bi-eyedropper",

  // Status
  abgelaufen: "bi-x-circle",
  parallelimport: "bi-arrow-repeat",
  stand: "bi-calendar-check",

  // Spezial
  staerkung: "bi-lightning",
  zusatzstoff: "bi-plus-circle",

  // UI-Aktionen
  berechnen: "bi-calculator",
  speichern: "bi-floppy",
  loeschen: "bi-trash",
  bearbeiten: "bi-pencil",
  ansehen: "bi-eye",
  drucken: "bi-printer",
  exportieren: "bi-download",
  importieren: "bi-upload",
  sync: "bi-arrow-clockwise",
} as const;

export type BvlIconKey = keyof typeof BVL_ICONS;

// ══════════════════════════════════════════════════════════════════════
// ICON RENDERER
// ══════════════════════════════════════════════════════════════════════

/**
 * Rendert ein Bootstrap Icon
 */
export function renderIcon(
  iconKey: BvlIconKey | string,
  options: {
    size?: "sm" | "md" | "lg";
    className?: string;
    title?: string;
  } = {}
): string {
  const { size = "md", className = "", title } = options;
  const iconClass = iconKey.startsWith("bi-")
    ? iconKey
    : BVL_ICONS[iconKey as BvlIconKey] || iconKey;
  const sizeClass =
    size === "sm" ? "bvl-icon-sm" : size === "lg" ? "bvl-icon-lg" : "bvl-icon";
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
  return `<i class="bi ${iconClass} ${sizeClass} ${className}"${titleAttr}></i>`;
}

// ══════════════════════════════════════════════════════════════════════
// WARTEZEIT FORMATTER
// ══════════════════════════════════════════════════════════════════════

export type WartezeitCategory = "kurz" | "mittel" | "lang" | "special" | "none";

export interface WartezeitInfo {
  value: number | string | null;
  category: WartezeitCategory;
  label: string;
  title: string;
  icon: string;
}

/**
 * Analysiert und kategorisiert einen Wartezeit-Wert
 */
export function parseWartezeit(value: unknown): WartezeitInfo {
  if (value === null || value === undefined || value === "") {
    return {
      value: null,
      category: "none",
      label: "-",
      title: "Keine Wartezeit angegeben",
      icon: "bi-dash",
    };
  }

  const strValue = String(value).trim().toUpperCase();

  // Spezialfälle
  if (strValue === "F") {
    return {
      value: "F",
      category: "special",
      label: "F",
      title: "Wartezeit nach Festsetzung der Ernte",
      icon: "bi-info-circle",
    };
  }

  if (strValue === "N") {
    return {
      value: "N",
      category: "special",
      label: "N",
      title: "Wartezeit nicht relevant",
      icon: "bi-dash-circle",
    };
  }

  // Numerischer Wert
  const numValue = parseInt(strValue, 10);
  if (isNaN(numValue)) {
    return {
      value: strValue,
      category: "none",
      label: strValue,
      title: `Wartezeit: ${strValue}`,
      icon: "bi-question-circle",
    };
  }

  // Kategorisierung nach Tagen
  if (numValue <= 7) {
    return {
      value: numValue,
      category: "kurz",
      label: `${numValue}T`,
      title: `${numValue} Tage Wartezeit (kurz)`,
      icon: "bi-check-circle",
    };
  }

  if (numValue <= 21) {
    return {
      value: numValue,
      category: "mittel",
      label: `${numValue}T`,
      title: `${numValue} Tage Wartezeit (mittel)`,
      icon: "bi-hourglass-split",
    };
  }

  return {
    value: numValue,
    category: "lang",
    label: `${numValue}T`,
    title: `${numValue} Tage Wartezeit (lang)`,
    icon: "bi-exclamation-triangle",
  };
}

/**
 * Rendert einen Wartezeit-Badge
 */
export function renderWartezeitBadge(value: unknown): string {
  const info = parseWartezeit(value);
  return `<span class="badge-wartezeit badge-wartezeit-${info.category}" title="${escapeHtml(info.title)}">
    <i class="bi ${info.icon} bvl-icon-sm"></i>${escapeHtml(info.label)}
  </span>`;
}

// ══════════════════════════════════════════════════════════════════════
// AUFWAND FORMATTER
// ══════════════════════════════════════════════════════════════════════

export interface AufwandInfo {
  menge: number | null;
  einheit: string;
  formatted: string;
}

/**
 * Formatiert Aufwandmenge mit Einheit
 */
export function formatAufwand(menge: unknown, einheit: unknown): AufwandInfo {
  const numMenge =
    typeof menge === "number" ? menge : parseFloat(String(menge || ""));
  const strEinheit = String(einheit || "").trim() || "?";

  if (isNaN(numMenge) || numMenge === 0) {
    return {
      menge: null,
      einheit: strEinheit,
      formatted: "-",
    };
  }

  // Formatierung: Maximal 2 Dezimalstellen, trailing zeros entfernen
  const formattedMenge = numMenge.toFixed(2).replace(/\.?0+$/, "");

  return {
    menge: numMenge,
    einheit: strEinheit,
    formatted: `${formattedMenge} ${strEinheit}`,
  };
}

/**
 * Rendert eine Aufwand-Anzeige
 */
export function renderAufwand(menge: unknown, einheit: unknown): string {
  const info = formatAufwand(menge, einheit);
  if (info.menge === null) {
    return `<span class="text-muted">-</span>`;
  }
  return `<span class="aufwand-display">
    <span class="aufwand-value">${escapeHtml(String(info.menge))}</span>
    <span class="aufwand-einheit">${escapeHtml(info.einheit)}</span>
  </span>`;
}

// ══════════════════════════════════════════════════════════════════════
// CHIP RENDERER (Kultur, Schadorg, Wirkstoff)
// ══════════════════════════════════════════════════════════════════════

export type ChipType = "kultur" | "schadorg" | "wirkstoff";

const CHIP_ICONS: Record<ChipType, string> = {
  kultur: "bi-flower1",
  schadorg: "bi-bug",
  wirkstoff: "bi-capsule",
};

/**
 * Rendert einen einzelnen Chip
 */
export function renderChip(
  value: string,
  type: ChipType,
  title?: string
): string {
  const icon = CHIP_ICONS[type];
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
  return `<span class="chip chip-${type}"${titleAttr}>
    <i class="bi ${icon} bvl-icon-sm"></i>${escapeHtml(value)}
  </span>`;
}

/**
 * Rendert eine Liste von Chips (komma-getrennte Werte)
 */
export function renderChipList(
  values: string | string[],
  type: ChipType,
  maxVisible = 3
): string {
  const items = Array.isArray(values)
    ? values
    : String(values || "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);

  if (items.length === 0) {
    return `<span class="text-muted">-</span>`;
  }

  if (items.length === 1) {
    return renderChip(items[0], type);
  }

  const visible = items.slice(0, maxVisible);
  const hidden = items.length - maxVisible;

  let html = `<div class="chip-list">`;
  html += visible.map((v) => renderChip(v, type)).join("");
  if (hidden > 0) {
    html += `<span class="chip chip-${type}" title="${items.slice(maxVisible).join(", ")}">+${hidden}</span>`;
  }
  html += `</div>`;

  return html;
}

// ══════════════════════════════════════════════════════════════════════
// ZULASSUNGS-STATUS FORMATTER
// ══════════════════════════════════════════════════════════════════════

export type ZulassungsStatus = "gueltig" | "auslaufend" | "abgelaufen";

export interface ZulassungsInfo {
  status: ZulassungsStatus;
  label: string;
  icon: string;
  daysRemaining: number | null;
}

/**
 * Berechnet Zulassungsstatus basierend auf Enddatum
 */
export function parseZulassungsStatus(zulEnde: unknown): ZulassungsInfo {
  if (!zulEnde) {
    return {
      status: "gueltig",
      label: "Gültig",
      icon: "bi-check-circle",
      daysRemaining: null,
    };
  }

  const endDate = new Date(String(zulEnde));
  if (isNaN(endDate.getTime())) {
    return {
      status: "gueltig",
      label: "Gültig",
      icon: "bi-check-circle",
      daysRemaining: null,
    };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysRemaining = Math.ceil(
    (endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysRemaining < 0) {
    return {
      status: "abgelaufen",
      label: "Abgelaufen",
      icon: "bi-x-circle",
      daysRemaining,
    };
  }

  if (daysRemaining <= 90) {
    return {
      status: "auslaufend",
      label: `Läuft aus (${daysRemaining}d)`,
      icon: "bi-exclamation-circle",
      daysRemaining,
    };
  }

  return {
    status: "gueltig",
    label: "Gültig",
    icon: "bi-check-circle",
    daysRemaining,
  };
}

/**
 * Rendert einen Zulassungs-Status
 */
export function renderZulassungsStatus(zulEnde: unknown): string {
  const info = parseZulassungsStatus(zulEnde);
  return `<span class="status-zulassung status-${info.status}">
    <i class="bi ${info.icon}"></i>${escapeHtml(info.label)}
  </span>`;
}
