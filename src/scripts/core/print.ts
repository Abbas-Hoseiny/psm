const BASE_FONT_STACK = '"Helvetica Neue", Helvetica, Arial, sans-serif';

/**
 * Layout für wiederholende Kopf-/Fußzeilen beim Druck.
 * - thead (table-header-group): Firmenkopf/Adresse, wird oben auf JEDER Seite
 *   wiederholt und reserviert dort Platz.
 * - tfoot (table-footer-group): NUR ein unsichtbarer Platzhalter, der unten auf
 *   jeder Seite Platz reserviert.
 * - Die eigentliche Fußzeile wird per position: fixed am unteren Seitenrand
 *   gezeichnet. Grund: table-footer-group heftet die Fußzeile auf der LETZTEN
 *   (kurzen) Seite direkt unter den Inhalt statt an den Seitenfuß. position:fixed
 *   wiederholt sich ebenfalls auf jeder Seite, bleibt aber immer unten – und der
 *   tfoot-Platzhalter verhindert, dass Inhalt den fixierten Footer überlappt.
 */
export const PRINT_PAGE_LAYOUT_STYLES = `
  .psm-print-page { width: 100%; border-collapse: collapse; }
  .psm-print-page > thead { display: table-header-group; }
  .psm-print-page > tfoot { display: table-footer-group; }
  .psm-print-page > thead > tr > td,
  .psm-print-page > tfoot > tr > td,
  .psm-print-page > tbody > tr > td {
    border: 0;
    padding: 0;
    vertical-align: top;
  }
  .psm-print-page__head > tr > td { padding-bottom: 6mm; }
  .psm-print-page__head .print-meta { margin-bottom: 0; }
  .psm-print-page__foot > tr > td { height: 16mm; }
  .psm-print-fixed-footer {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
  }
`;

/** Dezente, professionelle Marketing-Fußzeile (Pflänzchen + Digitale-PSM.de). */
export const PRINT_BRAND_FOOTER_STYLES = `
  .psm-print-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding-top: 5px;
    border-top: 1px solid #cfe3c8;
    font-family: ${BASE_FONT_STACK};
    font-size: 8.5pt;
    line-height: 1.2;
    color: #6b7280;
  }
  .psm-print-footer__brand {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-weight: 600;
    color: #2f7d32;
    white-space: nowrap;
  }
  .psm-print-footer__brand svg {
    width: 13px;
    height: 13px;
    display: block;
    flex: none;
  }
  .psm-print-footer__dash { color: #16a34a; }
  .psm-print-footer__tld { font-weight: 400; opacity: 0.55; }
  .psm-print-footer__tag { font-style: italic; opacity: 0.85; text-align: right; }
`;

const PRINT_SEEDLING_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 21.5c0-4.2 0-7 0-9.4" fill="none" stroke="#2f7d32" stroke-width="1.7" stroke-linecap="round"/><path d="M11.6 12.8C10.4 7.9 7.3 6 3 6.2c-.3 4.9 2.8 7.4 8.6 6.6z" fill="#22a06b"/><path d="M12.2 11.3c.9-4.2 3.4-5.8 7.3-5.5.4 4.5-2.4 6.7-7.3 5.5z" fill="#4ade80"/></svg>`;

/** Baut die Marketing-Fußzeile (wird im fix positionierten Seitenfuß gezeichnet). */
export function buildPrintBrandFooter(): string {
  return `
    <div class="psm-print-footer">
      <span class="psm-print-footer__brand">
        ${PRINT_SEEDLING_SVG}
        <span>Digitale<span class="psm-print-footer__dash">-</span>PSM<span class="psm-print-footer__tld">.de</span></span>
      </span>
      <span class="psm-print-footer__tag">Digitale Pflanzenschutz-Dokumentation</span>
    </div>
  `;
}

let overlayElement: HTMLDivElement | null = null;

function ensureOverlay(): HTMLDivElement {
  if (!overlayElement) {
    overlayElement = document.createElement("div");
    overlayElement.id = "print-overlay";
    overlayElement.className = "print-overlay";
    document.body.appendChild(overlayElement);
  }
  return overlayElement;
}

function cleanupOverlay(): void {
  if (!overlayElement) {
    return;
  }
  overlayElement.innerHTML = "";
  document.body.classList.remove("print-overlay-active");
}

function openPopup(
  html: string,
  onFail?: (popup?: Window | null) => void,
): Window | null {
  let popup: Window | null = null;
  try {
    popup = window.open(
      "",
      "_blank",
      "noopener,noreferrer,width=1024,height=768",
    );
  } catch (err) {
    console.warn("window.open failed", err);
  }
  if (!popup) {
    if (onFail) {
      onFail();
    }
    return null;
  }
  try {
    popup.document.open();
    // Print-Fenster benötigen document.write für korrektes Rendering
    popup.document.write(html);
    popup.document.close();
  } catch (err) {
    console.error("Unable to write into print window", err);
    if (onFail) {
      onFail(popup);
    }
    return null;
  }
  return popup;
}

export function printHtml({
  title = "Druck",
  styles = "",
  content = "",
}: {
  title?: string;
  styles?: string;
  content: string;
}): void {
  const safeTitle = String(title ?? "Druck").replace(/[<>]/g, "");
  const pageStyles = `@page { size: A4; margin: 14mm; }
    body { font-family: ${BASE_FONT_STACK}; color: #111; line-height: 1.45; }
    h1, h2, h3 { margin: 0 0 0.75rem; }
    .psm-print-page__body table { width: 100%; border-collapse: collapse; }
    .psm-print-page__body th, .psm-print-page__body td { border: 1px solid #555; padding: 6px 8px; text-align: left; vertical-align: top; }
    .nowrap { white-space: nowrap; }
    .print-meta { margin-bottom: 1rem; }
    .print-meta p { margin: 0; }
    ${PRINT_PAGE_LAYOUT_STYLES}
    ${PRINT_BRAND_FOOTER_STYLES}
    ${styles}`;

  // Inhalt in eine Tabelle wrappen: thead/tfoot reservieren auf jeder Seite oben
  // und unten Platz; der tfoot ist nur ein Platzhalter. Die eigentliche Fußzeile
  // wird per position: fixed unten gezeichnet (siehe PRINT_PAGE_LAYOUT_STYLES) und
  // erscheint so auf JEDER Seite – auch der letzten/einzigen – am Seitenfuß.
  const bodyHtml = `<table class="psm-print-page">
    <tfoot class="psm-print-page__foot"><tr><td></td></tr></tfoot>
    <tbody class="psm-print-page__body"><tr><td>${content}</td></tr></tbody>
  </table>
  <div class="psm-print-fixed-footer">${buildPrintBrandFooter()}</div>`;

  const html = `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8" />
    <title>${safeTitle}</title>
    <style>${pageStyles}</style>
  </head><body>${bodyHtml}</body></html>`;

  const popup = openPopup(html, (blockedPopup) => {
    const overlay = ensureOverlay();
    overlay.innerHTML = `<style>${pageStyles}</style>${bodyHtml}`;
    document.body.classList.add("print-overlay-active");

    const handleAfterPrint = () => {
      cleanupOverlay();
      window.removeEventListener("afterprint", handleAfterPrint);
    };
    window.addEventListener("afterprint", handleAfterPrint, { once: true });
    window.print();

    if (blockedPopup) {
      try {
        blockedPopup.close();
      } catch (err) {
        console.warn("Unable to close blocked popup", err);
      }
    }
  });

  if (!popup) {
    return;
  }

  const triggerPrint = () => {
    try {
      popup.focus();
    } catch (err) {
      console.warn("Cannot focus print popup", err);
    }
    try {
      popup.print();
    } catch (err) {
      console.error("Popup print failed", err);
    }
    const close = () => {
      try {
        popup.close();
      } catch (err) {
        console.warn("Cannot close print popup", err);
      }
    };
    if (popup.addEventListener) {
      popup.addEventListener("afterprint", close, { once: true });
    }
    setTimeout(close, 800);
  };

  if (popup.document.readyState === "complete") {
    setTimeout(triggerPrint, 50);
  } else {
    popup.addEventListener("load", () => {
      setTimeout(triggerPrint, 50);
    });
  }
}
