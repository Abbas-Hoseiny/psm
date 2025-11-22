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
