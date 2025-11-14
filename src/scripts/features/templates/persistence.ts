import { DEFAULT_LAYOUT_META, clampLayout } from "./utils/grid";
import type {
  EditorField,
  EditorState,
  FieldLayout,
  FieldType,
  LayoutMeta,
  TemplateDocument,
  TemplateRevision,
  TemplateRevisionSnapshot,
  TemplateSettings,
  ValidationConfig,
} from "./types";

const VALID_FIELD_TYPES: FieldType[] = ["label", "text", "number"];
const DEFAULT_TEMPLATE_SETTINGS: TemplateSettings = {
  gridVisible: true,
  snapping: true,
  zoom: 0.85,
};

function generateFieldId(type: FieldType): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${type}_${crypto.randomUUID()}`;
  }
  return `${type}_${Math.random().toString(36).slice(2, 10)}`;
}

export function generateTemplateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `tpl_${Math.random().toString(36).slice(2, 10)}`;
}

export function cloneField(field: EditorField): EditorField {
  return {
    ...field,
    validation: { ...field.validation },
    layout: { ...field.layout },
    printStyles: { ...field.printStyles },
  };
}

export function cloneTemplateDocument(
  template: TemplateDocument
): TemplateDocument {
  return {
    ...template,
    layoutMeta: { ...template.layoutMeta },
    fields: template.fields.map(cloneField),
    settings: { ...template.settings },
    revisions: template.revisions
      ? template.revisions.map((revision) => cloneTemplateRevision(revision))
      : undefined,
  };
}

function cloneRevisionSnapshot(
  snapshot: TemplateRevisionSnapshot | null | undefined
): TemplateRevisionSnapshot | undefined {
  if (!snapshot) {
    return undefined;
  }
  return {
    name: snapshot.name,
    description: snapshot.description,
    layoutMeta: { ...snapshot.layoutMeta },
    fields: snapshot.fields.map(cloneField),
    settings: { ...snapshot.settings },
  };
}

function cloneTemplateRevision(revision: TemplateRevision): TemplateRevision {
  const cloned: TemplateRevision = {
    version: revision.version,
    updatedAt: revision.updatedAt,
    summary: revision.summary,
  };
  if ("snapshot" in revision) {
    cloned.snapshot =
      revision.snapshot === undefined
        ? undefined
        : revision.snapshot
          ? cloneRevisionSnapshot(revision.snapshot)
          : null;
  }
  return cloned;
}

export function ensureUniqueTemplateName(
  baseName: string,
  templates: TemplateDocument[]
): string {
  const trimmed = baseName.trim() || "Neue Vorlage";
  let candidate = trimmed;
  let counter = 1;
  const existingNames = new Set(templates.map((item) => item.name));
  while (existingNames.has(candidate)) {
    counter += 1;
    candidate = `${trimmed} (${counter})`;
  }
  return candidate;
}

export function normalizeTemplateDocument(input: any): TemplateDocument | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const id =
    typeof input.id === "string" && input.id ? input.id : generateTemplateId();
  const name =
    typeof input.name === "string" && input.name.trim()
      ? input.name.trim()
      : "Neue Vorlage";
  const description =
    typeof input.description === "string" ? input.description : "";
  const version = Number.isFinite(Number(input.version))
    ? Number(input.version)
    : 1;
  const createdAtCandidate =
    typeof input.createdAt === "string" && input.createdAt
      ? input.createdAt
      : new Date().toISOString();
  const updatedAtCandidate =
    typeof input.updatedAt === "string" && input.updatedAt
      ? input.updatedAt
      : createdAtCandidate;

  const layoutMeta = normalizeLayoutMeta(input.layoutMeta);
  const rawFields = Array.isArray(input.fields) ? input.fields : [];
  const fields = rawFields
    .map((field: unknown) => normalizeField(field, layoutMeta))
    .filter((field: EditorField | null): field is EditorField =>
      Boolean(field)
    );

  const settings = normalizeSettings(input.settings);
  const revisionSnapshotBase: TemplateRevisionSnapshot = {
    name,
    description,
    layoutMeta: { ...layoutMeta },
    fields: fields.map(cloneField),
    settings: { ...settings },
  };
  const revisions = normalizeRevisionLog(
    input.revisions,
    version,
    updatedAtCandidate,
    revisionSnapshotBase
  );

  return {
    id,
    name,
    description,
    version,
    createdAt: createdAtCandidate,
    updatedAt: updatedAtCandidate,
    layoutMeta,
    fields,
    settings: settings ?? { ...DEFAULT_TEMPLATE_SETTINGS },
    revisions,
  };
}

export function createTemplateDocumentFromState(
  state: EditorState,
  options: {
    existing?: TemplateDocument | null;
    id?: string;
    name?: string;
    description?: string;
    version?: number;
    createdAt?: string;
    updatedAt?: string;
    summary?: string;
  } = {}
): TemplateDocument {
  const existing = options.existing ?? null;
  const now = new Date().toISOString();
  const id =
    options.id ?? existing?.id ?? state.templateId ?? generateTemplateId();
  const createdAt = options.createdAt ?? existing?.createdAt ?? now;
  const normalizedCreatedAt = state.createdAt ?? createdAt;
  const version =
    options.version ??
    (existing ? existing.version + 1 : (state.version ?? 1)) ??
    1;
  const updatedAt = options.updatedAt ?? now;
  const name = (
    options.name ??
    state.name ??
    existing?.name ??
    "Neue Vorlage"
  ).trim();
  const description =
    options.description ?? state.description ?? existing?.description ?? "";
  const revisionSnapshot = createRevisionSnapshotFromState(state, {
    name,
    description,
  });
  const revisions = mergeRevisions(
    existing?.revisions,
    version,
    updatedAt,
    options.summary,
    revisionSnapshot
  );

  return {
    id,
    name,
    description,
    version,
    createdAt: normalizedCreatedAt,
    updatedAt,
    layoutMeta: { ...state.layoutMeta },
    fields: state.fields.map(cloneField),
    settings: {
      gridVisible: state.gridVisible,
      snapping: state.snapping,
      zoom: state.zoom,
    },
    revisions,
  };
}

export function createRevisionSnapshotFromState(
  state: EditorState,
  overrides: { name?: string; description?: string } = {}
): TemplateRevisionSnapshot {
  const snapshotName =
    typeof overrides.name === "string" && overrides.name.trim()
      ? overrides.name.trim()
      : typeof state.name === "string" && state.name.trim()
        ? state.name.trim()
        : "Neue Vorlage";
  const snapshotDescription =
    typeof overrides.description === "string"
      ? overrides.description
      : (state.description ?? "");
  return {
    name: snapshotName,
    description: snapshotDescription,
    layoutMeta: { ...state.layoutMeta },
    fields: state.fields.map(cloneField),
    settings: {
      gridVisible: state.gridVisible,
      snapping: state.snapping,
      zoom: state.zoom,
    },
  };
}

export function normalizeRevisionSnapshotFromDocument(
  input: unknown,
  fallback?: TemplateRevisionSnapshot
): TemplateRevisionSnapshot | null {
  if (!input || typeof input !== "object") {
    return fallback ? (cloneRevisionSnapshot(fallback) ?? null) : null;
  }

  const raw = input as Record<string, unknown>;
  const baseLayout = fallback?.layoutMeta ?? DEFAULT_LAYOUT_META;
  const layoutMeta = normalizeLayoutMeta(
    (raw.layoutMeta as Partial<LayoutMeta> | undefined) ?? baseLayout
  );
  const fields = Array.isArray(raw.fields)
    ? raw.fields
        .map((field) => normalizeField(field, layoutMeta))
        .filter((field): field is EditorField => Boolean(field))
    : [];
  const settings =
    raw.settings && typeof raw.settings === "object"
      ? normalizeSettings(raw.settings)
      : fallback
        ? { ...fallback.settings }
        : { ...DEFAULT_TEMPLATE_SETTINGS };
  const name =
    typeof raw.name === "string" && raw.name.trim()
      ? raw.name.trim()
      : (fallback?.name ?? "Neue Vorlage");
  const description =
    typeof raw.description === "string"
      ? raw.description
      : (fallback?.description ?? "");

  return {
    name,
    description,
    layoutMeta,
    fields,
    settings,
  };
}

function normalizeLayoutMeta(
  meta: Partial<LayoutMeta> | undefined
): LayoutMeta {
  return {
    columns: sanitizePositiveInteger(
      meta?.columns,
      DEFAULT_LAYOUT_META.columns
    ),
    rows: sanitizePositiveInteger(meta?.rows, DEFAULT_LAYOUT_META.rows),
    cellWidth: sanitizePositiveNumber(
      meta?.cellWidth,
      DEFAULT_LAYOUT_META.cellWidth
    ),
    cellHeight: sanitizePositiveNumber(
      meta?.cellHeight,
      DEFAULT_LAYOUT_META.cellHeight
    ),
    padding: sanitizePositiveNumber(meta?.padding, DEFAULT_LAYOUT_META.padding),
  };
}

function normalizeSettings(settings: any): TemplateSettings {
  if (!settings || typeof settings !== "object") {
    return { ...DEFAULT_TEMPLATE_SETTINGS };
  }
  const zoomValue =
    typeof settings.zoom === "number" && Number.isFinite(settings.zoom)
      ? Number(settings.zoom)
      : DEFAULT_TEMPLATE_SETTINGS.zoom;
  return {
    gridVisible: Boolean(
      typeof settings.gridVisible === "boolean" ? settings.gridVisible : true
    ),
    snapping: Boolean(
      typeof settings.snapping === "boolean" ? settings.snapping : true
    ),
    zoom: Math.min(Math.max(zoomValue, 0.25), 3),
  };
}

function normalizeRevisionLog(
  input: unknown,
  currentVersion: number,
  updatedAt: string,
  currentSnapshot: TemplateRevisionSnapshot
): TemplateRevision[] {
  const revisions: TemplateRevision[] = [];
  const seen = new Set<number>();

  if (Array.isArray(input)) {
    for (const candidate of input) {
      if (!candidate || typeof candidate !== "object") {
        continue;
      }
      const raw = candidate as Record<string, unknown>;
      const parsedVersion = normalizeRevisionVersion(raw.version);
      if (!Number.isFinite(parsedVersion) || parsedVersion <= 0) {
        continue;
      }
      const version = Math.trunc(parsedVersion);
      if (seen.has(version)) {
        continue;
      }
      const entryUpdatedAt =
        typeof raw.updatedAt === "string" && raw.updatedAt
          ? raw.updatedAt
          : updatedAt;
      const summary =
        typeof raw.summary === "string" && raw.summary.trim()
          ? raw.summary.trim()
          : undefined;
      const snapshotSource = extractRevisionSnapshotSource(raw);
      const snapshot = snapshotSource
        ? normalizeRevisionSnapshot(snapshotSource, currentSnapshot)
        : version === currentVersion
          ? cloneRevisionSnapshot(currentSnapshot)
          : undefined;
      revisions.push({
        version,
        updatedAt: entryUpdatedAt,
        summary,
        snapshot,
      });
      seen.add(version);
    }
  }

  if (!seen.has(currentVersion)) {
    revisions.push({
      version: currentVersion,
      updatedAt,
      summary: undefined,
      snapshot: cloneRevisionSnapshot(currentSnapshot),
    });
  }

  revisions.sort((a, b) => a.version - b.version);
  return revisions;
}

function normalizeRevisionVersion(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return Number.parseInt(value, 10);
  }
  return Number.NaN;
}

function extractRevisionSnapshotSource(
  candidate: Record<string, unknown>
): unknown {
  const directSnapshot = candidate.snapshot;
  if (directSnapshot && typeof directSnapshot === "object") {
    return directSnapshot;
  }
  const documentSnapshot = candidate.document;
  if (documentSnapshot && typeof documentSnapshot === "object") {
    return documentSnapshot;
  }
  const rawJson =
    typeof candidate.documentJson === "string" && candidate.documentJson
      ? candidate.documentJson
      : typeof candidate.documentJSON === "string" && candidate.documentJSON
        ? candidate.documentJSON
        : undefined;
  if (rawJson) {
    try {
      return JSON.parse(rawJson);
    } catch (error) {
      console.warn("Konnte Revisions-Dokument nicht parsen", error);
    }
  }
  return undefined;
}

function normalizeRevisionSnapshot(
  source: unknown,
  fallback: TemplateRevisionSnapshot
): TemplateRevisionSnapshot | undefined {
  if (!source || typeof source !== "object") {
    return fallback ? cloneRevisionSnapshot(fallback) : undefined;
  }

  const raw = source as Record<string, unknown>;
  const layoutMeta = normalizeLayoutMeta(
    (raw.layoutMeta as Partial<LayoutMeta> | undefined) ?? fallback.layoutMeta
  );
  const fields = Array.isArray(raw.fields)
    ? raw.fields
        .map((field) => normalizeField(field, layoutMeta))
        .filter((field): field is EditorField => Boolean(field))
    : fallback
      ? fallback.fields.map(cloneField)
      : [];
  const settings =
    raw.settings && typeof raw.settings === "object"
      ? normalizeSettings(raw.settings)
      : { ...fallback.settings };
  const name =
    typeof raw.name === "string" && raw.name.trim()
      ? raw.name.trim()
      : fallback.name;
  const description =
    typeof raw.description === "string"
      ? raw.description
      : fallback.description;

  return {
    name,
    description,
    layoutMeta,
    fields,
    settings,
  };
}

function mergeRevisions(
  existing: TemplateRevision[] | undefined,
  version: number,
  updatedAt: string,
  summary?: string,
  snapshot?: TemplateRevisionSnapshot
): TemplateRevision[] {
  const revisions: TemplateRevision[] = [];

  if (Array.isArray(existing)) {
    for (const entry of existing) {
      if (!entry || typeof entry.version !== "number") {
        continue;
      }
      const entryVersion = Math.trunc(entry.version);
      if (entryVersion >= version) {
        continue;
      }
      const clonedSnapshot =
        entry.snapshot === undefined
          ? undefined
          : entry.snapshot
            ? cloneRevisionSnapshot(entry.snapshot)
            : null;
      revisions.push({
        version: entryVersion,
        updatedAt: entry.updatedAt,
        summary: entry.summary,
        snapshot: clonedSnapshot,
      });
    }
  }

  const normalizedSummary = summary?.trim() ? summary.trim() : undefined;
  const latestSnapshot = snapshot ? cloneRevisionSnapshot(snapshot) : undefined;
  revisions.push({
    version,
    updatedAt,
    summary: normalizedSummary,
    snapshot: latestSnapshot,
  });
  revisions.sort((a, b) => a.version - b.version);
  return revisions;
}

function normalizeField(
  input: unknown,
  layoutMeta: LayoutMeta
): EditorField | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const raw = input as Record<string, unknown>;
  const typeCandidate = typeof raw.type === "string" ? raw.type : "label";
  const type = (VALID_FIELD_TYPES as readonly string[]).includes(typeCandidate)
    ? (typeCandidate as FieldType)
    : "label";
  const id =
    typeof raw.id === "string" && raw.id ? raw.id : generateFieldId(type);
  const name =
    typeof raw.name === "string" && raw.name.trim()
      ? raw.name.trim()
      : `${type}_${id.slice(-4)}`;
  const label = typeof raw.label === "string" ? raw.label : name;
  const placeholder =
    typeof raw.placeholder === "string" ? raw.placeholder : "";
  const required = Boolean(raw.required);
  const validationSource =
    typeof raw.validation === "object" && raw.validation
      ? { ...(raw.validation as Record<string, unknown>) }
      : {};
  const defaultValue =
    typeof raw.defaultValue === "string" || typeof raw.defaultValue === "number"
      ? (raw.defaultValue as string | number)
      : null;
  const printStyles =
    typeof raw.printStyles === "object" && raw.printStyles
      ? { ...(raw.printStyles as Record<string, unknown>) }
      : {};

  const layoutSource = (raw.layout as Record<string, unknown>) || {};
  const layout: FieldLayout = clampLayout({
    x: sanitizePositiveInteger(layoutSource.x, 0),
    y: sanitizePositiveInteger(layoutSource.y, 0),
    w: sanitizePositiveInteger(layoutSource.w, 1),
    h: sanitizePositiveInteger(layoutSource.h, 1),
    layer: sanitizePositiveInteger(layoutSource.layer, 0),
    align: normalizeAlign(layoutSource.align),
  });

  layout.x = Math.min(layout.x, layoutMeta.columns - layout.w);
  layout.y = Math.min(layout.y, layoutMeta.rows - layout.h);

  const validation: ValidationConfig = {};
  if (type === "number") {
    validation.min = normalizeNullableNumber(validationSource.min);
    validation.max = normalizeNullableNumber(validationSource.max);
    validation.step = normalizePositiveNumberNullable(validationSource.step);
  } else {
    validation.min = null;
    validation.max = null;
    validation.step = null;
  }
  if (type === "text") {
    validation.maxLength = normalizePositiveIntegerNullable(
      validationSource.maxLength
    );
  } else {
    validation.maxLength = null;
  }
  const pattern =
    typeof validationSource.pattern === "string" &&
    validationSource.pattern.trim()
      ? validationSource.pattern
      : null;
  if (pattern) {
    validation.pattern = pattern;
  }

  const unit =
    type === "number" && typeof raw.unit === "string" ? raw.unit : "";
  const multiline = type === "text" ? Boolean(raw.multiline) : false;
  const style =
    type === "label" ? normalizeLabelStyle(raw.style) : ("body" as const);

  return {
    id,
    type,
    name,
    label,
    placeholder,
    required,
    validation,
    defaultValue,
    layout,
    printStyles,
    unit,
    multiline,
    style,
  };
}

function normalizeNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePositiveNumberNullable(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function normalizePositiveIntegerNullable(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.trunc(parsed);
}

function normalizeLabelStyle(value: unknown): "body" | "heading" | "muted" {
  if (value === "heading" || value === "muted") {
    return value;
  }
  return "body";
}

function normalizeAlign(value: unknown): FieldLayout["align"] {
  return value === "center" || value === "right" ? value : "left";
}

function sanitizePositiveInteger(value: unknown, fallback: number): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (Number.isFinite(parsed) && parsed >= 0) {
    return Math.trunc(parsed);
  }
  return fallback;
}

function sanitizePositiveNumber(value: unknown, fallback: number): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}
