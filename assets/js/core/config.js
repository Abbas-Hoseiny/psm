import { resolveFieldLabels } from './labels.js';
import { getState, patchState } from './state.js';

let cachedDefaults = null;

function mergeDefaults(base = {}, incoming = {}) {
  const merged = { ...base, ...incoming };
  merged.form = {
    ...(base.form || { creator: '', location: '', crop: '', quantity: '' }),
    ...(incoming.form || {})
  };
  return merged;
}

export async function loadDefaultsConfig() {
  if (cachedDefaults) {
    return cachedDefaults;
  }
  const response = await fetch('assets/config/defaults.json', { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`defaults.json not found (${response.status})`);
  }
  const defaults = await response.json();
  cachedDefaults = defaults;

  const current = getState();
  patchState({
    app: {
      ...current.app,
      version: defaults.meta?.version ?? 1
    }
  });

  // Apply defaults to store
  patchState({
    company: { ...current.company, ...(defaults.meta?.company ?? {}) },
    defaults: mergeDefaults(current.defaults, defaults.meta?.defaults ?? {}),
    measurementMethods: [...(defaults.meta?.measurementMethods ?? [])],
    mediums: [...(defaults.mediums ?? [])],
    history: [...(defaults.history ?? [])],
    fieldLabels: resolveFieldLabels(defaults.meta?.fieldLabels ?? {})
  });

  return cachedDefaults;
}

export function getDefaultsConfig() {
  return cachedDefaults;
}
