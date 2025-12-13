-- SQLite Schema for Digitale PSM
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
  wartezeit INTEGER,
  wirkstoff TEXT,
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

-- History entries (normalized for EU machine-readable compliance DVO 2023/564 + 2025/2203)
CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  -- Header fields (normalized columns for machine-readable export)
  ersteller TEXT,                   -- Person responsible for application
  standort TEXT,                    -- Location/field name
  kultur TEXT,                      -- Crop (human readable)
  eppo_code TEXT,                   -- EPPO code for crop
  bbch TEXT,                        -- BBCH growth stage
  datum TEXT,                       -- Application date (display format)
  date_iso TEXT,                    -- Application date (ISO format)
  uhrzeit TEXT,                     -- Application time
  usage_type TEXT,                  -- Usage type (Obstbau, Ackerbau, etc.)
  area_ha REAL,                     -- Treated area in hectares
  area_ar REAL,                     -- Treated area in ar
  area_sqm REAL,                    -- Treated area in square meters
  water_volume REAL,                -- Water volume used
  invekos TEXT,                     -- INVEKOS field ID
  gps TEXT,                         -- GPS coordinates (display format)
  gps_latitude REAL,                -- GPS latitude
  gps_longitude REAL,               -- GPS longitude
  gps_point_id TEXT,                -- Reference to GPS point
  -- QS-GAP fields (Leitfaden 3.6.2)
  qs_maschine TEXT,                 -- Application equipment
  qs_schaderreger TEXT,             -- Target pest/disease
  qs_verantwortlicher TEXT,         -- Responsible person (QS)
  qs_wetter TEXT,                   -- Weather conditions
  qs_behandlungsart TEXT,           -- Treatment type
  -- Legacy JSON for backward compatibility (will be removed in future)
  header_json TEXT                  -- Deprecated: JSON blob for migration
);

-- History items (calculation results - normalized for EU compliance)
CREATE TABLE IF NOT EXISTS history_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  history_id INTEGER NOT NULL,
  medium_id TEXT NOT NULL,
  -- Normalized product/medium fields
  medium_name TEXT,                 -- Product name
  medium_unit TEXT,                 -- Unit of measure
  method_id TEXT,                   -- Calculation method ID
  method_label TEXT,                -- Calculation method label
  medium_value REAL,                -- Dosage value per unit
  calculated_total REAL,            -- Calculated total amount
  zulassungsnummer TEXT,            -- Authorization number (BVL)
  wartezeit INTEGER,                -- Waiting period in days
  wirkstoff TEXT,                   -- Active substance(s)
  -- Input values used for calculation
  input_area_ha REAL,
  input_area_ar REAL,
  input_area_sqm REAL,
  input_water_volume REAL,
  -- Legacy JSON for backward compatibility
  payload_json TEXT,                -- Deprecated: JSON blob for migration
  FOREIGN KEY(history_id) REFERENCES history(id) ON DELETE CASCADE
);

-- Indices for performance and machine-readable queries
CREATE INDEX IF NOT EXISTS idx_history_created_at ON history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_date_iso ON history(date_iso);
CREATE INDEX IF NOT EXISTS idx_history_eppo_code ON history(eppo_code);
CREATE INDEX IF NOT EXISTS idx_history_kultur ON history(kultur);
CREATE INDEX IF NOT EXISTS idx_history_standort ON history(standort);
CREATE INDEX IF NOT EXISTS idx_history_items_history_id ON history_items(history_id);
CREATE INDEX IF NOT EXISTS idx_history_items_zulassungsnummer ON history_items(zulassungsnummer);
CREATE INDEX IF NOT EXISTS idx_history_items_wirkstoff ON history_items(wirkstoff);
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

-- Saved EPPO codes (user favorites for quick selection)
CREATE TABLE IF NOT EXISTS saved_eppo_codes (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  language TEXT,
  dtcode TEXT,
  usage_count INTEGER NOT NULL DEFAULT 0,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_saved_eppo_code ON saved_eppo_codes(code);
CREATE INDEX IF NOT EXISTS idx_saved_eppo_favorite ON saved_eppo_codes(is_favorite DESC, usage_count DESC);
CREATE INDEX IF NOT EXISTS idx_saved_eppo_usage ON saved_eppo_codes(usage_count DESC);

-- Saved BBCH stages (user favorites for quick selection)
CREATE TABLE IF NOT EXISTS saved_bbch_stages (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  principal_stage INTEGER,
  secondary_stage INTEGER,
  usage_count INTEGER NOT NULL DEFAULT 0,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_saved_bbch_code ON saved_bbch_stages(code);
CREATE INDEX IF NOT EXISTS idx_saved_bbch_favorite ON saved_bbch_stages(is_favorite DESC, usage_count DESC);
CREATE INDEX IF NOT EXISTS idx_saved_bbch_usage ON saved_bbch_stages(usage_count DESC);
