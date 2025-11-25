const SESSION_FLAG_KEY = "__psl_debug_overlay_session";
const ACCESS_FLAG_KEY = "pslDebugAccess";
const ACCESS_FLAG_VALUE = "allow";
const QUERY_PARAM = "debugOverlay";

type DebugOverlayReason = "dev-build" | "session" | "flag" | "unknown";

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

function stripDebugOverlayQueryParam(): void {
  if (typeof window === "undefined") {
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.delete(QUERY_PARAM);
  const nextSearch = url.searchParams.toString();
  const nextUrl = `${url.pathname}${nextSearch ? `?${nextSearch}` : ""}${url.hash}`;
  try {
    window.history.replaceState(null, document.title, nextUrl);
  } catch {
    // Ignore history errors silently
  }
}

function hasSessionFlag(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return Boolean(readStorage(window.sessionStorage, SESSION_FLAG_KEY));
}

function hasAccessGrant(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const value = readStorage(window.localStorage, ACCESS_FLAG_KEY);
  return value === ACCESS_FLAG_VALUE;
}

export function shouldEnableDebugOverlay(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  if (!import.meta.env.PROD) {
    markSession("dev-build");
    return true;
  }

  if (hasSessionFlag()) {
    publishDebugOverlayState(true, "session");
    return true;
  }

  const params = new URLSearchParams(window.location.search);
  const requested = params.has(QUERY_PARAM);

  if (!requested) {
    publishDebugOverlayState(false, "unknown");
    return false;
  }

  if (!hasAccessGrant()) {
    publishDebugOverlayState(false, "unknown");
    console.warn(
      "[PSL] Debug-Overlay-Anfrage ignoriert: localStorage.pslDebugAccess fehlt oder hat nicht den Wert 'allow'."
    );
    return false;
  }

  markSession("flag");
  stripDebugOverlayQueryParam();
  return true;
}
