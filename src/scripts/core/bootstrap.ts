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

function setupUnloadWarning(stateService: any): void {
  const handler = (event: BeforeUnloadEvent) => {
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

  patchState({
    app: {
      ...getState().app,
      ready: true,
    },
  });
}
