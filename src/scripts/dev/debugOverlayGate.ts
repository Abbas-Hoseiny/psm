const SESSION_FLAG_KEY = "__psl_debug_overlay_session";

type DebugOverlayReason = "manual" | "unknown";

function readStorage(
  storage: Storage | null | undefined,
  key: string
): string | null {
  if (!storage) {
    return null;
  }
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(
  storage: Storage | null | undefined,
  key: string,
  value: string
): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(key, value);
  } catch {
    // Ignore quota / privacy errors silently
  }
}

function publishDebugOverlayState(
  enabled: boolean,
  reason: DebugOverlayReason
): void {
  if (typeof window === "undefined") {
    return;
  }
  const globalWithPsl = window as typeof window & {
    __PSL?: Record<string, unknown>;
  };
  if (!globalWithPsl.__PSL) {
    globalWithPsl.__PSL = {};
  }
  globalWithPsl.__PSL.debugOverlay = { enabled, reason };
}

function markSession(reason: DebugOverlayReason): void {
  if (typeof window === "undefined") {
    return;
  }
  writeStorage(window.sessionStorage, SESSION_FLAG_KEY, reason);
  publishDebugOverlayState(true, reason);
}

function getSessionReason(): DebugOverlayReason | null {
  if (typeof window === "undefined") {
    return null;
  }
  const value = readStorage(window.sessionStorage, SESSION_FLAG_KEY);
  return value as DebugOverlayReason | null;
}

export function shouldEnableDebugOverlay(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const sessionReason = getSessionReason();
  if (sessionReason === "manual") {
    publishDebugOverlayState(true, sessionReason);
    return true;
  }
  publishDebugOverlayState(false, "unknown");
  return false;
}

export function markManualDebugOverlayAccess(): void {
  markSession("manual");
}
