/**
 * Core utility functions shared across the application.
 * These utilities are used for HTML escaping, number formatting,
 * and asynchronous frame scheduling.
 */

/**
 * Escapes HTML special characters to prevent XSS vulnerabilities.
 * @param value - The value to escape
 * @returns HTML-safe string
 */
export function escapeHtml(value: any): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Formats a number with fixed decimal places.
 * Returns a fallback value if the input is not a valid number.
 * @param value - The value to format
 * @param fractionDigits - Number of decimal places (default: 2)
 * @param fallback - Fallback value for invalid numbers (default: '–')
 * @returns Formatted number string
 */
export function formatNumber(
  value: any,
  fractionDigits: number = 2,
  fallback: string = "–"
): string {
  const num = Number.parseFloat(value);
  if (Number.isNaN(num)) {
    return fallback;
  }
  return num.toFixed(fractionDigits);
}

/**
 * Returns a Promise that resolves on the next animation frame.
 * Useful for yielding control to the browser and preventing UI blocking.
 * @returns Promise that resolves with the frame timestamp
 */
export function nextFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

/**
 * Simple debounce helper to limit how often a function runs.
 * Useful for input-driven handlers like autocomplete.
 * @param fn - callback function
 * @param delay - debounce interval in ms
 */
export function debounce<T extends (...args: any[]) => void>(
  fn: T,
  delay: number = 200
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, delay);
  };
}

/**
 * Formats latitude/longitude pairs into a simple string.
 * Accepts objects containing either latitude/longitude or lat/lng keys.
 */
export function formatGpsCoordinates(
  coords:
    | {
        latitude?: number | string;
        longitude?: number | string;
        lat?: number | string;
        lng?: number | string;
      }
    | null
    | undefined,
  fallback: string = ""
): string {
  if (!coords || typeof coords !== "object") {
    return fallback;
  }
  const latitude = Number(
    (coords as any).latitude ?? (coords as any).lat ?? Number.NaN
  );
  const longitude = Number(
    (coords as any).longitude ?? (coords as any).lng ?? Number.NaN
  );
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return fallback;
  }
  const format = (value: number) => value.toFixed(6);
  return `${format(latitude)}, ${format(longitude)}`;
}

/**
 * Builds a Google Maps URL that opens the provided coordinates in a new tab.
 * Returns null when the coordinates are invalid so callers can hide the link.
 */
export function buildGoogleMapsUrl(
  coords:
    | {
        latitude?: number | string;
        longitude?: number | string;
        lat?: number | string;
        lng?: number | string;
      }
    | null
    | undefined
): string | null {
  if (!coords || typeof coords !== "object") {
    return null;
  }
  const latitude = Number(
    (coords as any).latitude ?? (coords as any).lat ?? Number.NaN
  );
  const longitude = Number(
    (coords as any).longitude ?? (coords as any).lng ?? Number.NaN
  );
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  const query = encodeURIComponent(`${latitude},${longitude}`);
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

const GERMAN_DATE_FORMATTER = new Intl.DateTimeFormat("de-DE", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function formatDateGerman(date: Date): string {
  return GERMAN_DATE_FORMATTER.format(date);
}

export function parseGermanDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parts = trimmed.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const [day, month, year] = parts.map(Number);
  if (
    Number.isNaN(day) ||
    Number.isNaN(month) ||
    Number.isNaN(year) ||
    day < 1 ||
    month < 1 ||
    month > 12
  ) {
    return null;
  }
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? `${trimmed}T00:00:00`
    : trimmed;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateFromIso(iso: string | null | undefined): string {
  const date = parseIsoDate(iso);
  if (!date) {
    return "";
  }
  return formatDateGerman(date);
}

export function normalizeDateInput(value: string | null | undefined): {
  display: string;
  iso: string | null;
} {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    return { display: "", iso: null };
  }
  let parsed = parseIsoDate(trimmed);
  if (!parsed) {
    parsed = parseGermanDate(trimmed);
  }
  if (!parsed) {
    return { display: trimmed, iso: null };
  }
  return {
    display: formatDateGerman(parsed),
    iso: parsed.toISOString(),
  };
}
