import {
  createDatabase,
  detectPreferredDriver,
  getActiveDriverKey,
  openDatabase,
  setActiveDriver,
} from "@scripts/core/storage";
import { applyDatabase, createInitialDatabase } from "@scripts/core/database";
import { getState, subscribeState } from "@scripts/core/state";
import { escapeHtml } from "@scripts/core/utils";
import type { emit as emitEvent } from "@scripts/core/eventBus";

interface Services {
  state: {
    getState: typeof getState;
    subscribe: typeof subscribeState;
  };
  events: {
    emit: typeof emitEvent;
  };
}

type StartupView = "landing" | "wizard";
type CompanyState = ReturnType<typeof getState>["company"];

const DOWNLOAD_FILENAME_FALLBACK = "pflanzenschutz-datenbank.json";

let initialized = false;

function sanitizeFilename(name: string): string {
  if (!name) {
    return DOWNLOAD_FILENAME_FALLBACK;
  }
  const slug = name
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "pflanzenschutz-datenbank"}.json`;
}

async function withButtonBusy(
  button: HTMLButtonElement | null,
  task: () => Promise<void>
): Promise<void> {
  if (!button) {
    await task();
    return;
  }
  const originalText = button.textContent ?? "";
  button.disabled = true;
  button.dataset.busy = "true";
  button.textContent = "Bitte warten...";
  try {
    await task();
  } finally {
    button.disabled = false;
    button.dataset.busy = "false";
    button.textContent = originalText;
  }
}

function escapeAttr(value: unknown): string {
  return escapeHtml(value);
}

type WizardElements = {
  section: HTMLElement;
  form: HTMLFormElement;
  resultCard: HTMLElement;
  preview: HTMLElement;
  filenameLabel: HTMLElement;
  saveHint: HTMLElement | null;
  saveButton: HTMLButtonElement | null;
  reset: () => void;
};

function createWizard(baseCompany: CompanyState): WizardElements {
  const section = document.createElement("section");
  section.className = "section-container d-none";

  // Farbige Labels für bessere Orientierung
  const inputStyle =
    "background: #252525; border-color: #404040; color: #e8e8e8;";

  section.innerHTML = `
    <div class="section-inner">
      <div class="card" style="background: #1a1a1a; border: 1px solid #333;">
        <div class="card-body p-4">
          <div class="d-flex justify-content-between align-items-center mb-4">
            <h2 style="color: #58d68d; margin: 0;">Neue Datenbank</h2>
            <button type="button" class="btn btn-outline-secondary" data-action="wizard-back">
              <i class="bi bi-arrow-left me-1"></i>Zurück
            </button>
          </div>
          <form id="database-wizard-form" class="text-start">
            <div class="row mb-4">
              <div class="col-md-6 mb-3 mb-md-0">
                <label class="form-label d-block mb-2" style="color: #5dade2; font-size: 1rem; font-weight: 600;" for="wizard-company-name">Firmenname *</label>
                <input class="form-control" style="${inputStyle}" id="wizard-company-name" name="wizard-company-name" required value="${escapeAttr(baseCompany.name)}" />
              </div>
              <div class="col-md-6">
                <label class="form-label d-block mb-2" style="color: #f4d03f; font-size: 1rem; font-weight: 600;" for="wizard-company-headline">Überschrift</label>
                <input class="form-control" style="${inputStyle}" id="wizard-company-headline" name="wizard-company-headline" value="${escapeAttr(baseCompany.headline)}" />
              </div>
            </div>
            <div class="row mb-4">
              <div class="col-12">
                <label class="form-label d-block mb-2" style="color: #58d68d; font-size: 1rem; font-weight: 600;" for="wizard-company-address">Adresse</label>
                <textarea class="form-control" style="${inputStyle}" id="wizard-company-address" name="wizard-company-address" rows="2">${escapeHtml(baseCompany.address)}</textarea>
              </div>
            </div>
            <div class="d-flex gap-3">
              <button type="submit" class="btn btn-lg px-4" style="background: #3d8b40; border-color: #3d8b40; color: white;">
                <i class="bi bi-database-add me-2"></i>Erstellen
              </button>
              <button type="button" class="btn btn-outline-secondary px-4" data-action="wizard-back">Abbrechen</button>
            </div>
          </form>
        </div>
      </div>
      <div class="card mt-4 d-none" style="background: #1a1a1a; border: 1px solid #333;" data-role="wizard-result">
        <div class="card-body p-4">
          <h3 style="color: #58d68d;" class="mb-3">Datenbank erstellt</h3>
          <p class="mb-2" style="color: #a0a0a0;">Dateiname: <code style="color: #5dade2;" data-role="wizard-filename"></code></p>
          <div class="d-flex gap-2 mb-3">
            <button type="button" class="btn px-4" style="background: #3d8b40; border-color: #3d8b40; color: white;" data-action="wizard-save">
              <i class="bi bi-download me-2"></i>Speichern
            </button>
          </div>
          <p class="small mb-2" style="color: #707070;" data-role="wizard-save-hint"></p>
          <details>
            <summary style="color: #707070; cursor: pointer;" class="small mb-2">Vorschau anzeigen</summary>
            <pre class="rounded p-3 small overflow-auto mt-2" style="background: #252525; max-height: 14rem; color: #a0a0a0;" data-role="wizard-preview"></pre>
          </details>
        </div>
      </div>
    </div>
  `;

  const form = section.querySelector<HTMLFormElement>("#database-wizard-form");
  if (!form) {
    throw new Error("Wizard-Formular konnte nicht erzeugt werden");
  }
  const resultCard = section.querySelector<HTMLElement>(
    '[data-role="wizard-result"]'
  );
  if (!resultCard) {
    throw new Error("Wizard-Resultat-Container fehlt");
  }

  return {
    section,
    form,
    resultCard,
    preview: section.querySelector<HTMLElement>(
      '[data-role="wizard-preview"]'
    )!,
    filenameLabel: section.querySelector<HTMLElement>(
      '[data-role="wizard-filename"]'
    )!,
    saveHint: section.querySelector<HTMLElement>(
      '[data-role="wizard-save-hint"]'
    ),
    saveButton: section.querySelector<HTMLButtonElement>(
      '[data-action="wizard-save"]'
    ),
    reset() {
      form.reset();
      resultCard.classList.add("d-none");
      const preview = section.querySelector<HTMLElement>(
        '[data-role="wizard-preview"]'
      );
      if (preview) {
        preview.textContent = "";
      }
      const filenameLabel = section.querySelector<HTMLElement>(
        '[data-role="wizard-filename"]'
      );
      if (filenameLabel) {
        filenameLabel.textContent = "";
      }
    },
  };
}

export function initStartup(
  container: Element | null,
  services: Services
): void {
  if (!container || initialized) {
    return;
  }

  const host = container as HTMLElement;
  let generatedDatabase: any = null;
  let generatedFilename = DOWNLOAD_FILENAME_FALLBACK;
  let activeView: StartupView = "landing";

  const stateSnapshot = services.state.getState();
  const baseCompany = stateSnapshot.company;

  const landingSection = document.createElement("section");
  landingSection.className = "section-container";

  landingSection.innerHTML = `
    <div class="section-inner">
      <div class="card" style="background: #1a1a1a; border: 1px solid #333; position: relative;">
        <div class="card-body text-center py-5">
          <!-- Neue Datenbank Button oben rechts (selten gebraucht) -->
          <div style="position: absolute; top: 1rem; right: 1rem;">
            <button class="btn btn-sm btn-outline-secondary" data-action="start-wizard">
              <i class="bi bi-plus-circle me-1"></i>Neu erstellen
            </button>
          </div>
          
          <h2 class="mb-3" style="color: #58d68d; font-size: 1.75rem;">Datenbank öffnen</h2>
          <p class="mb-4" style="color: #a0a0a0;">
            Wähle deine bestehende Datei
          </p>
          
          <!-- Hauptaktion: Datei öffnen (zentral, groß, grün) -->
          <button class="btn btn-lg px-5 py-3" style="background: #3d8b40; border-color: #3d8b40; color: white; font-size: 1.1rem;" data-action="open">
            <i class="bi bi-folder2-open me-2"></i>Datei öffnen
          </button>
        </div>
      </div>
    </div>
  `;

  const wizard = createWizard(baseCompany);

  host.innerHTML = "";
  host.appendChild(landingSection);
  host.appendChild(wizard.section);

  const fileSystemSupported =
    typeof window !== "undefined" &&
    typeof (
      window as typeof window & {
        showSaveFilePicker?: (...args: unknown[]) => Promise<unknown>;
      }
    ).showSaveFilePicker === "function";
  if (wizard.saveButton) {
    if (!fileSystemSupported) {
      wizard.saveButton.disabled = true;
      wizard.saveButton.textContent = "Datei speichern (nicht verfügbar)";
      if (wizard.saveHint) {
        wizard.saveHint.textContent =
          "Dieser Browser unterstützt keinen direkten Dateidialog. Bitte nutze einen Chromium-basierten Browser (z. B. Chrome, Edge) über HTTPS oder http://localhost.";
      }
    } else if (wizard.saveHint) {
      wizard.saveHint.textContent =
        'Der Browser fragt nach einem Speicherort. Die erzeugte Datei kannst du später über "Bestehende Datei verbinden" erneut laden.';
    }
  }

  function updateRegionVisibility(state = services.state.getState()): void {
    const hasDatabase = Boolean(state.app?.hasDatabase);
    host.classList.toggle("d-none", hasDatabase);
    if (hasDatabase) {
      landingSection.classList.add("d-none");
      wizard.section.classList.add("d-none");
      return;
    }
    if (activeView === "wizard") {
      landingSection.classList.add("d-none");
      wizard.section.classList.remove("d-none");
    } else {
      landingSection.classList.remove("d-none");
      wizard.section.classList.add("d-none");
    }
  }

  async function handleOpen(button: HTMLButtonElement | null): Promise<void> {
    await withButtonBusy(button, async () => {
      try {
        const preferred = getActiveDriverKey();
        if (preferred === "sqlite" || preferred === "filesystem") {
          setActiveDriver(preferred);
        } else {
          setActiveDriver("filesystem");
        }
      } catch (err) {
        window.alert(
          "Dateisystemzugriff wird nicht unterstützt in diesem Browser."
        );
        throw err instanceof Error
          ? err
          : new Error("Dateisystem nicht verfügbar");
      }

      try {
        const result = await openDatabase();
        applyDatabase(result.data);
        services.events.emit("database:connected", {
          driver: getActiveDriverKey(),
        });
      } catch (err) {
        console.error("Fehler beim Öffnen der Datenbank", err);
        window.alert(
          err instanceof Error
            ? err.message
            : "Öffnen der Datenbank fehlgeschlagen"
        );
      }
    });
  }

  function handleUseDefaults(button: HTMLButtonElement | null): void {
    void withButtonBusy(button, async () => {
      const initialData = createInitialDatabase();
      const driverOrder = ["localstorage", "sqlite", "memory"] as const;
      for (const preferred of driverOrder) {
        try {
          setActiveDriver(preferred);
          const result = await createDatabase(initialData);
          applyDatabase(result.data);
          services.events.emit("database:connected", {
            driver: getActiveDriverKey() || preferred,
          });
          return;
        } catch (err) {
          console.warn(
            `Treiber ${preferred} konnte nicht initialisiert werden`,
            err
          );
        }
      }
      const message =
        "Keine geeignete Speicheroption verfügbar. Bitte Browserberechtigungen prüfen.";
      console.error(message);
      window.alert(message);
    });
  }

  async function handleWizardSave(
    button: HTMLButtonElement | null
  ): Promise<void> {
    if (!generatedDatabase) {
      window.alert("Bitte erst die Datenbank erzeugen.");
      return;
    }
    await withButtonBusy(button, async () => {
      try {
        const preferred = getActiveDriverKey();
        if (preferred === "sqlite" || preferred === "filesystem") {
          setActiveDriver(preferred);
        } else {
          setActiveDriver("filesystem");
        }
      } catch (err) {
        window.alert(
          "Dateisystemzugriff wird nicht unterstützt in diesem Browser."
        );
        throw err instanceof Error
          ? err
          : new Error("Dateisystem nicht verfügbar");
      }

      try {
        const result = await createDatabase(generatedDatabase);
        applyDatabase(result.data);
        services.events.emit("database:connected", {
          driver: getActiveDriverKey(),
        });
      } catch (err) {
        console.error("Fehler beim Speichern der Datenbank", err);
        window.alert(
          err instanceof Error
            ? err.message
            : "Die Datei konnte nicht gespeichert werden"
        );
      }
    });
  }

  function handleWizardSubmit(event: SubmitEvent): void {
    event.preventDefault();
    const formData = new FormData(wizard.form);
    const name = (formData.get("wizard-company-name") || "").toString().trim();
    if (!name) {
      window.alert("Bitte einen Firmennamen angeben.");
      return;
    }

    const headline = (formData.get("wizard-company-headline") || "")
      .toString()
      .trim();
    const address = (formData.get("wizard-company-address") || "")
      .toString()
      .trim();

    const overrides = {
      meta: {
        company: {
          name,
          headline,
          logoUrl: "",
          contactEmail: "",
          address,
        },
      },
    };

    generatedDatabase = createInitialDatabase(overrides);
    generatedFilename = sanitizeFilename(name);

    wizard.preview.textContent = JSON.stringify(generatedDatabase, null, 2);
    wizard.filenameLabel.textContent = generatedFilename;
    wizard.resultCard.classList.remove("d-none");
    wizard.resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function showLanding(): void {
    activeView = "landing";
    generatedDatabase = null;
    generatedFilename = DOWNLOAD_FILENAME_FALLBACK;
    wizard.reset();
    updateRegionVisibility();
  }

  function showWizard(): void {
    activeView = "wizard";
    updateRegionVisibility();
  }

  landingSection.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement | null)?.closest(
      "button[data-action]"
    ) as HTMLButtonElement | null;
    if (!button) {
      return;
    }
    const action = button.dataset.action;
    if (action === "start-wizard") {
      showWizard();
      return;
    }
    if (action === "open") {
      void handleOpen(button);
    } else if (action === "useDefaults") {
      handleUseDefaults(button);
    }
  });

  wizard.form.addEventListener("submit", handleWizardSubmit);

  wizard.section.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement | null)?.closest(
      "[data-action]"
    ) as HTMLButtonElement | null;
    if (!button) {
      return;
    }
    const action = button.dataset.action;
    if (action === "wizard-back") {
      showLanding();
      return;
    }
    if (action === "wizard-save") {
      void handleWizardSave(button);
    }
  });

  services.state.subscribe((nextState) => updateRegionVisibility(nextState));
  updateRegionVisibility(services.state.getState());

  if (!services.state.getState().app.hasDatabase) {
    const preferred = detectPreferredDriver();
    if (preferred && preferred !== getActiveDriverKey()) {
      try {
        setActiveDriver(preferred);
      } catch (err) {
        console.warn("Bevorzugter Speicher konnte nicht gesetzt werden", err);
      }
    }
  }

  initialized = true;
}
