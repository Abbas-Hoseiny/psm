/**
 * BVL-Einheitenkürzel für Aufwandmengen (BVL-Kodeliste 25).
 *
 * Die BVL-Daten liefern Einheiten als Kürzel, z.B. "LH" (l/ha) oder
 * "CQ" (ml/m²). Dieses Modul übersetzt sie in Klartext und rechnet
 * flächenbezogene Angaben auf eine Menge pro Hektar um.
 */

export type MediumUnit = "L" | "ml" | "kg" | "g";

const BVL_UNIT_LABELS: Record<string, string> = {
  "%%": "%",
  AD: "Dispenser je ha",
  B3: "g pro Bau",
  C5: "ml/m² und je m Kronenhöhe",
  C51: "ml/m² und je m Kronenhöhe bei maximal 2 m Kronenhöhe",
  C6: "g/100 m² und je m Kronenhöhe",
  C7: "ml/100 m² und je m Kronenhöhe",
  C71: "ml/100 m² und je m Kronenhöhe bei maximal 2 m Kronenhöhe",
  C8: "ml/t/Tag",
  CA: "ml/100 m²",
  CD: "ml/dt",
  CE: "ml pro Einheit Saatgut",
  CF: "ml pro 100 kg Saatgut",
  CG: "ml pro kg Saatgut",
  CH: "ml/ha",
  CK: "ml/kg",
  CL: "ml/l",
  CO1: "ml je 10 cm Stammumfang",
  CQ: "ml/m²",
  CR: "ml je 100 m³",
  CT: "ml/t",
  CTK: "ml/1000 Korn",
  CTL: "ml/100.000 Korn Saatgut",
  CTP: "ml/1000 Pflanzen",
  CU: "ml/m³",
  CX: "ml",
  CZ: "ml/10 m²",
  DG: "Dose(n) je 1000 m³",
  G2: "g/100 kg Substrat",
  G3: "g pro Gang",
  G5: "g/ha und je m Kronenhöhe",
  G6: "g h/m³",
  G7: "g/ha und je m Kronenhöhe bei maximal 2 m Kronenhöhe",
  GA: "g/100 m²",
  GD: "g/dt",
  GE: "g pro Einheit Saatgut",
  GH: "g/ha",
  GK: "g/kg",
  GL: "g/l",
  GLS: "g/l Substrat",
  GQ: "g/m²",
  GR: "g je 100 m³",
  GT: "g/t",
  GTL: "g/100.000 Korn Saatgut",
  GU: "g/m³",
  GV6: "g je 6 m³",
  GX: "g",
  IS: "mg/m³",
  K3: "g pro Köderstelle",
  K5: "kg/ha und je m Kronenhöhe",
  KH: "kg/ha",
  KHL: "kg/10.000 m² Laubwandfläche",
  KP: "kg pro 1000 Pflanzen",
  KSG: "l pro 100 kg Saatgut",
  KT: "kg/t",
  KU: "kg/m³",
  KX: "kg",
  L1: "l/100 t",
  L2: "l/100 kg Substrat",
  L5: "l/ha und je m Kronenhöhe",
  L6: "l/ha und je m Pflanzenhöhe",
  L7: "l/ha und je m Kronenhöhe bei maximal 2 m Kronenhöhe",
  L71: "l/100 m² und je m Kronenhöhe bei maximal 2 m Kronenhöhe",
  LA: "l/100 m²",
  LB: "l/10 m²",
  LD: "l/dt",
  LH: "l/ha",
  LHL: "l/10.000 m² Laubwandfläche",
  LK: "l/100 m² und je m Kronenhöhe",
  LP: "l pro 1000 Pflanzen",
  LQ: "l/m²",
  LT: "l/t",
  LU: "l/m³",
  LW: "l Wasser",
  LX: "l",
  M3: "g pro Stamm",
  M4: "ml pro Stamm",
  M5: "ml/ha und je m Kronenhöhe",
  MP: "ml je 100 l Prozesswasser",
  P2: "l pro Pflanze",
  P3: "g pro Pflanze",
  P9: "g/1000 Pflanzen",
  R1: "Körner pro Pflanzrohr",
  ST: "Stück je t",
  SU: "Stück je m³",
  TH: "Tabletten/ha",
  TK: "Tabletten/ha und je m Kronenhöhe",
  TQ2: "Tablette/10 m³",
  Y3: "g je 8-10 m Ganglänge",
  Z2: "Stück je 3-5 m Ganglänge",
  ZK: "Stück pro Köderstelle",
  ZL: "Stück pro Loch",
  ZQ: "Tablette(n) je l",
  ZT: "Stäbchen pro Topf",
};

// Kürzel, die sich exakt in eine Menge pro Hektar umrechnen lassen
const PER_HECTARE: Record<string, { unit: MediumUnit; factor: number }> = {
  LH: { unit: "L", factor: 1 },
  KH: { unit: "kg", factor: 1 },
  CH: { unit: "ml", factor: 1 },
  GH: { unit: "g", factor: 1 },
  CQ: { unit: "L", factor: 10 }, // ml/m²
  GQ: { unit: "kg", factor: 10 }, // g/m²
  CA: { unit: "L", factor: 0.1 }, // ml/100 m²
  GA: { unit: "kg", factor: 0.1 }, // g/100 m²
  LA: { unit: "L", factor: 100 }, // l/100 m²
  CZ: { unit: "L", factor: 1 }, // ml/10 m²
};

function normalizeCode(code: unknown): string {
  return typeof code === "string" ? code.trim().toUpperCase() : "";
}

/** Klartext zu einem BVL-Einheitenkürzel; unbekannte Kürzel bleiben unverändert. */
export function bvlUnitLabel(code: unknown): string {
  const raw = typeof code === "string" ? code.trim() : "";
  return BVL_UNIT_LABELS[normalizeCode(code)] ?? raw;
}

function unitFromLabel(label: string): MediumUnit {
  const lower = label.toLowerCase();
  if (lower.startsWith("ml")) return "ml";
  if (lower.startsWith("kg")) return "kg";
  if (/^g(\W|$)/.test(lower)) return "g";
  return "L";
}

export interface BvlAufwandPerHectare {
  /** Wert für das Feld "Wert (pro ha)" */
  value: number | null;
  unit: MediumUnit;
  /** true, wenn value eine exakte Menge pro Hektar ist */
  exact: boolean;
  /** true, wenn value gegenüber der BVL-Angabe umgerechnet wurde */
  converted: boolean;
}

/**
 * Leitet aus einer BVL-Aufwandmenge Wert und Einheit pro Hektar ab.
 * Angaben, die sich nicht auf Hektar umrechnen lassen (z.B. "je m Kronenhöhe"),
 * behalten ihren Wert; exact ist dann false.
 */
export function bvlAufwandPerHectare(
  value: unknown,
  code: unknown
): BvlAufwandPerHectare {
  const numeric =
    value === null || value === undefined || value === ""
      ? NaN
      : Number(value);
  const amount = Number.isFinite(numeric) ? numeric : null;
  const key = normalizeCode(code);
  const rule = PER_HECTARE[key];

  if (rule) {
    return {
      value:
        amount === null
          ? null
          : Number((amount * rule.factor).toPrecision(10)),
      unit: rule.unit,
      exact: true,
      converted: rule.factor !== 1,
    };
  }

  return {
    value: amount,
    unit: unitFromLabel(bvlUnitLabel(code)),
    exact: !key,
    converted: false,
  };
}
