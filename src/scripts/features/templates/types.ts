export type FieldType = "label" | "text" | "number";

export interface ValidationConfig {
  min?: number | null;
  max?: number | null;
  maxLength?: number | null;
  pattern?: string | null;
  step?: number | null;
}

export interface LayoutMeta {
  columns: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  padding: number;
}

export interface FieldLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  layer: number;
  align: "left" | "center" | "right";
}

export interface EditorField {
  id: string;
  type: FieldType;
  name: string;
  label: string;
  placeholder: string;
  required: boolean;
  validation: ValidationConfig;
  defaultValue: string | number | null;
  layout: FieldLayout;
  printStyles: Record<string, unknown>;
  unit?: string;
  multiline?: boolean;
  style?: "body" | "heading" | "muted";
}

export interface TemplateSettings {
  gridVisible: boolean;
  snapping: boolean;
  zoom: number;
}

export interface TemplateRevisionSnapshot {
  name: string;
  description: string;
  layoutMeta: LayoutMeta;
  fields: EditorField[];
  settings: TemplateSettings;
}

export interface TemplateRevision {
  version: number;
  updatedAt: string;
  summary?: string;
  snapshot?: TemplateRevisionSnapshot | null;
}

export interface TemplateDocument {
  id: string;
  name: string;
  description: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  layoutMeta: LayoutMeta;
  fields: EditorField[];
  settings: TemplateSettings;
  revisions?: TemplateRevision[];
}

export interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  version: number;
  updatedAt: string;
}

export interface EditorSnapshot {
  templateId: string | null;
  name: string;
  description: string;
  version: number;
  createdAt: string | null;
  updatedAt: string | null;
  lastSummary: string | null;
  revisions: TemplateRevision[];
  selectedRevisionVersion: number | null;
  layoutMeta: LayoutMeta;
  fields: EditorField[];
  selectedFieldIds: string[];
  gridVisible: boolean;
  snapping: boolean;
  zoom: number;
  dirty: boolean;
}

export interface EditorState extends EditorSnapshot {
  undoStack: EditorSnapshot[];
  redoStack: EditorSnapshot[];
}
