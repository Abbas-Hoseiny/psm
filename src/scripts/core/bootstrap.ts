import { loadDefaultsConfig } from "./config";
import {
  detectPreferredDriver,
  setActiveDriver,
  getActiveDriverKey,
} from "./storage/index";
import { loadGpsPoints } from "./database";
import { getState, patchState, subscribeState, updateSlice } from "./state";
import { emit, subscribe as subscribeEvent } from "./eventBus";
import { registerHistorySeeder } from "../dev/historySeeder";
import { initQsMode } from "./qsMode";
import { initPwa, storeFileHandle, saveDbState } from "./pwa";
import { applyDatabase } from "./database";
import * as sqlite from "./storage/sqlite";
// Flag to temporarily skip beforeunload warning for external links
let skipBeforeUnloadOnce = false;

function setupUnloadWarning(stateService: any): void {
  const handler = (event: BeforeUnloadEvent) => {
    // Skip warning if an external link was just clicked
    if (skipBeforeUnloadOnce) {
      skipBeforeUnloadOnce = false;
      return;
    }
    event.preventDefault();
    // Legacy-Unterstützung für ältere Browser (Chrome < 51, Firefox < 44)
    event.returnValue = "";
    return "";
  };
  let active = false;
  const update = (state: any) => {
    const shouldWarn = Boolean(state.app?.hasDatabase);
    if (shouldWarn && !active) {
      window.addEventListener("beforeunload", handler);
      active = true;
    } else if (!shouldWarn && active) {
      window.removeEventListener("beforeunload", handler);
      active = false;
    }
  };
  update(stateService.getState());
  stateService.subscribe(update);

  // Listen for clicks on external links to skip beforeunload warning
  document.addEventListener("click", (e) => {
    const link = (e.target as HTMLElement).closest("a");
    if (link && link.target === "_blank") {
      skipBeforeUnloadOnce = true;
      // Reset flag after a short delay in case navigation didn't happen
      setTimeout(() => {
        skipBeforeUnloadOnce = false;
      }, 100);
    }
  });
}

function getRegions() {
  const root = document.getElementById("app-root");
  if (!root) {
    throw new Error("app-root Container fehlt");
  }
  return {
    startup: root.querySelector('[data-region="startup"]'),
    shell: root.querySelector('[data-region="shell"]'),
    main: root.querySelector('[data-region="main"]'),
    footer: root.querySelector('[data-region="footer"]'),
  };
}

export async function bootstrap() {
  // Regions für zukünftige Feature-Initialisierung
  const _regions = getRegions();

  // QS-Modus initialisieren (prüft URL-Parameter)
  initQsMode();

  const driverKey = detectPreferredDriver();
  if (driverKey !== "memory") {
    setActiveDriver(driverKey);
  }

  await loadDefaultsConfig();

  const services = {
    state: {
      getState,
      patchState,
      updateSlice,
      subscribe: subscribeState,
    },
    events: {
      emit,
      subscribe: subscribeEvent,
    },
  };

  // Feature initialization - to be implemented in Astro components
  registerHistorySeeder(services);

  // Toast-Container wird in indexClient.ts initialisiert (einmalig).

  setupUnloadWarning(services.state);

  // PWA initialisieren mit Auto-Start Unterstützung
  void initPwa({
    onFileOpened: async (handle) => {
      if (sqlite.isSupported()) {
        setActiveDriver("sqlite");

        // Datei über das Handle öffnen
        const file = await handle.getFile();
        const arrayBuffer = await file.arrayBuffer();

        // Worker initialisieren und Datei importieren
        const result = await sqlite.importFromArrayBuffer(
          arrayBuffer,
          file.name,
        );

        // FileHandle für spätere Persistierung setzen und für Auto-Start speichern
        sqlite.setFileHandle(handle);
        await storeFileHandle(handle);

        // Datenbank verbinden
        applyDatabase(result.data);

        emit("database:connected", {
          driver: "sqlite",
          autoStarted: true,
        });
      }
    },
  });

  // Bei erfolgreicher Datenbank-Verbindung: State für Auto-Start speichern
  subscribeEvent("database:connected", async (_event) => {
    await saveDbState({
      hasDatabase: true,
      lastAccess: new Date().toISOString(),
      autoStartEnabled: true,
    });
  });

  // GPS-Punkte liegen in einer eigenen SQLite-Tabelle und sind NICHT Teil des
  // Startup-Snapshots. Ohne dies würden sie erst geladen, wenn der Nutzer den
  // GPS-Tab in den Einstellungen öffnet – dadurch blieb das Dropdown
  // "Gespeicherten Punkt verknüpfen" in "Neu erfassen" beim ersten Öffnen leer.
  // Daher hier sofort eager laden, sobald eine SQLite-Datenbank verbunden ist.
  subscribeEvent("database:connected", async (_event) => {
    if (getActiveDriverKey() !== "sqlite") {
      return;
    }
    try {
      await loadGpsPoints();
    } catch (err) {
      console.warn("GPS-Punkte konnten beim Start nicht geladen werden", err);
    }
  });

  patchState({
    app: {
      ...getState().app,
      ready: true,
    },
  });
}
