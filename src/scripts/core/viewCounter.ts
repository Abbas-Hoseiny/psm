/**
 * Aufruf-Zähler der Startseite
 *
 * Meldet jeden Aufruf der Startseite an einen eigenen kleinen Zähldienst und
 * zeigt die Zahl an. Der Dienst erhöht nur eine Zahl: keine Cookies, keine
 * gespeicherten IP-Adressen, kein Protokoll. Was dabei übertragen wird, steht
 * in src/pages/datenschutz/index.astro – bei Änderungen dort mitpflegen.
 *
 * Gezählt wird genau EINMAL pro Seitenaufruf; wird der Startbildschirm neu
 * gerendert, kommt die schon bekannte Zahl in das neue Element. Offline oder
 * Dienst nicht erreichbar: Der Zähler bleibt ausgeblendet.
 */

const COUNTER_URL = "https://hoseiny.de/z/psm";

let request: Promise<number | null> | null = null;
let currentContainer: HTMLElement | null = null;
let onlineListenerBound = false;

async function countView(): Promise<number | null> {
  try {
    const response = await fetch(COUNTER_URL, {
      method: "POST",
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) {
      return null;
    }
    const data: unknown = await response.json();
    const count = (data as { count?: unknown } | null)?.count;
    return typeof count === "number" && Number.isFinite(count) ? count : null;
  } catch {
    return null;
  }
}

function show(container: HTMLElement, count: number): void {
  container.textContent = `${count.toLocaleString("de-DE")} Aufrufe`;
  // Das umgebende Element (Auge + Zahl) ist bis hierhin ausgeblendet
  container.closest<HTMLElement>(".startup-view-counter")?.removeAttribute("hidden");
}

/**
 * Zeigt den Zähler im übergebenen Element. Mehrfache Aufrufe lösen keinen
 * weiteren Zählvorgang aus.
 */
export function mountHitCounter(container: HTMLElement | null): void {
  if (!container) {
    return;
  }
  currentContainer = container;
  // Offline: keine fehlschlagende Anfrage auslösen, sondern erst zählen,
  // sobald die Verbindung wieder da ist.
  if (!request && typeof navigator !== "undefined" && navigator.onLine === false) {
    if (!onlineListenerBound) {
      onlineListenerBound = true;
      window.addEventListener(
        "online",
        () => {
          if (currentContainer?.isConnected) {
            mountHitCounter(currentContainer);
          }
        },
        { once: true },
      );
    }
    return;
  }
  request ??= countView();
  void request.then((count) => {
    if (count !== null && currentContainer === container && container.isConnected) {
      show(container, count);
    }
  });
}
