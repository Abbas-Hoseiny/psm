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
