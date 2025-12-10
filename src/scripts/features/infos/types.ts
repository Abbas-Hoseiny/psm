/**
 * Infos Feature - TypeScript Types
 * Typen für das Info-System mit GitHub Pages als Backend
 */

// ══════════════════════════════════════════════════════════════════════
// KONFIGURATION
// ══════════════════════════════════════════════════════════════════════

export interface InfosConfig {
  /** Fester GitHub-Username für Info-Repos */
  githubUsername: string;
  /** Cache-Dauer in Millisekunden (Standard: 1 Stunde) */
  cacheMaxAge: number;
  /** Manifest-Dateiname */
  manifestFile: string;
  /** Meta-Dateiname */
  metaFile: string;
}

export const DEFAULT_INFOS_CONFIG: InfosConfig = {
  githubUsername: "abbas-hoseiny",
  cacheMaxAge: 3600000, // 1 Stunde
  manifestFile: "manifest.json",
  metaFile: "meta.json",
};

// ══════════════════════════════════════════════════════════════════════
// INFO SOURCE (Multi-Repo Support)
// ══════════════════════════════════════════════════════════════════════

export interface InfoSource {
  /** Eindeutige ID der Quelle */
  id: string;
  /** Anzeigename */
  label: string;
  /** Repo-Name (ohne URL) */
  repoName: string;
  /** Berechnete Base-URL */
  baseUrl: string;
  /** Optionale Überschreibung für Manifest-Datei */
  manifestFile?: string;
  /** Optionale Überschreibung für Meta-Datei */
  metaFile?: string;
}

// ══════════════════════════════════════════════════════════════════════
// KATEGORIE
// ══════════════════════════════════════════════════════════════════════

export interface InfoCategory {
  /** Eindeutige ID */
  id: string;
  /** Anzeigename */
  label: string;
  /** Icon-Name (Bootstrap Icons oder Emoji) */
  icon: string;
  /** Kurzbeschreibung */
  description: string;
  /** Sortierreihenfolge (höher = weiter oben) */
  priority: number;
  /** Optional: Quell-ID bei Multi-Repo */
  sourceId?: string;
}

// ══════════════════════════════════════════════════════════════════════
// ATTACHMENT (PDF, Bild, Download)
// ══════════════════════════════════════════════════════════════════════

export type AttachmentType = "image" | "pdf" | "video" | "download";

export interface InfoAttachment {
  /** Typ des Anhangs */
  type: AttachmentType;
  /** Anzeigename */
  label: string;
  /** Dateiname (relativ zum Artikel-Verzeichnis) */
  file: string;
  /** Optional: Dateigröße in Bytes */
  size?: number;
  /** Optional: MIME-Typ */
  mimeType?: string;
}

// ══════════════════════════════════════════════════════════════════════
// ARTIKEL
// ══════════════════════════════════════════════════════════════════════

export type ArticlePriority = "high" | "normal" | "low";

export interface InfoArticle {
  /** Eindeutige ID */
  id: string;
  /** Titel */
  title: string;
  /** Kurzbeschreibung für Vorschau */
  summary: string;
  /** Kategorie-ID */
  category: string;
  /** Dateiname der Markdown-Datei oder "inline:xxx" für eingebettete Inhalte */
  file: string;
  /** Veröffentlichungsdatum (ISO-Format) */
  date: string;
  /** Autor */
  author: string;
  /** Tags für Suche */
  tags: string[];
  /** Als Featured markiert? */
  featured?: boolean;
  /** Priorität für Sortierung */
  priority?: ArticlePriority;
  /** Anhänge (PDFs, Bilder, etc.) */
  attachments?: InfoAttachment[];
  /** Geladener Inhalt (wird zur Laufzeit befüllt) */
  content?: string;
  /** Optional: Quell-ID bei Multi-Repo */
  sourceId?: string;
  /** Optional: Base-URL für Assets */
  assetBaseUrl?: string;
}

// ══════════════════════════════════════════════════════════════════════
// BENACHRICHTIGUNG
// ══════════════════════════════════════════════════════════════════════

export type NotificationType = "info" | "warning" | "success";

export interface InfoNotification {
  /** Eindeutige ID */
  id: string;
  /** Typ der Benachrichtigung */
  type: NotificationType;
  /** Nachrichtentext */
  message: string;
  /** Optional: Link zu einem Artikel */
  linkTo?: string;
  /** Optional: Gültig bis (ISO-Datum) */
  validUntil?: string;
}

// ══════════════════════════════════════════════════════════════════════
// MANIFEST & META
// ══════════════════════════════════════════════════════════════════════

export interface InfoManifest {
  /** Manifest-Version */
  version: string;
  /** Letztes Update (ISO-Datum) */
  lastUpdated: string;
  /** Base-URL für Assets */
  baseUrl: string;
  /** Kategorien */
  categories: InfoCategory[];
  /** Artikel */
  articles: InfoArticle[];
  /** IDs der Featured-Artikel */
  featured: string[];
  /** Aktive Benachrichtigungen */
  notifications: InfoNotification[];
}

export interface InfoMeta {
  /** Meta-Version */
  version: string;
  /** Schema-Version */
  schemaVersion: string;
  /** Letztes Update */
  lastUpdated: string;
  /** Wer hat zuletzt aktualisiert */
  lastUpdatedBy: string;
  /** Anzahl Artikel */
  articleCount: number;
  /** Anzahl Kategorien */
  categoryCount: number;
}

// ══════════════════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════════════════

export interface InfosState {
  /** Geladenes Manifest */
  manifest: InfoManifest | null;
  /** Geladene Meta-Daten */
  meta: InfoMeta | null;
  /** Cache für geladene Artikel-Inhalte */
  loadedArticles: Map<string, string>;
  /** Zeitstempel des letzten Fetch */
  lastFetch: number | null;
  /** Lade-Status */
  isLoading: boolean;
  /** Fehlermeldung */
  error: string | null;
  /** Aktuell ausgewählte Kategorie */
  selectedCategory: string | null;
  /** Aktuell ausgewählter Artikel */
  selectedArticle: string | null;
}

// ══════════════════════════════════════════════════════════════════════
// VALIDIERUNG
// ══════════════════════════════════════════════════════════════════════

export interface ValidationResult {
  /** Ist gültig? */
  valid: boolean;
  /** Fehlermeldung (wenn ungültig) */
  error?: string;
}

// ══════════════════════════════════════════════════════════════════════
// SERVICES (für Dependency Injection)
// ══════════════════════════════════════════════════════════════════════

export interface InfosServices {
  state: {
    getState: () => unknown;
    subscribe: (callback: () => void) => () => void;
  };
  events: {
    emit: (eventName: string, payload?: unknown) => void;
    subscribe?: <T = unknown>(
      eventName: string,
      handler: (payload: T) => void
    ) => () => void;
  };
}

// ══════════════════════════════════════════════════════════════════════
// LIGHTBOX
// ══════════════════════════════════════════════════════════════════════

export type LightboxContentType = "image" | "pdf";

export interface LightboxState {
  /** Ist Lightbox aktiv? */
  isOpen: boolean;
  /** Typ des Inhalts */
  contentType: LightboxContentType | null;
  /** URL des Inhalts */
  contentUrl: string | null;
  /** Optionale Beschriftung */
  caption: string | null;
}
