/**
 * Infos Client - UI Rendering
 * Moderne Darstellung mit Quellen-Kacheln, Artikelansicht und PDF-Lightbox
 * 3 Hauptquellen: BVL-PDF, Peter Stader, Christian Bärthele
 */

import type {
  InfoArticle,
  InfoCategory,
  InfoNotification,
  InfoAttachment,
  InfosServices,
  LightboxContentType,
  InfoManifest,
} from "./types";

import {
  loadInfos,
  loadArticleContent,
  getCategories,
  getArticlesByCategory,
  getFeaturedArticles,
  getActiveNotifications,
  getArticleById,
  getCategoryById,
  getLastUpdateTime,
  getError,
  getAssetUrl,
  setSelectedCategory,
  setSelectedArticle,
  getSelectedCategory,
  getSelectedArticle,
  parseMarkdown,
  getCategoryIcon,
  formatDate,
  formatFileSize,
  escapeHtml,
  isLoading,
  buildManifestUrl,
} from "./index";

// ══════════════════════════════════════════════════════════════════════
// MODULE STATE
// ══════════════════════════════════════════════════════════════════════

let initialized = false;
let currentLightbox: HTMLElement | null = null;
let sectionElement: HTMLElement | null = null;
let contentElement: HTMLElement | null = null;

// ══════════════════════════════════════════════════════════════════════
// QUELLEN-KONFIGURATION (3 hardcodierte Quellen)
// ══════════════════════════════════════════════════════════════════════

type SourceKey = "bvlpdf" | "stader" | "baerthele";

interface SourceConfig {
  key: SourceKey;
  icon: string;
  label: string;
  description: string;
}

const SOURCES: SourceConfig[] = [
  {
    key: "bvlpdf",
    icon: "megaphone",
    label: "BVL-PDF",
    description: "Offizielle BVL-Dokumente und Pflanzenschutz-Informationen",
  },
  {
    key: "stader",
    icon: "peterstader",
    label: "Peter Stader",
    description: "Jungpflanzen und Beratung von Peter Stader",
  },
  {
    key: "baerthele",
    icon: "baerthele",
    label: "Christian Bärthele",
    description: "Jungpflanzen und Beratung von Christian Bärthele",
  },
];

interface SourceState {
  repoName: string;
  isConfigured: boolean;
  isLoading: boolean;
  error: string | null;
  manifest: InfoManifest | null;
}

const sourceStates: Record<SourceKey, SourceState> = {
  bvlpdf: {
    repoName: "",
    isConfigured: false,
    isLoading: false,
    error: null,
    manifest: null,
  },
  stader: {
    repoName: "",
    isConfigured: false,
    isLoading: false,
    error: null,
    manifest: null,
  },
  baerthele: {
    repoName: "",
    isConfigured: false,
    isLoading: false,
    error: null,
    manifest: null,
  },
};

// Welche Quelle ist gerade aktiv/ausgewählt?
let selectedSource: SourceKey | null = null;

// localStorage Keys
const STORAGE_KEY_PREFIX = "infos_source_";

function getSourceRepoName(source: SourceKey): string {
  try {
    return localStorage.getItem(`${STORAGE_KEY_PREFIX}${source}`) || "";
  } catch {
    return "";
  }
}

function saveSourceRepoName(source: SourceKey, repoName: string): void {
  try {
    if (repoName.trim()) {
      localStorage.setItem(`${STORAGE_KEY_PREFIX}${source}`, repoName.trim());
    } else {
      localStorage.removeItem(`${STORAGE_KEY_PREFIX}${source}`);
    }
  } catch (e) {
    console.warn("[InfosClient] Could not save repo name:", e);
  }
}

async function loadSourceManifest(source: SourceKey): Promise<void> {
  const repoName = sourceStates[source].repoName;
  if (!repoName) return;

  sourceStates[source].isLoading = true;
  sourceStates[source].error = null;

  try {
    const manifestUrl = buildManifestUrl(repoName);
    const response = await fetch(manifestUrl);

    if (!response.ok) {
      throw new Error(
        response.status === 404
          ? "Repository nicht gefunden"
          : `Fehler ${response.status}`
      );
    }

    const manifest: InfoManifest = await response.json();

    // Validate manifest - articles required, categories optional
    if (!manifest.articles || !Array.isArray(manifest.articles)) {
      throw new Error("Ungültiges Manifest-Format");
    }

    // Ensure categories array exists
    if (!manifest.categories) {
      manifest.categories = [];
    }

    sourceStates[source].manifest = manifest;
    sourceStates[source].isConfigured = true;
  } catch (error) {
    sourceStates[source].error =
      error instanceof Error ? error.message : "Unbekannter Fehler";
    sourceStates[source].manifest = null;
  } finally {
    sourceStates[source].isLoading = false;
  }
}

function initializeSources(): void {
  for (const source of SOURCES) {
    const repoName = getSourceRepoName(source.key);
    sourceStates[source.key].repoName = repoName;
    sourceStates[source.key].isConfigured = !!repoName;
  }
}

// ══════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ══════════════════════════════════════════════════════════════════════

export function initInfos(_services: InfosServices): void {
  if (initialized) return;

  // Find section element
  sectionElement = document.querySelector<HTMLElement>(
    '[data-section="infos"], #section-infos'
  );
  if (!sectionElement) {
    console.warn("[InfosClient] Section not found");
    return;
  }

  // Find content element
  contentElement = document.querySelector<HTMLElement>(
    '[data-feature="infos"]'
  );

  if (!contentElement) {
    contentElement = sectionElement.querySelector<HTMLElement>(
      '[data-role="infos-content"]'
    );
  }

  if (!contentElement) {
    // Last resort: create it
    const container = sectionElement.querySelector(".section-container");
    if (container) {
      contentElement = document.createElement("div");
      contentElement.setAttribute("data-feature", "infos");
      contentElement.setAttribute("data-role", "infos-content");
      container.appendChild(contentElement);
    }
  }

  console.log("[InfosClient] Elements found:", {
    section: !!sectionElement,
    content: !!contentElement,
  });

  if (!contentElement) {
    console.error("[InfosClient] Could not find or create content element!");
    return;
  }

  // Setup lightbox
  setupLightbox();

  // Initialize sources from localStorage
  initializeSources();

  // Render the overview (with source tiles)
  renderSourcesOverview();

  initialized = true;
  console.log("[InfosClient] Initialized");
}

// ══════════════════════════════════════════════════════════════════════
// LIGHTBOX SYSTEM
// ══════════════════════════════════════════════════════════════════════

function setupLightbox(): void {
  if (document.getElementById("infos-lightbox")) return;

  const lightbox = document.createElement("div");
  lightbox.id = "infos-lightbox";
  lightbox.className = "infos-lightbox";
  lightbox.innerHTML = `
    <div class="infos-lightbox-backdrop"></div>
    <div class="infos-lightbox-container">
      <button class="infos-lightbox-close" aria-label="Schließen">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
      <div class="infos-lightbox-content"></div>
      <div class="infos-lightbox-caption"></div>
      <div class="infos-lightbox-actions">
        <button class="infos-lightbox-btn" data-action="download">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
          </svg>
          Herunterladen
        </button>
        <button class="infos-lightbox-btn" data-action="open-new">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/>
          </svg>
          In neuem Tab
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(lightbox);
  currentLightbox = lightbox;

  // Event Listeners
  lightbox
    .querySelector(".infos-lightbox-backdrop")
    ?.addEventListener("click", closeLightbox);
  lightbox
    .querySelector(".infos-lightbox-close")
    ?.addEventListener("click", closeLightbox);

  lightbox
    .querySelector('[data-action="download"]')
    ?.addEventListener("click", () => {
      const url = lightbox.dataset.currentUrl;
      if (url) {
        const a = document.createElement("a");
        a.href = url;
        a.download = url.split("/").pop() || "download";
        a.click();
      }
    });

  lightbox
    .querySelector('[data-action="open-new"]')
    ?.addEventListener("click", () => {
      const url = lightbox.dataset.currentUrl;
      if (url) window.open(url, "_blank");
    });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && lightbox.classList.contains("active")) {
      closeLightbox();
    }
  });
}

function openLightbox(
  type: LightboxContentType,
  url: string,
  caption?: string
): void {
  if (!currentLightbox) return;

  const content = currentLightbox.querySelector(".infos-lightbox-content");
  const captionEl = currentLightbox.querySelector(".infos-lightbox-caption");
  if (!content) return;

  currentLightbox.dataset.currentUrl = url;

  if (type === "image") {
    content.innerHTML = `<img src="${url}" alt="${
      caption || ""
    }" class="infos-lightbox-image" />`;
  } else if (type === "pdf") {
    // Native Browser PDF-Viewer - viel besser als in WebView2!
    content.innerHTML = `<iframe src="${url}#toolbar=1&navpanes=0&scrollbar=1" class="infos-lightbox-pdf" title="${
      caption || "PDF"
    }"></iframe>`;
  }

  if (captionEl instanceof HTMLElement) {
    captionEl.textContent = caption || "";
    captionEl.style.display = caption ? "block" : "none";
  }

  currentLightbox.classList.add("active");
  document.body.style.overflow = "hidden";
}

function closeLightbox(): void {
  if (!currentLightbox) return;
  currentLightbox.classList.remove("active");
  document.body.style.overflow = "";
  setTimeout(() => {
    const content = currentLightbox?.querySelector(".infos-lightbox-content");
    if (content) content.innerHTML = "";
  }, 300);
}

// ══════════════════════════════════════════════════════════════════════
// SOURCES OVERVIEW (Hauptansicht mit 3 Quellen-Kacheln)
// ══════════════════════════════════════════════════════════════════════

function renderSourcesOverview(): void {
  if (!contentElement) return;

  console.log("[InfosClient] renderSourcesOverview");

  const html = `
    <div class="infos-modern">
      <div class="infos-container-card">
        <header class="infos-hero">
          <div class="infos-hero-content">
            <h1><span class="infos-hero-icon">📚</span> Informationen & Hilfe</h1>
            <p class="infos-hero-subtitle">Aktuelle Hinweise und Empfehlungen von Ihren Beratern</p>
          </div>
        </header>

        <section class="infos-section">
          <h2 class="infos-section-title"><span class="infos-section-icon">📡</span> Verfügbare Quellen</h2>
          <div class="infos-sources-grid">
            ${SOURCES.map((source) => renderSourceTile(source)).join("")}
          </div>
        </section>

        <div class="infos-sources-hint">
          <p class="text-muted small">
            <i class="bi bi-info-circle me-1"></i>
            Klicken Sie auf eine Kachel, um die Inhalte der jeweiligen Quelle anzuzeigen.
            Nicht konfigurierte Quellen können durch Klick eingerichtet werden.
          </p>
        </div>
      </div>
    </div>
  `;

  contentElement.innerHTML = html;
  attachSourcesOverviewListeners();
  console.log("[InfosClient] Sources overview rendered");
}

// Render Source Icon/Logo
function getSourceIcon(iconName: string): string {
  // Peter Stader Logo
  if (iconName === "peterstader") {
    return `<img 
      src="https://www.peterstader.de/wp-content/uploads/2020/01/logo-peter-stader-retina.png" 
      alt="Peter Stader" 
      class="infos-source-logo"
      style="max-width: 120px; max-height: 40px; height: 40px; width: auto; object-fit: contain;"
    />`;
  }

  // Christian Bärthele Logo
  if (iconName === "baerthele") {
    return `<img 
      src="https://jungpflanzen.bio/wp-content/uploads/2024/01/Baerthele_Jungpflanzen_Markenzeichen.svg" 
      alt="Christian Bärthele" 
      class="infos-source-logo"
      width="120"
      height="40"
      style="max-width: 120px; max-height: 40px; height: 40px; width: auto; object-fit: contain;"
    />`;
  }

  // BVL-PDF Megaphone
  if (iconName === "megaphone") {
    return "📢";
  }

  // Fallback
  return "📄";
}

function renderSourceTile(source: SourceConfig): string {
  const state = sourceStates[source.key];
  const iconHtml = getSourceIcon(source.icon);

  if (state.isLoading) {
    return `
      <div class="infos-source-tile infos-source-loading" data-source="${source.key}">
        <div class="infos-source-tile-icon">${iconHtml}</div>
        <div class="infos-source-tile-content">
          <h3>${escapeHtml(source.label)}</h3>
          <p>${escapeHtml(source.description)}</p>
        </div>
        <div class="infos-source-status">
          <span class="spinner-border spinner-border-sm text-secondary"></span>
          <span class="infos-source-hint">Wird geladen...</span>
        </div>
      </div>
    `;
  }

  if (!state.isConfigured || !state.repoName) {
    return `
      <div class="infos-source-tile infos-source-unconfigured" 
           data-source="${source.key}" data-action="configure-source">
        <div class="infos-source-tile-icon">${iconHtml}</div>
        <div class="infos-source-tile-content">
          <h3>${escapeHtml(source.label)}</h3>
          <p>${escapeHtml(source.description)}</p>
        </div>
        <div class="infos-source-status">
          <span class="badge bg-secondary">
            <i class="bi bi-gear-fill"></i> Nicht konfiguriert
          </span>
          <span class="infos-source-hint">Klicken zum Einrichten →</span>
        </div>
      </div>
    `;
  }

  // Konfiguriert - zeige Artikel-Anzahl wenn Manifest geladen
  const articleCount = state.manifest?.articles?.length || 0;
  const categoryCount = state.manifest?.categories?.length || 0;

  return `
    <div class="infos-source-tile infos-source-configured" 
         data-source="${source.key}" data-action="open-source">
      <button type="button" class="btn btn-sm btn-outline-secondary infos-source-edit-btn" 
              data-action="edit-source" data-source="${source.key}" title="Quelle bearbeiten">
        <i class="bi bi-gear"></i>
      </button>
      <div class="infos-source-tile-icon">${iconHtml}</div>
      <div class="infos-source-tile-content">
        <h3>${escapeHtml(source.label)}</h3>
        <p>${escapeHtml(source.description)}</p>
      </div>
      <div class="infos-source-status">
        ${
          state.manifest
            ? `
          <span class="badge bg-success">
            <i class="bi bi-check-circle"></i> ${articleCount} Artikel
          </span>
          ${categoryCount > 0 ? `<span class="badge bg-info">${categoryCount} Kategorien</span>` : ""}
        `
            : `
          <span class="badge bg-primary">
            <i class="bi bi-arrow-right"></i> Öffnen
          </span>
        `
        }
      </div>
    </div>
  `;
}

function attachSourcesOverviewListeners(): void {
  if (!contentElement) return;

  contentElement.addEventListener("click", async (e) => {
    const target = e.target as HTMLElement;

    // Edit button clicked
    const editBtn = target.closest<HTMLElement>('[data-action="edit-source"]');
    if (editBtn) {
      e.stopPropagation();
      const source = editBtn.dataset.source as SourceKey;
      if (source) {
        showSourceConfigModal(source);
      }
      return;
    }

    // Source tile clicked
    const tile = target.closest<HTMLElement>("[data-source]");
    if (tile) {
      const source = tile.dataset.source as SourceKey;
      const action = tile.dataset.action;

      if (action === "configure-source") {
        showSourceConfigModal(source);
      } else if (action === "open-source") {
        await openSource(source);
      }
      return;
    }
  });
}

async function openSource(source: SourceKey): Promise<void> {
  selectedSource = source;
  const state = sourceStates[source];

  // Load manifest if not already loaded
  if (!state.manifest) {
    state.isLoading = true;
    renderSourcesOverview();
    await loadSourceManifest(source);
    state.isLoading = false;
  }

  if (state.manifest) {
    renderSourceContent(source);
  } else {
    // Error loading - show config modal
    showSourceConfigModal(source);
  }
}

function renderSourceContent(source: SourceKey): void {
  if (!contentElement) return;

  const config = SOURCES.find((s) => s.key === source);
  const state = sourceStates[source];
  const manifest = state.manifest;

  if (!config || !manifest) {
    renderSourcesOverview();
    return;
  }

  const categories = manifest.categories || [];
  const articles = manifest.articles || [];
  const featured = articles.filter((a) => a.featured);

  const html = `
    <div class="infos-modern">
      <div class="infos-container-card">
        <nav class="infos-nav">
          <button type="button" class="infos-nav-back" data-action="back-to-sources">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
            Zurück zur Übersicht
          </button>
        </nav>

        <header class="infos-hero">
          <div class="infos-hero-content">
            <h1><span class="infos-hero-icon">${getSourceIcon(config.icon)}</span> ${escapeHtml(config.label)}</h1>
            <p class="infos-hero-subtitle">${escapeHtml(config.description)}</p>
          </div>
          <div class="infos-hero-actions">
            ${manifest.lastUpdated ? `<span class="infos-update-badge">Aktualisiert: ${formatDate(manifest.lastUpdated)}</span>` : ""}
            <button type="button" class="infos-btn infos-btn-ghost" data-action="refresh-source" data-source="${source}">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M23 4v6h-6M1 20v-6h6"/>
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
              </svg>
              Aktualisieren
            </button>
          </div>
        </header>

        ${
          featured.length > 0
            ? `
          <section class="infos-section">
            <h2 class="infos-section-title"><span class="infos-section-icon">⭐</span> Aktuell & Wichtig</h2>
            <div class="infos-featured-grid">
              ${featured.map((a) => renderFeaturedCardForSource(a, source, categories)).join("")}
            </div>
          </section>
        `
            : ""
        }

        <section class="infos-section">
          ${
            categories.length > 0
              ? `
            <h2 class="infos-section-title"><span class="infos-section-icon">📂</span> Themen durchsuchen</h2>
            <div class="infos-categories-grid">
              ${categories.map((c) => renderCategoryTileForSource(c, source, articles)).join("")}
            </div>
          `
              : articles.length > 0
                ? `
            <h2 class="infos-section-title"><span class="infos-section-icon">📄</span> Alle Artikel</h2>
            <div class="infos-articles-list">
              ${articles.map((a) => renderArticleCardForSource(a, source)).join("")}
            </div>
          `
                : `
            <div class="infos-empty-state">
              <div class="infos-empty-icon">📭</div>
              <h3>Keine Inhalte verfügbar</h3>
              <p>Diese Quelle enthält noch keine Artikel.</p>
            </div>
          `
          }
        </section>

        <footer class="infos-quick-footer">
          <div class="infos-quick-stat">
            <span class="infos-quick-number">${categories.length}</span>
            <span class="infos-quick-label">Kategorien</span>
          </div>
          <div class="infos-quick-stat">
            <span class="infos-quick-number">${articles.length}</span>
            <span class="infos-quick-label">Artikel</span>
          </div>
        </footer>
      </div>
    </div>
  `;

  contentElement.innerHTML = html;
  attachSourceContentListeners(source);
}

function renderFeaturedCardForSource(
  article: InfoArticle,
  source: SourceKey,
  categories: InfoCategory[]
): string {
  const category = categories.find((c) => c.id === article.category);
  return `
    <article class="infos-featured-card ${article.priority === "high" ? "infos-featured-card-urgent" : ""}" 
             data-article-id="${article.id}" data-source="${source}">
      ${article.priority === "high" ? '<div class="infos-urgent-badge">🔴 Wichtig</div>' : ""}
      <div class="infos-featured-header">
        <span class="infos-featured-category">${category ? escapeHtml(category.label) : ""}</span>
        <span class="infos-featured-date">${formatDate(article.date)}</span>
      </div>
      <h3 class="infos-featured-title">${escapeHtml(article.title)}</h3>
      <p class="infos-featured-summary">${escapeHtml(article.summary)}</p>
      <div class="infos-featured-footer">
        <span class="infos-featured-author">👤 ${escapeHtml(article.author)}</span>
        ${article.attachments?.length ? `<span class="infos-featured-attachments">📎 ${article.attachments.length}</span>` : ""}
      </div>
    </article>
  `;
}

function renderCategoryTileForSource(
  category: InfoCategory,
  source: SourceKey,
  articles: InfoArticle[]
): string {
  const categoryArticles = articles.filter((a) => a.category === category.id);
  return `
    <div class="infos-category-tile" data-category-id="${category.id}" data-source="${source}">
      <div class="infos-category-tile-icon">${getCategoryIcon(category.icon)}</div>
      <div class="infos-category-tile-content">
        <h3>${escapeHtml(category.label)}</h3>
        <p>${escapeHtml(category.description)}</p>
      </div>
      <div class="infos-category-tile-footer">
        <span class="infos-category-tile-count">${categoryArticles.length} Artikel</span>
        <span class="infos-category-tile-arrow">→</span>
      </div>
    </div>
  `;
}

function renderArticleCardForSource(
  article: InfoArticle,
  source: SourceKey
): string {
  const hasPdf = article.attachments?.some((a) => a.type === "pdf");
  const pdfAttachment = article.attachments?.find((a) => a.type === "pdf");

  return `
    <div class="infos-article-card" data-article-id="${article.id}" data-source="${source}">
      <div class="infos-article-card-icon">
        ${hasPdf ? "📄" : "📝"}
      </div>
      <div class="infos-article-card-content">
        <h4 class="infos-article-card-title">${escapeHtml(article.title)}</h4>
        ${article.summary ? `<p class="infos-article-card-summary">${escapeHtml(article.summary)}</p>` : ""}
        <div class="infos-article-card-meta">
          <span class="infos-article-card-date">📅 ${formatDate(article.date)}</span>
          ${article.author ? `<span class="infos-article-card-author">👤 ${escapeHtml(article.author)}</span>` : ""}
          ${pdfAttachment ? `<span class="infos-article-card-size">📎 ${formatFileSize(pdfAttachment.size || 0)}</span>` : ""}
        </div>
      </div>
      <div class="infos-article-card-action">
        ${hasPdf ? '<span class="badge bg-primary">PDF öffnen</span>' : '<span class="badge bg-secondary">Ansehen</span>'}
      </div>
    </div>
  `;
}

function attachSourceContentListeners(source: SourceKey): void {
  if (!contentElement) return;

  contentElement.addEventListener("click", async (e) => {
    const target = e.target as HTMLElement;

    if (target.closest('[data-action="back-to-sources"]')) {
      e.preventDefault();
      selectedSource = null;
      renderSourcesOverview();
      return;
    }

    if (target.closest('[data-action="refresh-source"]')) {
      e.preventDefault();
      sourceStates[source].manifest = null;
      await openSource(source);
      return;
    }

    const categoryTile = target.closest<HTMLElement>("[data-category-id]");
    if (categoryTile) {
      const categoryId = categoryTile.dataset.categoryId;
      if (categoryId) {
        renderCategoryViewForSource(source, categoryId);
      }
      return;
    }

    const articleCard = target.closest<HTMLElement>("[data-article-id]");
    if (articleCard) {
      const articleId = articleCard.dataset.articleId;
      if (articleId) {
        void renderArticleViewForSource(source, articleId);
      }
      return;
    }
  });
}

// ══════════════════════════════════════════════════════════════════════
// SOURCE CONFIG MODAL
// ══════════════════════════════════════════════════════════════════════

function showSourceConfigModal(source: SourceKey): void {
  const config = SOURCES.find((s) => s.key === source);
  const state = sourceStates[source];
  if (!config) return;

  // Remove existing modal
  document.getElementById("infos-config-modal")?.remove();

  const modal = document.createElement("div");
  modal.id = "infos-config-modal";
  modal.className = "infos-modal-backdrop";
  modal.innerHTML = `
    <div class="infos-modal">
      <div class="infos-modal-header">
        <h3><span class="infos-modal-icon">${getSourceIcon(config.icon)}</span> ${escapeHtml(config.label)} konfigurieren</h3>
        <button type="button" class="infos-modal-close" data-action="close-modal">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>
      <div class="infos-modal-body">
        <p class="text-muted mb-3">
          Geben Sie den Zugangsschlüssel ein, um die Inhalte von ${escapeHtml(config.label)} zu laden.
          Den Zugangsschlüssel erhalten Sie direkt von ${escapeHtml(config.label)}.
        </p>
        <div class="mb-3">
          <label class="form-label">Zugangsschlüssel</label>
          <div class="input-group">
            <input type="text" class="form-control" id="source-repo-input" 
                   placeholder="Zugangsschlüssel eingeben"
                   value="${escapeHtml(state.repoName)}" />
          </div>
        </div>
        <div class="infos-modal-result" style="display: none;"></div>
      </div>
      <div class="infos-modal-footer">
        <button type="button" class="btn btn-secondary" data-action="close-modal">Abbrechen</button>
        <button type="button" class="btn btn-primary" data-action="validate-source">
          <i class="bi bi-check-circle me-1"></i>Prüfen & Speichern
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Event listeners
  modal
    .querySelector('[data-action="close-modal"]')
    ?.addEventListener("click", () => modal.remove());
  modal
    .querySelector(".infos-modal-backdrop")
    ?.addEventListener("click", (e) => {
      if (e.target === modal) modal.remove();
    });

  modal
    .querySelector('[data-action="validate-source"]')
    ?.addEventListener("click", async () => {
      const input = modal.querySelector<HTMLInputElement>("#source-repo-input");
      const resultDiv = modal.querySelector<HTMLElement>(".infos-modal-result");
      const validateBtn = modal.querySelector<HTMLButtonElement>(
        '[data-action="validate-source"]'
      );

      if (!input || !resultDiv || !validateBtn) return;

      const repoName = input.value.trim();
      if (!repoName) {
        resultDiv.innerHTML = `<div class="alert alert-warning"><i class="bi bi-exclamation-triangle"></i> Bitte geben Sie einen Zugangsschlüssel ein.</div>`;
        resultDiv.style.display = "block";
        return;
      }

      validateBtn.disabled = true;
      validateBtn.innerHTML =
        '<span class="spinner-border spinner-border-sm me-1"></span>Prüft...';
      resultDiv.style.display = "none";

      try {
        const manifestUrl = buildManifestUrl(repoName);
        const response = await fetch(manifestUrl);

        if (!response.ok) {
          throw new Error(
            response.status === 404
              ? "Zugangsschlüssel ungültig oder nicht gefunden. Bitte prüfen Sie die Eingabe."
              : `Fehler beim Laden (Status ${response.status})`
          );
        }

        const manifest: InfoManifest = await response.json();

        // Validate manifest - articles required, categories optional
        if (!manifest.articles || !Array.isArray(manifest.articles)) {
          throw new Error("Ungültiges Manifest-Format: Keine Artikel gefunden");
        }

        // Ensure categories array exists (can be empty or derived from articles)
        if (!manifest.categories) {
          manifest.categories = [];
        }

        // Success!
        saveSourceRepoName(source, repoName);
        sourceStates[source].repoName = repoName;
        sourceStates[source].isConfigured = true;
        sourceStates[source].manifest = manifest;

        const categoryCount = manifest.categories?.length || 0;
        const articleCount = manifest.articles?.length || 0;

        resultDiv.innerHTML = `
        <div class="alert alert-success">
          <i class="bi bi-check-circle-fill me-1"></i>
          <strong>Erfolgreich!</strong> ${articleCount} Artikel${categoryCount > 0 ? ` in ${categoryCount} Kategorien` : ""} gefunden.
        </div>
      `;
        resultDiv.style.display = "block";

        setTimeout(() => {
          modal.remove();
          renderSourceContent(source);
        }, 1500);
      } catch (error) {
        let errorMessage = "Unbekannter Fehler";
        if (error instanceof Error) {
          if (error.message === "Failed to fetch") {
            errorMessage =
              "Verbindung fehlgeschlagen. Bitte prüfen Sie Ihre Internetverbindung und den Zugangsschlüssel.";
          } else {
            errorMessage = error.message;
          }
        }
        resultDiv.innerHTML = `
        <div class="alert alert-danger">
          <i class="bi bi-exclamation-triangle-fill me-1"></i>
          ${escapeHtml(errorMessage)}
        </div>
      `;
        resultDiv.style.display = "block";
      } finally {
        validateBtn.disabled = false;
        validateBtn.innerHTML =
          '<i class="bi bi-check-circle me-1"></i>Prüfen & Speichern';
      }
    });

  // Focus input
  setTimeout(
    () => modal.querySelector<HTMLInputElement>("#source-repo-input")?.focus(),
    100
  );
}

// ══════════════════════════════════════════════════════════════════════
// CATEGORY VIEW FOR SOURCE
// ══════════════════════════════════════════════════════════════════════

function renderCategoryViewForSource(
  source: SourceKey,
  categoryId: string
): void {
  if (!contentElement) return;

  const config = SOURCES.find((s) => s.key === source);
  const state = sourceStates[source];
  const manifest = state.manifest;

  if (!config || !manifest) {
    renderSourcesOverview();
    return;
  }

  const category = manifest.categories?.find((c) => c.id === categoryId);
  if (!category) {
    renderSourceContent(source);
    return;
  }

  const articles =
    manifest.articles?.filter((a) => a.category === categoryId) || [];

  contentElement.innerHTML = `
    <div class="infos-modern">
      <div class="infos-container-card">
        <nav class="infos-nav">
          <button type="button" class="infos-nav-back" data-action="back-to-source" data-source="${source}">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
            Zurück zu ${escapeHtml(config.label)}
          </button>
        </nav>

        <header class="infos-category-hero">
          <div class="infos-category-hero-icon">${getCategoryIcon(category.icon)}</div>
          <div class="infos-category-hero-content">
            <h1>${escapeHtml(category.label)}</h1>
            <p>${escapeHtml(category.description)}</p>
            <span class="infos-category-hero-count">${articles.length} Artikel verfügbar</span>
          </div>
        </header>

        <section class="infos-articles-section">
          ${
            articles.length > 0
              ? `
            <div class="infos-articles-list">
              ${articles.map((a) => renderArticleListItemForSource(a, source)).join("")}
            </div>
          `
              : `
            <div class="infos-empty-state">
              <div class="infos-empty-icon">📭</div>
              <h3>Noch keine Artikel</h3>
              <p>In dieser Kategorie gibt es noch keine Inhalte.</p>
            </div>
          `
          }
        </section>
      </div>
    </div>
  `;

  attachCategoryViewListeners(source);
}

function renderArticleListItemForSource(
  article: InfoArticle,
  source: SourceKey
): string {
  return `
    <article class="infos-article-item ${article.priority === "high" ? "infos-article-item-urgent" : ""}" 
             data-article-id="${article.id}" data-source="${source}">
      <div class="infos-article-item-main">
        <h3 class="infos-article-item-title">
          ${article.priority === "high" ? '<span class="infos-urgent-indicator">🔴</span>' : ""}
          ${escapeHtml(article.title)}
        </h3>
        <p class="infos-article-item-summary">${escapeHtml(article.summary)}</p>
        <div class="infos-article-item-meta">
          <span>📅 ${formatDate(article.date)}</span>
          <span>👤 ${escapeHtml(article.author)}</span>
          ${article.attachments?.length ? `<span>📎 ${article.attachments.length} Anhänge</span>` : ""}
        </div>
      </div>
      <div class="infos-article-item-arrow">→</div>
    </article>
  `;
}

function attachCategoryViewListeners(source: SourceKey): void {
  if (!contentElement) return;

  contentElement.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;

    if (target.closest('[data-action="back-to-source"]')) {
      e.preventDefault();
      renderSourceContent(source);
      return;
    }

    const articleItem = target.closest<HTMLElement>("[data-article-id]");
    if (articleItem) {
      const articleId = articleItem.dataset.articleId;
      if (articleId) {
        void renderArticleViewForSource(source, articleId);
      }
      return;
    }
  });
}

// ══════════════════════════════════════════════════════════════════════
// ARTICLE VIEW FOR SOURCE
// ══════════════════════════════════════════════════════════════════════

async function renderArticleViewForSource(
  source: SourceKey,
  articleId: string
): Promise<void> {
  if (!contentElement) return;

  const config = SOURCES.find((s) => s.key === source);
  const state = sourceStates[source];
  const manifest = state.manifest;

  if (!config || !manifest) {
    renderSourcesOverview();
    return;
  }

  const article = manifest.articles?.find((a) => a.id === articleId);
  if (!article) {
    renderSourceContent(source);
    return;
  }

  const category = manifest.categories?.find((c) => c.id === article.category);

  // For now, we'll show the article summary as content
  // In a real implementation, we would fetch the article content from GitHub Pages
  const content = article.summary || "Kein Inhalt verfügbar.";

  contentElement.innerHTML = `
    <div class="infos-modern">
      <div class="infos-container-card">
        <nav class="infos-nav">
          <button type="button" class="infos-nav-back" data-action="back-to-category" 
                  data-source="${source}" data-category-id="${article.category}">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
            Zurück zu ${category ? escapeHtml(category.label) : escapeHtml(config.label)}
          </button>
        </nav>

        <article class="infos-article-full">
          <header class="infos-article-full-header">
            ${article.priority === "high" ? '<div class="infos-urgent-badge">🔴 Wichtig</div>' : ""}
            <div class="infos-article-full-meta">
              <span class="infos-article-full-category">${category ? escapeHtml(category.label) : ""}</span>
              <span class="infos-article-full-date">📅 ${formatDate(article.date)}</span>
              <span class="infos-article-full-author">👤 ${escapeHtml(article.author)}</span>
            </div>
            <h1 class="infos-article-full-title">${escapeHtml(article.title)}</h1>
            <p class="infos-article-full-summary">${escapeHtml(article.summary)}</p>
          </header>

          <div class="infos-article-full-body">
            ${parseMarkdown(content)}
          </div>

          ${article.attachments?.length ? renderAttachmentsForSource(article.attachments, source) : ""}

          ${
            article.tags?.length
              ? `
            <footer class="infos-article-full-footer">
              <div class="infos-article-tags">
                ${article.tags.map((tag) => `<span class="infos-tag">#${escapeHtml(tag)}</span>`).join("")}
              </div>
            </footer>
          `
              : ""
          }
        </article>
      </div>
    </div>
  `;

  attachArticleViewListeners(source);
  makeImagesClickable();
}

function renderAttachmentsForSource(
  attachments: InfoAttachment[],
  source: SourceKey
): string {
  const state = sourceStates[source];
  const baseUrl = state.repoName
    ? `https://abbas-hoseiny.github.io/${state.repoName}/`
    : "";

  return `
    <section class="infos-attachments-section">
      <h3 class="infos-attachments-title">📎 Anhänge</h3>
      <div class="infos-attachments-grid">
        ${attachments
          .map((a) => {
            const url = baseUrl + a.file;
            const icon =
              a.type === "pdf"
                ? "📕"
                : a.type === "image"
                  ? "🖼️"
                  : a.type === "video"
                    ? "🎬"
                    : "📄";
            return `
            <div class="infos-attachment-card" data-type="${a.type}" data-url="${url}">
              <div class="infos-attachment-icon">${icon}</div>
              <div class="infos-attachment-info">
                <span class="infos-attachment-label">${escapeHtml(a.label)}</span>
                ${a.size ? `<span class="infos-attachment-size">${formatFileSize(a.size)}</span>` : ""}
              </div>
              <div class="infos-attachment-actions">
                ${
                  a.type === "pdf" || a.type === "image"
                    ? `<button class="infos-attachment-btn" data-action="preview" title="Vorschau">👁️</button>`
                    : ""
                }
                <a href="${url}" download class="infos-attachment-btn" title="Herunterladen">⬇️</a>
              </div>
            </div>
          `;
          })
          .join("")}
      </div>
    </section>
  `;
}

function attachArticleViewListeners(source: SourceKey): void {
  if (!contentElement) return;

  contentElement.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;

    const backBtn = target.closest<HTMLElement>(
      '[data-action="back-to-category"]'
    );
    if (backBtn) {
      e.preventDefault();
      const categoryId = backBtn.dataset.categoryId;
      if (categoryId) {
        renderCategoryViewForSource(source, categoryId);
      } else {
        renderSourceContent(source);
      }
      return;
    }

    // Attachment preview
    const previewBtn = target.closest<HTMLElement>('[data-action="preview"]');
    if (previewBtn) {
      e.preventDefault();
      const card = previewBtn.closest<HTMLElement>(".infos-attachment-card");
      if (card) {
        const type = card.dataset.type as LightboxContentType;
        const url = card.dataset.url;
        const label = card.querySelector(
          ".infos-attachment-label"
        )?.textContent;
        if (url && (type === "pdf" || type === "image")) {
          openLightbox(type, url, label || undefined);
        }
      }
      return;
    }
  });
}

function makeImagesClickable(): void {
  if (!contentElement) return;
  const images = contentElement.querySelectorAll<HTMLImageElement>(
    ".infos-article-full-body img"
  );
  images.forEach((img) => {
    img.style.cursor = "zoom-in";
    img.addEventListener("click", () =>
      openLightbox("image", img.src, img.alt || "Bild")
    );
  });
}

// ══════════════════════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════════════════════

export { openLightbox, closeLightbox };
