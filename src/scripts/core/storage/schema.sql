-- SQLite Schema for Pflanzenschutzliste
-- Version 1

-- Meta table for storing configuration and settings
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Measurement methods
CREATE TABLE IF NOT EXISTS measurement_methods (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  type TEXT NOT NULL,
  unit TEXT NOT NULL,
  requires TEXT, -- JSON array
  config TEXT    -- JSON object
);

-- Mediums
CREATE TABLE IF NOT EXISTS mediums (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  method_id TEXT NOT NULL,
  value REAL NOT NULL,
  FOREIGN KEY(method_id) REFERENCES measurement_methods(id)
);

-- History entries
CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  header_json TEXT NOT NULL -- JSON object containing header fields
);

-- History items (calculation results)
CREATE TABLE IF NOT EXISTS history_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  history_id INTEGER NOT NULL,
  medium_id TEXT NOT NULL,
  payload_json TEXT NOT NULL, -- JSON object with calculation details
  FOREIGN KEY(history_id) REFERENCES history(id) ON DELETE CASCADE
);

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_history_created_at ON history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_items_history_id ON history_items(history_id);
CREATE INDEX IF NOT EXISTS idx_mediums_method_id ON mediums(method_id);

-- Templates
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  document_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS template_revisions (
  template_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  summary TEXT,
  document_json TEXT,
  PRIMARY KEY(template_id, version),
  FOREIGN KEY(template_id) REFERENCES templates(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_templates_updated_at ON templates(updated_at DESC);
