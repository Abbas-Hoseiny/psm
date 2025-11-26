const DEFAULT_FIELD_LABELS = {
  calculation: {
    fields: {
      creator: {
        label: "Erstellt von",
        placeholder: "Name der verantwortlichen Person",
      },
      location: {
        label: "Standort / Abteil",
        placeholder: "z. B. Gewächshaus 1",
      },
      crop: {
        label: "Kultur",
        placeholder: "z. B. Salat",
      },
      quantity: {
        label: "Anzahl Kisten",
        placeholder: "z. B. 42",
        unit: "Kisten",
      },
      eppoCode: {
        label: "EPPO-Code",
        placeholder: "z. B. BEAVA",
      },
      bbch: {
        label: "BBCH-Stadium",
        placeholder: "z. B. 12",
      },
      usageType: {
        label: "Art der Verwendung",
        placeholder: "z. B. Agrarfläche",
      },
      gps: {
        label: "GPS-Koordinaten",
        placeholder: "z. B. 47.1234, 8.1234",
      },
      invekos: {
        label: "InVeKoS-Schlag",
        placeholder: "z. B. 123-456-789",
      },
      time: {
        label: "Uhrzeit",
        placeholder: "z. B. 08:30",
      },
      date: {
        label: "Datum",
        placeholder: "z. B. 12.03.2025",
      },
    },
    summary: {
      water: "Gesamtwasser (L)",
      area: "Fläche (Ar / m²)",
    },
    tableColumns: {
      medium: "Mittel",
      approval: "Zulassungsnr.",
      unit: "Einheit",
      method: "Methode",
      value: "Wert",
      perQuantity: "Kisten",
      areaAr: "Ar",
      areaSqm: "m²",
      total: "Gesamt",
    },
    resultTitle: "Benötigte Mittel",
  },
  history: {
    tableColumns: {
      date: "Datum",
      creator: "Erstellt von",
      location: "Standort",
      crop: "Kultur",
      usageType: "Verwendung",
      quantity: "Kisten",
      approval: "Zulassungsnr.",
      eppoCode: "EPPO",
      bbch: "BBCH",
      gps: "GPS",
      invekos: "InVeKoS",
      time: "Uhrzeit",
    },
    detail: {
      title: "",
      creator: "Erstellt von",
      location: "Standort / Abteil",
      crop: "Kultur",
      usageType: "Art der Verwendung",
      quantity: "Kisten",
      eppoCode: "EPPO-Code",
      bbch: "BBCH-Stadium",
      gps: "GPS-Koordinaten",
      invekos: "InVeKoS-Schlag",
      time: "Uhrzeit",
    },
    summaryTitle: "Historie (Zusammenfassung)",
    mediumsHeading: "Mittel & Gesamtmengen",
  },
  reporting: {
    tableColumns: {
      date: "Datum",
      creator: "Erstellt von",
      location: "Standort",
      crop: "Kultur",
      usageType: "Verwendung",
      quantity: "Kisten",
      mediums: "Mittel & Gesamtmengen",
    },
    infoAll: "Alle Einträge",
    infoEmpty: "Keine Einträge vorhanden",
    infoPrefix: "Zeitraum",
    printTitle: "Auswertung",
  },
};

const QUANTITY_LABEL_PRIMARY_PATH =
  "calculation.fields.quantity.label" as const;
const QUANTITY_LABEL_DEPENDENT_PATHS = [
  "calculation.tableColumns.perQuantity",
  "history.tableColumns.quantity",
  "history.detail.quantity",
  "reporting.tableColumns.quantity",
] as const;

function splitPath(path: string): string[] {
  return path.split(".").filter(Boolean);
}

function getValueAtPath(source: any, path: string): any {
  if (!source || typeof source !== "object") {
    return undefined;
  }
  return splitPath(path).reduce<any>((cursor, segment) => {
    if (cursor && typeof cursor === "object" && segment in cursor) {
      return cursor[segment];
    }
    return undefined;
  }, source);
}

function assignValueAtPath(target: any, path: string, value: any): void {
  const segments = splitPath(path);
  if (!segments.length) {
    return;
  }
  let cursor = target;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (index === segments.length - 1) {
      cursor[segment] = value;
      return;
    }
    const next = cursor[segment];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      cursor[segment] = {};
    } else {
      cursor[segment] = { ...next };
    }
    cursor = cursor[segment];
  }
}

function deepMerge(target: any, source: any): any {
  const result = Array.isArray(target) ? [...target] : { ...target };
  if (!source || typeof source !== "object") {
    return result;
  }
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const baseValue = key in result ? result[key] : {};
      result[key] = deepMerge(baseValue, value);
    } else {
      result[key] = Array.isArray(value) ? [...value] : value;
    }
  }
  return result;
}

function cloneLabels(labels: any): any {
  return JSON.parse(JSON.stringify(labels));
}

export function getDefaultFieldLabels(): typeof DEFAULT_FIELD_LABELS {
  return cloneLabels(DEFAULT_FIELD_LABELS);
}

export function resolveFieldLabels(custom: any = {}): any {
  const defaults = getDefaultFieldLabels();
  const merged = deepMerge(defaults, custom);
  const quantityLabel = getValueAtPath(merged, QUANTITY_LABEL_PRIMARY_PATH);
  if (quantityLabel) {
    QUANTITY_LABEL_DEPENDENT_PATHS.forEach((path) => {
      const currentValue = getValueAtPath(merged, path);
      const defaultValue = getValueAtPath(defaults, path);
      const customValue = getValueAtPath(custom, path);
      if (
        customValue === undefined ||
        customValue === defaultValue ||
        currentValue === defaultValue
      ) {
        assignValueAtPath(merged, path, quantityLabel);
      }
    });
  }
  return merged;
}

export function mergeFieldLabels(base: any, overrides: any = {}): any {
  return deepMerge(cloneLabels(base), overrides);
}

export function setFieldLabelByPath(
  labels: any,
  path: string,
  value: any
): any {
  const segments = splitPath(path);
  const copy = cloneLabels(labels);
  let cursor = copy;
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (i === segments.length - 1) {
      cursor[segment] = value;
    } else {
      cursor[segment] =
        cursor[segment] && typeof cursor[segment] === "object"
          ? { ...cursor[segment] }
          : {};
      cursor = cursor[segment];
    }
  }
  if (path === QUANTITY_LABEL_PRIMARY_PATH) {
    QUANTITY_LABEL_DEPENDENT_PATHS.forEach((dependentPath) => {
      assignValueAtPath(copy, dependentPath, value);
    });
  }
  return resolveFieldLabels(copy);
}
