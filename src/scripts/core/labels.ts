const DEFAULT_FIELD_LABELS = {
  calculation: {
    fields: {
      creator: {
        label: 'Erstellt von',
        placeholder: 'Name der verantwortlichen Person'
      },
      location: {
        label: 'Standort / Abteil',
        placeholder: 'z. B. Gewächshaus 1'
      },
      crop: {
        label: 'Kultur',
        placeholder: 'z. B. Salat'
      },
      quantity: {
        label: 'Anzahl Kisten',
        placeholder: 'z. B. 42',
        unit: 'Kisten'
      }
    },
    summary: {
      water: 'Gesamtwasser (L)',
      area: 'Fläche (Ar / m²)'
    },
    tableColumns: {
      medium: 'Mittel',
      unit: 'Einheit',
      method: 'Methode',
      value: 'Wert',
      perQuantity: 'Kisten',
      areaAr: 'Ar',
      areaSqm: 'm²',
      total: 'Gesamt'
    },
    resultTitle: 'Benötigte Mittel'
  },
  history: {
    tableColumns: {
      date: 'Datum',
      creator: 'Erstellt von',
      location: 'Standort',
      crop: 'Kultur',
      quantity: 'Kisten'
    },
    detail: {
      title: 'Historieneintrag',
      creator: 'Erstellt von',
      location: 'Standort / Abteil',
      crop: 'Kultur',
      quantity: 'Kisten'
    },
    summaryTitle: 'Historie (Zusammenfassung)',
    mediumsHeading: 'Mittel & Gesamtmengen'
  },
  reporting: {
    tableColumns: {
      date: 'Datum',
      creator: 'Erstellt von',
      location: 'Standort',
      crop: 'Kultur',
      quantity: 'Kisten',
      mediums: 'Mittel & Gesamtmengen'
    },
    infoAll: 'Alle Einträge',
    infoEmpty: 'Keine Einträge vorhanden',
    infoPrefix: 'Zeitraum',
    printTitle: 'Auswertung'
  }
};

function deepMerge(target: any, source: any): any {
  const result = Array.isArray(target) ? [...target] : { ...target };
  if (!source || typeof source !== 'object') {
    return result;
  }
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
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
  return deepMerge(getDefaultFieldLabels(), custom);
}

export function mergeFieldLabels(base: any, overrides: any = {}): any {
  return deepMerge(cloneLabels(base), overrides);
}

export function setFieldLabelByPath(labels: any, path: string, value: any): any {
  const segments = path.split('.');
  const copy = cloneLabels(labels);
  let cursor = copy;
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (i === segments.length - 1) {
      cursor[segment] = value;
    } else {
      cursor[segment] = cursor[segment] && typeof cursor[segment] === 'object'
        ? { ...cursor[segment] }
        : {};
      cursor = cursor[segment];
    }
  }
  return resolveFieldLabels(copy);
}
