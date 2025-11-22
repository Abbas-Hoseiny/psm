import { getDefaultsConfig } from "./config";
import { resolveFieldLabels } from "./labels";
import { getState, patchState } from "./state";

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

export function applyDatabase(data: any): void {
  if (!data) {
    throw new Error("Keine Daten zum Anwenden übergeben");
  }
  const current = getState();
  const fieldLabels = resolveFieldLabels(data.meta?.fieldLabels ?? {});
  patchState({
    company: { ...current.company, ...(data.meta?.company ?? {}) },
    defaults: mergeDefaults(current.defaults, data.meta?.defaults ?? {}),
    measurementMethods: [
      ...(data.meta?.measurementMethods ?? current.measurementMethods),
    ],
    mediums: [...(data.mediums ?? [])],
    history: [...(data.history ?? [])],
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
    if ("templates" in base) {
      delete base.templates;
    }
    const merged = deepMerge(base, overrides);
    if ("templates" in merged) {
      delete (merged as any).templates;
    }
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
  };
  const merged = deepMerge(base, overrides);
  if ("templates" in merged) {
    delete (merged as any).templates;
  }
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
  };
}
