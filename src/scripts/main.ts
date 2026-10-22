// Bootstrap-Plugins werden gezielt importiert statt das komplette Bundle per
// CDN zu laden. Collapse registriert beim Import die data-bs-toggle="collapse"
// Data-API (Navbar-Toggler, Debug-Panels). Weitere Plugins werden im Code
// nicht verwendet (Tooltips werden nicht initialisiert).
import "bootstrap/js/dist/collapse";
import { bootstrap } from "./core/bootstrap";

const bootstrapFlag = "__pflanzenschutz_bootstrapped__";
const win = window as typeof window & Record<string, unknown>;

function startApp(): void {
  bootstrap().catch((error) => {
    console.error("bootstrap failed", error);
  });
}

if (!win[bootstrapFlag]) {
  win[bootstrapFlag] = true;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startApp, { once: true });
  } else {
    startApp();
  }
}
