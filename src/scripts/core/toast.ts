/**
 * Toast Notification System
 * Non-blocking notifications to replace window.alert()
 */

import { emit, subscribe } from "./eventBus";
import { updateSlice, getState } from "./state";

export interface ToastNotification {
  id: string;
  type: "success" | "error" | "warning" | "info";
  message: string;
  duration: number;
  createdAt: number;
}

const DEFAULT_DURATION = 4000;
const ERROR_DURATION = 6000;
const activeTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Generate unique notification ID
 */
function generateId(): string {
  return `toast_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Show a toast notification (replaces window.alert)
 */
export function showToast(
  message: string,
  type: ToastNotification["type"] = "info",
  duration?: number
): string {
  const id = generateId();
  const actualDuration =
    duration ?? (type === "error" ? ERROR_DURATION : DEFAULT_DURATION);

  const notification: ToastNotification = {
    id,
    type,
    message,
    duration: actualDuration,
    createdAt: Date.now(),
  };

  // Add to state
  updateSlice("ui", (ui) => ({
    ...ui,
    notifications: [...(ui.notifications || []), notification],
  }));

  // Emit event for UI components
  emit("ui:notification", {
    id,
    type,
    message,
    duration: actualDuration,
  });

  // Auto-dismiss after duration
  if (actualDuration > 0) {
    const timer = setTimeout(() => {
      dismissToast(id);
    }, actualDuration);
    activeTimers.set(id, timer);
  }

  return id;
}

/**
 * Dismiss a specific toast notification
 */
export function dismissToast(id: string): void {
  // Clear timer if exists
  const timer = activeTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    activeTimers.delete(id);
  }

  // Remove from state
  updateSlice("ui", (ui) => ({
    ...ui,
    notifications: (ui.notifications || []).filter(
      (n: ToastNotification) => n.id !== id
    ),
  }));

  emit("ui:notification:dismiss", { id });
}

/**
 * Dismiss all toast notifications
 */
export function dismissAllToasts(): void {
  // Clear all timers
  activeTimers.forEach((timer) => clearTimeout(timer));
  activeTimers.clear();

  // Clear state
  updateSlice("ui", (ui) => ({
    ...ui,
    notifications: [],
  }));
}

/**
 * Get all active notifications
 */
export function getActiveToasts(): ToastNotification[] {
  return (getState().ui.notifications || []) as ToastNotification[];
}

// Convenience methods
export const toast = {
  success: (message: string, duration?: number) =>
    showToast(message, "success", duration),
  error: (message: string, duration?: number) =>
    showToast(message, "error", duration),
  warning: (message: string, duration?: number) =>
    showToast(message, "warning", duration),
  info: (message: string, duration?: number) =>
    showToast(message, "info", duration),
  dismiss: dismissToast,
  dismissAll: dismissAllToasts,
};

/**
 * Initialize Toast UI Container
 * Call this once during app bootstrap
 */
export function initToastContainer(): void {
  // Check if container already exists
  if (document.getElementById("toast-container")) {
    return;
  }

  const container = document.createElement("div");
  container.id = "toast-container";
  container.className = "toast-container";
  container.setAttribute("aria-live", "polite");
  container.setAttribute("aria-atomic", "true");
  document.body.appendChild(container);

  // Subscribe to notification events
  subscribe("ui:notification", (payload) => {
    renderToast(payload as ToastNotification);
  });

  subscribe("ui:notification:dismiss", (payload) => {
    const { id } = payload as { id: string };
    removeToastElement(id);
  });

  // Inject styles
  injectToastStyles();
}

/**
 * Render a toast element in the DOM
 */
function renderToast(notification: ToastNotification): void {
  const container = document.getElementById("toast-container");
  if (!container) {
    return;
  }

  const toastEl = document.createElement("div");
  toastEl.className = `toast toast-${notification.type}`;
  toastEl.dataset.toastId = notification.id;
  toastEl.setAttribute("role", "alert");

  const iconMap: Record<ToastNotification["type"], string> = {
    success: "bi-check-circle-fill",
    error: "bi-exclamation-triangle-fill",
    warning: "bi-exclamation-circle-fill",
    info: "bi-info-circle-fill",
  };

  toastEl.innerHTML = `
    <div class="toast-icon">
      <i class="bi ${iconMap[notification.type]}"></i>
    </div>
    <div class="toast-content">
      <p class="toast-message">${escapeHtml(notification.message)}</p>
    </div>
    <button class="toast-close" aria-label="Schließen">
      <i class="bi bi-x"></i>
    </button>
  `;

  // Close button handler
  const closeBtn = toastEl.querySelector(".toast-close");
  closeBtn?.addEventListener("click", () => {
    dismissToast(notification.id);
  });

  container.appendChild(toastEl);

  // Trigger animation
  requestAnimationFrame(() => {
    toastEl.classList.add("toast-visible");
  });
}

/**
 * Remove toast element from DOM
 */
function removeToastElement(id: string): void {
  const toastEl = document.querySelector(`[data-toast-id="${id}"]`);
  if (!toastEl) {
    return;
  }

  toastEl.classList.remove("toast-visible");
  toastEl.classList.add("toast-hiding");

  setTimeout(() => {
    toastEl.remove();
  }, 300);
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Inject toast styles
 */
function injectToastStyles(): void {
  if (document.getElementById("toast-styles")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "toast-styles";
  style.textContent = `
    .toast-container {
      position: fixed;
      top: 1rem;
      right: 1rem;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      max-width: 400px;
      pointer-events: none;
    }

    .toast {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      padding: 1rem;
      border-radius: 0.5rem;
      background: var(--color-surface, #1e1e2e);
      border: 1px solid var(--color-border, #313244);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      opacity: 0;
      transform: translateX(100%);
      transition: all 0.3s ease;
      pointer-events: auto;
    }

    .toast-visible {
      opacity: 1;
      transform: translateX(0);
    }

    .toast-hiding {
      opacity: 0;
      transform: translateX(100%);
    }

    .toast-icon {
      flex-shrink: 0;
      font-size: 1.25rem;
    }

    .toast-success .toast-icon { color: #a6e3a1; }
    .toast-error .toast-icon { color: #f38ba8; }
    .toast-warning .toast-icon { color: #fab387; }
    .toast-info .toast-icon { color: #89b4fa; }

    .toast-content {
      flex: 1;
      min-width: 0;
    }

    .toast-message {
      margin: 0;
      font-size: 0.9rem;
      color: var(--color-text, #cdd6f4);
      word-wrap: break-word;
    }

    .toast-close {
      flex-shrink: 0;
      background: none;
      border: none;
      color: var(--color-text-muted, #6c7086);
      cursor: pointer;
      padding: 0.25rem;
      font-size: 1rem;
      line-height: 1;
      opacity: 0.7;
      transition: opacity 0.2s;
    }

    .toast-close:hover {
      opacity: 1;
    }

    @media (max-width: 480px) {
      .toast-container {
        left: 1rem;
        right: 1rem;
        max-width: none;
      }
    }
  `;
  document.head.appendChild(style);
}
