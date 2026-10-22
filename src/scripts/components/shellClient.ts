import {
  type AppState,
  getState,
  subscribeState,
  updateSlice,
} from "@scripts/core/state";
import { emit } from "@scripts/core/eventBus";

function initOfflineIndicator(): void {
  const indicator = document.getElementById("offline-indicator");
  if (!indicator) return;

  const updateStatus = () => {
    const isOffline = !navigator.onLine;
    indicator.classList.toggle("d-none", !isOffline);
  };

  updateStatus();
  window.addEventListener("online", updateStatus);
  window.addEventListener("offline", updateStatus);
}

function initShell(): void {
  const buttons = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".nav-btn"),
  );

  // Initialize offline indicator
  initOfflineIndicator();

  buttons.forEach((button) => {
    button.addEventListener("click", (event) => {
      const target = event.currentTarget;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const section = target.dataset.section as
        | AppState["app"]["activeSection"]
        | undefined;
      if (!section) {
        return;
      }

      updateSlice("app", (app) => ({ ...app, activeSection: section }));

      buttons.forEach((btn) => btn.classList.remove("active"));
      button.classList.add("active");

      emit("app:sectionChanged", section);
    });
  });

  // Performance: DOM-Referenzen einmal auflösen statt bei jedem State-Update
  const brandTitle = document.getElementById("brand-title");
  const brandTagline = document.getElementById("brand-tagline");

  const syncShell = (state: AppState) => {
    if (brandTitle && state.company.name) {
      brandTitle.textContent = state.company.name;
    }
    if (brandTagline && state.company.headline) {
      brandTagline.textContent = state.company.headline;
    }

    const hasDatabase = state.app.hasDatabase;
    buttons.forEach((btn) => {
      const section = btn.getAttribute("data-section");
      btn.disabled = !hasDatabase;
      btn.classList.toggle(
        "active",
        hasDatabase && section === state.app.activeSection,
      );
    });
  };

  // Nur reagieren, wenn sich die für die Shell relevanten Slices geändert haben
  subscribeState((state, prevState) => {
    if (state.company !== prevState.company || state.app !== prevState.app) {
      syncShell(state);
    }
  });
  syncShell(getState());

  let isPrinting = false;
  const activeDocumentTitle = document.title || "Pflanzenschutz";

  window.addEventListener("beforeprint", () => {
    if (isPrinting) return;
    isPrinting = true;
    document.title = " ";
  });

  window.addEventListener("afterprint", () => {
    if (!isPrinting) return;
    isPrinting = false;
    document.title = activeDocumentTitle;
  });
}

function bootstrapShell(): void {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initShell, { once: true });
  } else {
    initShell();
  }
}

bootstrapShell();
