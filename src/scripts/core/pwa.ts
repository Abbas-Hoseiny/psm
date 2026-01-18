/**
 * PWA Manager für Digitale PSM
 *
 * Funktionen:
 * - Service Worker Registration
 * - Auto-Startup ohne Dialog (wenn Datenbank vorhanden)
 * - Install Prompt Management
 * - File Handling API für direktes Öffnen von Dateien
 */

interface DbState {
  hasDatabase: boolean;
  fileHandleName?: string;
  lastAccess?: string;
  autoStartEnabled?: boolean;
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface LaunchParams {
  files?: FileSystemFileHandle[];
}

// File System Access API Erweiterungen (noch nicht in Standard-TypeScript)
interface FileSystemHandlePermissionDescriptor {
  mode?: "read" | "readwrite";
}

interface ExtendedFileSystemFileHandle extends FileSystemFileHandle {
  queryPermission(
    descriptor?: FileSystemHandlePermissionDescriptor,
  ): Promise<PermissionState>;
  requestPermission(
    descriptor?: FileSystemHandlePermissionDescriptor,
  ): Promise<PermissionState>;
}

declare global {
  interface Window {
    launchQueue?: {
      setConsumer(callback: (launchParams: LaunchParams) => void): void;
    };
  }
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let swRegistration: ServiceWorkerRegistration | null = null;

// ===== SERVICE WORKER =====

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) {
    console.warn("[PWA] Service Workers nicht unterstützt");
    return null;
  }

  try {
    swRegistration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });

    console.log("[PWA] Service Worker registriert:", swRegistration.scope);

    // Auto-Update Check
    swRegistration.addEventListener("updatefound", () => {
      const newWorker = swRegistration?.installing;
      if (newWorker) {
        newWorker.addEventListener("statechange", () => {
          if (
            newWorker.state === "installed" &&
            navigator.serviceWorker.controller
          ) {
            console.log("[PWA] Neues Update verfügbar");
            dispatchPwaEvent("pwa:update-available");
          }
        });
      }
    });

    // Message Handler für SW-Kommunikation
    navigator.serviceWorker.addEventListener("message", handleSwMessage);

    return swRegistration;
  } catch (error) {
    console.error("[PWA] Service Worker Registrierung fehlgeschlagen:", error);
    return null;
  }
}

function handleSwMessage(event: MessageEvent): void {
  const { type, payload } = event.data || {};

  switch (type) {
    case "DB_STATE":
      dispatchPwaEvent("pwa:db-state", payload);
      break;
    case "CACHES_CLEARED":
      dispatchPwaEvent("pwa:caches-cleared");
      break;
  }
}

// ===== DB STATE MANAGEMENT =====

/**
 * Speichert den aktuellen Datenbank-Zustand im Service Worker
 * Ermöglicht Auto-Startup beim nächsten App-Start
 */
export async function saveDbState(state: DbState): Promise<void> {
  if (!navigator.serviceWorker.controller) {
    // Fallback: LocalStorage wenn SW nicht aktiv
    localStorage.setItem(
      "psm-db-state",
      JSON.stringify({
        ...state,
        updatedAt: new Date().toISOString(),
      }),
    );
    return;
  }

  navigator.serviceWorker.controller.postMessage({
    type: "SET_DB_STATE",
    payload: state,
  });
}

/**
 * Lädt den gespeicherten Datenbank-Zustand
 */
export async function getDbState(): Promise<DbState | null> {
  // Erst LocalStorage prüfen (schneller)
  const localState = localStorage.getItem("psm-db-state");
  if (localState) {
    try {
      return JSON.parse(localState);
    } catch {
      // Ignore
    }
  }

  // Dann SW fragen
  if (navigator.serviceWorker?.controller) {
    return new Promise((resolve) => {
      const handler = (event: MessageEvent) => {
        if (event.data?.type === "DB_STATE") {
          navigator.serviceWorker.removeEventListener("message", handler);
          resolve(event.data.payload);
        }
      };

      navigator.serviceWorker.addEventListener("message", handler);
      navigator.serviceWorker.controller!.postMessage({ type: "GET_DB_STATE" });

      // Timeout nach 1s
      setTimeout(() => {
        navigator.serviceWorker.removeEventListener("message", handler);
        resolve(null);
      }, 1000);
    });
  }

  return null;
}

/**
 * Prüft ob Auto-Startup aktiviert ist und eine Datenbank vorhanden ist
 */
export async function shouldAutoStart(): Promise<boolean> {
  const state = await getDbState();
  return Boolean(state?.hasDatabase && state?.autoStartEnabled);
}

/**
 * Aktiviert/Deaktiviert Auto-Startup
 */
export async function setAutoStart(enabled: boolean): Promise<void> {
  const currentState = (await getDbState()) || { hasDatabase: false };
  await saveDbState({
    ...currentState,
    autoStartEnabled: enabled,
  });
}

// ===== INSTALL PROMPT =====

export function initInstallPrompt(): void {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    console.log("[PWA] Install Prompt verfügbar");
    
    // WICHTIG: Wenn Chrome beforeinstallprompt feuert, ist die App NICHT installiert
    // Das localStorage-Flag könnte veraltet sein (z.B. nach Deinstallation)
    if (localStorage.getItem("psm-app-installed") === "true") {
      console.log("[PWA] Widerspruch erkannt: Flag sagt installiert, aber Prompt verfügbar");
      // Wir vertrauen Chrome mehr als dem localStorage
      localStorage.removeItem("psm-app-installed");
      console.log("[PWA] Veraltetes Installations-Flag entfernt");
    }
    
    dispatchPwaEvent("pwa:install-available");
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    // WICHTIG: Flag setzen egal wie installiert wurde (Button oder Browser-Menü)
    markAsInstalled();
    console.log("[PWA] App installiert - Flag gesetzt");
    dispatchPwaEvent("pwa:installed");
  });
}

export function isInstallAvailable(): boolean {
  return deferredPrompt !== null;
}

export function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true
  );
}

/**
 * Erkennt den Browser-Typ für PWA-spezifische Hinweise
 */
export function detectBrowser():
  | "chrome"
  | "edge"
  | "firefox"
  | "safari"
  | "other" {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("edg/")) return "edge";
  if (ua.includes("chrome") && !ua.includes("edg")) return "chrome";
  if (ua.includes("firefox")) return "firefox";
  if (ua.includes("safari") && !ua.includes("chrome")) return "safari";
  return "other";
}

/**
 * Prüft ob die App wahrscheinlich bereits installiert ist
 * Nutzt mehrere Methoden für beste Zuverlässigkeit
 */
export function isProbablyInstalled(): boolean {
  // 1. Wenn im Standalone-Modus läuft, ist sie definitiv installiert
  if (isStandalone()) return true;

  // 2. Prüfe ob die App schon mal installiert wurde (localStorage Flag)
  if (localStorage.getItem("psm-app-installed") === "true") return true;

  // 3. Prüfe display-mode Media Query für verschiedene Modi
  if (
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches ||
    window.matchMedia("(display-mode: window-controls-overlay)").matches
  ) {
    return true;
  }

  return false;
}

/**
 * Async Version mit getInstalledRelatedApps API (Chrome only, aber zuverlässig)
 * WICHTIG: Diese Funktion sollte beim App-Start aufgerufen werden!
 */
export async function checkIfInstalled(): Promise<boolean> {
  // 1. Schnelle Prüfungen zuerst
  if (isProbablyInstalled()) return true;

  // 2. getInstalledRelatedApps API (nur Chrome/Edge)
  try {
    if ("getInstalledRelatedApps" in navigator) {
      const apps = await (navigator as any).getInstalledRelatedApps();
      console.log("[PWA] getInstalledRelatedApps result:", apps);
      if (apps && apps.length > 0) {
        // Flag setzen für zukünftige schnelle Prüfungen
        markAsInstalled();
        return true;
      }
    }
  } catch (e) {
    console.warn("[PWA] getInstalledRelatedApps API Fehler:", e);
  }

  // 3. Fallback: Prüfe ob beforeinstallprompt NICHT gefeuert wurde
  // Wenn nach 3 Sekunden kein Prompt verfügbar ist und wir nicht im Browser-Mode sind,
  // könnte die App bereits installiert sein
  // (Nur als Heuristik, nicht 100% zuverlässig)

  return false;
}

/**
 * Markiert die App als installiert (für zukünftige Besuche)
 */
export function markAsInstalled(): void {
  localStorage.setItem("psm-app-installed", "true");
  console.log("[PWA] App als installiert markiert");
}

/**
 * Entfernt das Installations-Flag (für Debugging/Reset)
 */
export function clearInstalledFlag(): void {
  localStorage.removeItem("psm-app-installed");
  console.log("[PWA] Installations-Flag entfernt");
}

/**
 * Gibt PWA-Installations-Status und Anweisungen zurück (synchron)
 * Für schnelle UI-Updates, nutzt nur lokale Prüfungen
 */
export function getInstallStatus(): {
  canInstall: boolean;
  isInstalled: boolean;
  isStandalone: boolean;
  browser: string;
  showBanner: boolean;
} {
  const browser = detectBrowser();
  const standalone = isStandalone();
  const installed = isProbablyInstalled();
  const canInstall = isInstallAvailable();

  // Kein Banner wenn bereits in der App (standalone)
  const showBanner = !standalone;

  return {
    canInstall,
    isInstalled: installed && !standalone,
    isStandalone: standalone,
    browser,
    showBanner,
  };
}

/**
 * Async Version von getInstallStatus - nutzt getInstalledRelatedApps API
 * Sollte beim App-Start aufgerufen werden für genauere Erkennung
 */
export async function getInstallStatusAsync(): Promise<{
  canInstall: boolean;
  isInstalled: boolean;
  isStandalone: boolean;
  browser: string;
  showBanner: boolean;
}> {
  const browser = detectBrowser();
  const standalone = isStandalone();

  // Async Prüfung mit getInstalledRelatedApps API
  const installed = await checkIfInstalled();
  const canInstall = isInstallAvailable();

  // Kein Banner wenn bereits in der App (standalone)
  const showBanner = !standalone;

  return {
    canInstall,
    isInstalled: installed && !standalone,
    isStandalone: standalone,
    browser,
    showBanner,
  };
}

export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) {
    console.warn("[PWA] Kein Install Prompt verfügbar");
    return false;
  }

  try {
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    console.log("[PWA] Install Prompt Ergebnis:", outcome);

    if (outcome === "accepted") {
      markAsInstalled();
    }

    deferredPrompt = null;

    return outcome === "accepted";
  } catch (error) {
    console.error("[PWA] Install Prompt fehlgeschlagen:", error);
    return false;
  }
}

// ===== FILE HANDLING =====

/**
 * Initialisiert das File Handling für PWA
 * Ermöglicht direktes Öffnen von .sqlite/.json Dateien
 */
export function initFileHandling(
  onFileOpened: (handle: FileSystemFileHandle) => Promise<void>,
): void {
  if (!("launchQueue" in window)) {
    console.log("[PWA] Launch Queue API nicht verfügbar");
    return;
  }

  window.launchQueue?.setConsumer(async (launchParams: LaunchParams) => {
    if (!launchParams.files?.length) {
      console.log("[PWA] Launch ohne Dateien");
      return;
    }

    console.log(
      "[PWA] Datei via Launch Queue empfangen:",
      launchParams.files.length,
    );

    for (const fileHandle of launchParams.files) {
      try {
        await onFileOpened(fileHandle);

        // State speichern für Auto-Startup
        await saveDbState({
          hasDatabase: true,
          fileHandleName: fileHandle.name,
          lastAccess: new Date().toISOString(),
          autoStartEnabled: true,
        });

        break; // Nur erste Datei verarbeiten
      } catch (error) {
        console.error("[PWA] Fehler beim Öffnen der Datei:", error);
      }
    }
  });

  console.log("[PWA] File Handling initialisiert");
}

// ===== STORED FILE HANDLE =====

const HANDLE_STORE_NAME = "psm-file-handles";
const HANDLE_KEY = "last-database";

/**
 * Speichert ein FileHandle für späteren Auto-Start
 */
export async function storeFileHandle(
  handle: FileSystemFileHandle,
): Promise<void> {
  try {
    const db = await openHandleDb();
    const tx = db.transaction(HANDLE_STORE_NAME, "readwrite");
    const store = tx.objectStore(HANDLE_STORE_NAME);

    await new Promise<void>((resolve, reject) => {
      const request = store.put({
        key: HANDLE_KEY,
        handle,
        savedAt: new Date().toISOString(),
      });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    db.close();
    console.log("[PWA] FileHandle gespeichert");

    // State aktualisieren
    await saveDbState({
      hasDatabase: true,
      fileHandleName: handle.name,
      lastAccess: new Date().toISOString(),
      autoStartEnabled: true,
    });
  } catch (error) {
    console.error("[PWA] FileHandle speichern fehlgeschlagen:", error);
  }
}

/**
 * Lädt das gespeicherte FileHandle und prüft Berechtigung
 */
export async function getStoredFileHandle(): Promise<FileSystemFileHandle | null> {
  try {
    const db = await openHandleDb();
    const tx = db.transaction(HANDLE_STORE_NAME, "readonly");
    const store = tx.objectStore(HANDLE_STORE_NAME);

    const result = await new Promise<
      { handle: FileSystemFileHandle } | undefined
    >((resolve, reject) => {
      const request = store.get(HANDLE_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    db.close();

    if (!result?.handle) {
      return null;
    }

    // Berechtigung prüfen (File System Access API Erweiterung)
    const extendedHandle = result.handle as ExtendedFileSystemFileHandle;
    if (typeof extendedHandle.queryPermission === "function") {
      const permission = await extendedHandle.queryPermission({
        mode: "readwrite",
      });

      if (permission === "granted") {
        console.log("[PWA] FileHandle mit Berechtigung geladen");
        return result.handle;
      }
    }

    // Berechtigung anfordern (benötigt User-Interaktion)
    console.log("[PWA] FileHandle gefunden, aber Berechtigung erforderlich");
    return result.handle;
  } catch (error) {
    console.error("[PWA] FileHandle laden fehlgeschlagen:", error);
    return null;
  }
}

/**
 * Fordert Berechtigung für gespeichertes Handle an
 */
export async function requestFileHandlePermission(
  handle: FileSystemFileHandle,
): Promise<boolean> {
  try {
    const extendedHandle = handle as ExtendedFileSystemFileHandle;
    if (typeof extendedHandle.requestPermission !== "function") {
      // Browser unterstützt keine Berechtigungsanfrage - versuchen wir getFile
      await handle.getFile();
      return true;
    }
    const permission = await extendedHandle.requestPermission({
      mode: "readwrite",
    });
    return permission === "granted";
  } catch {
    return false;
  }
}

/**
 * Löscht gespeichertes FileHandle
 */
export async function clearStoredFileHandle(): Promise<void> {
  try {
    const db = await openHandleDb();
    const tx = db.transaction(HANDLE_STORE_NAME, "readwrite");
    const store = tx.objectStore(HANDLE_STORE_NAME);

    await new Promise<void>((resolve, reject) => {
      const request = store.delete(HANDLE_KEY);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    db.close();

    // State zurücksetzen
    await saveDbState({
      hasDatabase: false,
      autoStartEnabled: false,
    });

    console.log("[PWA] FileHandle gelöscht");
  } catch (error) {
    console.error("[PWA] FileHandle löschen fehlgeschlagen:", error);
  }
}

async function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("psm-file-handles", 1);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(HANDLE_STORE_NAME)) {
        db.createObjectStore(HANDLE_STORE_NAME, { keyPath: "key" });
      }
    };
  });
}

// ===== UTILITIES =====

function dispatchPwaEvent(name: string, detail?: any): void {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

/**
 * Aktualisiert den Service Worker
 */
export async function updateServiceWorker(): Promise<void> {
  if (swRegistration?.waiting) {
    swRegistration.waiting.postMessage({ type: "SKIP_WAITING" });
  }
}

/**
 * Prüft PWA-Unterstützung
 */
export function getPwaCapabilities() {
  return {
    serviceWorker: "serviceWorker" in navigator,
    fileSystemAccess: typeof (window as any).showOpenFilePicker === "function",
    launchQueue: "launchQueue" in window,
    indexedDB: "indexedDB" in window,
    standalone: isStandalone(),
    installAvailable: isInstallAvailable(),
  };
}

// ===== INITIALIZATION =====

/**
 * Vollständige PWA-Initialisierung
 */
export async function initPwa(options?: {
  onFileOpened?: (handle: FileSystemFileHandle) => Promise<void>;
  onAutoStart?: () => Promise<void>;
}): Promise<void> {
  console.log("[PWA] Initialisierung...");

  // 1. Service Worker registrieren
  await registerServiceWorker();

  // 2. Install Prompt initialisieren
  initInstallPrompt();

  // 3. File Handling initialisieren
  if (options?.onFileOpened) {
    initFileHandling(options.onFileOpened);
  }

  // 4. Auto-Start prüfen
  if (options?.onAutoStart && (await shouldAutoStart())) {
    const storedHandle = await getStoredFileHandle();

    if (storedHandle) {
      const extendedHandle = storedHandle as ExtendedFileSystemFileHandle;
      let hasPermission = false;

      if (typeof extendedHandle.queryPermission === "function") {
        const permission = await extendedHandle.queryPermission({
          mode: "readwrite",
        });
        hasPermission = permission === "granted";
      }

      if (hasPermission) {
        console.log("[PWA] Auto-Start mit gespeicherter Datei");
        if (options.onFileOpened) {
          await options.onFileOpened(storedHandle);
        }
        return;
      }

      // Handle vorhanden aber Berechtigung erforderlich
      console.log("[PWA] Auto-Start: Berechtigung für Datei erforderlich");
      dispatchPwaEvent("pwa:permission-required", { handle: storedHandle });
    }
  }

  console.log("[PWA] Capabilities:", getPwaCapabilities());
}

// ===== DEBUG HELPERS (für Browser-Konsole) =====

/**
 * Debugging-Funktion für PWA-Status
 * Kann in der Browser-Konsole aufgerufen werden: window.pwaDebug()
 */
export async function debugPwaStatus(): Promise<void> {
  console.group("🔧 PWA Debug Status");

  console.log("📱 Standalone Mode:", isStandalone());
  console.log(
    "💾 localStorage Flag:",
    localStorage.getItem("psm-app-installed"),
  );
  console.log("🔔 Install Prompt verfügbar:", isInstallAvailable());
  console.log("🌐 Browser:", detectBrowser());

  // Display Mode Checks
  console.group("📺 Display Mode Checks");
  console.log(
    "standalone:",
    window.matchMedia("(display-mode: standalone)").matches,
  );
  console.log(
    "fullscreen:",
    window.matchMedia("(display-mode: fullscreen)").matches,
  );
  console.log(
    "minimal-ui:",
    window.matchMedia("(display-mode: minimal-ui)").matches,
  );
  console.log(
    "window-controls-overlay:",
    window.matchMedia("(display-mode: window-controls-overlay)").matches,
  );
  console.log("browser:", window.matchMedia("(display-mode: browser)").matches);
  console.groupEnd();

  // getInstalledRelatedApps API
  console.group("🔍 getInstalledRelatedApps API");
  if ("getInstalledRelatedApps" in navigator) {
    try {
      const apps = await (navigator as any).getInstalledRelatedApps();
      console.log("Installierte Apps:", apps);
    } catch (e) {
      console.log("API Fehler:", e);
    }
  } else {
    console.log("API nicht verfügbar");
  }
  console.groupEnd();

  // Sync vs Async Status
  console.group("📊 Status Vergleich");
  console.log("Sync (isProbablyInstalled):", isProbablyInstalled());
  console.log("Async (checkIfInstalled):", await checkIfInstalled());
  console.log("getInstallStatus():", getInstallStatus());
  console.log("getInstallStatusAsync():", await getInstallStatusAsync());
  console.groupEnd();

  console.log("💡 Tipp: clearInstalledFlag() zum Zurücksetzen des Flags");
  console.groupEnd();
}

// Globale Debugging-Funktionen exponieren
if (typeof window !== "undefined") {
  (window as any).pwaDebug = debugPwaStatus;
  (window as any).pwaClearFlag = clearInstalledFlag;
}
