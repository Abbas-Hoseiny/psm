import {
  ensureSliceWindow,
  extractSliceItems,
  getState,
  subscribeState,
  updateSlice,
  type AppState,
  type MediumProfile,
} from "@scripts/core/state";
import { getDatabaseSnapshot } from "@scripts/core/database";
import { saveDatabase } from "@scripts/core/storage";
import { escapeHtml } from "@scripts/core/utils";
import { toast } from "@scripts/core/toast";
import { isSameMedium } from "@scripts/core/mediumDuplicates";
import {
  createPagerWidget,
  type PagerWidget,
} from "@scripts/features/shared/pagerWidget";
// Code-Splitting: GPS und BVL/Zulassung (inkl. bvlSync/bvlDataset, zusammen der
// größte Teil des Bundles) werden erst beim ersten Öffnen des jeweiligen Tabs
// geladen. Die Initialisierung war bereits tab-lazy; jetzt wird auch der Code
// nicht mehr beim App-Start heruntergeladen und geparst.
const loadGpsFeature = () => import("@scripts/features/gps");
const loadZulassungFeature = () => import("@scripts/features/zulassung");

interface Services {
  state: {
    getState: typeof getState;
    subscribe: typeof subscribeState;
    updateSlice: typeof updateSlice;
  };
  events?: {
    emit?: (eventName: string, payload?: unknown) => void;
    subscribe?: <T = unknown>(
      eventName: string,
      handler: (payload: T) => void
    ) => (() => void) | void;
  };
}

let initialized = false;
let mediumsTableBody: HTMLTableSectionElement | null = null;
let mediumSubmitButton: HTMLButtonElement | null = null;
let mediumCancelButton: HTMLButtonElement | null = null;
let mediumFormTitle: HTMLElement | null = null;
let editingMediumId: string | null = null;
let methodInput: HTMLInputElement | null = null;
let methodDatalist: HTMLDataListElement | null = null;
let addForm: HTMLFormElement | null = null;
let profileForm: HTMLFormElement | null = null;
let profileNameInput: HTMLInputElement | null = null;
let profileIdInput: HTMLInputElement | null = null;
let profileTableBody: HTMLTableSectionElement | null = null;
let profileSubmitButton: HTMLButtonElement | null = null;
let profileSelectionSummary: HTMLElement | null = null;
let profileSelectAllInput: HTMLInputElement | null = null;
let profileDraftSelection = new Set<string>();
let editingProfileId: string | null = null;
let sanitizingProfiles = false;
let profileSavePending = false;
let mediumSavePending = false;
const getMediumItems = (state: AppState): any[] =>
  extractSliceItems<any>(state.mediums);
const MEDIUMS_PAGE_SIZE = 25;
const mediumsNumberFormatter = new Intl.NumberFormat("de-DE");
let mediumsPageIndex = 0;
let mediumsPagerWidget: PagerWidget | null = null;
let mediumsPagerTarget: HTMLElement | null = null;
let settingsSectionRoot: HTMLElement | null = null;
let settingsServices: Services | null = null;
let activeSettingsTab: string = "mittel";

function createSection(): HTMLElement {
  const section = document.createElement("div");
  section.className = "section-inner";
  section.innerHTML = `
    <h2 class="text-center mb-4">
      <i class="bi bi-gear me-2"></i>Einstellungen
    </h2>
    
    <!-- Settings Tab Navigation -->
    <div class="settings-tabs mb-4">
      <ul class="nav nav-pills nav-fill" role="tablist">
        <li class="nav-item" role="presentation">
          <button class="nav-link active" data-settings-tab="mittel" type="button">
            <i class="bi bi-droplet me-1"></i>
            <span class="d-none d-md-inline">Mittel & Profile</span>
            <span class="d-md-none">Mittel</span>
          </button>
        </li>
        <li class="nav-item" role="presentation">
          <button class="nav-link" data-settings-tab="bvl" type="button">
            <i class="bi bi-database me-1"></i>
            <span class="d-none d-md-inline">BVL & Codes</span>
            <span class="d-md-none">BVL</span>
          </button>
        </li>
        <li class="nav-item" role="presentation">
          <button class="nav-link" data-settings-tab="gps" type="button">
            <i class="bi bi-geo-alt me-1"></i>
            <span class="d-none d-md-inline">GPS-Standorte</span>
            <span class="d-md-none">GPS</span>
          </button>
        </li>
      </ul>
    </div>

    <!-- Tab Contents -->
    <div class="settings-tab-content">
      <!-- Mittel & Profile Tab -->
      <div class="settings-pane" data-pane="mittel" style="display: block;">
        <div class="card card-dark">
          <div class="card-header bg-success bg-opacity-25">
            <h5 class="mb-0"><i class="bi bi-droplet me-2"></i>Mittel-Verwaltung</h5>
          </div>
          <div class="card-body">
            <!-- Mittel-Tabelle -->
            <div class="table-responsive mb-4">
              <table class="table table-dark table-hover mb-0" id="settings-mediums-table">
                <thead>
                  <tr>
                    <th class="text-center" style="width:40px">
                      <input type="checkbox" class="form-check-input" data-role="profile-select-all" title="Alle auswählen" />
                    </th>
                    <th>Name</th>
                    <th>Einheit</th>
                    <th>Methode</th>
                    <th>Wert</th>
                    <th>Zulassungsnr.</th>
                    <th>Wartezeit</th>
                    <th>Wirkstoff</th>
                    <th class="medium-actions-cell"><span class="visually-hidden">Aktionen</span></th>
                  </tr>
                </thead>
                <tbody></tbody>
              </table>
            </div>
            <div class="d-flex justify-content-end mb-4" data-role="mediums-pager"></div>

            <hr class="border-secondary my-4" />

            <!-- Neues Mittel hinzufügen / vorhandenes bearbeiten -->
            <h5 class="text-success mb-3" data-role="medium-form-title">+ Neues Mittel</h5>
            <form id="settings-medium-form" class="row g-2 align-items-end mb-4">
              <div class="col-6 col-md-4 col-xl-2">
                <label class="form-label small">Name *</label>
                <input class="form-control form-control-sm" name="medium-name" placeholder="Name" required />
              </div>
              <div class="col-6 col-md-3 col-xl-2">
                <label class="form-label small">Einheit *</label>
                <select class="form-select form-select-sm" name="medium-unit" required>
                  <option value="L">L (Liter/ha)</option>
                  <option value="ml">ml (ml/ha)</option>
                  <option value="kg">kg (kg/ha)</option>
                  <option value="g">g (g/ha)</option>
                </select>
              </div>
              <div class="col-6 col-md-3 col-xl-2">
                <label class="form-label small">Methode *</label>
                <input class="form-control form-control-sm" name="medium-method" placeholder="pro Hektar" list="settings-method-options" required />
                <datalist id="settings-method-options"></datalist>
              </div>
              <div class="col-6 col-md-2 col-xl-1">
                <label class="form-label small">Wert *</label>
                <input type="number" step="any" class="form-control form-control-sm" name="medium-value" placeholder="" required />
              </div>
              <div class="col-6 col-md-4 col-xl-2">
                <label class="form-label small">Zulassungsnr. *</label>
                <input class="form-control form-control-sm" name="medium-approval" placeholder="" required />
              </div>
              <div class="col-6 col-md-3 col-xl-1">
                <label class="form-label small">Wartetage</label>
                <input type="number" min="0" class="form-control form-control-sm" name="medium-wartezeit" placeholder="" />
              </div>
              <div class="col-12 col-md-5 col-xl-2">
                <label class="form-label small">Wirkstoff</label>
                <input class="form-control form-control-sm" name="medium-wirkstoff" placeholder="" />
              </div>
              <div class="col-12 d-flex flex-wrap justify-content-end gap-2 mt-3">
                <button class="btn btn-outline-secondary btn-sm d-none" type="button" data-action="medium-edit-cancel">Abbrechen</button>
                <button class="btn btn-success btn-sm" type="submit" data-role="medium-submit"><i class="bi bi-plus-lg me-1"></i>Mittel hinzufügen</button>
              </div>
            </form>

            <hr class="border-secondary my-4" />

            <!-- Profile -->
            <div class="row g-4">
              <div class="col-lg-5">
                <h5 class="text-info mb-3">Profil erstellen</h5>
                <form id="settings-profile-form">
                  <input type="hidden" name="profile-id" />
                  <div class="input-group mb-2">
                    <input id="profile-name" class="form-control" name="profile-name" placeholder="Profilname" required />
                    <button class="btn btn-success" type="submit" data-role="profile-submit">Speichern</button>
                  </div>
                  <div class="d-flex justify-content-between align-items-center">
                    <small class="text-muted" data-role="profile-selection-summary">Keine Mittel ausgewählt</small>
                    <button class="btn btn-outline-secondary btn-sm" type="button" data-action="profile-reset">Zurücksetzen</button>
                  </div>
                </form>
              </div>
              <div class="col-lg-7">
                <h5 class="mb-3">Gespeicherte Profile</h5>
                <div class="table-responsive">
                  <table class="table table-dark table-hover table-sm mb-0" id="settings-profile-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Mittel</th>
                        <th style="width:120px"></th>
                      </tr>
                    </thead>
                    <tbody></tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- GPS Tab -->
      <div class="settings-pane" data-pane="gps" style="display: none;">
        <div data-feature="gps-embedded"></div>
      </div>

      <!-- BVL & Codes Tab (combines BVL data and EPPO/BBCH management) -->
      <div class="settings-pane" data-pane="bvl" style="display: none;">
        <div data-feature="bvl-embedded"></div>
      </div>
    </div>
  `;
  return section;
}

function generateProfileId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `profile-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function sanitizeDraftSelection(state: AppState): void {
  if (!profileDraftSelection.size) {
    return;
  }
  const validMediumIds = new Set<string>(
    getMediumItems(state).map((medium: any) => medium.id)
  );
  let changed = false;
  profileDraftSelection.forEach((id) => {
    if (!validMediumIds.has(id)) {
      profileDraftSelection.delete(id);
      changed = true;
    }
  });
  if (changed) {
    profileDraftSelection = new Set(profileDraftSelection);
  }
}

function syncProfileCheckboxes(): void {
  if (!mediumsTableBody) {
    return;
  }
  mediumsTableBody
    .querySelectorAll<HTMLInputElement>('[data-role="profile-select"]')
    .forEach((checkbox) => {
      const mediumId = checkbox.dataset.mediumId;
      checkbox.checked = Boolean(
        mediumId && profileDraftSelection.has(mediumId)
      );
    });
}

function updateProfileSelectionSummary(state: AppState): void {
  const total = getMediumItems(state).length;
  const selected = profileDraftSelection.size;
  let text = "Noch keine Mittel ausgewählt.";
  if (!total) {
    text = "Keine Mittel vorhanden.";
  } else if (selected === total && total > 0) {
    text = `${selected} Mittel ausgewählt (alle).`;
  } else if (selected > 0) {
    text = `${selected} Mittel ausgewählt.`;
  }
  if (profileSelectionSummary) {
    profileSelectionSummary.textContent = text;
  }
  if (profileSelectAllInput) {
    profileSelectAllInput.disabled = total === 0;
    profileSelectAllInput.indeterminate = selected > 0 && selected < total;
    profileSelectAllInput.checked = total > 0 && selected === total;
  }
}

function resetProfileForm(state: AppState): void {
  editingProfileId = null;
  if (profileForm) {
    profileForm.reset();
  }
  if (profileIdInput) {
    profileIdInput.value = "";
  }
  if (profileNameInput) {
    profileNameInput.value = "";
  }
  if (profileSubmitButton) {
    profileSubmitButton.textContent = "Profil speichern";
  }
  profileDraftSelection = new Set<string>();
  syncProfileCheckboxes();
  updateProfileSelectionSummary(state);
}

function loadProfileIntoForm(profile: MediumProfile, state: AppState): void {
  editingProfileId = profile.id;
  if (profileIdInput) {
    profileIdInput.value = profile.id;
  }
  if (profileNameInput) {
    profileNameInput.value = profile.name;
    profileNameInput.focus();
  }
  if (profileSubmitButton) {
    profileSubmitButton.textContent = "Profil aktualisieren";
  }
  profileDraftSelection = new Set(profile.mediumIds);
  syncProfileCheckboxes();
  updateProfileSelectionSummary(state);
}

function setProfileSubmitBusy(isBusy: boolean, busyLabel?: string): void {
  if (!profileSubmitButton) {
    return;
  }
  profileSubmitButton.disabled = isBusy;
  if (isBusy) {
    profileSubmitButton.textContent = busyLabel || "Speichert...";
    return;
  }
  profileSubmitButton.textContent = editingProfileId
    ? "Profil aktualisieren"
    : "Profil speichern";
}

function mediumFormField<T extends HTMLElement>(name: string): T | null {
  return addForm ? addForm.querySelector<T>(`[name="${name}"]`) : null;
}

// Überschrift und Knöpfe des Mittel-Formulars an "neu" / "bearbeiten" anpassen
function updateMediumFormMode(): void {
  const isEdit = Boolean(editingMediumId);
  if (mediumFormTitle) {
    mediumFormTitle.textContent = isEdit ? "Mittel bearbeiten" : "+ Neues Mittel";
  }
  mediumCancelButton?.classList.toggle("d-none", !isEdit);
  if (mediumSubmitButton) {
    mediumSubmitButton.innerHTML = isEdit
      ? '<i class="bi bi-check-lg me-1"></i>Änderungen speichern'
      : '<i class="bi bi-plus-lg me-1"></i>Mittel hinzufügen';
  }
}

function setMediumFormBusy(isBusy: boolean, busyLabel?: string): void {
  if (!mediumSubmitButton) {
    return;
  }
  mediumSubmitButton.disabled = isBusy;
  if (mediumCancelButton) {
    mediumCancelButton.disabled = isBusy;
  }
  if (isBusy) {
    mediumSubmitButton.textContent = busyLabel || "Speichert...";
    return;
  }
  updateMediumFormMode();
}

// Wartezeit kann aus den BVL-Daten als Text kommen (z. B. "F"); das Zahlenfeld
// kann nur Tage aufnehmen
function isFreeTextWartezeit(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    Number.isNaN(Number(value))
  );
}

function resetMediumForm(): void {
  editingMediumId = null;
  if (addForm) {
    addForm.reset();
    addForm
      .querySelectorAll<HTMLOptionElement>('option[data-temporary="true"]')
      .forEach((option) => option.remove());
  }
  const wartezeitInput = mediumFormField<HTMLInputElement>("medium-wartezeit");
  if (wartezeitInput) {
    wartezeitInput.placeholder = "";
  }
  updateMediumFormMode();
}

function loadMediumIntoForm(medium: any, state: AppState): void {
  if (!addForm) {
    return;
  }
  resetMediumForm();
  editingMediumId = medium.id;

  const nameInput = mediumFormField<HTMLInputElement>("medium-name");
  const unitSelect = mediumFormField<HTMLSelectElement>("medium-unit");
  const valueInput = mediumFormField<HTMLInputElement>("medium-value");
  const approvalInput = mediumFormField<HTMLInputElement>("medium-approval");
  const wartezeitInput = mediumFormField<HTMLInputElement>("medium-wartezeit");
  const wirkstoffInput = mediumFormField<HTMLInputElement>("medium-wirkstoff");

  if (nameInput) {
    nameInput.value = medium.name ?? "";
  }
  if (unitSelect) {
    const unit = String(medium.unit ?? "");
    const known = Array.from(unitSelect.options).some(
      (option) => option.value === unit
    );
    // Aus den BVL-Daten übernommene Mittel können andere Einheiten tragen
    if (unit && !known) {
      const option = new Option(unit, unit);
      option.dataset.temporary = "true";
      unitSelect.add(option);
    }
    unitSelect.value = unit;
  }
  if (methodInput) {
    const method = state.measurementMethods.find(
      (item: any) => item.id === medium.methodId
    );
    methodInput.value = method?.label || medium.method || medium.methodId || "";
  }
  if (valueInput) {
    valueInput.value = medium.value != null ? String(medium.value) : "";
  }
  if (approvalInput) {
    approvalInput.value = medium.approval || medium.zulassungsnummer || "";
  }
  if (wartezeitInput) {
    if (isFreeTextWartezeit(medium.wartezeit)) {
      wartezeitInput.value = "";
      wartezeitInput.placeholder = medium.wartezeit;
    } else {
      wartezeitInput.value =
        medium.wartezeit != null && medium.wartezeit !== ""
          ? String(medium.wartezeit)
          : "";
    }
  }
  if (wirkstoffInput) {
    wirkstoffInput.value = medium.wirkstoff ?? "";
  }

  updateMediumFormMode();
  addForm.scrollIntoView({ behavior: "smooth", block: "center" });
  nameInput?.focus({ preventScroll: true });
}

async function deleteMediumAtIndex(
  index: number,
  services: Services,
  trigger?: HTMLButtonElement | null
): Promise<void> {
  if (mediumSavePending) {
    return;
  }
  const currentState = services.state.getState();
  const targetMedium = getMediumItems(currentState)[index] ?? null;
  const targetId = targetMedium?.id || null;
  mediumSavePending = true;
  setMediumFormBusy(true);
  // innerHTML, damit das Symbol im Knopf erhalten bleibt
  const originalLabel = trigger?.innerHTML ?? null;
  if (trigger) {
    trigger.disabled = true;
    trigger.textContent = "Lösche...";
  }
  try {
    services.state.updateSlice("mediums", (mediumsSlice) => {
      const slice = ensureSliceWindow<any>(mediumsSlice as any);
      const items = slice.items.slice();
      items.splice(index, 1);
      return {
        ...slice,
        items,
        totalCount: Math.min(slice.totalCount, items.length),
        lastUpdatedAt: new Date().toISOString(),
      };
    });
    const persisted = await persistChanges({ silent: true });
    if (persisted && targetId) {
      services.events?.emit?.("mediums:data-changed", {
        action: "deleted",
        id: targetId,
      });
    }
    if (targetId && targetId === editingMediumId) {
      resetMediumForm();
    }
  } finally {
    mediumSavePending = false;
    setMediumFormBusy(false);
    if (trigger && trigger.isConnected) {
      trigger.disabled = false;
      trigger.innerHTML = originalLabel ?? "Löschen";
    }
  }
}

async function deleteProfileAndPersist(
  profile: MediumProfile,
  services: Services,
  trigger?: HTMLButtonElement | null
): Promise<void> {
  const originalLabel = trigger?.textContent ?? null;
  if (trigger) {
    trigger.disabled = true;
    trigger.textContent = "Lösche...";
  }
  try {
    services.state.updateSlice(
      "mediumProfiles",
      (profiles: MediumProfile[] = []) =>
        profiles.filter((item) => item.id !== profile.id)
    );
    if (editingProfileId === profile.id) {
      resetProfileForm(services.state.getState());
    }
    await persistChanges({ successMessage: "Profil gelöscht." });
  } finally {
    if (trigger) {
      trigger.disabled = false;
      trigger.textContent = originalLabel || "Löschen";
    }
  }
}

function renderProfileList(state: AppState): void {
  if (!profileTableBody) {
    return;
  }
  const tableBody = profileTableBody;
  const profiles = state.mediumProfiles || [];
  if (!profiles.length) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="3" class="text-center text-muted">Noch keine Profile erstellt.</td>
      </tr>
    `;
    return;
  }
  const mediumMap = new Map<string, any>(
    getMediumItems(state).map((medium: any) => [medium.id, medium])
  );
  tableBody.innerHTML = "";
  profiles.forEach((profile) => {
    const row = document.createElement("tr");
    const labels = profile.mediumIds
      .map((id) => mediumMap.get(id))
      .filter(Boolean)
      .map((medium: any) => escapeHtml(medium.name));
    const mediumHtml = labels.length
      ? labels.join(", ")
      : '<span class="text-muted">Keine gültigen Mittel</span>';
    row.innerHTML = `
      <td>${escapeHtml(profile.name)}</td>
      <td>${mediumHtml}</td>
      <td>
        <div class="d-flex flex-wrap gap-2">
          <button class="btn btn-sm btn-outline-info" data-action="profile-edit" data-id="${escapeHtml(
            profile.id
          )}">Bearbeiten</button>
          <button class="btn btn-sm btn-outline-danger" data-action="profile-delete" data-id="${escapeHtml(
            profile.id
          )}">Löschen</button>
        </div>
      </td>
    `;
    tableBody.appendChild(row);
  });
}

function sanitizeMediumProfiles(state: AppState, services: Services): void {
  if (sanitizingProfiles || !state.mediumProfiles?.length) {
    return;
  }
  const validMediumIds = new Set<string>(
    getMediumItems(state).map((medium: any) => medium.id)
  );
  let changed = false;
  const sanitizedProfiles = state.mediumProfiles
    .map((profile) => {
      const filteredIds = profile.mediumIds.filter((id) =>
        validMediumIds.has(id)
      );
      if (filteredIds.length !== profile.mediumIds.length) {
        changed = true;
        return {
          ...profile,
          mediumIds: filteredIds,
          updatedAt: new Date().toISOString(),
        } as MediumProfile;
      }
      return profile;
    })
    .filter((profile) => {
      if (!profile.mediumIds.length) {
        changed = true;
        return false;
      }
      return true;
    });
  if (!changed) {
    return;
  }
  sanitizingProfiles = true;
  services.state.updateSlice("mediumProfiles", () => sanitizedProfiles);
  sanitizingProfiles = false;
}

function getMediumsPageBounds(total: number): {
  start: number;
  end: number;
  total: number;
} {
  if (!total) {
    mediumsPageIndex = 0;
    return { start: 0, end: 0, total: 0 };
  }
  const totalPages = Math.max(Math.ceil(total / MEDIUMS_PAGE_SIZE), 1);
  if (mediumsPageIndex >= totalPages) {
    mediumsPageIndex = totalPages - 1;
  }
  if (mediumsPageIndex < 0) {
    mediumsPageIndex = 0;
  }
  const start = mediumsPageIndex * MEDIUMS_PAGE_SIZE;
  const end = Math.min(start + MEDIUMS_PAGE_SIZE, total);
  return { start, end, total };
}

function ensureMediumsPager(): PagerWidget | null {
  if (!settingsSectionRoot) {
    return null;
  }
  const target = settingsSectionRoot.querySelector<HTMLElement>(
    '[data-role="mediums-pager"]'
  );
  if (!target) {
    return null;
  }
  if (!mediumsPagerWidget || mediumsPagerTarget !== target) {
    mediumsPagerWidget?.destroy();
    mediumsPagerWidget = createPagerWidget(target, {
      onPrev: () => goToPrevMediumsPage(),
      onNext: () => goToNextMediumsPage(),
      labels: {
        prev: "Zurück",
        next: "Weiter",
        loading: "Lade Mittel...",
        empty: "Keine Mittel verfügbar",
      },
    });
    mediumsPagerTarget = target;
  }
  return mediumsPagerWidget;
}

function updateMediumsPager(state: AppState): void {
  const widget = ensureMediumsPager();
  if (!widget) {
    return;
  }
  const total = getMediumItems(state).length;
  if (!total) {
    mediumsPageIndex = 0;
    widget.update({
      status: "disabled",
      info: "Noch keine Mittel gespeichert.",
    });
    return;
  }
  const { start, end } = getMediumsPageBounds(total);
  const info = `Mittel ${mediumsNumberFormatter.format(
    start + 1
  )}–${mediumsNumberFormatter.format(end)} von ${mediumsNumberFormatter.format(
    total
  )}`;
  widget.update({
    status: "ready",
    info,
    canPrev: mediumsPageIndex > 0,
    canNext: end < total,
  });
}

function goToPrevMediumsPage(): void {
  if (mediumsPageIndex === 0) {
    return;
  }
  const state = settingsServices?.state.getState();
  if (!state) {
    return;
  }
  mediumsPageIndex = Math.max(mediumsPageIndex - 1, 0);
  renderMediumRows(state);
}

function goToNextMediumsPage(): void {
  const state = settingsServices?.state.getState();
  if (!state) {
    return;
  }
  const total = getMediumItems(state).length;
  if (!total) {
    return;
  }
  const maxPage = Math.max(Math.ceil(total / MEDIUMS_PAGE_SIZE) - 1, 0);
  if (mediumsPageIndex >= maxPage) {
    return;
  }
  mediumsPageIndex = Math.min(mediumsPageIndex + 1, maxPage);
  renderMediumRows(state);
}

function renderMediumRows(state: AppState): void {
  if (!mediumsTableBody) {
    return;
  }
  sanitizeDraftSelection(state);
  const methodsById = new Map<string, any>(
    state.measurementMethods.map((method: any) => [method.id, method])
  );

  const total = getMediumItems(state).length;
  if (!total) {
    mediumsTableBody.innerHTML = `
      <tr>
        <td colspan="9" class="text-center text-muted">Noch keine Mittel gespeichert.</td>
      </tr>
    `;
    updateProfileSelectionSummary(state);
    updateMediumsPager(state);
    return;
  }

  const { start, end } = getMediumsPageBounds(total);
  const visibleMediums = getMediumItems(state).slice(start, end);
  mediumsTableBody.innerHTML = "";
  visibleMediums.forEach((medium: any, index: number) => {
    const globalIndex = start + index;
    const row = document.createElement("tr");
    const method = methodsById.get(medium.methodId);
    // Zulassung kann als 'approval' oder 'zulassungsnummer' gespeichert sein
    const approvalValue = medium.approval || medium.zulassungsnummer;
    const approvalText =
      typeof approvalValue === "string" && approvalValue.trim().length
        ? escapeHtml(approvalValue)
        : '<span class="badge-missing" title="Zulassungsnummer fehlt">fehlt</span>';
    // Wartezeit kann String (z.B. "FX") oder Number sein
    const wartezeitText =
      typeof medium.wartezeit === "string" && medium.wartezeit.trim().length
        ? escapeHtml(medium.wartezeit)
        : typeof medium.wartezeit === "number"
          ? `${medium.wartezeit} Tage`
          : "-";
    const wirkstoffText =
      typeof medium.wirkstoff === "string" && medium.wirkstoff.trim().length
        ? escapeHtml(medium.wirkstoff)
        : "-";
    row.innerHTML = `
      <td class="text-center">
        <input type="checkbox" class="form-check-input" data-role="profile-select" data-medium-id="${escapeHtml(
          medium.id
        )}" ${profileDraftSelection.has(medium.id) ? "checked" : ""} />
      </td>
      <td>${escapeHtml(medium.name)}</td>
      <td>${escapeHtml(medium.unit)}</td>
      <td>${escapeHtml(method ? method.label : medium.method || medium.methodId || "-")}</td>
      <td>${escapeHtml(medium.value != null ? String(medium.value) : "")}</td>
      <td>${approvalText}</td>
      <td>${wartezeitText}</td>
      <td>${wirkstoffText}</td>
      <td class="medium-actions-cell">
        <div class="medium-row-actions">
          <button class="btn btn-sm btn-outline-secondary" type="button" data-action="edit" data-index="${globalIndex}" title="Bearbeiten" aria-label="Bearbeiten"><i class="bi bi-pencil"></i><span class="medium-action-label">Bearbeiten</span></button>
          <button class="btn btn-sm btn-danger" type="button" data-action="delete" data-index="${globalIndex}" title="Löschen" aria-label="Löschen"><i class="bi bi-trash"></i><span class="medium-action-label">Löschen</span></button>
        </div>
      </td>
    `;
    mediumsTableBody?.appendChild(row);
  });
  updateProfileSelectionSummary(state);
  updateMediumsPager(state);
}

function renderMethodSuggestions(state: AppState): void {
  if (!methodDatalist) {
    return;
  }
  const seen = new Set<string>();
  methodDatalist.innerHTML = "";
  state.measurementMethods.forEach((method: any) => {
    const labelKey = (method.label ?? "").toLowerCase();
    const idKey = (method.id ?? "").toLowerCase();
    if (labelKey && !seen.has(labelKey)) {
      seen.add(labelKey);
      const labelOption = document.createElement("option");
      labelOption.value = method.label;
      methodDatalist!.appendChild(labelOption);
    }
    // Technische Kennung nur vorschlagen, wenn es keine Bezeichnung gibt
    if (!labelKey && idKey && !seen.has(idKey)) {
      seen.add(idKey);
      const idOption = document.createElement("option");
      idOption.value = method.id;
      methodDatalist!.appendChild(idOption);
    }
  });
}

function createMethodId(label: string): string {
  const slug = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug) {
    return slug;
  }
  return `method-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
}

function ensureMethodExists(
  state: AppState,
  services: Services
): string | null {
  if (!methodInput) {
    return null;
  }
  const rawValue = methodInput.value.trim();
  if (!rawValue) {
    window.alert("Bitte eine Methode angeben.");
    methodInput.focus();
    return null;
  }
  const existing = state.measurementMethods.find(
    (method: any) =>
      method.label?.toLowerCase() === rawValue.toLowerCase() ||
      method.id?.toLowerCase() === rawValue.toLowerCase()
  );
  if (existing) {
    return existing.id;
  }
  const id = createMethodId(rawValue);
  const defaultUnit =
    state.fieldLabels?.calculation?.fields?.quantity?.unit || "Kiste";
  const newMethod = {
    id,
    label: rawValue,
    type: "factor",
    unit: defaultUnit,
    requires: ["areaHa"],
    config: { sourceField: "areaHa" },
  };
  services.state.updateSlice("measurementMethods", (methods: any[]) => [
    ...methods,
    newMethod,
  ]);
  return id;
}

interface PersistOptions {
  successMessage?: string;
  silent?: boolean;
}

async function persistChanges(options?: PersistOptions): Promise<boolean> {
  try {
    const snapshot = getDatabaseSnapshot();
    await saveDatabase(snapshot);
    if (!options?.silent) {
      window.alert(options?.successMessage ?? "Änderungen wurden gespeichert.");
    }
    return true;
  } catch (err) {
    console.error("Fehler beim Speichern", err);
    const message =
      err instanceof Error ? err.message : "Speichern fehlgeschlagen";
    window.alert(message);
    return false;
  }
}

function toggleSectionVisibility(section: HTMLElement, state: AppState): void {
  const ready = Boolean(state.app?.hasDatabase);
  const active = state.app?.activeSection === "settings";
  section.classList.toggle("d-none", !(ready && active));
}

export function initSettings(
  container: Element | null,
  services: Services
): void {
  if (!container || initialized) {
    return;
  }

  const host = container as HTMLElement;
  host.innerHTML = "";
  const section = createSection();
  host.appendChild(section);
  settingsSectionRoot = section;
  settingsServices = services;
  mediumsPageIndex = 0;
  mediumsPagerWidget?.destroy();
  mediumsPagerWidget = null;
  mediumsPagerTarget = null;

  mediumsTableBody = section.querySelector<HTMLTableSectionElement>(
    "#settings-mediums-table tbody"
  );
  methodInput = section.querySelector<HTMLInputElement>(
    'input[name="medium-method"]'
  );
  methodDatalist = section.querySelector<HTMLDataListElement>(
    "#settings-method-options"
  );
  addForm = section.querySelector<HTMLFormElement>("#settings-medium-form");
  mediumSubmitButton = addForm
    ? addForm.querySelector<HTMLButtonElement>('button[type="submit"]')
    : null;
  mediumCancelButton = section.querySelector<HTMLButtonElement>(
    '[data-action="medium-edit-cancel"]'
  );
  mediumFormTitle = section.querySelector<HTMLElement>(
    '[data-role="medium-form-title"]'
  );
  editingMediumId = null;
  profileForm = section.querySelector<HTMLFormElement>(
    "#settings-profile-form"
  );
  profileNameInput = section.querySelector<HTMLInputElement>("#profile-name");
  profileIdInput = section.querySelector<HTMLInputElement>(
    'input[name="profile-id"]'
  );
  profileTableBody = section.querySelector<HTMLTableSectionElement>(
    "#settings-profile-table tbody"
  );
  profileSubmitButton = section.querySelector<HTMLButtonElement>(
    '[data-role="profile-submit"]'
  );
  profileSelectionSummary = section.querySelector<HTMLElement>(
    '[data-role="profile-selection-summary"]'
  );
  profileSelectAllInput = section.querySelector<HTMLInputElement>(
    '[data-role="profile-select-all"]'
  );

  // ===== Tab Switching Logic =====
  let gpsInitialized = false;
  let bvlInitialized = false;

  function setPaneLoading(tabName: string, loading: boolean): void {
    const pane = section.querySelector<HTMLElement>(
      `[data-pane="${tabName}"]`
    );
    if (pane) {
      pane.setAttribute("aria-busy", loading ? "true" : "false");
    }
  }

  function switchSettingsTab(tabName: string): void {
    activeSettingsTab = tabName;

    // Update tab button states
    section
      .querySelectorAll<HTMLButtonElement>("[data-settings-tab]")
      .forEach((btn) => {
        const isActive = btn.dataset.settingsTab === tabName;
        btn.classList.toggle("active", isActive);
      });

    // Update pane visibility
    section.querySelectorAll<HTMLElement>("[data-pane]").forEach((pane) => {
      const isActive = pane.dataset.pane === tabName;
      pane.style.display = isActive ? "block" : "none";
    });

    // Lazy-initialize embedded features on first visit
    if (tabName === "gps" && !gpsInitialized) {
      const gpsContainer = section.querySelector(
        '[data-feature="gps-embedded"]'
      );
      if (gpsContainer) {
        gpsInitialized = true;
        setPaneLoading("gps", true);
        loadGpsFeature()
          .then(({ initGps }) => {
            initGps(gpsContainer, services);
          })
          .catch((error) => {
            gpsInitialized = false;
            console.error("GPS-Modul konnte nicht geladen werden", error);
          })
          .finally(() => setPaneLoading("gps", false));
      }
    }

    if (tabName === "bvl" && !bvlInitialized) {
      const bvlContainer = section.querySelector(
        '[data-feature="bvl-embedded"]'
      );

      if (bvlContainer) {
        bvlInitialized = true;

        // Build services for Zulassung - emit might not be available
        const zulassungServices = {
          state: services.state,
          events: {
            emit:
              services.events?.emit ||
              ((name: string, payload?: unknown) => {
                console.log("[Settings BVL] Fallback emit:", name, payload);
              }),
            subscribe: services.events?.subscribe
              ? <T = unknown>(
                  eventName: string,
                  handler: (payload: T) => void
                ): (() => void) => {
                  const result = services.events!.subscribe!(
                    eventName,
                    handler
                  );
                  return typeof result === "function" ? result : () => {};
                }
              : undefined,
          },
        };
        setPaneLoading("bvl", true);
        loadZulassungFeature()
          .then(({ initZulassung, resetZulassungInit }) => {
            // Reset Zulassung init state to allow embedding
            resetZulassungInit();
            // Initialize in embedded mode - always visible
            initZulassung(bvlContainer, zulassungServices, { embedded: true });
          })
          .catch((error) => {
            bvlInitialized = false;
            console.error("BVL-Modul konnte nicht geladen werden", error);
          })
          .finally(() => setPaneLoading("bvl", false));
      }
    }
  }

  // Attach tab click handlers
  section
    .querySelectorAll<HTMLButtonElement>("[data-settings-tab]")
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        const tabName = btn.dataset.settingsTab;
        if (tabName) {
          switchSettingsTab(tabName);
        }
      });
    });

  async function handleMediumSubmit(): Promise<void> {
    if (!addForm || mediumSavePending) {
      return;
    }
    const state = services.state.getState();
    const formData = new FormData(addForm);
    const name = (formData.get("medium-name") || "").toString().trim();
    const unit = (formData.get("medium-unit") || "").toString().trim();
    const valueRaw = formData.get("medium-value");
    const value = Number(valueRaw);
    const approvalNumber = (formData.get("medium-approval") || "")
      .toString()
      .trim();
    const wartezeitRaw = formData.get("medium-wartezeit");
    const wartezeit = wartezeitRaw ? Number(wartezeitRaw) : null;
    const wirkstoff =
      (formData.get("medium-wirkstoff") || "").toString().trim() || null;
    if (!name || !unit || Number.isNaN(value)) {
      window.alert("Bitte alle Felder korrekt ausfüllen.");
      return;
    }
    const existing = editingMediumId
      ? (getMediumItems(state).find(
          (item: any) => item.id === editingMediumId
        ) ?? null)
      : null;
    if (editingMediumId && !existing) {
      // Das Mittel gibt es nicht mehr (z. B. inzwischen gelöscht)
      resetMediumForm();
      toast.warning("Dieses Mittel gibt es nicht mehr.");
      return;
    }
    const methodId = ensureMethodExists(state, services);
    if (!methodId) {
      return;
    }
    if (!approvalNumber) {
      toast.warning("Bitte die Zulassungsnummer eintragen.");
      addForm.querySelector<HTMLInputElement>('[name="medium-approval"]')?.focus();
      return;
    }
    // Dasselbe Mittel nicht zweimal anlegen (gleicher Name mit anderem Wert bleibt erlaubt)
    const duplicate = getMediumItems(state).find(
      (item: any) =>
        item.id !== existing?.id &&
        isSameMedium(item, { name, unit, methodId, value, zulassungsnummer: approvalNumber })
    );
    if (duplicate) {
      toast.warning(`„${name}“ gibt es mit diesen Angaben schon.`, 6000);
      return;
    }
    const wartezeitValue =
      wartezeit != null && !Number.isNaN(wartezeit) ? wartezeit : null;
    const id: string = existing
      ? existing.id
      : typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `medium-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const medium: any = {
      ...(existing ?? {}),
      id,
      name,
      unit,
      methodId,
      value,
      zulassungsnummer: approvalNumber || null,
      // Text-Wartezeit aus den BVL-Daten bleibt stehen, solange keine Tage eingetragen werden
      wartezeit:
        wartezeitValue == null && isFreeTextWartezeit(existing?.wartezeit)
          ? existing.wartezeit
          : wartezeitValue,
      wirkstoff,
    };
    if (existing) {
      if ("approval" in existing) {
        medium.approval = approvalNumber || null;
      }
      // Die Methode steht jetzt in methodId
      delete medium.method;
    }
    mediumSavePending = true;
    setMediumFormBusy(true, "Speichere...");
    try {
      if (!existing) {
        // Seite mit dem neuen Mittel zeigen
        mediumsPageIndex = Math.floor(
          getMediumItems(state).length / MEDIUMS_PAGE_SIZE
        );
      }
      services.state.updateSlice("mediums", (mediumsSlice) => {
        const slice = ensureSliceWindow<any>(mediumsSlice as any);
        const items = existing
          ? slice.items.map((item: any) => (item.id === id ? medium : item))
          : [...slice.items, medium];
        return {
          ...slice,
          items,
          totalCount: existing ? slice.totalCount : items.length,
          lastUpdatedAt: new Date().toISOString(),
        };
      });
      renderMethodSuggestions(services.state.getState());
      const persisted = await persistChanges({
        successMessage: "Mittel gespeichert.",
        silent: true,
      });
      if (persisted) {
        resetMediumForm();
        services.events?.emit?.("mediums:data-changed", {
          action: existing ? "updated" : "created",
          id,
        });
        toast.success(`„${name}“ gespeichert.`);
      }
    } finally {
      mediumSavePending = false;
      setMediumFormBusy(false);
    }
  }

  addForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    void handleMediumSubmit();
  });

  mediumCancelButton?.addEventListener("click", () => {
    resetMediumForm();
  });

  mediumsTableBody?.addEventListener("click", (event) => {
    const target = (
      event.target as HTMLElement | null
    )?.closest<HTMLButtonElement>('[data-action="delete"], [data-action="edit"]');
    if (!target) {
      return;
    }
    const index = Number(target.dataset.index);
    if (Number.isNaN(index)) {
      return;
    }
    const state = services.state.getState();
    const medium = getMediumItems(state)[index] ?? null;
    if (!medium) {
      return;
    }
    if (target.dataset.action === "edit") {
      if (!mediumSavePending) {
        loadMediumIntoForm(medium, state);
      }
      return;
    }
    if (!window.confirm(`Mittel "${medium.name}" wirklich löschen?`)) {
      return;
    }
    void deleteMediumAtIndex(index, services, target);
  });

  mediumsTableBody?.addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement | null;
    if (!input || input.dataset.role !== "profile-select") {
      return;
    }
    const mediumId = input.dataset.mediumId;
    if (!mediumId) {
      return;
    }
    if (input.checked) {
      profileDraftSelection.add(mediumId);
    } else {
      profileDraftSelection.delete(mediumId);
    }
    const state = services.state.getState();
    updateProfileSelectionSummary(state);
  });

  profileSelectAllInput?.addEventListener("change", () => {
    const state = services.state.getState();
    if (!profileSelectAllInput) {
      return;
    }
    profileSelectAllInput.indeterminate = false;
    if (profileSelectAllInput.checked) {
      profileDraftSelection = new Set(
        getMediumItems(state).map((medium: any) => medium.id)
      );
    } else {
      profileDraftSelection = new Set<string>();
    }
    syncProfileCheckboxes();
    updateProfileSelectionSummary(state);
  });

  const handleProfileSubmit = async (): Promise<void> => {
    if (!profileNameInput) {
      return;
    }
    const name = profileNameInput.value.trim();
    if (!name) {
      window.alert("Bitte einen Profilnamen eingeben.");
      profileNameInput.focus();
      return;
    }
    if (!profileDraftSelection.size) {
      window.alert("Bitte mindestens ein Mittel auswählen.");
      return;
    }
    const state = services.state.getState();
    const duplicate = state.mediumProfiles?.some(
      (profile) =>
        profile.name.toLowerCase() === name.toLowerCase() &&
        profile.id !== editingProfileId
    );
    if (duplicate) {
      window.alert("Ein Profil mit diesem Namen existiert bereits.");
      return;
    }
    const mediumIds = getMediumItems(state)
      .filter((medium: any) => profileDraftSelection.has(medium.id))
      .map((medium: any) => medium.id);
    if (!mediumIds.length) {
      window.alert(
        "Ausgewählte Mittel sind nicht mehr verfügbar. Bitte Auswahl prüfen."
      );
      sanitizeDraftSelection(state);
      syncProfileCheckboxes();
      updateProfileSelectionSummary(state);
      return;
    }
    if (profileSavePending) {
      return;
    }
    const isUpdate = Boolean(editingProfileId);
    profileSavePending = true;
    setProfileSubmitBusy(true, isUpdate ? "Aktualisiere..." : "Speichere...");
    const timestamp = new Date().toISOString();
    try {
      if (editingProfileId) {
        services.state.updateSlice(
          "mediumProfiles",
          (profiles: MediumProfile[] = []) =>
            profiles.map((profile) =>
              profile.id === editingProfileId
                ? { ...profile, name, mediumIds, updatedAt: timestamp }
                : profile
            )
        );
      } else {
        const newProfile: MediumProfile = {
          id: generateProfileId(),
          name,
          mediumIds,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        services.state.updateSlice(
          "mediumProfiles",
          (profiles: MediumProfile[] = []) => [...profiles, newProfile]
        );
      }
      const persisted = await persistChanges({
        successMessage: isUpdate
          ? "Profil aktualisiert und gespeichert."
          : "Profil gespeichert.",
      });
      if (persisted) {
        resetProfileForm(services.state.getState());
      }
    } finally {
      profileSavePending = false;
      setProfileSubmitBusy(false);
    }
  };

  profileForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    void handleProfileSubmit();
  });

  profileTableBody?.addEventListener("click", (event) => {
    const target = (
      event.target as HTMLElement | null
    )?.closest<HTMLButtonElement>('[data-action^="profile-"]');
    if (!target) {
      return;
    }
    const id = target.dataset.id;
    if (!id) {
      return;
    }
    const state = services.state.getState();
    if (target.dataset.action === "profile-edit") {
      const profile = state.mediumProfiles?.find((item) => item.id === id);
      if (profile) {
        loadProfileIntoForm(profile, state);
      }
      return;
    }
    if (target.dataset.action === "profile-delete") {
      const profile = state.mediumProfiles?.find((item) => item.id === id);
      if (!profile) {
        return;
      }
      if (!window.confirm(`Profil "${profile.name}" wirklich löschen?`)) {
        return;
      }
      void deleteProfileAndPersist(profile, services, target);
    }
  });

  section
    .querySelector<HTMLButtonElement>('[data-action="profile-reset"]')
    ?.addEventListener("click", () => {
      resetProfileForm(services.state.getState());
    });

  resetProfileForm(services.state.getState());

  const handleStateChange = (nextState: AppState) => {
    sanitizeMediumProfiles(nextState, services);
    toggleSectionVisibility(section, nextState);
    if (nextState.app.activeSection === "settings") {
      renderMediumRows(nextState);
      renderMethodSuggestions(nextState);
      renderProfileList(nextState);
      updateProfileSelectionSummary(nextState);
    }
  };

  services.state.subscribe(handleStateChange);
  handleStateChange(services.state.getState());

  initialized = true;
}
