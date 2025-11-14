import {
  DEFAULT_LAYOUT_META,
  GRID_COLUMNS,
  GRID_ROWS,
  clampLayout,
} from "./utils/grid";
import { cloneField } from "./persistence";
import type {
  EditorField,
  EditorSnapshot,
  EditorState,
  FieldLayout,
  FieldType,
  TemplateRevision,
  TemplateRevisionSnapshot,
  TemplateDocument,
} from "./types";

export interface EditorPreferenceSnapshot {
  gridVisible: boolean;
  snapping: boolean;
  zoom: number;
}

export type EditorPreferencePatch = Partial<EditorPreferenceSnapshot>;

export interface EditorStoreOptions {
  initialPreferences?: EditorPreferencePatch;
  onPreferencesChange?: (preferences: EditorPreferenceSnapshot) => void;
}

export const DEFAULT_ZOOM = 0.85;
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 3;

interface EditorStore {
  getState(): EditorState;
  subscribe(listener: (state: EditorState) => void): () => void;
  reset(): void;
  addField(type: FieldType, initialLayout?: Partial<FieldLayout>): EditorField;
  updateFieldLayout(id: string, layout: FieldLayout): void;
  updateField(
    id: string,
    patch: Partial<Omit<EditorField, "id" | "layout">> & {
      layout?: Partial<FieldLayout>;
    }
  ): void;
  updateFields(
    ids: string[],
    patch: Partial<Omit<EditorField, "id" | "layout">> & {
      layout?: Partial<FieldLayout>;
    }
  ): void;
  removeField(id: string): void;
  removeFields(ids: string[]): void;
  duplicateFields(ids: string[]): EditorField[];
  bringFieldsToFront(ids: string[]): void;
  sendFieldsToBack(ids: string[]): void;
  loadTemplate(template: TemplateDocument): void;
  markSaved(meta: {
    id: string;
    version: number;
    updatedAt: string;
    summary?: string | null;
    revisions?: TemplateRevision[];
  }): void;
  setTemplateMeta(meta: { name?: string; description?: string }): void;
  selectField(id: string | null): void;
  selectFields(ids: string[]): void;
  toggleGrid(): void;
  toggleSnapping(): void;
  setZoom(value: number): void;
  applyPreferences(preferences: EditorPreferencePatch): void;
  selectRevision(version: number | null): void;
  restoreRevision(revision: TemplateRevision): void;
  setRevisionSnapshot(
    version: number,
    snapshot: TemplateRevisionSnapshot | null | undefined
  ): void;
  undo(): void;
  redo(): void;
}

export const DEFAULT_FIELD_SIZE = { w: 3, h: 2 } as const;
const UNDO_STACK_LIMIT = 50;
function sanitizePreferencePatch(
  patch: EditorPreferencePatch | null | undefined
): EditorPreferencePatch | null {
  if (!patch || typeof patch !== "object") {
    return null;
  }

  const sanitized: EditorPreferencePatch = {};

  if (typeof patch.gridVisible === "boolean") {
    sanitized.gridVisible = patch.gridVisible;
  }
  if (typeof patch.snapping === "boolean") {
    sanitized.snapping = patch.snapping;
  }
  if (typeof patch.zoom === "number" && Number.isFinite(patch.zoom)) {
    sanitized.zoom = clampZoom(patch.zoom);
  }

  return Object.keys(sanitized).length ? sanitized : null;
}

export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_ZOOM;
  }
  return Math.min(Math.max(value, MIN_ZOOM), MAX_ZOOM);
}

function cloneRevisionEntries(
  revisions: TemplateRevision[]
): TemplateRevision[] {
  return revisions.map((entry) => {
    const cloned: TemplateRevision = {
      version: entry.version,
      updatedAt: entry.updatedAt,
      summary: entry.summary,
    };
    if ("snapshot" in entry) {
      cloned.snapshot =
        entry.snapshot === undefined
          ? undefined
          : entry.snapshot
            ? {
                name: entry.snapshot.name,
                description: entry.snapshot.description,
                layoutMeta: { ...entry.snapshot.layoutMeta },
                fields: entry.snapshot.fields.map(cloneField),
                settings: { ...entry.snapshot.settings },
              }
            : null;
    }
    return cloned;
  });
}

function createSnapshotFromState(source: EditorState): EditorSnapshot {
  return {
    templateId: source.templateId,
    name: source.name,
    description: source.description,
    version: source.version,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    lastSummary: source.lastSummary,
    revisions: cloneRevisionEntries(source.revisions),
    selectedRevisionVersion: source.selectedRevisionVersion,
    layoutMeta: { ...source.layoutMeta },
    fields: source.fields.map(cloneField),
    selectedFieldIds: [...source.selectedFieldIds],
    gridVisible: source.gridVisible,
    snapping: source.snapping,
    zoom: source.zoom,
    dirty: source.dirty,
  };
}

function pushSnapshot(
  stack: EditorSnapshot[],
  snapshot: EditorSnapshot
): EditorSnapshot[] {
  const next = [...stack, snapshot];
  if (next.length > UNDO_STACK_LIMIT) {
    next.shift();
  }
  return next;
}

function layoutsEqual(a: FieldLayout, b: FieldLayout): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.w === b.w &&
    a.h === b.h &&
    (a.layer ?? 0) === (b.layer ?? 0) &&
    (a.align ?? "left") === (b.align ?? "left")
  );
}

function rehydrateStateFromSnapshot(
  snapshot: EditorSnapshot,
  undoStack: EditorSnapshot[],
  redoStack: EditorSnapshot[]
): EditorState {
  return {
    templateId: snapshot.templateId,
    name: snapshot.name,
    description: snapshot.description,
    version: snapshot.version,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    lastSummary: snapshot.lastSummary,
    revisions: cloneRevisionEntries(snapshot.revisions),
    selectedRevisionVersion: snapshot.selectedRevisionVersion,
    layoutMeta: { ...snapshot.layoutMeta },
    fields: snapshot.fields.map(cloneField),
    selectedFieldIds: [...snapshot.selectedFieldIds],
    gridVisible: snapshot.gridVisible,
    snapping: snapshot.snapping,
    zoom: snapshot.zoom,
    dirty: snapshot.dirty,
    undoStack,
    redoStack,
  };
}

function createEmptySnapshot(): EditorSnapshot {
  return {
    templateId: null,
    name: "Neue Vorlage",
    description: "",
    version: 1,
    createdAt: null,
    updatedAt: null,
    lastSummary: null,
    revisions: [],
    selectedRevisionVersion: null,
    layoutMeta: DEFAULT_LAYOUT_META,
    fields: [],
    selectedFieldIds: [],
    gridVisible: true,
    snapping: true,
    zoom: DEFAULT_ZOOM,
    dirty: false,
  };
}

function createDefaultField(
  type: FieldType,
  existingFields: EditorField[],
  layoutOverride?: Partial<FieldLayout>
): EditorField {
  const id = createId(type);
  const name = `${type}_${id.slice(-4)}`;
  const labelMap: Record<FieldType, string> = {
    label: "Beschriftung",
    text: "Textfeld",
    number: "Zahl",
  };
  const layout = findAvailableSlot(
    existingFields,
    DEFAULT_FIELD_SIZE.w,
    DEFAULT_FIELD_SIZE.h
  );
  const mergedLayout = layoutOverride
    ? clampLayout({
        ...layout,
        ...layoutOverride,
      } as FieldLayout)
    : layout;
  const baseField: EditorField = {
    id,
    type,
    name,
    label: labelMap[type] || name,
    placeholder: "",
    required: false,
    validation: {},
    defaultValue: null,
    layout: {
      ...mergedLayout,
      layer: existingFields.length,
      align: mergedLayout.align ?? "left",
    },
    printStyles: {},
  };

  if (type === "number") {
    baseField.validation = { min: null, max: null, step: null };
    baseField.unit = "";
  } else if (type === "text") {
    baseField.validation = { maxLength: null };
    baseField.multiline = false;
  } else if (type === "label") {
    baseField.style = "body";
  }

  return baseField;
}

function createId(type: FieldType): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${type}_${Math.random().toString(36).slice(2, 10)}`;
}

function doesOverlap(a: FieldLayout, b: FieldLayout): boolean {
  const horizontal = a.x < b.x + b.w && a.x + a.w > b.x;
  const vertical = a.y < b.y + b.h && a.y + a.h > b.y;
  return horizontal && vertical;
}

function findAvailableSlot(
  fields: EditorField[],
  width: number,
  height: number
): FieldLayout {
  const maxRows = GRID_ROWS - height;
  const maxCols = GRID_COLUMNS - width;
  for (let row = 0; row <= maxRows; row += 1) {
    for (let col = 0; col <= maxCols; col += 1) {
      const layout = {
        x: col,
        y: row,
        w: width,
        h: height,
        layer: 0,
        align: "left" as const,
      };
      const overlaps = fields.some((field) =>
        doesOverlap(field.layout, layout)
      );
      if (!overlaps) {
        return layout;
      }
    }
  }
  return {
    x: 0,
    y: 0,
    w: width,
    h: height,
    layer: 0,
    align: "left",
  };
}

let currentSnapshot = createEmptySnapshot();

function getLatestRevisionSummary(
  template: TemplateDocument | null | undefined
): string | null {
  if (!template || !Array.isArray(template.revisions)) {
    return null;
  }
  let latest: TemplateRevision | null = null;
  for (const revision of template.revisions) {
    if (!revision) {
      continue;
    }
    if (!latest || (revision.version ?? 0) > (latest.version ?? 0)) {
      latest = revision;
    }
  }
  if (!latest) {
    return null;
  }
  const summary = latest.summary;
  return summary && summary.trim() ? summary.trim() : null;
}

export function createEditorStore(
  options: EditorStoreOptions = {}
): EditorStore {
  const preferenceDefaults = sanitizePreferencePatch(
    options.initialPreferences
  );
  const preferenceListener = options.onPreferencesChange ?? null;

  let state: EditorState = {
    ...currentSnapshot,
    undoStack: [],
    redoStack: [],
  };

  const listeners = new Set<(next: EditorState) => void>();

  function emitPreferenceChange(): void {
    if (!preferenceListener) {
      return;
    }
    preferenceListener({
      gridVisible: state.gridVisible,
      snapping: state.snapping,
      zoom: state.zoom,
    });
  }

  function notify(next: EditorState): void {
    listeners.forEach((listener) => listener(next));
  }

  function getState(): EditorState {
    return state;
  }

  function setState(next: EditorState): void {
    state = next;
    currentSnapshot = {
      templateId: state.templateId,
      name: state.name,
      description: state.description,
      version: state.version,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      lastSummary: state.lastSummary,
      layoutMeta: state.layoutMeta,
      revisions: state.revisions,
      selectedRevisionVersion: state.selectedRevisionVersion,
      fields: state.fields,
      selectedFieldIds: state.selectedFieldIds,
      gridVisible: state.gridVisible,
      snapping: state.snapping,
      zoom: state.zoom,
      dirty: state.dirty,
    };
    notify(state);
  }

  function subscribe(listener: (next: EditorState) => void): () => void {
    listeners.add(listener);
    listener(state);
    return () => listeners.delete(listener);
  }

  function reset(): void {
    setState({
      ...createEmptySnapshot(),
      undoStack: [],
      redoStack: [],
    });
    if (preferenceDefaults) {
      applyPreferences(preferenceDefaults);
    }
  }

  function addField(
    type: FieldType,
    initialLayout?: Partial<FieldLayout>
  ): EditorField {
    const historySnapshot = createSnapshotFromState(state);
    const field = createDefaultField(type, state.fields, initialLayout);
    setState({
      ...state,
      fields: [...state.fields, field],
      selectedFieldIds: [field.id],
      dirty: true,
      undoStack: pushSnapshot(state.undoStack, historySnapshot),
      redoStack: [],
    });
    return field;
  }

  function updateFieldLayout(id: string, layout: FieldLayout): void {
    const historySnapshot = createSnapshotFromState(state);
    const nextFields = state.fields.map((field) => {
      if (field.id !== id) {
        return field;
      }
      const nextLayout = clampLayout({
        ...layout,
        layer: field.layout.layer,
        align: field.layout.align,
      });
      return {
        ...field,
        layout: nextLayout,
      };
    });
    setState({
      ...state,
      fields: nextFields,
      dirty: true,
      undoStack: pushSnapshot(state.undoStack, historySnapshot),
      redoStack: [],
    });
  }

  function updateField(
    id: string,
    patch: Partial<Omit<EditorField, "id" | "layout">> & {
      layout?: Partial<FieldLayout>;
    }
  ): void {
    const historySnapshot = createSnapshotFromState(state);
    const nextFields = state.fields.map((field) => {
      if (field.id !== id) {
        return field;
      }
      const nextLayout = patch.layout
        ? {
            ...field.layout,
            ...patch.layout,
          }
        : field.layout;
      const nextField: EditorField = {
        ...field,
        ...patch,
        layout: nextLayout,
      } as EditorField;
      return nextField;
    });
    setState({
      ...state,
      fields: nextFields,
      dirty: true,
      undoStack: pushSnapshot(state.undoStack, historySnapshot),
      redoStack: [],
    });
  }

  function updateFields(
    ids: string[],
    patch: Partial<Omit<EditorField, "id" | "layout">> & {
      layout?: Partial<FieldLayout>;
    }
  ): void {
    const idSet = new Set(ids);
    if (!idSet.size) {
      return;
    }

    const historySnapshot = createSnapshotFromState(state);
    const layoutPatch = patch.layout;
    const valuePatch = { ...patch };
    delete (valuePatch as { layout?: Partial<FieldLayout> }).layout;

    let changed = false;
    const nextFields = state.fields.map((field) => {
      if (!idSet.has(field.id)) {
        return field;
      }

      let updatedField: EditorField = field;
      if (layoutPatch) {
        const nextLayout = clampLayout({
          ...field.layout,
          ...layoutPatch,
        } as FieldLayout);
        if (!layoutsEqual(nextLayout, field.layout)) {
          updatedField = {
            ...updatedField,
            layout: nextLayout,
          };
        }
      }

      for (const [key, value] of Object.entries(valuePatch) as Array<
        [keyof typeof valuePatch, unknown]
      >) {
        if (value === undefined) {
          continue;
        }
        const targetKey = key as keyof EditorField;
        if ((updatedField as any)[targetKey] !== value) {
          if (updatedField === field) {
            updatedField = { ...updatedField };
          }
          (updatedField as any)[targetKey] = value;
        }
      }

      if (updatedField !== field) {
        changed = true;
      }
      return updatedField;
    });

    if (!changed) {
      return;
    }

    setState({
      ...state,
      fields: nextFields,
      dirty: true,
      undoStack: pushSnapshot(state.undoStack, historySnapshot),
      redoStack: [],
    });
  }

  function removeField(id: string): void {
    removeFields([id]);
  }

  function removeFields(ids: string[]): void {
    const toRemove = new Set(ids);
    if (!toRemove.size) {
      return;
    }
    const nextFields = state.fields.filter((field) => !toRemove.has(field.id));
    if (nextFields.length === state.fields.length) {
      return;
    }
    const historySnapshot = createSnapshotFromState(state);
    setState({
      ...state,
      fields: normalizeLayers(nextFields),
      selectedFieldIds: state.selectedFieldIds.filter(
        (fieldId) => !toRemove.has(fieldId)
      ),
      dirty: true,
      undoStack: pushSnapshot(state.undoStack, historySnapshot),
      redoStack: [],
    });
  }

  function duplicateFields(ids: string[]): EditorField[] {
    const selected = ids
      .map((id) => state.fields.find((field) => field.id === id))
      .filter((field): field is EditorField => Boolean(field));
    if (!selected.length) {
      return [];
    }

    const historySnapshot = createSnapshotFromState(state);
    const existingNames = new Set(state.fields.map((field) => field.name));
    const maxLayer = state.fields.reduce(
      (acc, field) => Math.max(acc, field.layout.layer ?? 0),
      0
    );

    const duplicates = selected.map((field, index) => {
      const id = createId(field.type);
      const baseName = `${field.name}_copy`;
      let candidate = baseName;
      let counter = 1;
      while (existingNames.has(candidate)) {
        counter += 1;
        candidate = `${baseName}_${counter}`;
      }
      existingNames.add(candidate);

      const cloned = cloneField(field);
      cloned.id = id;
      cloned.name = candidate;
      cloned.layout = clampLayout({
        ...cloned.layout,
        x: field.layout.x + 1,
        y: field.layout.y + 1,
        layer: maxLayer + index + 1,
      });
      return cloned;
    });

    const nextFields = [...state.fields, ...duplicates];
    setState({
      ...state,
      fields: normalizeLayers(nextFields),
      selectedFieldIds: duplicates.map((field) => field.id),
      dirty: true,
      undoStack: pushSnapshot(state.undoStack, historySnapshot),
      redoStack: [],
    });

    return duplicates;
  }

  function bringFieldsToFront(ids: string[]): void {
    if (!ids.length) {
      return;
    }
    const idSet = new Set(ids);
    const moving = state.fields.filter((field) => idSet.has(field.id));
    if (!moving.length) {
      return;
    }
    const stationary = state.fields.filter((field) => !idSet.has(field.id));
    const reordered = [...stationary, ...moving];
    const historySnapshot = createSnapshotFromState(state);
    const nextFields = normalizeLayers(reordered);
    setState({
      ...state,
      fields: nextFields,
      dirty: true,
      undoStack: pushSnapshot(state.undoStack, historySnapshot),
      redoStack: [],
    });
  }

  function sendFieldsToBack(ids: string[]): void {
    if (!ids.length) {
      return;
    }
    const idSet = new Set(ids);
    const moving = state.fields.filter((field) => idSet.has(field.id));
    if (!moving.length) {
      return;
    }
    const stationary = state.fields.filter((field) => !idSet.has(field.id));
    const reordered = [...moving, ...stationary];
    const historySnapshot = createSnapshotFromState(state);
    const nextFields = normalizeLayers(reordered);
    setState({
      ...state,
      fields: nextFields,
      dirty: true,
      undoStack: pushSnapshot(state.undoStack, historySnapshot),
      redoStack: [],
    });
  }

  function loadTemplate(template: TemplateDocument): void {
    const settings = template.settings || {
      gridVisible: true,
      snapping: true,
      zoom: DEFAULT_ZOOM,
    };
    const createdAt = template.createdAt ?? null;
    const updatedAt = template.updatedAt ?? createdAt;
    const lastSummary = getLatestRevisionSummary(template);
    const revisions = Array.isArray(template.revisions)
      ? template.revisions.map((revision) => ({ ...revision }))
      : [];
    const nextZoom = clampZoom(settings.zoom ?? DEFAULT_ZOOM);
    const nextState: EditorState = {
      ...state,
      templateId: template.id,
      name: template.name,
      description: template.description ?? "",
      version: template.version ?? 1,
      createdAt,
      updatedAt,
      lastSummary,
      revisions,
      selectedRevisionVersion: template.version ?? null,
      layoutMeta: { ...template.layoutMeta },
      fields: template.fields.map(cloneField),
      selectedFieldIds: [],
      gridVisible: settings.gridVisible ?? true,
      snapping: settings.snapping ?? true,
      zoom: nextZoom,
      undoStack: [],
      redoStack: [],
      dirty: false,
    };
    setState(nextState);
  }

  function markSaved(meta: {
    id: string;
    version: number;
    updatedAt: string;
    summary?: string | null;
    revisions?: TemplateRevision[];
  }): void {
    const summary =
      meta.summary && meta.summary.trim()
        ? meta.summary.trim()
        : state.lastSummary;
    const updatedAt = meta.updatedAt;
    const createdAt = state.createdAt ?? updatedAt;
    const revisions = Array.isArray(meta.revisions)
      ? meta.revisions.map((revision) => ({ ...revision }))
      : state.revisions;
    setState({
      ...state,
      templateId: meta.id,
      version: meta.version,
      createdAt,
      updatedAt,
      lastSummary: summary ?? null,
      revisions,
      selectedRevisionVersion: meta.version,
      dirty: false,
    });
  }

  function setTemplateMeta(meta: {
    name?: string;
    description?: string;
  }): void {
    if (!meta.name && !meta.description) {
      return;
    }
    const nextName = meta.name ?? state.name;
    const nextDescription = meta.description ?? state.description;
    if (nextName === state.name && nextDescription === state.description) {
      return;
    }
    const historySnapshot = createSnapshotFromState(state);
    setState({
      ...state,
      name: nextName,
      description: nextDescription,
      dirty: true,
      undoStack: pushSnapshot(state.undoStack, historySnapshot),
      redoStack: [],
    });
  }

  function selectField(id: string | null): void {
    const alreadySelected =
      id !== null &&
      state.selectedFieldIds.length === 1 &&
      state.selectedFieldIds[0] === id;
    const alreadyCleared = id === null && state.selectedFieldIds.length === 0;
    if (alreadySelected || alreadyCleared) {
      return;
    }
    setState({
      ...state,
      selectedFieldIds: id ? [id] : [],
    });
  }

  function selectFields(ids: string[]): void {
    const nextSelection = Array.from(new Set(ids));
    const unchanged =
      nextSelection.length === state.selectedFieldIds.length &&
      nextSelection.every((id, index) => id === state.selectedFieldIds[index]);
    if (unchanged) {
      return;
    }
    setState({
      ...state,
      selectedFieldIds: nextSelection,
    });
  }

  function toggleGrid(): void {
    const historySnapshot = createSnapshotFromState(state);
    setState({
      ...state,
      gridVisible: !state.gridVisible,
      dirty: true,
      undoStack: pushSnapshot(state.undoStack, historySnapshot),
      redoStack: [],
    });
    emitPreferenceChange();
  }

  function toggleSnapping(): void {
    const historySnapshot = createSnapshotFromState(state);
    setState({
      ...state,
      snapping: !state.snapping,
      dirty: true,
      undoStack: pushSnapshot(state.undoStack, historySnapshot),
      redoStack: [],
    });
    emitPreferenceChange();
  }

  function setZoom(value: number): void {
    const nextZoom = clampZoom(value);
    if (nextZoom === state.zoom) {
      return;
    }
    const historySnapshot = createSnapshotFromState(state);
    setState({
      ...state,
      zoom: nextZoom,
      dirty: true,
      undoStack: pushSnapshot(state.undoStack, historySnapshot),
      redoStack: [],
    });
    emitPreferenceChange();
  }

  function applyPreferences(preferences: EditorPreferencePatch): void {
    let changed = false;
    let nextGrid = state.gridVisible;
    if (typeof preferences.gridVisible === "boolean") {
      nextGrid = preferences.gridVisible;
      changed = changed || nextGrid !== state.gridVisible;
    }

    let nextSnapping = state.snapping;
    if (typeof preferences.snapping === "boolean") {
      nextSnapping = preferences.snapping;
      changed = changed || nextSnapping !== state.snapping;
    }

    let nextZoom = state.zoom;
    if (typeof preferences.zoom === "number") {
      nextZoom = clampZoom(preferences.zoom);
      changed = changed || nextZoom !== state.zoom;
    }

    if (!changed) {
      return;
    }

    setState({
      ...state,
      gridVisible: nextGrid,
      snapping: nextSnapping,
      zoom: nextZoom,
      dirty: state.dirty,
      undoStack: state.undoStack,
      redoStack: state.redoStack,
    });
  }

  function selectRevision(version: number | null): void {
    const nextVersion = version ?? null;
    if (state.selectedRevisionVersion === nextVersion) {
      return;
    }
    setState({
      ...state,
      selectedRevisionVersion: nextVersion,
    });
  }

  function restoreRevision(revision: TemplateRevision): void {
    if (!revision || !revision.snapshot) {
      console.warn(
        "Keine Snapshot-Daten für die ausgewählte Revision vorhanden."
      );
      return;
    }

    const snapshot = revision.snapshot;
    const settings = snapshot.settings || {
      gridVisible: true,
      snapping: true,
    };
    const restoredZoom = clampZoom(settings.zoom ?? DEFAULT_ZOOM);
    const restoredFields = normalizeLayers(snapshot.fields.map(cloneField));

    setState({
      ...state,
      name: snapshot.name || state.name,
      description:
        typeof snapshot.description === "string"
          ? snapshot.description
          : state.description,
      layoutMeta: { ...snapshot.layoutMeta },
      fields: restoredFields,
      gridVisible:
        typeof settings.gridVisible === "boolean" ? settings.gridVisible : true,
      snapping:
        typeof settings.snapping === "boolean" ? settings.snapping : true,
      zoom: restoredZoom,
      undoStack: [],
      redoStack: [],
      dirty: true,
      selectedFieldIds: [],
      selectedRevisionVersion: revision.version ?? null,
      lastSummary: revision.summary ?? state.lastSummary,
    });
  }

  function setRevisionSnapshot(
    version: number,
    snapshot: TemplateRevisionSnapshot | null | undefined
  ): void {
    if (!Number.isFinite(version)) {
      return;
    }

    let changed = false;
    const targetVersion = Math.trunc(version);
    const nextRevisions = state.revisions.map((entry) => {
      if (!entry || Math.trunc(entry.version ?? Number.NaN) !== targetVersion) {
        return entry;
      }
      if (entry.snapshot === snapshot) {
        return entry;
      }
      const nextEntry = {
        ...entry,
        snapshot,
      };
      if (nextEntry !== entry) {
        changed = true;
      }
      return nextEntry;
    });

    if (!changed) {
      return;
    }

    setState({
      ...state,
      revisions: nextRevisions,
    });
  }

  function undo(): void {
    if (!state.undoStack.length) {
      return;
    }
    const previousSnapshot =
      state.undoStack[state.undoStack.length - 1] ?? null;
    if (!previousSnapshot) {
      return;
    }
    const nextUndoStack = state.undoStack.slice(0, -1);
    const redoSnapshot = createSnapshotFromState(state);
    const nextRedoStack = pushSnapshot(state.redoStack, redoSnapshot);
    setState(
      rehydrateStateFromSnapshot(previousSnapshot, nextUndoStack, nextRedoStack)
    );
  }

  function redo(): void {
    if (!state.redoStack.length) {
      return;
    }
    const nextSnapshot = state.redoStack[state.redoStack.length - 1] ?? null;
    if (!nextSnapshot) {
      return;
    }
    const nextRedoStack = state.redoStack.slice(0, -1);
    const undoSnapshot = createSnapshotFromState(state);
    const nextUndoStack = pushSnapshot(state.undoStack, undoSnapshot);
    setState(
      rehydrateStateFromSnapshot(nextSnapshot, nextUndoStack, nextRedoStack)
    );
  }

  if (preferenceDefaults) {
    applyPreferences(preferenceDefaults);
  }

  return {
    getState,
    subscribe,
    reset,
    addField,
    updateFieldLayout,
    updateField,
    updateFields,
    removeField,
    removeFields,
    duplicateFields,
    bringFieldsToFront,
    sendFieldsToBack,
    loadTemplate,
    markSaved,
    setTemplateMeta,
    selectField,
    selectFields,
    toggleGrid,
    toggleSnapping,
    setZoom,
    applyPreferences,
    selectRevision,
    restoreRevision,
    setRevisionSnapshot,
    undo,
    redo,
  };
}

export type { EditorStore };

function normalizeLayers(fields: EditorField[]): EditorField[] {
  return fields.map((field, index) => ({
    ...field,
    layout: {
      ...field.layout,
      layer: index,
    },
  }));
}
