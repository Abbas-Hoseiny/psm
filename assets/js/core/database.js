import { getDefaultsConfig } from './config.js';
import { resolveFieldLabels } from './labels.js';
import { getState, patchState } from './state.js';

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function deepMerge(target, source) {
  if (!source || typeof source !== 'object') {
    return target;
  }
  const result = Array.isArray(target) ? [...target] : { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      result[key] = value.map(item => (item && typeof item === 'object' ? clone(item) : item));
      continue;
    }
    if (value && typeof value === 'object') {
      const baseValue = result[key] && typeof result[key] === 'object' && !Array.isArray(result[key]) ? result[key] : {};
      result[key] = deepMerge(baseValue, value);
      continue;
    }
    result[key] = value;
  }
  return result;
}

function mergeDefaults(base = {}, incoming = {}) {
  const merged = { ...base, ...incoming };
  merged.form = {
    ...(base.form || { creator: '', location: '', crop: '', quantity: '' }),
    ...(incoming.form || {})
  };
  return merged;
}

export function applyDatabase(data) {
  if (!data) {
    throw new Error('Keine Daten zum Anwenden übergeben');
  }
  const current = getState();
  const fieldLabels = resolveFieldLabels(data.meta?.fieldLabels ?? {});
  patchState({
    company: { ...current.company, ...(data.meta?.company ?? {}) },
    defaults: mergeDefaults(current.defaults, data.meta?.defaults ?? {}),
    measurementMethods: [...(data.meta?.measurementMethods ?? current.measurementMethods)],
    mediums: [...(data.mediums ?? [])],
    history: [...(data.history ?? [])],
    fieldLabels,
    app: {
      ...current.app,
      hasDatabase: true
    }
  });
}

export function createInitialDatabase(overrides = {}) {
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
          creator: '',
          location: '',
          crop: '',
          quantity: ''
        }
      },
      base.meta.defaults ?? {}
    );
    return deepMerge(base, overrides);
  }
  const state = getState();
  const base = {
    meta: {
      version: state.app.version || 1,
      company: { ...state.company },
      defaults: { ...state.defaults },
      measurementMethods: [...state.measurementMethods],
      fieldLabels: { ...state.fieldLabels }
    },
    mediums: [...state.mediums],
    history: []
  };
  return deepMerge(base, overrides);
}

export function getDatabaseSnapshot() {
  const state = getState();
  return {
    meta: {
      version: state.app.version || 1,
      company: { ...state.company },
      defaults: { ...state.defaults },
      measurementMethods: [...state.measurementMethods],
      fieldLabels: { ...state.fieldLabels }
    },
    mediums: [...state.mediums],
    history: [...state.history]
  };
}
