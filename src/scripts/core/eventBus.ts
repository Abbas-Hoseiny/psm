import type { AppState } from "./state";

/**
 * Type-safe Event Map
 * All application events with their payload types
 */
export interface EventMap {
  // App lifecycle events
  "app:sectionChanged": AppState["app"]["activeSection"];
  "app:ready": void;

  // Database events
  "database:connected": { driver: string };
  "database:saved": { scope: string; driver?: string };
  "database:error": { scope: string; error: unknown };

  // History events
  "history:data-changed": {
    type?: string;
    source?: string;
    id?: number | string | null;
  };
  "history:gps-activation-result": {
    status: "success" | "error" | "pending";
    id: string;
    name?: string | null;
    message: string;
    source?: string;
    timestamp?: number;
  };

  // GPS events
  "gps:data-changed": {
    action: "upsert" | "delete" | "activate" | "sync-active";
    id?: string | null;
  };
  "gps:set-active-from-history": { id: string; source: string };
  "gps:active-point-changed": {
    id: string | null;
    point?: unknown;
    source?: string;
  };

  // Lookup events
  "lookup:apply-eppo": {
    code?: string;
    name?: string;
    language?: string;
    dtcode?: string;
  };
  "lookup:apply-bbch": { code?: string; label?: string };
  "savedCodes:changed": { eppoCount: number; bbchCount: number };

  // Documentation events
  "documentation:focus-range": {
    startDate?: string;
    endDate?: string;
    highlightEntryIds?: Array<
      string | number | { ref: string | number; source?: string }
    >;
    label?: string;
  };

  // Performance events
  "performance:budget-warning": {
    metric: string;
    value: number;
    budget: number;
  };

  // UI Notification events
  "ui:notification": {
    id: string;
    type: "success" | "error" | "warning" | "info";
    message: string;
    duration?: number;
  };
  "ui:notification:dismiss": { id: string };
}

type EventHandler<T = unknown> = (payload: T) => void;

const subscribers = new Map<string, Map<string, EventHandler<any>>>();
let counter = 0;

/**
 * Subscribe to a typed event
 * @param eventName - Name of the event from EventMap
 * @param handler - Handler function receiving typed payload
 * @returns Unsubscribe function - MUST be called to prevent memory leaks
 */
export function subscribe<K extends keyof EventMap>(
  eventName: K,
  handler: EventHandler<EventMap[K]>
): () => void;
export function subscribe<T = unknown>(
  eventName: string,
  handler: EventHandler<T>
): () => void;
export function subscribe(
  eventName: string,
  handler: EventHandler<any>
): () => void {
  if (!subscribers.has(eventName)) {
    subscribers.set(eventName, new Map());
  }
  const token = `h_${eventName}_${counter++}`;
  subscribers.get(eventName)!.set(token, handler);
  return () => {
    const handlers = subscribers.get(eventName);
    if (handlers) {
      handlers.delete(token);
      if (!handlers.size) {
        subscribers.delete(eventName);
      }
    }
  };
}

/**
 * Emit a typed event
 * @param eventName - Name of the event from EventMap
 * @param payload - Typed payload for the event
 */
export function emit<K extends keyof EventMap>(
  eventName: K,
  payload?: EventMap[K]
): void;
export function emit<T = unknown>(eventName: string, payload?: T): void;
export function emit(eventName: string, payload?: unknown): void {
  const handlers = subscribers.get(eventName);
  if (!handlers) {
    return;
  }
  for (const handler of handlers.values()) {
    try {
      handler(payload);
    } catch (err) {
      console.error(`eventBus handler error for ${eventName}`, err);
    }
  }
}

/**
 * Emit a typed event asynchronously using microtasks
 * Performance: Non-blocking - handlers run after current call stack clears
 * Use for events that don't require immediate handling
 * @param eventName - Name of the event from EventMap
 * @param payload - Typed payload for the event
 */
export function emitAsync<K extends keyof EventMap>(
  eventName: K,
  payload?: EventMap[K]
): void;
export function emitAsync<T = unknown>(eventName: string, payload?: T): void;
export function emitAsync(eventName: string, payload?: unknown): void {
  const handlers = subscribers.get(eventName);
  if (!handlers) {
    return;
  }
  for (const handler of handlers.values()) {
    queueMicrotask(() => {
      try {
        handler(payload);
      } catch (err) {
        console.error(`eventBus async handler error for ${eventName}`, err);
      }
    });
  }
}

/**
 * Check if an event has any subscribers
 */
export function hasSubscribers(eventName: string): boolean {
  const handlers = subscribers.get(eventName);
  return handlers ? handlers.size > 0 : false;
}

/**
 * Get count of subscribers for an event
 */
export function getSubscriberCount(eventName: string): number {
  const handlers = subscribers.get(eventName);
  return handlers ? handlers.size : 0;
}

/**
 * Clear all event subscriptions
 * Use with caution - mainly for testing
 */
export function clearEventBus(): void {
  subscribers.clear();
  counter = 0;
}
