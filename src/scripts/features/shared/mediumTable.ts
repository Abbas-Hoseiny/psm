import { escapeHtml, formatNumber } from "@scripts/core/utils";

const COLUMN_FALLBACK_LABELS = {
  medium: "Mittel",
  approval: "Zulassungsnr.",
  wartezeit: "Wartezeit",
  wirkstoff: "Wirkstoff",
  unit: "Einheit",
  method: "Methode",
  value: "Wert",
  perQuantity: "Fläche (ha)",
  areaAr: "Ar",
  areaSqm: "m²",
  total: "Gesamt",
} as const;

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function resolveAreaHaFromInputs(inputs: any): number | null {
  if (!inputs || typeof inputs !== "object") {
    return null;
  }
  const direct = toNumber(inputs.areaHa);
  if (direct !== null) {
    return direct;
  }
  const areaAr = toNumber(inputs.areaAr);
  if (areaAr !== null) {
    return areaAr / 100;
  }
  const areaSqm = toNumber(inputs.areaSqm);
  if (areaSqm !== null) {
    return areaSqm / 10000;
  }
  return null;
}

type VariantKey = "calculation" | "detail" | "summary";

type VariantConfig = {
  columns: Array<keyof typeof COLUMN_FALLBACK_LABELS>;
  numberFallback: string;
  missingValue: string;
};

const VARIANT_CONFIG: Record<VariantKey, VariantConfig> = {
  calculation: {
    columns: [
      "medium",
      "approval",
      "unit",
      "method",
      "value",
      "perQuantity",
      "areaAr",
      "areaSqm",
      "total",
    ],
    numberFallback: "0.00",
    missingValue: "-",
  },
  detail: {
    columns: ["medium", "approval", "unit", "method", "value", "total"],
    numberFallback: "-",
    missingValue: "-",
  },
  summary: {
    columns: ["medium", "approval", "total"],
    numberFallback: "-",
    missingValue: "-",
  },
};

/**
 * Erweitert die Spalten um Wartezeit und Wirkstoff
 * Diese Spalten werden immer angezeigt (QS-GAP-Leitfaden 3.6.1)
 */
function expandColumnsForQsMode(
  columns: Array<keyof typeof COLUMN_FALLBACK_LABELS>,
  _items?: any[]
): Array<keyof typeof COLUMN_FALLBACK_LABELS> {
  // Wartezeit und Wirkstoff immer anzeigen (QS-Standard)
  // Füge Wartezeit und Wirkstoff nach approval ein
  const approvalIndex = columns.indexOf("approval");
  if (approvalIndex === -1) {
    return [...columns, "wartezeit", "wirkstoff"];
  }
  const result = [...columns];
  result.splice(approvalIndex + 1, 0, "wartezeit", "wirkstoff");
  return result;
}

function resolveVariant(variant: VariantKey, items?: any[]): VariantConfig {
  const base = VARIANT_CONFIG[variant] || VARIANT_CONFIG.calculation;
  return {
    ...base,
    columns: expandColumnsForQsMode(base.columns, items),
  };
}

function resolveLabel(
  labels: any,
  key: keyof typeof COLUMN_FALLBACK_LABELS
): string {
  const label = labels?.calculation?.tableColumns?.[key];
  return escapeHtml(label || COLUMN_FALLBACK_LABELS[key] || key);
}

type ColumnRenderer = {
  cell: (item: any, config: VariantConfig) => string;
  className?: string;
};

const COLUMN_DEFS: Record<keyof typeof COLUMN_FALLBACK_LABELS, ColumnRenderer> =
  {
    medium: {
      cell: (item, config) => {
        const value = item?.name;
        return value ? escapeHtml(value) : config.missingValue;
      },
    },
    unit: {
      cell: (item, config) => {
        const value = item?.unit;
        return value ? escapeHtml(value) : config.missingValue;
      },
      className: "nowrap",
    },
    approval: {
      cell: (item, config) => {
        const value = item?.zulassungsnummer;
        return value ? escapeHtml(value) : config.missingValue;
      },
      className: "nowrap",
    },
    wartezeit: {
      cell: (item, config) => {
        const value = item?.wartezeit;
        if (value === null || value === undefined) {
          return `<span class="badge-wartezeit badge-wartezeit-none">-</span>`;
        }

        // Spezialfälle: F (Festsetzung), N (nicht relevant)
        const strValue = String(value).trim().toUpperCase();
        if (strValue === "F" || strValue === "N") {
          const label = strValue === "F" ? "F" : "N";
          return `<span class="badge-wartezeit badge-wartezeit-special" title="${strValue === "F" ? "Nach Festsetzung" : "Nicht relevant"}">
            <i class="bi bi-info-circle bvl-icon-sm"></i>${label}
          </span>`;
        }

        // Numerischer Wert
        const numValue = parseInt(String(value), 10);
        if (isNaN(numValue)) {
          return `<span class="badge-wartezeit badge-wartezeit-none">${escapeHtml(String(value))}</span>`;
        }

        // Farbkodierung nach Tagen
        let badgeClass = "badge-wartezeit-kurz"; // Grün: 0-7 Tage
        let icon = "bi-check-circle";
        if (numValue > 21) {
          badgeClass = "badge-wartezeit-lang"; // Orange: >21 Tage
          icon = "bi-exclamation-triangle";
        } else if (numValue > 7) {
          badgeClass = "badge-wartezeit-mittel"; // Gelb: 8-21 Tage
          icon = "bi-hourglass-split";
        }

        return `<span class="badge-wartezeit ${badgeClass}" title="${numValue} Tage Wartezeit">
          <i class="bi ${icon} bvl-icon-sm"></i>${numValue}T
        </span>`;
      },
      className: "nowrap",
    },
    wirkstoff: {
      cell: (item, config) => {
        const value = item?.wirkstoff;
        if (!value) return config.missingValue;

        // Mehrere Wirkstoffe? (komma-getrennt)
        const wirkstoffe = String(value)
          .split(",")
          .map((w) => w.trim())
          .filter(Boolean);
        if (wirkstoffe.length === 1) {
          return `<span class="chip chip-wirkstoff" title="Wirkstoff">
            <i class="bi bi-capsule bvl-icon-sm"></i>${escapeHtml(wirkstoffe[0])}
          </span>`;
        }

        // Mehrere Wirkstoffe als Chip-Liste
        return `<div class="chip-list">${wirkstoffe
          .map(
            (w) =>
              `<span class="chip chip-wirkstoff"><i class="bi bi-capsule bvl-icon-sm"></i>${escapeHtml(w)}</span>`
          )
          .join("")}</div>`;
      },
    },
    method: {
      cell: (item, config) => {
        const value = item?.methodLabel || item?.methodId;
        return value ? escapeHtml(value) : config.missingValue;
      },
    },
    value: {
      cell: (item, config) =>
        formatNumber(item?.value, 2, config.numberFallback),
    },
    perQuantity: {
      cell: (item, config) => {
        const areaHa = resolveAreaHaFromInputs(item?.inputs);
        if (areaHa === null) {
          const legacy = item?.inputs?.kisten;
          return legacy === null || legacy === undefined
            ? config.missingValue
            : escapeHtml(String(legacy));
        }
        return formatNumber(areaHa, 2, config.numberFallback);
      },
      className: "nowrap",
    },
    areaAr: {
      cell: (item, config) =>
        formatNumber(item?.inputs?.areaAr, 2, config.numberFallback),
    },
    areaSqm: {
      cell: (item, config) =>
        formatNumber(item?.inputs?.areaSqm, 2, config.numberFallback),
    },
    total: {
      cell: (item, config) => {
        const total = formatNumber(item?.total, 2, config.numberFallback);
        if (total === config.numberFallback) {
          return config.numberFallback;
        }
        const unit = item?.unit ? ` ${escapeHtml(item.unit)}` : "";
        return `${total}${unit}`;
      },
      className: "nowrap",
    },
  };

function renderHeadCells(
  columns: Array<keyof typeof COLUMN_FALLBACK_LABELS>,
  labels: any
): string {
  return columns
    .map((columnKey) => `<th>${resolveLabel(labels, columnKey)}</th>`)
    .join("");
}

function renderRowCells(
  item: any,
  columns: Array<keyof typeof COLUMN_FALLBACK_LABELS>,
  config: VariantConfig
): string {
  return columns
    .map((columnKey) => {
      const column = COLUMN_DEFS[columnKey];
      if (!column) {
        return "<td>-</td>";
      }
      const value = column.cell(item, config);
      const className = column.className ? ` class="${column.className}"` : "";
      return `<td${className}>${value}</td>`;
    })
    .join("");
}

export function buildMediumTableHead(
  labels: any,
  variant: VariantKey = "calculation",
  items?: any[]
): string {
  const config = resolveVariant(variant, items);
  return `<tr>${renderHeadCells(config.columns, labels)}</tr>`;
}

export function buildMediumTableRows(
  items: any[] = [],
  variant: VariantKey = "calculation"
): string {
  const config = resolveVariant(variant, items);
  if (!Array.isArray(items) || !items.length) {
    return "";
  }
  return items
    .map((item) => `<tr>${renderRowCells(item, config.columns, config)}</tr>`)
    .join("");
}

export function buildMediumTableHTML(
  items: any[] = [],
  labels: any,
  variant: VariantKey = "calculation",
  options: { classes?: string } = {}
): string {
  const {
    classes = "table table-dark table-striped align-middle calc-medium-table",
  } = options;
  const config = resolveVariant(variant, items);
  const head = `<tr>${renderHeadCells(config.columns, labels)}</tr>`;
  const body = items
    .map((item) => `<tr>${renderRowCells(item, config.columns, config)}</tr>`)
    .join("");
  return `<table class="${classes}"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

export function buildMediumSummaryLines(items: any[] = []): string[] {
  if (!Array.isArray(items) || !items.length) {
    return [];
  }
  const config = resolveVariant("summary", items);
  return items.map((item) => {
    const name = item?.name ? escapeHtml(item.name) : config.missingValue;
    if (!item || !item.name) {
      return name;
    }
    const total = formatNumber(item.total, 2, config.numberFallback);
    if (total === config.numberFallback) {
      return `${name}: ${config.numberFallback}`;
    }
    const unit = item?.unit ? ` ${escapeHtml(item.unit)}` : "";
    return `${name}: ${total}${unit}`;
  });
}
