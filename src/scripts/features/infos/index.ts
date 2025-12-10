/**
 * Infos Feature - Data Layer
 * Lädt Manifeste von GitHub Pages, verwaltet Cache und Validierung
 */

import type {
  InfosConfig,
  InfosState,
  InfoManifest,
  InfoMeta,
  InfoCategory,
  InfoArticle,
  InfoNotification,
  InfoSource,
  ValidationResult,
  DEFAULT_INFOS_CONFIG,
} from "./types";

// ══════════════════════════════════════════════════════════════════════
// KONFIGURATION
// ══════════════════════════════════════════════════════════════════════

const CONFIG: InfosConfig = {
  githubUsername: "abbas-hoseiny",
  cacheMaxAge: 3600000, // 1 Stunde
  manifestFile: "manifest.json",
  metaFile: "meta.json",
};

// Erlaubte URL-Prefixe (Whitelist)
const ALLOWED_URL_PREFIXES = [
  `https://${CONFIG.githubUsername}.github.io/`,
  `https://raw.githubusercontent.com/${
    CONFIG.githubUsername.charAt(0).toUpperCase() +
    CONFIG.githubUsername.slice(1)
  }/`,
];

// Regex für gültige Repo-Namen
const VALID_REPO_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/;

// ══════════════════════════════════════════════════════════════════════
// FALLBACK INHALTE (für Offline/Fehler)
// ══════════════════════════════════════════════════════════════════════

const FALLBACK_CATEGORIES: InfoCategory[] = [
  {
    id: "compliance",
    label: "Compliance & Zertifizierung",
    icon: "shield-check",
    description: "EU- und QS-Anforderungen an die Dokumentation",
    priority: 10,
  },
  {
    id: "anleitungen",
    label: "Anleitungen",
    icon: "book",
    description: "Tutorials und Hilfe zur App-Nutzung",
    priority: 11,
  },
];

const FALLBACK_ARTICLES: InfoArticle[] = [
  {
    id: "app-erfuellt-anforderungen",
    title: "EU-Verordnung 2023/564 & QS-GAP Compliance",
    summary:
      "Vollständige Dokumentation gemäß EU-Verordnung 2023/564 und QS-GAP-Leitfaden",
    category: "compliance",
    file: "inline:app-erfuellt-anforderungen",
    date: "2025-01-07",
    author: "Abbas",
    tags: ["compliance", "eu-verordnung", "qs-gap", "dokumentation"],
    featured: true,
    priority: "high",
  },
  {
    id: "schnellstart",
    title: "Schnellstart-Anleitung",
    summary:
      "In 5 Minuten zur ersten PSM-Dokumentation - Schritt für Schritt erklärt",
    category: "anleitungen",
    file: "inline:schnellstart",
    date: "2025-01-07",
    author: "Abbas",
    tags: ["anleitung", "schnellstart", "tutorial"],
    featured: true,
  },
];

const INLINE_ARTICLE_CONTENT: Record<string, string> = {
  "inline:app-erfuellt-anforderungen": `# EU-Verordnung 2023/564 & QS-GAP Compliance

## Übersicht

Diese App erfüllt alle Anforderungen der **EU-Durchführungsverordnung 2023/564** sowie des **QS-GAP-Leitfadens** für die digitale Pflanzenschutz-Dokumentation.

---

## EU-Verordnung 2023/564 - Was Sie wissen müssen

### Wichtige Fristen

| Frist | Anforderung |
|-------|-------------|
| **1. Januar 2026** | Elektronische Aufzeichnungen in maschinenlesbarem Format werden verpflichtend |
| **30 Tage** | Papieraufzeichnungen müssen innerhalb von 30 Tagen digitalisiert werden |

### ✅ So erfüllt diese App die EU-Anforderungen

| EU-Anforderung | App-Umsetzung |
|----------------|---------------|
| Maschinenlesbares Format | ✅ SQLite-Datenbank mit strukturierten Feldern |
| Produktbezeichnung | ✅ Automatisch aus PSM-Liste |
| Datum | ✅ Pflichtfeld bei jeder Eingabe |
| Aufwandmenge | ✅ Automatische Berechnung im Kalkulator |
| Fläche (ha) | ✅ Flächenerfassung in ha, Ar oder m² |

---

## Zusammenfassung

Diese App unterstützt Sie bei der digitalen Dokumentation gemäß:

- ✅ EU-Durchführungsverordnung 2023/564
- ✅ QS-GAP-Leitfaden Kapitel 3.6.1 & 3.6.2

**Stand:** Dezember 2025`,

  "inline:schnellstart": `# Schnellstart-Anleitung

## In 5 Minuten zur ersten PSM-Dokumentation

### 1. App-Übersicht

Nach dem Start sehen Sie die **Hauptnavigation** mit folgenden Bereichen:

| Bereich | Funktion |
|---------|----------|
| **Berechnung** | PSM-Mengen berechnen und dokumentieren |
| **Dokumentation** | Alle gespeicherten Einträge einsehen |
| **Einstellungen** | Eigene Mittel und Profile verwalten |

### 2. Erste Berechnung

1. Geben Sie Ihre Fläche ein (ha)
2. Wählen Sie ein Pflanzenschutzmittel
3. Klicken Sie auf **Berechnen**
4. Speichern Sie die Berechnung

**Fertig!** Sie sind bereit für die digitale PSM-Dokumentation.`,
};

// ══════════════════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════════════════

let infosState: InfosState = {
  manifest: null,
  meta: null,
  loadedArticles: new Map(),
  lastFetch: null,
  isLoading: false,
  error: null,
  selectedCategory: null,
  selectedArticle: null,
};

// ══════════════════════════════════════════════════════════════════════
// CACHE (localStorage)
// ══════════════════════════════════════════════════════════════════════

const CACHE_VERSION = "v1";
const CACHE_KEY_MANIFEST = `${CACHE_VERSION}_infos_manifest`;
const CACHE_KEY_META = `${CACHE_VERSION}_infos_meta`;
const CACHE_KEY_ARTICLES = `${CACHE_VERSION}_infos_articles`;
const CACHE_KEY_TIMESTAMP = `${CACHE_VERSION}_infos_timestamp`;
const CACHE_KEY_REPO = `infos:repoName`;

function saveToCache(key: string, data: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.warn("[Infos] Cache-Speicherung fehlgeschlagen:", e);
  }
}

function loadFromCache<T>(key: string): T | null {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  } catch (e) {
    console.warn("[Infos] Cache-Laden fehlgeschlagen:", e);
    return null;
  }
}

function clearCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY_MANIFEST);
    localStorage.removeItem(CACHE_KEY_META);
    localStorage.removeItem(CACHE_KEY_ARTICLES);
    localStorage.removeItem(CACHE_KEY_TIMESTAMP);
  } catch (e) {
    console.warn("[Infos] Cache-Löschen fehlgeschlagen:", e);
  }
}

function isCacheValid(): boolean {
  const timestamp = loadFromCache<number>(CACHE_KEY_TIMESTAMP);
  if (!timestamp) return false;
  return Date.now() - timestamp < CONFIG.cacheMaxAge;
}

// ══════════════════════════════════════════════════════════════════════
// REPO-NAME VERWALTUNG
// ══════════════════════════════════════════════════════════════════════

export function getSavedRepoName(): string {
  try {
    return localStorage.getItem(CACHE_KEY_REPO) || "";
  } catch {
    return "";
  }
}

export function saveRepoName(repoName: string): void {
  try {
    if (repoName.trim()) {
      localStorage.setItem(CACHE_KEY_REPO, repoName.trim());
    } else {
      localStorage.removeItem(CACHE_KEY_REPO);
    }
  } catch (e) {
    console.warn("[Infos] Repo-Name konnte nicht gespeichert werden:", e);
  }
}

// ══════════════════════════════════════════════════════════════════════
// VALIDIERUNG
// ══════════════════════════════════════════════════════════════════════

export function validateRepoName(repoName: string): ValidationResult {
  const trimmed = repoName.trim();

  if (!trimmed) {
    return { valid: false, error: "Kein Repo-Name angegeben" };
  }

  if (trimmed.includes("http://") || trimmed.includes("https://")) {
    return {
      valid: false,
      error: "Bitte nur den Repo-Namen eingeben, keine URL",
    };
  }

  if (trimmed.includes("/") || trimmed.includes("\\")) {
    return {
      valid: false,
      error: "Ungültiger Repo-Name (keine Pfade erlaubt)",
    };
  }

  if (!VALID_REPO_NAME_REGEX.test(trimmed)) {
    return {
      valid: false,
      error: "Ungültiger Repo-Name (nur Buchstaben, Zahlen, - und _ erlaubt)",
    };
  }

  return { valid: true };
}

export function isURLAllowed(url: string): boolean {
  const lowerUrl = url.toLowerCase();
  return ALLOWED_URL_PREFIXES.some((prefix) =>
    lowerUrl.startsWith(prefix.toLowerCase())
  );
}

// ══════════════════════════════════════════════════════════════════════
// URL-BUILDER
// ══════════════════════════════════════════════════════════════════════

export function buildManifestUrl(repoName: string): string {
  return `https://${CONFIG.githubUsername}.github.io/${repoName}/${CONFIG.manifestFile}`;
}

export function buildMetaUrl(repoName: string): string {
  return `https://${CONFIG.githubUsername}.github.io/${repoName}/${CONFIG.metaFile}`;
}

export function buildArticleUrl(repoName: string, articleFile: string): string {
  return `https://${CONFIG.githubUsername}.github.io/${repoName}/${articleFile}`;
}

export function buildAssetUrl(repoName: string, assetPath: string): string {
  return `https://${CONFIG.githubUsername}.github.io/${repoName}/${assetPath}`;
}

export function getAssetUrl(assetPath: string): string {
  const repoName = getSavedRepoName();
  if (!repoName) return assetPath;
  return buildAssetUrl(repoName, assetPath);
}

// ══════════════════════════════════════════════════════════════════════
// DATEN LADEN
// ══════════════════════════════════════════════════════════════════════

export async function loadInfos(forceRefresh = false): Promise<void> {
  // Bereits am Laden
  if (infosState.isLoading) return;

  infosState.isLoading = true;
  infosState.error = null;

  try {
    const repoName = getSavedRepoName();

    // Kein Repo konfiguriert -> Fallback verwenden
    if (!repoName) {
      console.log("[Infos] Kein Repo konfiguriert, verwende Fallback-Inhalte");
      useFallbackContent();
      return;
    }

    // Cache prüfen
    if (!forceRefresh && isCacheValid()) {
      const cachedManifest = loadFromCache<InfoManifest>(CACHE_KEY_MANIFEST);
      if (cachedManifest) {
        console.log("[Infos] Verwende gecachte Daten");
        infosState.manifest = cachedManifest;
        infosState.meta = loadFromCache<InfoMeta>(CACHE_KEY_META);
        infosState.lastFetch = loadFromCache<number>(CACHE_KEY_TIMESTAMP);
        return;
      }
    }

    // Manifest laden
    const manifestUrl = buildManifestUrl(repoName);
    console.log("[Infos] Lade Manifest von:", manifestUrl);

    const response = await fetch(manifestUrl, {
      cache: forceRefresh ? "no-cache" : "default",
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(
          `Repo "${repoName}" nicht gefunden. Prüfen Sie den Namen.`
        );
      }
      throw new Error(`Fehler beim Laden (Status ${response.status})`);
    }

    const manifest: InfoManifest = await response.json();

    // Validierung
    if (!manifest.categories || !manifest.articles) {
      throw new Error("Ungültiges Manifest-Format");
    }

    // State aktualisieren
    infosState.manifest = manifest;
    infosState.lastFetch = Date.now();

    // Cache speichern
    saveToCache(CACHE_KEY_MANIFEST, manifest);
    saveToCache(CACHE_KEY_TIMESTAMP, Date.now());

    // Meta laden (optional)
    try {
      const metaUrl = buildMetaUrl(repoName);
      const metaResponse = await fetch(metaUrl);
      if (metaResponse.ok) {
        infosState.meta = await metaResponse.json();
        saveToCache(CACHE_KEY_META, infosState.meta);
      }
    } catch {
      // Meta ist optional
    }

    console.log("[Infos] Manifest geladen:", {
      categories: manifest.categories.length,
      articles: manifest.articles.length,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unbekannter Fehler";
    console.error("[Infos] Fehler beim Laden:", message);
    infosState.error = message;

    // Bei Fehler Fallback verwenden
    useFallbackContent();
  } finally {
    infosState.isLoading = false;
  }
}

function useFallbackContent(): void {
  infosState.manifest = {
    version: "1.0.0",
    lastUpdated: new Date().toISOString(),
    baseUrl: "",
    categories: FALLBACK_CATEGORIES,
    articles: FALLBACK_ARTICLES,
    featured: FALLBACK_ARTICLES.filter((a) => a.featured).map((a) => a.id),
    notifications: [],
  };
  infosState.lastFetch = Date.now();
}

// ══════════════════════════════════════════════════════════════════════
// ARTIKEL-INHALT LADEN
// ══════════════════════════════════════════════════════════════════════

export async function loadArticleContent(
  article: InfoArticle
): Promise<string> {
  // Inline-Content
  if (article.file.startsWith("inline:")) {
    const key = article.file;
    return (
      INLINE_ARTICLE_CONTENT[key] || `# ${article.title}\n\n${article.summary}`
    );
  }

  // Bereits geladen
  if (infosState.loadedArticles.has(article.id)) {
    return infosState.loadedArticles.get(article.id)!;
  }

  // Von GitHub Pages laden
  const repoName = getSavedRepoName();
  if (!repoName) {
    return `# ${article.title}\n\n${article.summary}`;
  }

  try {
    const articleUrl = buildArticleUrl(repoName, article.file);
    const response = await fetch(articleUrl);

    if (!response.ok) {
      throw new Error(`Artikel nicht gefunden (${response.status})`);
    }

    const content = await response.text();
    infosState.loadedArticles.set(article.id, content);
    return content;
  } catch (error) {
    console.error("[Infos] Artikel-Laden fehlgeschlagen:", error);
    return `# ${article.title}\n\nInhalt konnte nicht geladen werden.\n\n${article.summary}`;
  }
}

// ══════════════════════════════════════════════════════════════════════
// GETTER-FUNKTIONEN
// ══════════════════════════════════════════════════════════════════════

export function getCategories(): InfoCategory[] {
  return infosState.manifest?.categories || [];
}

export function getCategoryById(id: string): InfoCategory | undefined {
  return getCategories().find((c) => c.id === id);
}

export function getArticles(): InfoArticle[] {
  return infosState.manifest?.articles || [];
}

export function getArticleById(id: string): InfoArticle | undefined {
  return getArticles().find((a) => a.id === id);
}

export function getArticlesByCategory(categoryId: string): InfoArticle[] {
  return getArticles().filter((a) => a.category === categoryId);
}

export function getFeaturedArticles(): InfoArticle[] {
  const featuredIds = infosState.manifest?.featured || [];
  return getArticles()
    .filter((a) => featuredIds.includes(a.id) || a.featured)
    .sort((a, b) => {
      const priorityOrder = { high: 0, normal: 1, low: 2 };
      const aPriority = priorityOrder[a.priority || "normal"];
      const bPriority = priorityOrder[b.priority || "normal"];
      return aPriority - bPriority;
    });
}

export function getActiveNotifications(): InfoNotification[] {
  const notifications = infosState.manifest?.notifications || [];
  const now = new Date();

  return notifications.filter((n) => {
    if (!n.validUntil) return true;
    return new Date(n.validUntil) > now;
  });
}

export function getLastUpdateTime(): string | null {
  if (!infosState.lastFetch) return null;
  return new Date(infosState.lastFetch).toLocaleString("de-DE");
}

export function getError(): string | null {
  return infosState.error;
}

export function isLoading(): boolean {
  return infosState.isLoading;
}

// ══════════════════════════════════════════════════════════════════════
// NAVIGATION STATE
// ══════════════════════════════════════════════════════════════════════

export function setSelectedCategory(categoryId: string | null): void {
  infosState.selectedCategory = categoryId;
  infosState.selectedArticle = null;
}

export function setSelectedArticle(articleId: string | null): void {
  infosState.selectedArticle = articleId;
}

export function getSelectedCategory(): string | null {
  return infosState.selectedCategory;
}

export function getSelectedArticle(): string | null {
  return infosState.selectedArticle;
}

// ══════════════════════════════════════════════════════════════════════
// HILFSFUNKTIONEN
// ══════════════════════════════════════════════════════════════════════

export function parseMarkdown(markdown: string): string {
  // Einfacher Markdown-Parser für grundlegende Formatierung
  let html = markdown
    // Escape HTML
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Headers
    .replace(/^### (.*$)/gim, "<h3>$1</h3>")
    .replace(/^## (.*$)/gim, "<h2>$1</h2>")
    .replace(/^# (.*$)/gim, "<h1>$1</h1>")
    // Bold
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    // Italic
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    // Code blocks
    .replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
    // Inline code
    .replace(/`(.*?)`/g, "<code>$1</code>")
    // Horizontal rule
    .replace(/^---$/gim, "<hr>")
    // Links
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>'
    )
    // Tables (einfach)
    .replace(/^\|(.+)\|$/gim, (match, content) => {
      const cells = content.split("|").map((c: string) => c.trim());
      const row = cells.map((c: string) => `<td>${c}</td>`).join("");
      return `<tr>${row}</tr>`;
    })
    // Liste items
    .replace(/^- (.*$)/gim, "<li>$1</li>")
    // Checkboxes
    .replace(/- \[x\] (.*$)/gim, '<li class="checked">✅ $1</li>')
    .replace(/- \[ \] (.*$)/gim, '<li class="unchecked">☐ $1</li>')
    // Paragraphs
    .replace(/\n\n/g, "</p><p>")
    // Line breaks
    .replace(/\n/g, "<br>");

  // Wrap in paragraph if not already wrapped
  if (!html.startsWith("<")) {
    html = `<p>${html}</p>`;
  }

  // Wrap tables
  html = html.replace(
    /(<tr>[\s\S]*?<\/tr>)+/g,
    "<table class='table table-sm'>$&</table>"
  );

  // Wrap list items
  html = html.replace(/(<li>[\s\S]*?<\/li>)+/g, "<ul>$&</ul>");

  return html;
}

export function getCategoryIcon(iconName: string): string {
  // Mapping von Icon-Namen zu Bootstrap Icons oder Emojis
  const iconMap: Record<string, string> = {
    "shield-check": "🛡️",
    book: "📖",
    "book-open": "📚",
    "file-text": "📄",
    "info-circle": "ℹ️",
    warning: "⚠️",
    calendar: "📅",
    star: "⭐",
    folder: "📁",
    download: "⬇️",
    link: "🔗",
    image: "🖼️",
    video: "🎬",
    pdf: "📕",
  };

  return iconMap[iconName] || "📌";
}

export function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return dateString;
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function escapeHtml(str: unknown): string {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ══════════════════════════════════════════════════════════════════════
// REPO VORSCHAU & TEST
// ══════════════════════════════════════════════════════════════════════

export interface RepoPreviewResult {
  success: boolean;
  error?: string;
  manifest?: InfoManifest;
  categoriesCount?: number;
  articlesCount?: number;
}

export async function previewRepo(
  repoName: string
): Promise<RepoPreviewResult> {
  // Validierung
  const validation = validateRepoName(repoName);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  try {
    const manifestUrl = buildManifestUrl(repoName);
    const response = await fetch(manifestUrl);

    if (!response.ok) {
      if (response.status === 404) {
        return {
          success: false,
          error: `Repo "${repoName}" nicht gefunden oder GitHub Pages nicht aktiviert.`,
        };
      }
      return {
        success: false,
        error: `Fehler beim Laden (Status ${response.status})`,
      };
    }

    const manifest: InfoManifest = await response.json();

    return {
      success: true,
      manifest,
      categoriesCount: manifest.categories?.length || 0,
      articlesCount: manifest.articles?.length || 0,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Verbindung fehlgeschlagen";
    return { success: false, error: message };
  }
}
