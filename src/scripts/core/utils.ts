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
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Formats a number with fixed decimal places.
 * Returns a fallback value if the input is not a valid number.
 * @param value - The value to format
 * @param fractionDigits - Number of decimal places (default: 2)
 * @param fallback - Fallback value for invalid numbers (default: '–')
 * @returns Formatted number string
 */
export function formatNumber(value: any, fractionDigits: number = 2, fallback: string = '–'): string {
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
  return new Promise(resolve => requestAnimationFrame(resolve));
}
