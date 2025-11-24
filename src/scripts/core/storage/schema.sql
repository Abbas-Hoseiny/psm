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
  zulassungsnummer TEXT,
  FOREIGN KEY(method_id) REFERENCES measurement_methods(id)
);

CREATE TABLE IF NOT EXISTS medium_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS medium_profile_mediums (
  profile_id TEXT NOT NULL,
  medium_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (profile_id, medium_id),
  FOREIGN KEY(profile_id) REFERENCES medium_profiles(id) ON DELETE CASCADE,
  FOREIGN KEY(medium_id) REFERENCES mediums(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_medium_profile_mediums_profile
  ON medium_profile_mediums(profile_id, sort_order);

CREATE TABLE IF NOT EXISTS lookup_eppo_codes (
  code TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  dtcode TEXT,
  preferred INTEGER DEFAULT 1,
  dt_label TEXT,
  language_label TEXT,
  authority TEXT,
  name_de TEXT,
  name_en TEXT,
  name_la TEXT,
  PRIMARY KEY (code, language)
);

CREATE INDEX IF NOT EXISTS idx_lookup_eppo_name ON lookup_eppo_codes(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_lookup_eppo_dtcode ON lookup_eppo_codes(dtcode);
CREATE INDEX IF NOT EXISTS idx_lookup_eppo_language ON lookup_eppo_codes(language);

-- Lookup tables for BBCH stages
CREATE TABLE IF NOT EXISTS lookup_bbch_stages (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  principal_stage INTEGER,
  secondary_stage INTEGER,
  definition TEXT,
  kind TEXT
);

CREATE INDEX IF NOT EXISTS idx_lookup_bbch_label ON lookup_bbch_stages(label COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_lookup_bbch_principal ON lookup_bbch_stages(principal_stage);

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

CREATE TABLE IF NOT EXISTS gps_points (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  source TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gps_points_created ON gps_points(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gps_points_name ON gps_points(name COLLATE NOCASE);

-- Archive logs for documentation exports
CREATE TABLE IF NOT EXISTS archive_logs (
  id TEXT PRIMARY KEY,
  archived_at TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  entry_count INTEGER NOT NULL DEFAULT 0,
  file_name TEXT,
  storage_hint TEXT,
  note TEXT,
  metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_archive_logs_archived_at
  ON archive_logs(archived_at DESC, id DESC);
