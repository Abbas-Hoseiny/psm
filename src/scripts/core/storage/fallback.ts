const STORAGE_KEY = 'pflanzenschutzliste-db';

function hasLocalStorage(): boolean {
  try {
    const key = '__storage_test__';
    window.localStorage.setItem(key, '1');
    window.localStorage.removeItem(key);
    return true;
  } catch (err) {
    return false;
  }
}

export function isSupported(): boolean {
  return typeof window !== 'undefined' && hasLocalStorage();
}

export async function create(initialData: any): Promise<{ data: any; context: any }> {
  if (!isSupported()) {
    throw new Error('LocalStorage nicht verfügbar');
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(initialData));
  return { data: initialData, context: { storageKey: STORAGE_KEY } };
}

export async function open(): Promise<{ data: any; context: any }> {
  if (!isSupported()) {
    throw new Error('LocalStorage nicht verfügbar');
  }
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    throw new Error('Keine gespeicherten Daten gefunden');
  }
  return { data: JSON.parse(raw), context: { storageKey: STORAGE_KEY } };
}

export async function save(data: any): Promise<{ context: any }> {
  if (!isSupported()) {
    throw new Error('LocalStorage nicht verfügbar');
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  return { context: { storageKey: STORAGE_KEY } };
}

export function getContext(): any {
  return { storageKey: STORAGE_KEY };
}

export function reset(): void {
  if (!isSupported()) {
    return;
  }
  window.localStorage.removeItem(STORAGE_KEY);
}
