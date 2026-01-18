import { loadDefaultsConfig } from "./config";
import { detectPreferredDriver, setActiveDriver } from "./storage/index";
import { getState, patchState, subscribeState, updateSlice } from "./state";
import { emit, subscribe as subscribeEvent } from "./eventBus";
import { registerHistorySeeder } from "../dev/historySeeder";
import {
  shouldEnableDebugOverlay,
  markManualDebugOverlayAccess,
} from "../dev/debugOverlayGate";
import { initQsMode } from "./qsMode";
import { initInfos } from "../features/infos/infosClient";
import { initToastContainer } from "./toast";
import { initPwa, storeFileHandle, saveDbState } from "./pwa";

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
    event.returnValue =
      "Die Verbindung zur Datenbank wird getrennt. Ungespeicherte Änderungen können verloren gehen.";
    return event.returnValue;
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
  const regions = getRegions();

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

  const overlayToggle = document.querySelector<HTMLButtonElement>(
    "[data-action='debug-overlay-toggle']"
  );

  const markToggleActive = () => {
    if (!overlayToggle) {
      return;
    }
    overlayToggle.dataset.active = "true";
    overlayToggle.setAttribute("aria-pressed", "true");
  };

  let debugOverlayInit: Promise<void> | null = null;
  const loadDebugOverlay = (reason?: "manual") => {
    if (reason === "manual") {
      markManualDebugOverlayAccess();
    }
    if (!debugOverlayInit) {
      debugOverlayInit = import("../dev/debugOverlay")
        .then(({ initDebugOverlay }) => {
          initDebugOverlay(services);
          markToggleActive();
        })
        .catch((error) => {
          debugOverlayInit = null;
          console.error("Debug-Overlay konnte nicht geladen werden", error);
        });
    } else if (reason === "manual") {
      markToggleActive();
    }
    return debugOverlayInit;
  };

  if (shouldEnableDebugOverlay()) {
    void loadDebugOverlay();
  }

  overlayToggle?.addEventListener("click", () => {
    overlayToggle.dataset.active = "loading";
    overlayToggle.disabled = true;
    void loadDebugOverlay("manual").finally(() => {
      overlayToggle.disabled = false;
      markToggleActive();
    });
  });

  // Initialize Toast notification system
  initToastContainer();

  // Infos-Feature initialisieren
  const infosContainer = document.querySelector('[data-feature="infos"]');
  if (infosContainer instanceof HTMLElement) {
    initInfos(services);
  }

  setupUnloadWarning(services.state);

  // PWA initialisieren mit Auto-Start Unterstützung
  void initPwa({
    onFileOpened: async (handle) => {
      // Dynamisch das Storage-Modul laden und Datei öffnen
      const storage = await import("./storage/index");
      const sqlite = await import("./storage/sqlite");
      
      if (sqlite.isSupported()) {
        storage.setActiveDriver("sqlite");
        
        // Datei über das Handle öffnen
        const file = await handle.getFile();
        const arrayBuffer = await file.arrayBuffer();
        
        // Worker initialisieren und Datei importieren
        const result = await sqlite.importFromArrayBuffer(arrayBuffer, file.name);
        
        // FileHandle speichern für Auto-Start
        await storeFileHandle(handle);
        
        // Datenbank verbinden
        const { applyDatabase } = await import("./database");
        applyDatabase(result.data);
        
        emit("database:connected", {
          driver: "sqlite",
          autoStarted: true
        });
      }
    }
  });
  
  // Bei erfolgreicher Datenbank-Verbindung: State für Auto-Start speichern
  subscribeEvent("database:connected", async (event) => {
    await saveDbState({
      hasDatabase: true,
      lastAccess: new Date().toISOString(),
      autoStartEnabled: true
    });
  });

  patchState({
    app: {
      ...getState().app,
      ready: true,
    },
  });
}
