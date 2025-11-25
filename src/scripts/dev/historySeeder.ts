import {
  appendHistoryEntry,
  persistSqliteDatabaseFile,
} from "@scripts/core/storage/sqlite";
import { getActiveDriverKey } from "@scripts/core/storage";
import type { emit as EmitEvent } from "@scripts/core/eventBus";
import type { AppState, getState as GetState } from "@scripts/core/state";
import type { CalculationItem } from "@scripts/features/calculation";

const SEED_FLAG_KEY = "__psl_history_seeded";
const DEFAULT_COUNT = 200;

const CROPS = [
  "Salat",
  "Apfel",
  "Wein",
  "Tomate",
  "Kartoffel",
  "Hopfen",
  "Raps",
  "Birne",
];
const USAGE_TYPES = ["Spritzung", "Düngung", "Pflege", "Behandlung"];
const EPPO_CODES = [
  "LACES",
  "MALDO",
  "VITVI",
  "SOLTU",
  "PRNUS",
  "CUPAR",
  "CYNCR",
  "ALLCE",
];
const BBCH_STAGES = [
  "BBCH 10",
  "BBCH 31",
  "BBCH 41",
  "BBCH 55",
  "BBCH 65",
  "BBCH 71",
  "BBCH 81",
];

const MEDIUM_TEMPLATES = [
  {
    mediumId: "seed-water",
    name: "Wasser",
    unit: "L",
    methodId: "perKiste",
    methodLabel: "pro Kiste",
    value: 0.02,
    zulassungsnummer: "N/A",
  },
  {
    mediumId: "seed-tonikum",
    name: "Tonikum X",
    unit: "ml",
    methodId: "perKiste",
    methodLabel: "pro Kiste",
    value: 0.85,
    zulassungsnummer: "Z-123456",
  },
  {
    mediumId: "seed-oel",
    name: "Pflegeöl Y",
    unit: "ml",
    methodId: "percentWater",
    methodLabel: "% vom Wasser",
    value: 0.12,
    zulassungsnummer: "Z-654321",
  },
];

interface Services {
  state: {
    getState: typeof GetState;
    subscribe?: (
      listener: (state: AppState, prevState: AppState) => void
    ) => (() => void) | void;
  };
  events: {
    emit: typeof EmitEvent;
  };
}

interface SeedOptions {
  count?: number;
  setFlag?: boolean;
}

export function registerHistorySeeder(services: Services): void {
  if (typeof window === "undefined") {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const hasSeedFlag = params.has("seedHistory");
  const isDevBuild = !import.meta.env.PROD;

  if (!isDevBuild && !hasSeedFlag) {
    return;
  }

  const globalThisWithPsl = window as typeof window & {
    __PSL?: Record<string, unknown>;
  };

  if (!globalThisWithPsl.__PSL) {
    globalThisWithPsl.__PSL = {};
  }

  const api = globalThisWithPsl.__PSL as Record<string, unknown>;
  api.seedHistoryEntries = (count = DEFAULT_COUNT) =>
    seedHistoryEntries(services, { count });
  api.resetHistorySeedFlag = () => localStorage.removeItem(SEED_FLAG_KEY);

  const shouldAutoSeed =
    !hasSeedFlag &&
    !localStorage.getItem(SEED_FLAG_KEY) &&
    getActiveDriverKey() === "sqlite";

  if (shouldAutoSeed) {
    void seedHistoryEntries(services, {
      count: DEFAULT_COUNT,
      setFlag: true,
    }).catch((error) => {
      console.error("History seeding failed", error);
    });
  }
}

async function waitForSqliteReady(services: Services): Promise<void> {
  if (services.state.getState().app?.hasDatabase) {
    return;
  }
  if (typeof services.state.subscribe !== "function") {
    throw new Error("SQLite-Datenbank ist noch nicht initialisiert.");
  }
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(
        new Error("SQLite-Datenbank wurde nicht rechtzeitig initialisiert.")
      );
    }, 10000);

    const unsubscribe = services.state.subscribe?.((nextState) => {
      if (nextState.app?.hasDatabase) {
        cleanup();
        resolve();
      }
    });

    const cleanup = () => {
      window.clearTimeout(timeout);
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  });
}

async function seedHistoryEntries(
  services: Services,
  options: SeedOptions = {}
): Promise<{ inserted: number; durationMs: number }> {
  const count = options.count ?? DEFAULT_COUNT;
  if (getActiveDriverKey() !== "sqlite") {
    throw new Error(
      "SQLite-Treiber muss aktiv sein, bevor Daten befüllt werden können."
    );
  }

  await waitForSqliteReady(services);

  const start = performance.now();
  let inserted = 0;

  for (let index = 0; index < count; index += 1) {
    const entry = buildSeedEntry(index);
    await appendHistoryEntry(entry);
    inserted += 1;
  }

  try {
    await persistSqliteDatabaseFile();
  } catch (error) {
    console.warn(
      "Seed-Daten konnten nicht persistent gespeichert werden",
      error
    );
  }

  services.events.emit("history:data-changed", { source: "dev-history-seed" });

  if (options.setFlag) {
    localStorage.setItem(SEED_FLAG_KEY, "1");
  }

  return {
    inserted,
    durationMs: performance.now() - start,
  };
}

function buildSeedEntry(index: number) {
  const date = new Date();
  date.setDate(date.getDate() - index);
  const germanDate = date.toLocaleDateString("de-DE");
  const iso = date.toISOString();
  const kisten = 20 + (index % 30);
  const waterVolume = Number((kisten * 0.5).toFixed(2));

  return {
    datum: germanDate,
    dateIso: iso,
    ersteller: `Seeder ${1 + (index % 5)}`,
    standort: `Test-Ort ${String.fromCharCode(65 + (index % 6))}`,
    kultur: CROPS[index % CROPS.length],
    usageType: USAGE_TYPES[index % USAGE_TYPES.length],
    kisten,
    eppoCode: EPPO_CODES[index % EPPO_CODES.length],
    bbch: BBCH_STAGES[index % BBCH_STAGES.length],
    gps: `GPS-Notiz ${index}`,
    gpsCoordinates: {
      latitude: 48.0 + (index % 10) * 0.01,
      longitude: 11.0 + (index % 10) * 0.01,
    },
    gpsPointId: `seed-gps-${index}`,
    invekos: `INV-${String(1000 + index).padStart(4, "0")}`,
    uhrzeit: `${String(6 + (index % 12)).padStart(2, "0")}:${String((index * 7) % 60).padStart(2, "0")}`,
    savedAt: iso,
    items: buildSeedItems(index, kisten, waterVolume),
  };
}

function buildSeedItems(
  index: number,
  kisten: number,
  waterVolume: number
): CalculationItem[] {
  return MEDIUM_TEMPLATES.map((template, itemIdx) => {
    const variance = 1 + ((index + itemIdx) % 4) * 0.05;
    const value = Number((template.value * variance).toFixed(4));
    const total = Number((value * kisten).toFixed(2));
    return {
      id: `seed-item-${index}-${itemIdx}`,
      name: template.name,
      unit: template.unit,
      methodLabel: template.methodLabel,
      methodId: template.methodId,
      value,
      total,
      inputs: {
        kisten,
        waterVolume,
      },
      zulassungsnummer: template.zulassungsnummer,
      mediumId: template.mediumId,
    } as CalculationItem & { mediumId: string };
  });
}
