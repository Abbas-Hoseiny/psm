/**
 * Aufruf-Zähler (Besucher-Badge)
 *
 * Nutzt den kostenlosen Dienst "Hits" (https://hits.sh): keine Anmeldung, kein
 * API-Key, datenschutzfreundlich (keine Cookies, kein Tracking-Script). Jeder
 * Abruf des Badge-Bildes zählt einen Aufruf; die Statistik ist unter
 * https://hits.sh/digitale-psm.de/ einsehbar.
 *
 * Das Badge wird als <img> eingebunden – damit gibt es keine CORS-Probleme und
 * der Dienst liefert die Zahl bereits gerendert. Das Element wird genau EINMAL
 * pro Seitenaufruf erzeugt (Singleton) und bei Neu-Rendern des Startbildschirms
 * nur verschoben, damit nicht mehrfach gezählt wird.
 */

const HITS_PATH = "digitale-psm.de";
const HITS_BADGE_URL =
  `https://hits.sh/${HITS_PATH}.svg?` +
  new URLSearchParams({
    style: "flat-square",
    label: "Aufrufe",
    color: "22c55e",
    labelColor: "1f2937",
  }).toString();

export const HITS_STATS_URL = `https://hits.sh/${HITS_PATH}/`;

let badgeElement: HTMLImageElement | null = null;
let pendingContainer: HTMLElement | null = null;
let onlineListenerBound = false;

function createBadge(): HTMLImageElement {
  const img = document.createElement("img");
  img.src = HITS_BADGE_URL;
  img.alt = "Aufrufe";
  img.title = "Seitenaufrufe (hits.sh)";
  img.height = 20;
  img.decoding = "async";
  img.referrerPolicy = "no-referrer";
  img.style.verticalAlign = "middle";
  // Offline oder Dienst nicht erreichbar: Badge unsichtbar lassen statt
  // kaputtes Bild anzuzeigen.
  img.addEventListener("error", () => {
    img.style.display = "none";
  });
  return img;
}

/**
 * Hängt das (einmalig erzeugte) Zähler-Badge in den übergebenen Container.
 * Mehrfache Aufrufe verschieben nur das Element und lösen keinen weiteren
 * Zählvorgang aus.
 */
export function mountHitCounter(container: HTMLElement | null): void {
  if (!container) {
    return;
  }
  // Offline: keine fehlschlagende Anfrage auslösen, sondern das Badge erst
  // einhängen, sobald die Verbindung wieder da ist (zählt dann den Aufruf).
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    pendingContainer = container;
    if (!onlineListenerBound) {
      onlineListenerBound = true;
      window.addEventListener(
        "online",
        () => {
          const target = pendingContainer;
          pendingContainer = null;
          if (target?.isConnected) {
            mountHitCounter(target);
          }
        },
        { once: true },
      );
    }
    return;
  }
  if (!badgeElement) {
    badgeElement = createBadge();
  }
  if (badgeElement.parentElement !== container) {
    container.replaceChildren(badgeElement);
  }
}
