import { HITS_STATS_URL } from "@scripts/core/viewCounter";

/** Identischer Inhalt im statischen HTML und in der interaktiven Startansicht. */
export function renderLandingMarkup(hasFile = false): string {
    const showContinueFocus = hasFile;

    // Anleitung (Videos + Schritt-für-Schritt) – in beiden Szenarien sichtbar
    const guideCardHtml = `<a class="startup-guide" href="/anleitung/" data-action="open-guide">
            <span class="startup-guide-media">
              <img src="/assets/img/anleitung-vorschau.webp" alt="Digitale PSM: Formular zur Erfassung einer Pflanzenschutz-Anwendung" width="960" height="540" data-role="guide-preview" decoding="async" />
              <span class="startup-guide-play"><i class="bi bi-play-fill"></i></span>
            </span>
            <span class="startup-guide-text">
              <span class="startup-guide-title">Anleitung mit Videos</span>
              <span class="startup-guide-sub">Kurze Videos zeigen Schritt für Schritt, wie die App funktioniert.</span>
              <span class="startup-guide-cta">Anleitung ansehen<i class="bi bi-arrow-right"></i></span>
            </span>
          </a>`;

    return `
    <div class="section-inner">
      <div class="card startup-card">
        <div class="card-body startup-body">
          <div class="startup-brand">
            <img src="/assets/img/favicon.svg" alt="" width="28" height="28" />
            <span>Digitale<span class="startup-brand-dash">-</span>PSM<span class="startup-brand-tld">.de</span></span>
          </div>

          <div class="startup-hero">
            <div class="startup-intro">
              <h1 class="startup-title">Pflanzenschutz einfach dokumentieren</h1>
              ${
                showContinueFocus
                  ? `<!-- Szenario 2: Hat Datei → Fortsetzen im Fokus -->
                <div id="auto-start-banner" class="startup-resume">
                  <p class="startup-resume-label">
                    <i class="bi bi-clock-history me-1"></i>Zuletzt verwendet
                  </p>
                  <p class="startup-resume-file" data-role="auto-start-filename"></p>
                  <div class="startup-resume-actions">
                    <button class="btn btn-lg startup-btn-resume" data-action="auto-start">
                      <i class="bi bi-arrow-right-circle-fill me-2"></i>Fortsetzen
                    </button>
                    <button class="btn startup-btn-icon" data-action="auto-start-forget" title="Aus Liste entfernen" aria-label="Aus Liste entfernen">
                      <i class="bi bi-x-lg"></i>
                    </button>
                  </div>
                </div>

                <!-- Sekundär: Andere Datei öffnen, neue Datenbank -->
                <div class="startup-actions">
                  <button class="btn startup-btn-ghost" data-action="open">
                    <i class="bi bi-folder2-open me-2"></i>Andere Datei öffnen
                  </button>
                  <button class="btn startup-btn-ghost" data-action="start-wizard">
                    <i class="bi bi-plus-lg me-2"></i>Neu erstellen
                  </button>
                </div>`
                  : `<!-- Szenario 1 & 3: Neuer User → Neu erstellen im Fokus -->
                <p class="startup-lead">
                  Für Gärtnereien und landwirtschaftliche Betriebe: Die App berechnet, wie viel Pflanzenschutzmittel du für deine Fläche brauchst, und hält jede Anwendung fest.
                </p>
                <ul class="startup-facts">
                  <li><i class="bi bi-filetype-json"></i>Maschinenlesbar als JSON-Datei</li>
                  <li><i class="bi bi-file-earmark-pdf"></i>PDF und Druck</li>
                  <li><i class="bi bi-hdd"></i>Daten bleiben auf deinem Gerät</li>
                </ul>

                <p class="startup-details">
                  Mit offiziellen BVL-Zulassungsdaten, EPPO-Codes und BBCH-Stadien.
                  Nach dem ersten Laden ist die App auch offline nutzbar.
                </p>

                <!-- Hauptaktion: Neu erstellen, sekundär: Datei öffnen -->
                <div class="startup-actions">
                  <button class="btn btn-lg startup-btn-primary" data-action="start-wizard">
                    <i class="bi bi-plus-circle-fill me-2"></i>Neu erstellen
                  </button>
                  <button class="btn startup-btn-ghost" data-action="open">
                    <i class="bi bi-folder2-open me-2"></i>Bestehende Datei öffnen
                  </button>
                </div>
                <p class="startup-compatibility">
                  Kostenlos und ohne Konto. Nutze Chrome oder Edge am Computer.
                  Auf dem Handy wird das Öffnen und Speichern der Datenbank noch nicht unterstützt.
                </p>`
              }
            </div>

            ${guideCardHtml}

            <!-- Hinweis zu den Vorgaben – in beiden Szenarien sichtbar -->
            <p class="startup-note">
              Die Felder richten sich nach den Vorgaben für Pflanzenschutz-Aufzeichnungen (Verordnung (EU) 2023/564, § 11 Pflanzenschutzgesetz). Für vollständige und richtige Angaben bist du selbst verantwortlich – die App ist kostenlos und ohne Gewähr.
            </p>
          </div>

          <!-- PWA Banner - nur wenn nicht in App -->
          <div id="pwa-install-banner" class="d-none mt-4">
            <hr class="my-3" style="border-color: rgba(255,255,255,0.1);" />
            <div data-role="pwa-content">
              <!-- Wird dynamisch gefüllt -->
            </div>
          </div>

          <!-- Info & Lizenz + Datenschutz + Statistik -->
          <div class="startup-foot">
            <a href="https://info.digitale-psm.de" target="_blank" rel="noopener noreferrer">
              <i class="bi bi-info-circle me-1"></i>Info & Lizenz
            </a>
            <a href="mailto:abbas@hoseiny.de">
              <i class="bi bi-envelope me-1"></i>Kontakt
            </a>
            <a href="/datenschutz/">
              <i class="bi bi-shield-check me-1"></i>Datenschutz
            </a>
            <!-- Statistik und Zähler brechen auf dem Handy gemeinsam um -->
            <span class="startup-foot-group">
              <a href="https://st.digitale-psm.de" target="_blank" rel="noopener noreferrer">
                <i class="bi bi-bar-chart-line me-1"></i>Statistik
              </a>
              <a id="startup-view-counter" class="startup-view-counter" href="${HITS_STATS_URL}" target="_blank" rel="noopener noreferrer" title="Aufruf-Statistik (hits.sh)">
                <i class="bi bi-eye"></i>
                <span data-role="view-count"></span>
              </a>
            </span>
          </div>
        </div>
      </div>
    </div>
  `;

}
