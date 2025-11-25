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
import {
  createPagerWidget,
  type PagerWidget,
} from "@scripts/features/shared/pagerWidget";

interface Services {
  state: {
    getState: typeof getState;
    subscribe: typeof subscribeState;
    updateSlice: typeof updateSlice;
  };
  events?: {
    emit?: (eventName: string, payload?: unknown) => void;
  };
}

let initialized = false;
let mediumsTableBody: HTMLTableSectionElement | null = null;
let mediumSubmitButton: HTMLButtonElement | null = null;
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

function createSection(): HTMLElement {
  const section = document.createElement("div");
  section.className = "section-inner";
  section.innerHTML = `
    <h2 class="text-center mb-4">Mittel-Verwaltung</h2>
    <div class="card card-dark mb-4">
      <div class="card-body">
        <p class="mb-2"><strong>Was kann ich hier tun?</strong></p>
        <p class="text-muted mb-0">
          Erfasse, bearbeite oder lösche deine Mittel. Trage Name, Einheit, Methode, Zulassungsnummer und den Faktor ein –
          die Änderungen werden nach jedem Speichern sofort dauerhaft gesichert. Tippe bei der Methode einfach einen bestehenden Namen oder
          vergib einen neuen – neu erfasste Methoden stehen beim nächsten Mal automatisch zur Auswahl.
        </p>
      </div>
    </div>
    <div class="card card-dark mb-4">
      <div class="card-body">
        <div class="table-responsive">
          <table class="table table-dark table-bordered" id="settings-mediums-table">
            <thead>
              <tr>
                <th class="text-center" style="width:3.5rem">
                  <span class="visually-hidden">Auswahl</span>
                  <input type="checkbox" class="form-check-input" data-role="profile-select-all" aria-label="Alle Mittel auswählen" />
                </th>
                <th>Name</th>
                <th>Einheit</th>
                <th>Methode</th>
                <th>Wert</th>
                <th>Zulassungsnr.</th>
                <th>Aktion</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
        <div class="d-flex justify-content-end mt-3" data-role="mediums-pager"></div>
        <div class="mt-4">
          <h3 class="h5 text-info mb-2">Ausgewählte Mittel als Profil speichern</h3>
          <p class="text-muted mb-3">
            Setze links Häkchen bei den Mitteln, die gemeinsam verwendet werden sollen. Profilnamen erscheinen nur hier –
            Berechnung, Historie und Ausdruck enthalten ausschließlich die ausgewählten Mittel.
          </p>
          <p class="small text-muted mb-3">
            Profile werden beim Speichern oder Aktualisieren sofort dauerhaft gesichert.
          </p>
          <form id="settings-profile-form" class="row g-3 align-items-end">
            <input type="hidden" name="profile-id" />
            <div class="col-lg-5">
              <label class="form-label" for="profile-name">Profilname</label>
              <input id="profile-name" class="form-control" name="profile-name" placeholder="z. B. Salat-Gewächshaus" required />
            </div>
            <div class="col-lg-4">
              <div class="small text-muted" data-role="profile-selection-summary">
                Noch keine Mittel ausgewählt.
              </div>
            </div>
            <div class="col-lg-3 d-flex flex-wrap gap-2 justify-content-lg-end">
              <button class="btn btn-success" type="submit" data-role="profile-submit">Profil speichern</button>
              <button class="btn btn-outline-secondary" type="button" data-action="profile-reset">Auswahl löschen</button>
            </div>
          </form>
        </div>
      </div>
    </div>
    <div class="card card-dark">
      <div class="card-body">
        <h3 class="h5 text-success mb-3">Neues Mittel hinzufügen</h3>
        <p class="text-muted">Trage alle Pflichtfelder aus. Die Zulassungsnummer ist optional, der Wert beschreibt den Faktor, der bei der Berechnung angewendet wird.</p>
        <form id="settings-medium-form" class="row g-3">
          <div class="col-md-3">
            <input class="form-control" name="medium-name" placeholder="Name (z. B. Elot-Vis)" required />
          </div>
          <div class="col-md-2">
            <input class="form-control" name="medium-unit" placeholder="Einheit (z. B. ml, %)" required />
          </div>
          <div class="col-md-3">
            <input class="form-control" name="medium-method" placeholder="Methode (z. B. perKiste)" list="settings-method-options" required />
            <datalist id="settings-method-options"></datalist>
          </div>
          <div class="col-md-2">
            <input type="number" step="any" class="form-control" name="medium-value" placeholder="Wert" required />
          </div>
          <div class="col-md-2">
            <input class="form-control" name="medium-approval" placeholder="Zulassungsnr. (optional)" />
          </div>
          <div class="col-md-2 d-grid">
            <button class="btn btn-success" type="submit">Hinzufügen</button>
          </div>
        </form>
        <div class="mt-3 small text-muted">
          Nach dem Hinzufügen kannst du Mittel jederzeit löschen. Änderungen werden automatisch gespeichert.
        </div>
      </div>
    </div>
    <div class="card card-dark">
      <div class="card-body">
        <h3 class="h5 text-info mb-3">Gespeicherte Profile</h3>
        <div class="table-responsive">
          <table class="table table-dark table-bordered" id="settings-profile-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Ausgewählte Mittel</th>
                <th>Aktionen</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    </div>
    <div class="mt-4 no-print">
      <div class="alert alert-secondary mb-0 small text-muted">
        Mittel-Änderungen werden sofort gespeichert.
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

function setMediumFormBusy(isBusy: boolean, busyLabel?: string): void {
  if (!mediumSubmitButton) {
    return;
  }
  mediumSubmitButton.disabled = isBusy;
  if (isBusy) {
    mediumSubmitButton.textContent = busyLabel || "Speichert...";
    return;
  }
  mediumSubmitButton.textContent = "Hinzufügen";
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
  const originalLabel = trigger?.textContent ?? null;
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
  } finally {
    mediumSavePending = false;
    setMediumFormBusy(false);
    if (trigger && trigger.isConnected) {
      trigger.disabled = false;
      trigger.textContent = originalLabel ?? "Löschen";
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
  const info = `Mittel ${mediumsNumberFormatter.format(start + 1)}–${mediumsNumberFormatter.format(
    end
  )} von ${mediumsNumberFormatter.format(total)}`;
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
        <td colspan="7" class="text-center text-muted">Noch keine Mittel gespeichert.</td>
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
    const approvalText =
      typeof medium.zulassungsnummer === "string" &&
      medium.zulassungsnummer.trim().length
        ? escapeHtml(medium.zulassungsnummer)
        : "-";
    row.innerHTML = `
      <td class="text-center">
        <input type="checkbox" class="form-check-input" data-role="profile-select" data-medium-id="${escapeHtml(
          medium.id
        )}" ${profileDraftSelection.has(medium.id) ? "checked" : ""} />
      </td>
      <td>${escapeHtml(medium.name)}</td>
      <td>${escapeHtml(medium.unit)}</td>
      <td>${escapeHtml(method ? method.label : medium.methodId)}</td>
      <td>${escapeHtml(medium.value != null ? String(medium.value) : "")}</td>
      <td>${approvalText}</td>
      <td>
        <button class="btn btn-sm btn-danger" data-action="delete" data-index="${globalIndex}">Löschen</button>
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
    if (idKey && !seen.has(idKey)) {
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
    requires: ["kisten"],
    config: { sourceField: "kisten" },
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

  async function handleMediumAdd(): Promise<void> {
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
    if (!name || !unit || Number.isNaN(value)) {
      window.alert("Bitte alle Felder korrekt ausfüllen.");
      return;
    }
    const methodId = ensureMethodExists(state, services);
    if (!methodId) {
      return;
    }
    const id =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `medium-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const medium = {
      id,
      name,
      unit,
      methodId,
      value,
      zulassungsnummer: approvalNumber || null,
    };
    mediumSavePending = true;
    setMediumFormBusy(true, "Speichere...");
    try {
      services.state.updateSlice("mediums", (mediumsSlice) => {
        const slice = ensureSliceWindow<any>(mediumsSlice as any);
        const items = [...slice.items, medium];
        return {
          ...slice,
          items,
          totalCount: items.length,
          lastUpdatedAt: new Date().toISOString(),
        };
      });
      renderMethodSuggestions(services.state.getState());
      const persisted = await persistChanges({
        successMessage: "Mittel gespeichert.",
        silent: true,
      });
      if (persisted) {
        addForm.reset();
        services.events?.emit?.("mediums:data-changed", {
          action: "created",
          id,
        });
      }
    } finally {
      mediumSavePending = false;
      setMediumFormBusy(false);
    }
  }

  addForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    void handleMediumAdd();
  });

  mediumsTableBody?.addEventListener("click", (event) => {
    const target = (
      event.target as HTMLElement | null
    )?.closest<HTMLButtonElement>('[data-action="delete"]');
    if (!target) {
      return;
    }
    const index = Number(target.dataset.index);
    if (Number.isNaN(index)) {
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
