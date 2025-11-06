import { getDefaultsConfig } from './config.js';
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

export function applyDatabase(data) {
  if (!data) {
    throw new Error('Keine Daten zum Anwenden übergeben');
  }
  const current = getState();
  patchState({
    company: { ...current.company, ...(data.meta?.company ?? {}) },
    defaults: { ...current.defaults, ...(data.meta?.defaults ?? {}) },
    measurementMethods: [...(data.meta?.measurementMethods ?? current.measurementMethods)],
    mediums: [...(data.mediums ?? [])],
    history: [...(data.history ?? [])],
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
    return deepMerge(base, overrides);
  }
  const state = getState();
  const base = {
    meta: {
      version: state.app.version || 1,
      company: { ...state.company },
      defaults: { ...state.defaults },
      measurementMethods: [...state.measurementMethods]
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
      measurementMethods: [...state.measurementMethods]
    },
    mediums: [...state.mediums],
    history: [...state.history]
  };
}
