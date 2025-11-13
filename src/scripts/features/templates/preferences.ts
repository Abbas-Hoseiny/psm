import { clampZoom } from "./editorState";
import type {
  EditorPreferencePatch,
  EditorPreferenceSnapshot,
} from "./editorState";

const STORAGE_KEY = "pflanzenschutzliste:template-editor:preferences";

function getLocalStorageSafe(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch (error) {
    console.warn("Template-Editor: localStorage ist nicht verfügbar.", error);
    return null;
  }
}

export function loadEditorPreferences(): EditorPreferencePatch | null {
  const storage = getLocalStorageSafe();
  if (!storage) {
    return null;
  }
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const result: EditorPreferencePatch = {};
    if (typeof (parsed as any).gridVisible === "boolean") {
      result.gridVisible = Boolean((parsed as any).gridVisible);
    }
    if (typeof (parsed as any).snapping === "boolean") {
      result.snapping = Boolean((parsed as any).snapping);
    }
    if (typeof (parsed as any).zoom === "number") {
      const numericZoom = Number((parsed as any).zoom);
      if (Number.isFinite(numericZoom)) {
        result.zoom = clampZoom(numericZoom);
      }
    }
    return Object.keys(result).length ? result : null;
  } catch (error) {
    console.warn(
      "Template-Editor: Einstellungen konnten nicht geladen werden.",
      error
    );
    return null;
  }
}

export function saveEditorPreferences(
  preferences: EditorPreferenceSnapshot
): void {
  const storage = getLocalStorageSafe();
  if (!storage) {
    return;
  }
  const payload: Required<EditorPreferenceSnapshot> = {
    gridVisible: Boolean(preferences.gridVisible),
    snapping: Boolean(preferences.snapping),
    zoom: clampZoom(preferences.zoom),
  };
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn(
      "Template-Editor: Einstellungen konnten nicht gespeichert werden.",
      error
    );
  }
}
