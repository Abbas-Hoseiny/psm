/**
 * View Counter Client
 * Minimalistisches Modul für externe View-Statistiken
 * API: https://api.digitale-psm.de
 */

const API_BASE = "https://api.digitale-psm.de";
const DOMAIN = "digitale-psm.de";

export type PageType = "app" | "info" | "statistik";

interface ViewResponse {
  domain: string;
  page: string;
  views: number;
  counted?: boolean;
  unique?: boolean;
}

interface AllViewsResponse {
  domain: string;
  pages: Record<string, { views: number; unique: number }>;
  total: number;
}

/**
 * Zählt einen View für die angegebene Seite
 * Wird automatisch dedupliziert (30 Min Session)
 */
export async function countView(page: PageType): Promise<number | null> {
  try {
    const response = await fetch(
      `${API_BASE}/api/v1/${DOMAIN}/views/${page}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }
    );

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data: ViewResponse = await response.json();
    return data.views;
  } catch (err) {
    console.warn("[ViewCounter] Fehler beim Zählen:", err);
    return null;
  }
}

/**
 * Ruft alle Views für die Domain ab
 */
export async function getAllViews(): Promise<AllViewsResponse | null> {
  try {
    const response = await fetch(`${API_BASE}/api/v1/${DOMAIN}/views`);

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    return await response.json();
  } catch (err) {
    console.warn("[ViewCounter] Fehler beim Abrufen:", err);
    return null;
  }
}

/**
 * Ruft Views für eine bestimmte Seite ab
 */
export async function getViewsForPage(
  page: PageType
): Promise<number | null> {
  try {
    const response = await fetch(
      `${API_BASE}/api/v1/${DOMAIN}/views/${page}`
    );

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data: ViewResponse = await response.json();
    return data.views;
  } catch {
    return null;
  }
}

/**
 * Formatiert Zahl schön (1234 -> "1.234")
 */
export function formatViewCount(count: number): string {
  return count.toLocaleString("de-DE");
}

/**
 * Kompakte Formatierung (1234 -> "1,2K")
 */
export function formatViewCountCompact(count: number): string {
  if (count >= 1000000) {
    return (count / 1000000).toFixed(1).replace(".", ",") + "M";
  }
  if (count >= 1000) {
    return (count / 1000).toFixed(1).replace(".", ",") + "K";
  }
  return count.toString();
}
