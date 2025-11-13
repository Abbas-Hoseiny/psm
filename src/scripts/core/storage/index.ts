import * as fileSystemDriver from "./fileSystem";
import * as fallbackDriver from "./fallback";
import * as sqliteDriver from "./sqlite";
import { getState, patchState } from "../state";

type DriverKey = "sqlite" | "filesystem" | "localstorage" | "memory";

interface StorageDriver {
  isSupported: () => boolean;
  create: (
    initialData: any,
    suggestedName?: string
  ) => Promise<{ data: any; context: any }>;
  open: () => Promise<{ data: any; context: any }>;
  save: (data: any) => Promise<{ context: any }>;
  getContext?: () => any;
  reset?: () => void;
}

const DRIVERS: Record<string, StorageDriver> = {
  sqlite: sqliteDriver,
  filesystem: fileSystemDriver,
  localstorage: fallbackDriver,
};

export function detectPreferredDriver(): DriverKey {
  if (sqliteDriver.isSupported()) {
    return "sqlite";
  }
  if (fileSystemDriver.isSupported()) {
    return "filesystem";
  }
  if (fallbackDriver.isSupported()) {
    return "localstorage";
  }
  return "memory";
}

let activeDriverKey: DriverKey = detectPreferredDriver();

export function setActiveDriver(driverKey: DriverKey): void {
  if (driverKey !== "memory" && !DRIVERS[driverKey]) {
    throw new Error(`Unbekannter Storage-Treiber: ${driverKey}`);
  }
  activeDriverKey = driverKey;
  patchState({
    app: {
      ...getState().app,
      storageDriver: driverKey,
      hasFileAccess: driverKey === "filesystem",
    },
  });
}

export function getActiveDriverKey(): DriverKey {
  return activeDriverKey;
}

export function getDriver(): StorageDriver | null {
  return DRIVERS[activeDriverKey] || null;
}

export async function createDatabase(
  initialData: any
): Promise<{ data: any; context: any }> {
  const driver = getDriver();
  if (!driver) {
    throw new Error("Kein verfügbarer Speicher-Treiber");
  }
  return driver.create(initialData);
}

export async function openDatabase(): Promise<{ data: any; context: any }> {
  const driver = getDriver();
  if (!driver) {
    throw new Error("Kein verfügbarer Speicher-Treiber");
  }
  return driver.open();
}

export async function saveDatabase(data: any): Promise<{ context: any }> {
  const driver = getDriver();
  if (!driver) {
    throw new Error("Kein verfügbarer Speicher-Treiber");
  }
  return driver.save(data);
}

export function resetDriverContext(): void {
  const driver = getDriver();
  if (driver && typeof driver.reset === "function") {
    driver.reset();
  }
}

export async function loadTemplateRevisionDocument(
  templateId: string,
  version: number
): Promise<any | null> {
  if (!templateId || !Number.isFinite(version)) {
    return null;
  }

  if (
    activeDriverKey === "sqlite" &&
    typeof (sqliteDriver as any).getTemplateRevisionDocument === "function"
  ) {
    return sqliteDriver.getTemplateRevisionDocument(templateId, version);
  }

  const state = getState();
  const templates = Array.isArray(state.templates) ? state.templates : [];
  const targetVersion = Math.trunc(Number(version));
  if (!Number.isFinite(targetVersion)) {
    return null;
  }

  const template = templates.find((entry) => entry && entry.id === templateId);
  if (!template || !Array.isArray(template.revisions)) {
    return null;
  }

  const revision = template.revisions.find((entry) => {
    if (!entry || !Number.isFinite(entry.version)) {
      return false;
    }
    return Math.trunc(entry.version) === targetVersion;
  });

  if (!revision) {
    return null;
  }

  if ("snapshot" in revision) {
    const snapshot = revision.snapshot;
    if (snapshot === null) {
      return null;
    }
    if (snapshot !== undefined) {
      return snapshot;
    }
  }

  const document = (revision as any).document;
  if (document && typeof document === "object") {
    return document;
  }

  const rawJson =
    (revision as any).documentJson ?? (revision as any).documentJSON;
  if (typeof rawJson === "string" && rawJson.trim()) {
    try {
      return JSON.parse(rawJson);
    } catch (error) {
      console.warn(
        "Konnte Revisions-Dokument nicht parsen",
        templateId,
        targetVersion,
        error
      );
    }
  }

  return null;
}
