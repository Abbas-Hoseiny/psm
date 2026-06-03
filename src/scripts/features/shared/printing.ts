import { nextFrame, escapeHtml } from "@scripts/core/utils";
import {
  PRINT_PAGE_LAYOUT_STYLES,
  PRINT_BRAND_FOOTER_STYLES,
  buildPrintBrandFooter,
} from "@scripts/core/print";
import {
  renderCalculationSnapshotForPrint,
  type CalculationSnapshotEntry,
  type CalculationSnapshotLabels,
} from "./calculationSnapshot";
import type { AppState } from "@scripts/core/state";

const BASE_FONT_STACK = '"Helvetica Neue", Helvetica, Arial, sans-serif';

const PRINT_BASE_STYLES = `
  @page { size: A4; margin: 14mm; }
  body {
    font-family: ${BASE_FONT_STACK};
    color: #111;
    line-height: 1.45;
    margin: 0;
    padding: 0;
  }
  h1, h2, h3 { margin: 0 0 0.75rem; }
  .calc-snapshot-table,
  .history-detail-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 1rem;
  }
  .calc-snapshot-table th,
  .calc-snapshot-table td,
  .history-detail-table th,
  .history-detail-table td {
    border: 1px solid #555;
    padding: 6px 8px;
    text-align: left;
    vertical-align: top;
  }
  .calc-snapshot-table th,
  .history-detail-table th {
    background: #f2f2f2;
    font-weight: 600;
  }
  .nowrap { white-space: nowrap; }
  .print-meta { margin-bottom: 1.5rem; }
  .print-meta p { margin: 0; }
  .print-meta h1 { margin-bottom: 0.5rem; }
  .calc-snapshot-print {
    page-break-inside: avoid;
    margin-bottom: 2rem;
    padding-bottom: 0.5rem;
  }
  .calc-snapshot-print__header h3 {
    margin: 0 0 0.5rem;
    font-size: 1.1rem;
  }
  .calc-snapshot-print__meta {
    margin-bottom: 1rem;
  }
  .calc-snapshot-table,
  .history-detail-table {
    font-size: 0.9rem;
  }
`;

export function buildCompanyPrintHeader(
  company: AppState["company"] | null | undefined,
): string {
  const hasContent = Boolean(
    company?.name ||
      company?.headline ||
      company?.address ||
      company?.contactEmail,
  );
  if (!hasContent) {
    return "";
  }

  const headline = company?.headline?.trim();
  const companyName = company?.name?.trim();
  const headingText = headline || companyName || "";
  const headingHtml = headingText ? `<h1>${escapeHtml(headingText)}</h1>` : "";

  const addressLines = company?.address
    ? company.address
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    : [];

  const normalize = (value: string) =>
    value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

  const hasDuplicateFirstLine = Boolean(
    companyName &&
      addressLines.length > 0 &&
      normalize(addressLines[0]) === normalize(companyName),
  );

  const displayLines = [...addressLines];
  if (companyName && !hasDuplicateFirstLine) {
    displayLines.unshift(companyName);
  }

  const addressHtml = displayLines.length
    ? `<p>${displayLines.map((line) => escapeHtml(line)).join("<br />")}</p>`
    : "";

  const email = company?.contactEmail
    ? `<p>${escapeHtml(company.contactEmail)}</p>`
    : "";

  return `
    <div class="print-meta">
      ${headingHtml}
      ${addressHtml}
      ${email}
    </div>
  `;
}

function createPrintFrame(): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.top = "-9999px";
  iframe.style.left = "-9999px";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);
  return iframe;
}

function cleanupPrintFrame(iframe: HTMLIFrameElement | null): void {
  if (iframe?.parentNode) {
    iframe.parentNode.removeChild(iframe);
  }
}

type PrintOptions = {
  chunkSize?: number;
  title?: string;
  headerHtml?: string;
  additionalStyles?: string;
};

export async function printEntriesChunked(
  entries: CalculationSnapshotEntry[],
  labels: CalculationSnapshotLabels,
  options: PrintOptions = {},
): Promise<void> {
  const {
    chunkSize = 50,
    title = "Druck",
    headerHtml = "",
    additionalStyles = "",
  } = options;

  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("No entries to print");
  }

  const iframe = createPrintFrame();
  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) {
    cleanupPrintFrame(iframe);
    throw new Error("Print-Frame konnte nicht initialisiert werden");
  }

  const safeTitle = String(title).replace(/[<>]/g, "");
  const styles =
    PRINT_BASE_STYLES +
    PRINT_PAGE_LAYOUT_STYLES +
    PRINT_BRAND_FOOTER_STYLES +
    (additionalStyles || "");

  doc.open();
  // Print-Frames benötigen document.write für korrektes Rendering
  doc.write(`<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <title>${safeTitle}</title>
  <style>${styles}</style>
</head>
<body>`);

  // Inhalt in eine Tabelle wrappen: thead (Firmenkopf/Titel) wiederholt sich oben
  // auf JEDER Druckseite; der tfoot ist nur ein Platzhalter, der unten Platz
  // reserviert. Die eigentliche Fußzeile wird per position: fixed unten gezeichnet
  // (siehe PRINT_PAGE_LAYOUT_STYLES) und erscheint so auf JEDER Seite – auch der
  // letzten/einzigen – am Seitenfuß statt direkt unter dem Inhalt.
  const pageTable = doc.createElement("table");
  pageTable.className = "psm-print-page";
  pageTable.innerHTML = `${
    headerHtml
      ? `<thead class="psm-print-page__head"><tr><td>${headerHtml}</td></tr></thead>`
      : ""
  }<tfoot class="psm-print-page__foot"><tr><td></td></tr></tfoot><tbody class="psm-print-page__body"><tr><td></td></tr></tbody>`;
  doc.body.appendChild(pageTable);

  const fixedFooter = doc.createElement("div");
  fixedFooter.className = "psm-print-fixed-footer";
  fixedFooter.innerHTML = buildPrintBrandFooter();
  doc.body.appendChild(fixedFooter);

  const bodyCell =
    pageTable.querySelector<HTMLTableCellElement>("tbody > tr > td");
  const container = doc.createElement("div");
  container.className = "calc-snapshots-container";
  (bodyCell || doc.body).appendChild(container);

  const totalChunks = Math.ceil(entries.length / chunkSize);

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
    const start = chunkIndex * chunkSize;
    const end = Math.min(start + chunkSize, entries.length);
    const chunk = entries.slice(start, end);

    const fragment = doc.createDocumentFragment();

    for (const entry of chunk) {
      const html = renderCalculationSnapshotForPrint(entry, labels);
      const wrapper = doc.createElement("div");
      wrapper.innerHTML = html;
      while (wrapper.firstChild) {
        fragment.appendChild(wrapper.firstChild);
      }
    }

    container.appendChild(fragment);

    if (chunkIndex < totalChunks - 1) {
      await nextFrame();
    }
  }

  doc.write("</body></html>");
  doc.close();

  await new Promise<void>((resolve) => {
    const frameWindow = iframe.contentWindow;
    if (!frameWindow) {
      resolve();
      return;
    }
    if (frameWindow.document.readyState === "complete") {
      resolve();
    } else {
      frameWindow.addEventListener("load", () => resolve(), { once: true });
    }
  });

  await new Promise<void>((resolve) => setTimeout(resolve, 100));

  try {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
  } catch (err) {
    console.error("Print failed", err);
    cleanupPrintFrame(iframe);
    throw err;
  }

  const frameWindow = iframe.contentWindow;
  if (frameWindow && "addEventListener" in frameWindow) {
    frameWindow.addEventListener(
      "afterprint",
      () => cleanupPrintFrame(iframe),
      { once: true },
    );
  }

  // "afterprint" ist der Normalfall zum Aufräumen. Der Timeout ist nur ein
  // Sicherheitsnetz, falls afterprint nicht feuert. Früher 5s – das entfernte
  // bei großen/langsamen Drucken das Iframe, WÄHREND der Druckdialog noch offen
  // war (leere Vorschau). Daher großzügig (cleanupPrintFrame ist idempotent).
  setTimeout(() => cleanupPrintFrame(iframe), 120000);
}
