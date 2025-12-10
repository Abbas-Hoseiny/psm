/**
 * Infos Settings - Repo-Name Konfiguration
 *
 * Verwaltet die Eingabe und Validierung von GitHub-Repository-Namen
 * für die Infos-Quelle.
 */

import {
  validateRepoName,
  getSavedRepoName,
  saveRepoName,
  loadInfos,
  buildManifestUrl,
} from "./index";
import type { ValidationResult, InfoManifest } from "./types";

interface InfosSettingsState {
  repoName: string;
  isValid: boolean;
  isLoading: boolean;
  errorMessage: string;
}

let settingsState: InfosSettingsState = {
  repoName: "",
  isValid: false,
  isLoading: false,
  errorMessage: "",
};

let container: HTMLElement | null = null;
let initialized = false;

/**
 * Vorschau des Repositorys - lädt das Manifest zur Validierung
 */
async function previewRepo(
  repoName: string
): Promise<{ success: boolean; manifest?: InfoManifest; error?: string }> {
  try {
    const manifestUrl = buildManifestUrl(repoName);
    const response = await fetch(manifestUrl);

    if (!response.ok) {
      if (response.status === 404) {
        return {
          success: false,
          error: `Repository "${repoName}" nicht gefunden oder kein manifest.json vorhanden.`,
        };
      }
      return {
        success: false,
        error: `Fehler beim Laden (Status ${response.status})`,
      };
    }

    const manifest: InfoManifest = await response.json();

    if (!manifest.categories || !manifest.articles) {
      return { success: false, error: "Ungültiges Manifest-Format" };
    }

    return { success: true, manifest };
  } catch (error) {
    return {
      success: false,
      error: `Netzwerkfehler: ${
        error instanceof Error ? error.message : "Unbekannter Fehler"
      }`,
    };
  }
}

/**
 * Erstellt das Settings-UI für Infos Repo-Konfiguration
 */
function createSettingsSection(): HTMLElement {
  const section = document.createElement("div");
  section.className = "card card-dark mb-4";
  section.innerHTML = `
    <div class="card-body">
      <h3 class="h5 text-info mb-3">
        <i class="bi bi-github me-2"></i>Infos-Quelle Konfiguration
      </h3>
      <p class="text-muted mb-4">
        Konfiguriere den GitHub-Repository-Namen für die Infos-Quelle.
        Der Repo-Name ist der Teil nach deinem GitHub-Benutzernamen, z.B. <code>mein-info-repo</code>.
        Das Repository muss öffentlich sein und eine <code>manifest.json</code> im GitHub Pages-Root enthalten.
      </p>
      
      <div class="row g-3 align-items-end">
        <div class="col-md-6">
          <label class="form-label">
            <i class="bi bi-folder me-1"></i>Repository Name
          </label>
          <div class="input-group">
            <span class="input-group-text bg-dark border-secondary text-muted" style="font-size: 0.85rem;">
              abbas-hoseiny.github.io/
            </span>
            <input 
              type="text" 
              class="form-control" 
              data-input="repo-name"
              placeholder="z.B. stader-infos"
              autocomplete="off"
            />
          </div>
        </div>
        <div class="col-md-6 d-flex gap-2">
          <button 
            class="btn btn-outline-secondary" 
            type="button"
            data-action="validate"
          >
            <i class="bi bi-check-circle me-1"></i>Validieren
          </button>
          <button 
            class="btn btn-outline-primary" 
            type="button"
            data-action="preview"
          >
            <i class="bi bi-eye me-1"></i>Vorschau
          </button>
          <button 
            class="btn btn-success" 
            type="button"
            data-action="save"
          >
            <i class="bi bi-check-lg me-1"></i>Speichern
          </button>
        </div>
      </div>
      
      <div class="validation-feedback mt-2" data-feedback="message"></div>
      
      <div class="preview-container mt-3 d-none" data-preview="container">
        <div class="card bg-dark border-secondary">
          <div class="card-body">
            <h6 class="card-title text-success">
              <i class="bi bi-check-circle-fill me-1"></i>Manifest gefunden
            </h6>
            <div class="row small text-muted">
              <div class="col-md-4">
                <strong>Kategorien:</strong> <span data-preview="categories">0</span>
              </div>
              <div class="col-md-4">
                <strong>Artikel:</strong> <span data-preview="articles">0</span>
              </div>
              <div class="col-md-4">
                <strong>Letzte Aktualisierung:</strong> <span data-preview="updated">-</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  return section;
}

/**
 * Aktualisiert das Feedback
 */
function updateFeedback(result: {
  valid: boolean;
  error?: string;
  success?: string;
}): void {
  const feedback = container?.querySelector('[data-feedback="message"]');
  const input = container?.querySelector<HTMLInputElement>(
    '[data-input="repo-name"]'
  );

  if (!feedback || !input) return;

  // Entferne alle Status-Klassen
  input.classList.remove("is-valid", "is-invalid");
  feedback.classList.remove("text-success", "text-danger", "text-warning");

  if (result.valid) {
    input.classList.add("is-valid");
    feedback.classList.add("text-success");
    feedback.innerHTML = `<i class="bi bi-check-circle-fill me-1"></i>${
      result.success || "Gültig"
    }`;
    settingsState.isValid = true;
    settingsState.errorMessage = "";
  } else if (result.error) {
    input.classList.add("is-invalid");
    feedback.classList.add("text-danger");
    feedback.innerHTML = `<i class="bi bi-exclamation-triangle-fill me-1"></i>${result.error}`;
    settingsState.isValid = false;
    settingsState.errorMessage = result.error;
  } else {
    feedback.textContent = "";
  }
}

/**
 * Zeigt/Versteckt die Vorschau
 */
function showPreview(manifest: InfoManifest | null): void {
  const previewContainer = container?.querySelector(
    '[data-preview="container"]'
  );
  if (!previewContainer) return;

  if (manifest) {
    previewContainer.classList.remove("d-none");

    const categoriesEl = previewContainer.querySelector(
      '[data-preview="categories"]'
    );
    const articlesEl = previewContainer.querySelector(
      '[data-preview="articles"]'
    );
    const updatedEl = previewContainer.querySelector(
      '[data-preview="updated"]'
    );

    if (categoriesEl)
      categoriesEl.textContent = String(manifest.categories?.length || 0);
    if (articlesEl)
      articlesEl.textContent = String(manifest.articles?.length || 0);
    if (updatedEl) updatedEl.textContent = manifest.lastUpdated || "-";
  } else {
    previewContainer.classList.add("d-none");
  }
}

/**
 * Setzt Ladeindikator
 */
function setLoading(isLoading: boolean): void {
  const validateBtn = container?.querySelector<HTMLButtonElement>(
    '[data-action="validate"]'
  );
  const previewBtn = container?.querySelector<HTMLButtonElement>(
    '[data-action="preview"]'
  );
  const saveBtn = container?.querySelector<HTMLButtonElement>(
    '[data-action="save"]'
  );
  const input = container?.querySelector<HTMLInputElement>(
    '[data-input="repo-name"]'
  );

  [validateBtn, previewBtn, saveBtn].forEach((btn) => {
    if (btn) btn.disabled = isLoading;
  });

  if (input) input.disabled = isLoading;

  if (validateBtn) {
    if (isLoading) {
      validateBtn.innerHTML =
        '<span class="spinner-border spinner-border-sm me-1"></span>Prüft...';
    } else {
      validateBtn.innerHTML =
        '<i class="bi bi-check-circle me-1"></i>Validieren';
    }
  }

  settingsState.isLoading = isLoading;
}

/**
 * Validiert die Repo-Eingabe
 */
async function handleValidate(): Promise<void> {
  const input = container?.querySelector<HTMLInputElement>(
    '[data-input="repo-name"]'
  );
  if (!input) return;

  const repoName = input.value.trim();

  if (!repoName) {
    updateFeedback({ valid: false, error: "Bitte einen Repo-Namen eingeben." });
    return;
  }

  // Lokale Validierung
  const localResult = validateRepoName(repoName);
  if (!localResult.valid) {
    updateFeedback({
      valid: false,
      error: localResult.error || "Ungültiger Repo-Name",
    });
    return;
  }

  setLoading(true);
  showPreview(null);

  try {
    const result = await previewRepo(repoName);

    if (result.success) {
      updateFeedback({
        valid: true,
        success: "Repository gefunden und Manifest gültig.",
      });
      settingsState.repoName = repoName;
    } else {
      updateFeedback({ valid: false, error: result.error });
    }
  } catch (error) {
    updateFeedback({
      valid: false,
      error: `Fehler: ${
        error instanceof Error ? error.message : "Unbekannter Fehler"
      }`,
    });
  } finally {
    setLoading(false);
  }
}

/**
 * Zeigt eine Vorschau des Repositorys
 */
async function handlePreview(): Promise<void> {
  const input = container?.querySelector<HTMLInputElement>(
    '[data-input="repo-name"]'
  );
  if (!input) return;

  const repoName = input.value.trim();

  if (!repoName) {
    updateFeedback({ valid: false, error: "Bitte einen Repo-Namen eingeben." });
    return;
  }

  // Lokale Validierung
  const localResult = validateRepoName(repoName);
  if (!localResult.valid) {
    updateFeedback({
      valid: false,
      error: localResult.error || "Ungültiger Repo-Name",
    });
    return;
  }

  setLoading(true);
  showPreview(null);

  try {
    const result = await previewRepo(repoName);

    if (result.success && result.manifest) {
      updateFeedback({
        valid: true,
        success: `Gefunden: ${
          result.manifest.categories?.length || 0
        } Kategorien, ${result.manifest.articles?.length || 0} Artikel`,
      });
      showPreview(result.manifest);
      settingsState.repoName = repoName;
      settingsState.isValid = true;
    } else {
      updateFeedback({ valid: false, error: result.error });
    }
  } catch (error) {
    updateFeedback({
      valid: false,
      error: `Fehler: ${
        error instanceof Error ? error.message : "Unbekannter Fehler"
      }`,
    });
  } finally {
    setLoading(false);
  }
}

/**
 * Speichert den Repo-Namen
 */
async function handleSave(): Promise<void> {
  const input = container?.querySelector<HTMLInputElement>(
    '[data-input="repo-name"]'
  );
  const saveBtn = container?.querySelector<HTMLButtonElement>(
    '[data-action="save"]'
  );

  if (!input) return;

  const repoName = input.value.trim();

  if (!repoName) {
    updateFeedback({ valid: false, error: "Bitte einen Repo-Namen eingeben." });
    return;
  }

  // Lokale Validierung
  const localResult = validateRepoName(repoName);
  if (!localResult.valid) {
    updateFeedback({
      valid: false,
      error: localResult.error || "Ungültiger Repo-Name",
    });
    return;
  }

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML =
      '<span class="spinner-border spinner-border-sm me-1"></span>Speichert...';
  }

  try {
    // Repo-Namen speichern
    saveRepoName(repoName);

    // Infos neu laden
    await loadInfos(true);

    updateFeedback({
      valid: true,
      success: "Gespeichert! Infos werden neu geladen.",
    });

    if (saveBtn) {
      saveBtn.innerHTML = '<i class="bi bi-check-lg me-1"></i>Gespeichert!';
      saveBtn.classList.remove("btn-success");
      saveBtn.classList.add("btn-outline-success");

      setTimeout(() => {
        if (saveBtn) {
          saveBtn.innerHTML = '<i class="bi bi-check-lg me-1"></i>Speichern';
          saveBtn.classList.add("btn-success");
          saveBtn.classList.remove("btn-outline-success");
          saveBtn.disabled = false;
        }
      }, 2000);
    }
  } catch (error) {
    console.error("[InfosSettings] Fehler beim Speichern:", error);
    updateFeedback({
      valid: false,
      error: `Speichern fehlgeschlagen: ${
        error instanceof Error ? error.message : "Unbekannter Fehler"
      }`,
    });

    if (saveBtn) {
      saveBtn.innerHTML = '<i class="bi bi-check-lg me-1"></i>Speichern';
      saveBtn.disabled = false;
    }
  }
}

/**
 * Lädt gespeicherte Werte aus localStorage
 */
function loadSavedValues(): void {
  const savedName = getSavedRepoName();
  if (savedName) {
    const input = container?.querySelector<HTMLInputElement>(
      '[data-input="repo-name"]'
    );
    if (input) {
      input.value = savedName;
    }
    settingsState.repoName = savedName;
  }
}

/**
 * Event Handler für Input-Änderungen (Live-Validierung)
 */
function handleInputChange(value: string): void {
  settingsState.repoName = value;

  // Vorschau verstecken bei Änderung
  showPreview(null);

  const input = container?.querySelector<HTMLInputElement>(
    '[data-input="repo-name"]'
  );
  const feedback = container?.querySelector('[data-feedback="message"]');

  if (!input || !feedback) return;

  input.classList.remove("is-valid", "is-invalid");
  feedback.classList.remove("text-success", "text-danger", "text-warning");

  if (!value) {
    feedback.textContent = "";
    return;
  }

  // Basis-Formatvalidierung
  const localResult = validateRepoName(value);
  if (!localResult.valid) {
    feedback.classList.add("text-warning");
    feedback.innerHTML = `<i class="bi bi-info-circle me-1"></i>${localResult.error}`;
  } else {
    feedback.classList.add("text-muted");
    feedback.innerHTML =
      '<i class="bi bi-arrow-right me-1"></i>Klicke auf Validieren oder Vorschau';
  }
}

/**
 * Initialisiert das Infos-Settings Modul
 */
export function initInfosSettings(targetContainer: HTMLElement): void {
  if (initialized) return;

  container = targetContainer;

  // Settings-Section erstellen und einfügen
  const section = createSettingsSection();
  container.appendChild(section);

  // Event-Listener registrieren
  section.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const button = target.closest<HTMLButtonElement>("[data-action]");

    if (!button) return;

    const action = button.dataset.action;

    if (action === "validate") {
      void handleValidate();
    } else if (action === "preview") {
      void handlePreview();
    } else if (action === "save") {
      void handleSave();
    }
  });

  // Input-Event-Listener für Live-Feedback
  const input = section.querySelector<HTMLInputElement>(
    '[data-input="repo-name"]'
  );
  if (input) {
    input.addEventListener("input", (event) => {
      handleInputChange((event.target as HTMLInputElement).value.trim());
    });

    // Enter-Taste zum Validieren
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void handleValidate();
      }
    });
  }

  // Gespeicherte Werte laden
  loadSavedValues();

  initialized = true;
  console.log("[InfosSettings] Initialisiert");
}

/**
 * Gibt zurück, ob das Modul initialisiert ist
 */
export function isInfosSettingsInitialized(): boolean {
  return initialized;
}
