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
import { toast } from "@scripts/core/toast";
import { mountHitCounter, HITS_STATS_URL } from "@scripts/core/viewCounter";
import type { emit as emitEvent } from "@scripts/core/eventBus";
import {
  isStandalone,
  isInstallAvailable,
  promptInstall,
  getStoredFileHandle,
  requestFileHandlePermission,
  storeFileHandle,
  clearStoredFileHandle,
  getDbState,
  setAutoStart,
  getPwaCapabilities,
  getInstallStatus,
  getInstallStatusAsync,
  markAsInstalled,
  checkIfInstalled,
} from "@scripts/core/pwa";
import * as sqlite from "@scripts/core/storage/sqlite";

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

// Der Dateidialog schlägt genau den im Assistenten angezeigten Namen vor;
// die Endung richtet sich nach dem aktiven Speicher-Treiber.
function filenameExtension(): string {
  return getActiveDriverKey() === "sqlite" ? "sqlite" : "json";
}

function sanitizeFilename(name: string): string {
  if (!name) {
    return `pflanzenschutz-datenbank.${filenameExtension()}`;
  }
  const slug = name
    .toString()
    .toLowerCase()
    .trim()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "pflanzenschutz-datenbank"}.${filenameExtension()}`;
}

async function withButtonBusy(
  button: HTMLButtonElement | null,
  task: () => Promise<void>,
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

  section.innerHTML = `
    <div class="section-inner">
      <div class="card startup-card">
        <div class="card-body p-4">
          <div class="d-flex justify-content-between align-items-center mb-4">
            <h2 class="mb-0" style="color: var(--color-primary);">Neue Datenbank</h2>
            <button type="button" class="btn btn-psm-secondary-outline" data-action="wizard-back">
              <i class="bi bi-arrow-left me-1"></i>Zurück
            </button>
          </div>
          <p class="text-muted mb-4">Diese Angaben erscheinen in der Kopfzeile der App und auf Ausdrucken. Nur der Firmenname ist Pflicht.</p>
          <form id="database-wizard-form" class="text-start">
            <div class="row mb-4">
              <div class="col-md-6 mb-3 mb-md-0">
                <label class="form-label d-block mb-2" for="wizard-company-name">
                  Firmenname <span class="text-danger">*</span>
                </label>
                <input class="form-control" id="wizard-company-name" name="wizard-company-name" required autocomplete="organization" value="${escapeAttr(
                  baseCompany.name,
                )}" placeholder="z. B. Gärtnerei Muster GmbH" />
              </div>
              <div class="col-md-6">
                <label class="form-label d-block mb-2" for="wizard-company-headline">
                  Überschrift <span class="text-muted small">(optional)</span>
                </label>
                <input class="form-control" id="wizard-company-headline" name="wizard-company-headline" value="${escapeAttr(
                  baseCompany.headline,
                )}" placeholder="z. B. Pflanzenschutz-Dokumentation" />
                <div class="form-text">Untertitel unter dem Firmennamen.</div>
              </div>
            </div>
            <div class="row mb-4">
              <div class="col-12">
                <label class="form-label d-block mb-2" for="wizard-company-address">
                  Adresse <span class="text-muted small">(optional)</span>
                </label>
                <textarea class="form-control" id="wizard-company-address" name="wizard-company-address" rows="2" autocomplete="street-address" placeholder="Straße und Hausnummer, PLZ Ort">${escapeHtml(
                  baseCompany.address,
                )}</textarea>
                <div class="form-text">Erscheint auf Ausdrucken.</div>
              </div>
            </div>
            <div class="d-flex gap-3">
              <button type="submit" class="btn btn-psm-primary btn-lg px-4">
                <i class="bi bi-database-add me-2"></i>Erstellen
              </button>
              <button type="button" class="btn btn-psm-secondary-outline px-4" data-action="wizard-back">Abbrechen</button>
            </div>
          </form>
        </div>
      </div>
      <div class="card startup-card mt-4 d-none" data-role="wizard-result">
        <div class="card-body p-4">
          <h3 class="mb-3" style="color: var(--color-primary);">✓ Datenbank erstellt</h3>
          <p class="mb-2">Dateiname: <code style="color: var(--color-info);" data-role="wizard-filename"></code></p>
          <div class="d-flex gap-2 mb-3">
            <button type="button" class="btn btn-psm-primary px-4" data-action="wizard-save">
              <i class="bi bi-download me-2"></i>Speichern
            </button>
          </div>
          <p class="small mb-2 text-muted" data-role="wizard-save-hint"></p>
          <details>
            <summary class="small mb-2 text-muted" style="cursor: pointer;">Vorschau anzeigen</summary>
            <pre class="rounded p-3 small overflow-auto mt-2" style="background: var(--color-bg-elevated); max-height: 14rem;" data-role="wizard-preview"></pre>
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
    '[data-role="wizard-result"]',
  );
  if (!resultCard) {
    throw new Error("Wizard-Resultat-Container fehlt");
  }

  return {
    section,
    form,
    resultCard,
    preview: section.querySelector<HTMLElement>(
      '[data-role="wizard-preview"]',
    )!,
    filenameLabel: section.querySelector<HTMLElement>(
      '[data-role="wizard-filename"]',
    )!,
    saveHint: section.querySelector<HTMLElement>(
      '[data-role="wizard-save-hint"]',
    ),
    saveButton: section.querySelector<HTMLButtonElement>(
      '[data-action="wizard-save"]',
    ),
    reset() {
      form.reset();
      resultCard.classList.add("d-none");
      const preview = section.querySelector<HTMLElement>(
        '[data-role="wizard-preview"]',
      );
      if (preview) {
        preview.textContent = "";
      }
      const filenameLabel = section.querySelector<HTMLElement>(
        '[data-role="wizard-filename"]',
      );
      if (filenameLabel) {
        filenameLabel.textContent = "";
      }
    },
  };
}

export function initStartup(
  container: Element | null,
  services: Services,
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
  landingSection.className = "section-container startup-landing";

  // Dynamisches HTML basierend auf Zustand - wird später aktualisiert
  function renderLandingContent(hasFile: boolean, inApp: boolean): void {
    // Szenario bestimmen:
    // 1. Neuer User (keine Datei) → "Neu erstellen" im Fokus
    // 2. Hat Datei → "Fortsetzen" im Fokus
    // 3. In App ohne Datei → "Neu erstellen" im Fokus, kein Install-Banner

    const showContinueFocus = hasFile;

    // Anleitung (Videos + Schritt-für-Schritt) – in beiden Szenarien sichtbar
    const guideCardHtml = `<a class="startup-guide" href="/anleitung/" data-action="open-guide">
            <span class="startup-guide-media">
              <img src="/assets/img/anleitung-vorschau.webp" alt="" width="960" height="540" data-role="guide-preview" />
              <span class="startup-guide-play"><i class="bi bi-play-fill"></i></span>
            </span>
            <span class="startup-guide-text">
              <span class="startup-guide-title">Anleitung mit Videos</span>
              <span class="startup-guide-sub">Kurze Videos zeigen Schritt für Schritt, wie die App funktioniert.</span>
              <span class="startup-guide-cta">Anleitung ansehen<i class="bi bi-arrow-right"></i></span>
            </span>
          </a>`;

    landingSection.innerHTML = `
    <div class="section-inner">
      <div class="card startup-card">
        <div class="card-body startup-body">
          <div class="startup-brand">
            <img src="/assets/img/favicon.svg" alt="" width="28" height="28" />
            <span>Digitale<span class="startup-brand-dash">-</span>PSM<span class="startup-brand-tld">.de</span></span>
          </div>

          <div class="startup-hero">
            <div class="startup-intro">
              <h1 class="startup-title">Pflanzenschutz einfach dokumentieren</h1>
              ${
                showContinueFocus
                  ? `<!-- Szenario 2: Hat Datei → Fortsetzen im Fokus -->
                <div id="auto-start-banner" class="startup-resume">
                  <p class="startup-resume-label">
                    <i class="bi bi-clock-history me-1"></i>Zuletzt verwendet
                  </p>
                  <p class="startup-resume-file" data-role="auto-start-filename"></p>
                  <div class="startup-resume-actions">
                    <button class="btn btn-lg startup-btn-resume" data-action="auto-start">
                      <i class="bi bi-arrow-right-circle-fill me-2"></i>Fortsetzen
                    </button>
                    <button class="btn startup-btn-icon" data-action="auto-start-forget" title="Aus Liste entfernen" aria-label="Aus Liste entfernen">
                      <i class="bi bi-x-lg"></i>
                    </button>
                  </div>
                </div>

                <!-- Sekundär: Andere Datei öffnen, neue Datenbank -->
                <div class="startup-actions">
                  <button class="btn startup-btn-ghost" data-action="open">
                    <i class="bi bi-folder2-open me-2"></i>Andere Datei öffnen
                  </button>
                  <button class="btn startup-btn-ghost" data-action="start-wizard">
                    <i class="bi bi-plus-lg me-2"></i>Neu erstellen
                  </button>
                </div>`
                  : `<!-- Szenario 1 & 3: Neuer User → Neu erstellen im Fokus -->
                <p class="startup-lead">
                  Für Gärtnereien und landwirtschaftliche Betriebe: Die App berechnet, wie viel Pflanzenschutzmittel du für deine Fläche brauchst, und hält jede Anwendung fest.
                </p>
                <ul class="startup-facts">
                  <li><i class="bi bi-filetype-json"></i>Maschinenlesbar als JSON-Datei</li>
                  <li><i class="bi bi-file-earmark-pdf"></i>PDF und Druck</li>
                  <li><i class="bi bi-hdd"></i>Daten bleiben auf deinem Gerät</li>
                </ul>

                <!-- Hauptaktion: Neu erstellen, sekundär: Datei öffnen -->
                <div class="startup-actions">
                  <button class="btn btn-lg startup-btn-primary" data-action="start-wizard">
                    <i class="bi bi-plus-circle-fill me-2"></i>Neu erstellen
                  </button>
                  <button class="btn startup-btn-ghost" data-action="open">
                    <i class="bi bi-folder2-open me-2"></i>Bestehende Datei öffnen
                  </button>
                </div>
                <p class="startup-action-hint">
                  Erstelle eine neue Datenbank oder öffne eine bestehende Datei.
                </p>`
              }
            </div>

            ${guideCardHtml}

            <!-- Hinweis zu den Vorgaben – in beiden Szenarien sichtbar -->
            <p class="startup-note">
              Die Felder richten sich nach den Vorgaben für Pflanzenschutz-Aufzeichnungen (Verordnung (EU) 2023/564, § 11 Pflanzenschutzgesetz). Für vollständige und richtige Angaben bist du selbst verantwortlich – die App ist kostenlos und ohne Gewähr.
            </p>
          </div>

          <!-- PWA Banner - nur wenn nicht in App -->
          <div id="pwa-install-banner" class="${inApp ? "d-none" : "d-none"} mt-4">
            <hr class="my-3" style="border-color: rgba(255,255,255,0.1);" />
            <div data-role="pwa-content">
              <!-- Wird dynamisch gefüllt -->
            </div>
          </div>

          <!-- Info & Lizenz + Statistik -->
          <div class="startup-foot">
            <a href="https://info.digitale-psm.de" target="_blank" rel="noopener noreferrer">
              <i class="bi bi-info-circle me-1"></i>Info & Lizenz
            </a>
            <a href="https://st.digitale-psm.de" target="_blank" rel="noopener noreferrer">
              <i class="bi bi-bar-chart-line me-1"></i>Statistik
            </a>
            <a id="startup-view-counter" class="startup-view-counter" href="${HITS_STATS_URL}" target="_blank" rel="noopener noreferrer" title="Aufruf-Statistik (hits.sh)">
              <i class="bi bi-eye"></i>
              <span data-role="view-count"></span>
            </a>
          </div>
        </div>
      </div>
    </div>
  `;

    // Fehlt das Vorschaubild (ohne Netz und ohne Cache), bleibt die Fläche
    // mit dem Play-Symbol stehen statt eines kaputten Bildes
    const guidePreview = landingSection.querySelector<HTMLImageElement>(
      '[data-role="guide-preview"]',
    );
    guidePreview?.addEventListener("error", () => guidePreview.remove(), {
      once: true,
    });
  }

  // Initial rendern mit Standardwerten (wird später aktualisiert)
  renderLandingContent(false, isStandalone());
  // Aufruf-Zähler sofort einhängen (Singleton: spätere Neu-Render verschieben
  // nur das Element, es wird nicht erneut gezählt)
  mountHitCounter(
    landingSection.querySelector<HTMLElement>('[data-role="view-count"]'),
  );

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
        'Der Browser fragt nach einem Speicherort. Die erzeugte Datei kannst du später über "Bestehende Datei öffnen" erneut laden.';
    }
  }

  let databaseWasOpen = false;

  function updateRegionVisibility(state = services.state.getState()): void {
    const hasDatabase = Boolean(state.app?.hasDatabase);
    host.classList.toggle("d-none", hasDatabase);
    if (hasDatabase) {
      landingSection.classList.add("d-none");
      wizard.section.classList.add("d-none");
      if (!databaseWasOpen) {
        // Der Assistent scrollt zur Ergebnis-Karte; die App soll oben beginnen
        window.scrollTo(0, 0);
      }
      databaseWasOpen = true;
      return;
    }
    databaseWasOpen = false;
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
        toast.error(
          "Dateisystemzugriff wird nicht unterstützt in diesem Browser.",
        );
        throw err instanceof Error
          ? err
          : new Error("Dateisystem nicht verfügbar");
      }

      try {
        const result = await openDatabase();
        applyDatabase(result.data);

        // FileHandle für Auto-Start speichern (wenn SQLite-Treiber)
        const context = result.context;
        if (context?.fileHandle) {
          await storeFileHandle(context.fileHandle);
        }

        services.events.emit("database:connected", {
          driver: getActiveDriverKey(),
        });
      } catch (err) {
        console.error("Fehler beim Öffnen der Datenbank", err);
        toast.error(
          err instanceof Error
            ? err.message
            : "Öffnen der Datenbank fehlgeschlagen",
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
            err,
          );
        }
      }
      const message =
        "Keine geeignete Speicheroption verfügbar. Bitte Browserberechtigungen prüfen.";
      console.error(message);
      toast.error(message);
    });
  }

  async function handleWizardSave(
    button: HTMLButtonElement | null,
  ): Promise<void> {
    if (!generatedDatabase) {
      toast.warning("Bitte erst die Datenbank erzeugen.");
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
        toast.error(
          "Dateisystemzugriff wird nicht unterstützt in diesem Browser.",
        );
        throw err instanceof Error
          ? err
          : new Error("Dateisystem nicht verfügbar");
      }

      try {
        const result = await createDatabase(
          generatedDatabase,
          generatedFilename,
        );
        applyDatabase(result.data);

        // FileHandle für Auto-Start speichern – wie beim Öffnen einer Datei,
        // damit die Startseite beim nächsten Besuch "Fortsetzen" anbietet
        const context = result.context;
        if (context?.fileHandle) {
          await storeFileHandle(context.fileHandle);
        }

        services.events.emit("database:connected", {
          driver: getActiveDriverKey(),
        });
      } catch (err) {
        console.error("Fehler beim Speichern der Datenbank", err);
        toast.error(
          err instanceof Error
            ? err.message
            : "Die Datei konnte nicht gespeichert werden",
        );
      }
    });
  }

  function handleWizardSubmit(event: SubmitEvent): void {
    event.preventDefault();
    const formData = new FormData(wizard.form);
    const name = (formData.get("wizard-company-name") || "").toString().trim();
    if (!name) {
      toast.warning("Bitte einen Firmennamen angeben.");
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
    wizard.form.querySelector<HTMLInputElement>("#wizard-company-name")?.focus();
  }

  // Auto-Start Handler - öffnet gespeicherte Datei
  async function handleAutoStart(
    button: HTMLButtonElement | null,
  ): Promise<void> {
    await withButtonBusy(button, async () => {
      try {
        const storedHandle = await getStoredFileHandle();
        if (!storedHandle) {
          toast.warning("Keine gespeicherte Datei gefunden.");
          return;
        }

        // Berechtigung prüfen/anfordern
        const hasPermission = await requestFileHandlePermission(storedHandle);
        if (!hasPermission) {
          toast.warning(
            "Berechtigung zum Zugriff auf die Datei wurde verweigert.",
          );
          return;
        }

        // Datei öffnen
        setActiveDriver("sqlite");
        const file = await storedHandle.getFile();
        const arrayBuffer = await file.arrayBuffer();

        const result = await sqlite.importFromArrayBuffer(
          arrayBuffer,
          file.name,
        );
        sqlite.setFileHandle(storedHandle);

        applyDatabase(result.data);

        // FileHandle aktualisieren für zukünftiges Speichern
        await storeFileHandle(storedHandle);

        services.events.emit("database:connected", {
          driver: "sqlite",
          autoStarted: true,
        });

        toast.success("Datenbank erfolgreich geladen!");
      } catch (err) {
        console.error("Auto-Start fehlgeschlagen:", err);
        toast.error(
          err instanceof Error
            ? err.message
            : "Fehler beim Laden der gespeicherten Datei",
        );
      }
    });
  }

  // Vergisst die gespeicherte Datei
  async function handleForgetAutoStart(): Promise<void> {
    await clearStoredFileHandle();
    const autoStartBanner =
      landingSection.querySelector<HTMLElement>("#auto-start-banner");
    if (autoStartBanner) {
      autoStartBanner.classList.add("d-none");
    }
    toast.info("Gespeicherte Datei wurde vergessen.");
  }

  // PWA Installation
  async function handleInstallPwa(
    button: HTMLButtonElement | null,
  ): Promise<void> {
    await withButtonBusy(button, async () => {
      const accepted = await promptInstall();
      if (accepted) {
        toast.success("App wird installiert!");
        const banner = landingSection.querySelector<HTMLElement>(
          "#pwa-install-banner",
        );
        if (banner) {
          banner.classList.add("d-none");
        }
      }
    });
  }

  landingSection.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement | null)?.closest(
      "button[data-action]",
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
    } else if (action === "auto-start") {
      void handleAutoStart(button);
    } else if (action === "auto-start-forget") {
      void handleForgetAutoStart();
    } else if (action === "install-pwa") {
      void handleInstallPwa(button);
    }
  });

  wizard.form.addEventListener("submit", handleWizardSubmit);

  wizard.section.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement | null)?.closest(
      "[data-action]",
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

  // PWA-Features initialisieren (siehe unten)

  // PWA-Features initialisieren
  void (async () => {
    // Zustand ermitteln
    const storedHandle = await getStoredFileHandle();
    const dbState = await getDbState();
    const hasFile = Boolean(storedHandle && dbState?.hasDatabase);
    const inApp = isStandalone();

    // Landing neu rendern mit korrektem Zustand
    renderLandingContent(hasFile, inApp);

    // Aufruf-Zähler (hits.sh-Badge) einhängen – zählt genau einmal pro Aufruf
    mountHitCounter(
      landingSection.querySelector<HTMLElement>('[data-role="view-count"]'),
    );

    // Dateiname setzen wenn Datei vorhanden
    if (hasFile && storedHandle) {
      const filenameEl = landingSection.querySelector<HTMLElement>(
        '[data-role="auto-start-filename"]',
      );
      if (filenameEl) {
        filenameEl.textContent = `Datei: ${storedHandle.name}`;
      }
    }

    // PWA-Status Banner aktualisieren
    updatePwaStatusBanner();

    // Auf PWA-Events hören
    window.addEventListener("pwa:install-available", () => {
      updatePwaStatusBanner();
    });

    window.addEventListener("pwa:installed", () => {
      markAsInstalled();
      updatePwaStatusBanner();
    });

    // Permission-Required Event (wenn Auto-Start Berechtigung fehlt)
    window.addEventListener("pwa:permission-required", async (event: Event) => {
      const customEvent = event as CustomEvent<{
        handle: FileSystemFileHandle;
      }>;
      const handle = customEvent.detail?.handle;

      if (handle) {
        const autoStartBanner =
          landingSection.querySelector<HTMLElement>("#auto-start-banner");
        const filenameEl = landingSection.querySelector<HTMLElement>(
          '[data-role="auto-start-filename"]',
        );

        if (autoStartBanner && filenameEl) {
          filenameEl.textContent = `Datei: ${handle.name} (Berechtigung erforderlich)`;
          autoStartBanner.classList.remove("d-none");
        }
      }
    });

    console.log("[Startup] PWA Capabilities:", getPwaCapabilities());

    // Async Install-Check beim Start (genauere Erkennung)
    const asyncStatus = await getInstallStatusAsync();
    console.log("[Startup] PWA Install Status (async):", asyncStatus);
    updatePwaStatusBannerWithStatus(asyncStatus);
  })();

  // Hilfsfunktion: PWA-Status Banner aktualisieren (sync für Event-Handler)
  function updatePwaStatusBanner(): void {
    const status = getInstallStatus();
    updatePwaStatusBannerWithStatus(status);
  }

  // Hilfsfunktion: PWA-Status Banner mit gegebenem Status aktualisieren
  function updatePwaStatusBannerWithStatus(status: {
    canInstall: boolean;
    isInstalled: boolean;
    isStandalone: boolean;
    showBanner: boolean;
  }): void {
    const banner = landingSection.querySelector<HTMLElement>(
      "#pwa-install-banner",
    );
    const contentEl = landingSection.querySelector<HTMLElement>(
      '[data-role="pwa-content"]',
    );

    if (!banner || !contentEl) return;

    // Kein Banner wenn in der App (standalone)
    if (!status.showBanner) {
      banner.classList.add("d-none");
      return;
    }

    // Banner anzeigen
    banner.classList.remove("d-none");

    // Fall 1: Bereits installiert (aber im Browser) → App öffnen Hinweis
    // WICHTIG: Zuerst prüfen! Chrome bietet Install-Prompt auch bei installierten Apps an.
    if (status.isInstalled) {
      contentEl.innerHTML = `
        <p class="small mb-2" style="color: var(--text-muted);">
          <i class="bi bi-check-circle text-success me-1"></i>App ist bereits installiert
        </p>
        <p class="small mb-0" style="color: rgba(255,255,255,0.5);">
          Öffne die App über dein Desktop- oder Startmenü-Symbol für die beste Erfahrung.
        </p>
      `;
    }
    // Fall 2: Noch nicht installiert, aber Installation möglich → Install-Button
    else if (status.canInstall) {
      contentEl.innerHTML = `
        <p class="small mb-2" style="color: var(--text-muted);">
          <i class="bi bi-download me-1"></i>Für schnelleren Zugriff als App installieren
        </p>
        <button class="btn btn-sm btn-outline-light" data-action="install-pwa">
          <i class="bi bi-download me-1"></i>App installieren
        </button>
      `;
    }
    // Fall 3: Nicht installierbar (Firefox etc.) → Kein Banner
    else {
      banner.classList.add("d-none");
    }
  }

  initialized = true;
}
