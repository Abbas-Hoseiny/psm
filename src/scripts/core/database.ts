import { getDefaultsConfig } from "./config";
import { resolveFieldLabels } from "./labels";
import { getState, patchState } from "./state";
import {
  cloneTemplateDocument,
  normalizeTemplateDocument,
} from "../features/templates/persistence";
import type { TemplateDocument } from "../features/templates/types";

function clone(obj: any): any {
  return JSON.parse(JSON.stringify(obj));
}

function deepMerge(target: any, source: any): any {
  if (!source || typeof source !== "object") {
    return target;
  }
  const result = Array.isArray(target) ? [...target] : { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        item && typeof item === "object" ? clone(item) : item
      );
      continue;
    }
    if (value && typeof value === "object") {
      const baseValue =
        result[key] &&
        typeof result[key] === "object" &&
        !Array.isArray(result[key])
          ? result[key]
          : {};
      result[key] = deepMerge(baseValue, value);
      continue;
    }
    result[key] = value;
  }
  return result;
}

function mergeDefaults(base: any = {}, incoming: any = {}): any {
  const merged = { ...base, ...incoming };
  merged.form = {
    ...(base.form || { creator: "", location: "", crop: "", quantity: "" }),
    ...(incoming.form || {}),
  };
  return merged;
}

function normalizeTemplates(input: unknown): TemplateDocument[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const templates: TemplateDocument[] = [];
  for (const candidate of input) {
    const normalized = normalizeTemplateDocument(candidate);
    if (normalized) {
      templates.push(normalized);
    }
  }
  templates.sort((a, b) => {
    const aTime = Date.parse(a.updatedAt ?? "") || 0;
    const bTime = Date.parse(b.updatedAt ?? "") || 0;
    return bTime - aTime;
  });
  return templates;
}

export function applyDatabase(data: any): void {
  if (!data) {
    throw new Error("Keine Daten zum Anwenden übergeben");
  }
  const current = getState();
  const fieldLabels = resolveFieldLabels(data.meta?.fieldLabels ?? {});
  const templates = normalizeTemplates(data.templates ?? []);
  patchState({
    company: { ...current.company, ...(data.meta?.company ?? {}) },
    defaults: mergeDefaults(current.defaults, data.meta?.defaults ?? {}),
    measurementMethods: [
      ...(data.meta?.measurementMethods ?? current.measurementMethods),
    ],
    mediums: [...(data.mediums ?? [])],
    history: [...(data.history ?? [])],
    templates,
    fieldLabels,
    app: {
      ...current.app,
      hasDatabase: true,
    },
  });
}

export function createInitialDatabase(overrides: any = {}): any {
  const defaults = getDefaultsConfig();
  if (defaults) {
    const base = clone(defaults);
    base.meta = base.meta || {};
    base.meta.fieldLabels = resolveFieldLabels(base.meta.fieldLabels ?? {});
    base.meta.defaults = mergeDefaults(
      {
        waterPerKisteL: 5,
        kistenProAr: 300,
        form: {
          creator: "",
          location: "",
          crop: "",
          quantity: "",
        },
      },
      base.meta.defaults ?? {}
    );
    base.templates = normalizeTemplates(base.templates);
    const merged = deepMerge(base, overrides);
    merged.templates = normalizeTemplates((merged as any).templates);
    return merged;
  }
  const state = getState();
  const base = {
    meta: {
      version: state.app.version || 1,
      company: { ...state.company },
      defaults: { ...state.defaults },
      measurementMethods: [...state.measurementMethods],
      fieldLabels: { ...state.fieldLabels },
    },
    mediums: [...state.mediums],
    history: [],
    templates: state.templates.map(cloneTemplateDocument),
  };
  const merged = deepMerge(base, overrides);
  merged.templates = normalizeTemplates((merged as any).templates);
  return merged;
}

export function getDatabaseSnapshot(): any {
  const state = getState();
  return {
    meta: {
      version: state.app.version || 1,
      company: { ...state.company },
      defaults: { ...state.defaults },
      measurementMethods: [...state.measurementMethods],
      fieldLabels: { ...state.fieldLabels },
    },
    mediums: [...state.mediums],
    history: [...state.history],
    templates: state.templates.map(cloneTemplateDocument),
  };
}
