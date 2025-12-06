/**
 * QS-GAP Dokumentationsfelder
 *
 * Pestalozzi enthält alle Felder gemäß QS-GAP-Leitfaden (Kapitel 3.6.1 + 3.6.2)
 * für vollständige Pflanzenschutz-Dokumentation.
 *
 * Zusätzliche QS-Felder (optional, aber empfohlen):
 * - Maschine/Gerät (verwendete Spritztechnik)
 * - Schaderreger/Grund (Krankheit, Schädling, Unkraut)
 * - Verantwortliche Person (wenn ≠ Anwender)
 * - Wetterbedingungen (bei Einfluss auf Wirksamkeit/Abdrift)
 * - Behandlungsart (bei Nachernte: sprühen, nebeln, etc.)
 *
 * HINWEIS: Wartezeit und Wirkstoff sind Eigenschaften des Pflanzenschutzmittels
 * und werden in den Einstellungen pro Mittel gepflegt (nicht pro Anwendung).
 */

export interface QsConfig {
  /** QS-Felder sind immer verfügbar */
  enabled: boolean;
  /** Strenge Validierung (Pflichtfelder) - standardmäßig aus */
  strictValidation: boolean;
}

export interface QsFieldValues {
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
  enabled: true, // QS-Felder immer verfügbar
  strictValidation: false, // Felder optional, nicht Pflicht
};

let qsLabels: QsFieldLabels = { ...DEFAULT_QS_LABELS };

/**
 * Initialisiert die QS-Felder (immer aktiv)
 */
export function initQsMode(): void {
  // QS-Felder sind immer verfügbar
  qsConfig.enabled = true;
  document.documentElement.classList.add("qs-mode");
  console.log("[QS] Dokumentationsfelder gemäß QS-GAP-Leitfaden verfügbar");
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
    maschine: "",
    schaderreger: "",
    verantwortlicher: "",
    wetter: "",
    behandlungsart: "",
  };
}

/**
 * Validiert QS-Felder (optional - nur bei strictValidation)
 * @returns Array von Fehlermeldungen (leer wenn alles ok oder Validierung aus)
 */
export function validateQsFields(
  fields: Partial<QsFieldValues>,
  strict = false
): string[] {
  // Keine Pflichtvalidierung - alle Felder sind optional
  if (!strict && !qsConfig.strictValidation) {
    return [];
  }

  const errors: string[] = [];

  // Nur bei explizit aktivierter strenger Validierung
  if (strict || qsConfig.strictValidation) {
    if (!fields.maschine?.trim()) {
      errors.push(
        "Maschine/Gerät ist für vollständige QS-Dokumentation empfohlen"
      );
    }
    if (!fields.schaderreger?.trim()) {
      errors.push(
        "Schaderreger/Grund ist für vollständige QS-Dokumentation empfohlen"
      );
    }
  }

  return errors;
}

/**
 * Generiert die URL (QS ist jetzt immer aktiv)
 * @deprecated QS-Felder sind jetzt immer verfügbar
 */
export function getQsModeUrl(baseUrl?: string): string {
  const base = baseUrl || window.location.origin + window.location.pathname;
  return base;
}

/**
 * Generiert die Standard-URL
 * @deprecated QS-Felder sind jetzt immer verfügbar
 */
export function getStandardModeUrl(baseUrl?: string): string {
  const base = baseUrl || window.location.origin + window.location.pathname;
  return base;
}

/**
 * Hilfsfunktion zum Erstellen eines QS-Badge HTML
 * (Wird nicht mehr angezeigt, da QS-Felder jetzt Standard sind)
 */
export function renderQsBadge(): string {
  // QS-Badge nicht mehr nötig - Felder sind jetzt Standard
  return "";
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
