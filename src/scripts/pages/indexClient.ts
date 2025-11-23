import { emit, subscribe } from "@scripts/core/eventBus";
import {
  getState,
  subscribeState as subscribeAppState,
  updateSlice,
} from "@scripts/core/state";
import { initCalculation } from "@scripts/features/calculation";
import { initStartup } from "@scripts/features/startup";
import { initDocumentation } from "@scripts/features/documentation";
import { initSettings } from "@scripts/features/settings";
import { initZulassung } from "@scripts/features/zulassung";
import { initLookup } from "@scripts/features/lookup";
import { initGps } from "@scripts/features/gps";
import type { AppState } from "@scripts/core/state";

function initIndex(): void {
  const services = {
    state: {
      getState,
      updateSlice,
      subscribe: subscribeAppState,
    },
    events: {
      emit,
      subscribe,
    },
  };

  const startupRegion = document.querySelector('[data-region="startup"]');
  const shellRegion = document.querySelector('[data-region="shell"]');
  const mainRegion = document.querySelector('[data-region="main"]');
  const footerRegion = document.querySelector('[data-region="footer"]');

  initStartup(startupRegion, services);
  const calcContainer = document.querySelector('[data-feature="calculation"]');
  initCalculation(calcContainer, services);
  const documentationContainer = document.querySelector(
    '[data-feature="documentation"]'
  );
  initDocumentation(documentationContainer, services);
  const settingsContainer = document.querySelector('[data-feature="settings"]');
  initSettings(settingsContainer, services);
  const zulassungContainer = document.querySelector(
    '[data-feature="zulassung"]'
  );
  initZulassung(zulassungContainer, services);
  const lookupContainer = document.querySelector('[data-feature="lookup"]');
  initLookup(lookupContainer, services);
  const gpsContainer = document.querySelector('[data-feature="gps"]');
  initGps(gpsContainer, services);

  const toggleRegions = (state: AppState) => {
    const hasDatabase = Boolean(state.app?.hasDatabase);
    if (startupRegion instanceof HTMLElement) {
      startupRegion.classList.toggle("d-none", hasDatabase);
    }
    if (shellRegion instanceof HTMLElement) {
      shellRegion.classList.toggle("d-none", !hasDatabase);
    }
    if (mainRegion instanceof HTMLElement) {
      mainRegion.classList.toggle("d-none", !hasDatabase);
    }
    if (footerRegion instanceof HTMLElement) {
      footerRegion.classList.toggle("d-none", !hasDatabase);
    }

    if (hasDatabase) {
      const activeSection = state.app?.activeSection ?? "calc";
      document
        .querySelectorAll<HTMLElement>(".content-section")
        .forEach((element) => {
          element.style.display = "none";
        });
      const target = document.getElementById(`section-${activeSection}`);
      if (target instanceof HTMLElement) {
        target.style.display = "block";
      }
    }
  };

  toggleRegions(services.state.getState());
  subscribeAppState(toggleRegions);

  subscribe("app:sectionChanged", (section) => {
    document
      .querySelectorAll<HTMLElement>(".content-section")
      .forEach((element) => {
        element.style.display = "none";
      });

    const targetSection = document.getElementById(`section-${section}`);
    if (targetSection instanceof HTMLElement) {
      targetSection.style.display = "block";
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initIndex, { once: true });
} else {
  initIndex();
}
