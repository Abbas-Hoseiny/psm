/**
 * QS-Modus Konfiguration
 * 
 * Der QS-Modus erweitert Pestalozzi um zusätzliche Pflichtfelder gemäß
 * QS-GAP-Leitfaden (Kapitel 3.6.1 + 3.6.2) für Pflanzenschutz-Dokumentation.
 * 
 * Aktivierung: ?mode=qs in der URL
 * 
 * Zusätzliche QS-Pflichtfelder:
 * - Wartezeit (Tage gemäß Hersteller)
 * - Maschine/Gerät (verwendete Spritztechnik)
 * - Schaderreger/Grund (Krankheit, Schädling, Unkraut)
 * - Verantwortliche Person (wenn ≠ Anwender)
 * - Wetterbedingungen (bei Einfluss auf Wirksamkeit/Abdrift)
 * - Behandlungsart (bei Nachernte: sprühen, nebeln, etc.)
 */

export interface QsConfig {
  /** QS-Modus aktiv */
  enabled: boolean;
  /** URL-Parameter für Aktivierung */
  urlParam: string;
  /** QS-Pflichtfelder sind required */
  strictValidation: boolean;
}

export interface QsFieldValues {
  /** Wartezeit in Tagen */
  wartezeit: string;
  /** Maschine/Gerät */
  maschine: string;
  /** Schaderreger/Krankheit/Unkraut (Grund der Behandlung) */
  schaderreger: string;
  /** Verantwortliche Person (wenn ≠ Anwender) */
  verantwortlicher: string;
  /** Wetterbedingungen */
  wetter: string;
  /** Behandlungsart (bei Nachernte) */
  behandlungsart: string;
}

export interface QsFieldLabels {
  wartezeit: {
    label: string;
    placeholder: string;
    hint: string;
  };
  maschine: {
    label: string;
    placeholder: string;
    hint: string;
  };
  schaderreger: {
    label: string;
    placeholder: string;
    hint: string;
  };
  verantwortlicher: {
    label: string;
    placeholder: string;
    hint: string;
  };
  wetter: {
    label: string;
    placeholder: string;
    hint: string;
    options: string[];
  };
  behandlungsart: {
    label: string;
    placeholder: string;
    hint: string;
    options: string[];
  };
}

const DEFAULT_QS_LABELS: QsFieldLabels = {
  wartezeit: {
    label: "Wartezeit (Tage)",
    placeholder: "z. B. 14",
    hint: "Wartezeit gemäß Herstellerangabe in Tagen",
  },
  maschine: {
    label: "Maschine / Gerät",
    placeholder: "z. B. Anhängespritze 1000L",
    hint: "Verwendete Spritztechnik",
  },
  schaderreger: {
    label: "Schaderreger / Grund",
    placeholder: "z. B. Blattläuse, Mehltau",
    hint: "Krankheit, Schädling oder Unkraut als Behandlungsgrund",
  },
  verantwortlicher: {
    label: "Verantwortliche Person",
    placeholder: "Name (falls ≠ Anwender)",
    hint: "Person, die über die Anwendung entschieden hat",
  },
  wetter: {
    label: "Wetterbedingungen",
    placeholder: "z. B. sonnig, windstill",
    hint: "Bei Einfluss auf Wirksamkeit oder Abdrift",
    options: [
      "sonnig, windstill",
      "bewölkt, windstill",
      "leichter Wind (< 3 m/s)",
      "mäßiger Wind (3-5 m/s)",
      "Tau / feucht",
      "nach Regen",
      "trocken",
    ],
  },
  behandlungsart: {
    label: "Behandlungsart",
    placeholder: "z. B. Sprühen",
    hint: "Art der Ausbringung (besonders bei Nachernte relevant)",
    options: [
      "Sprühen / Spritzen",
      "Nebeln",
      "Tauchen",
      "Stäuben",
      "Gießen",
      "Beizen",
      "Streuen / Granulat",
    ],
  },
};

let qsConfig: QsConfig = {
  enabled: false,
  urlParam: "mode",
  strictValidation: true,
};

let qsLabels: QsFieldLabels = { ...DEFAULT_QS_LABELS };

/**
 * Initialisiert den QS-Modus basierend auf URL-Parameter
 */
export function initQsMode(): void {
  const params = new URLSearchParams(window.location.search);
  const modeValue = params.get(qsConfig.urlParam);
  qsConfig.enabled = modeValue === "qs";
  
  if (qsConfig.enabled) {
    console.log("[QS-Modus] Aktiviert – zusätzliche Pflichtfelder aktiv");
    document.documentElement.classList.add("qs-mode");
  }
}

/**
 * Prüft ob QS-Modus aktiv ist
 */
export function isQsModeEnabled(): boolean {
  return qsConfig.enabled;
}

/**
 * Gibt die aktuelle QS-Konfiguration zurück
 */
export function getQsConfig(): Readonly<QsConfig> {
  return { ...qsConfig };
}

/**
 * Gibt die QS-Feld-Labels zurück
 */
export function getQsLabels(): Readonly<QsFieldLabels> {
  return qsLabels;
}

/**
 * Setzt benutzerdefinierte QS-Labels
 */
export function setQsLabels(customLabels: Partial<QsFieldLabels>): void {
  qsLabels = {
    ...DEFAULT_QS_LABELS,
    ...customLabels,
  };
}

/**
 * Erzeugt leere QS-Feldwerte
 */
export function createEmptyQsFields(): QsFieldValues {
  return {
    wartezeit: "",
    maschine: "",
    schaderreger: "",
    verantwortlicher: "",
    wetter: "",
    behandlungsart: "",
  };
}

/**
 * Validiert QS-Pflichtfelder
 * @returns Array von Fehlermeldungen (leer wenn alles ok)
 */
export function validateQsFields(
  fields: Partial<QsFieldValues>,
  strict = true
): string[] {
  if (!qsConfig.enabled) {
    return [];
  }
  
  const errors: string[] = [];
  
  if (strict || qsConfig.strictValidation) {
    // QS-Pflichtfelder gemäß Leitfaden 3.6.2
    if (!fields.maschine?.trim()) {
      errors.push("Maschine/Gerät ist für QS erforderlich");
    }
    if (!fields.schaderreger?.trim()) {
      errors.push("Schaderreger/Grund ist für QS erforderlich");
    }
    // Wartezeit, Wetter, Verantwortlicher sind empfohlen aber nicht K.O.
  }
  
  // Wartezeit muss numerisch sein wenn angegeben
  if (fields.wartezeit?.trim()) {
    const wartezeitNum = parseInt(fields.wartezeit, 10);
    if (isNaN(wartezeitNum) || wartezeitNum < 0) {
      errors.push("Wartezeit muss eine positive Zahl sein");
    }
  }
  
  return errors;
}

/**
 * Generiert die URL mit QS-Modus Parameter
 */
export function getQsModeUrl(baseUrl?: string): string {
  const base = baseUrl || window.location.origin + window.location.pathname;
  const url = new URL(base);
  url.searchParams.set(qsConfig.urlParam, "qs");
  return url.toString();
}

/**
 * Generiert die URL ohne QS-Modus
 */
export function getStandardModeUrl(baseUrl?: string): string {
  const base = baseUrl || window.location.origin + window.location.pathname;
  const url = new URL(base);
  url.searchParams.delete(qsConfig.urlParam);
  return url.toString();
}

/**
 * Hilfsfunktion zum Erstellen eines QS-Badge HTML
 */
export function renderQsBadge(): string {
  if (!qsConfig.enabled) {
    return "";
  }
  return `<span class="badge bg-info ms-2" title="QS-Modus aktiv – erweiterte Dokumentation">QS</span>`;
}

/**
 * CSS-Klassen für QS-Felder
 */
export const QS_CSS_CLASSES = {
  container: "qs-fields-container",
  field: "qs-field",
  required: "qs-required",
  badge: "qs-badge",
} as const;
