import { subscribe } from "@scripts/core/eventBus";
import {
  getState,
  subscribeState as subscribeAppState,
  updateSlice,
} from "@scripts/core/state";
import { initCalculation } from "@scripts/features/calculation";
import { initStartup } from "@scripts/features/startup";
import { initDocumentation } from "@scripts/features/documentation";
import { initSettings } from "@scripts/features/settings";
import { initToastContainer } from "@scripts/core/toast";
import type { AppState } from "@scripts/core/state";

/**
 * Switch visible section in the main content area
 * Single source of truth for section visibility
 */
function switchToSection(section: AppState["app"]["activeSection"]): void {
  document
    .querySelectorAll<HTMLElement>(".content-section")
    .forEach((element) => {
      element.style.display = "none";
    });

  const targetSection = document.getElementById(`section-${section}`);
  if (targetSection instanceof HTMLElement) {
    targetSection.style.display = "block";
  }
}

function initIndex(): void {
  // Initialize Toast notification system
  initToastContainer();

  const services = {
    state: {
      getState,
      updateSlice,
      subscribe: subscribeAppState,
    },
    events: {
      emit: (eventName: string, payload?: unknown) => {
        // Import dynamically to avoid circular dependency
        import("@scripts/core/eventBus").then(({ emit }) => {
          emit(eventName as any, payload as any);
        });
      },
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

  const updateBodyBackground = (hasDatabase: boolean) => {
    const bodyEl = document.body;
    if (!bodyEl) return;
    bodyEl.classList.toggle("bg-app", hasDatabase);
    bodyEl.classList.toggle("bg-startup", !hasDatabase);
  };

  const toggleRegions = (state: AppState) => {
    const hasDatabase = Boolean(state.app?.hasDatabase);
    updateBodyBackground(hasDatabase);
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

    // Use single source of truth for section visibility
    if (hasDatabase) {
      const activeSection = state.app?.activeSection ?? "calc";
      switchToSection(activeSection);
    }
  };

  toggleRegions(services.state.getState());

  // Single state subscription handles everything
  subscribeAppState((state, prevState) => {
    // Handle region visibility
    if (state.app?.hasDatabase !== prevState.app?.hasDatabase) {
      toggleRegions(state);
    }
    // Handle section changes
    if (
      state.app?.activeSection !== prevState.app?.activeSection &&
      state.app?.hasDatabase
    ) {
      switchToSection(state.app.activeSection);
    }
  });

  // Event subscription only for side effects (not for UI updates)
  // UI updates should be driven by state changes
  subscribe("app:sectionChanged", () => {
    // Side effects only - UI is handled by state subscription above
    // This event is for other modules to react to section changes
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initIndex, { once: true });
} else {
  initIndex();
}
