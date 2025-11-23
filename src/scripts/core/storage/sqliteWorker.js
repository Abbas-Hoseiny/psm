/**
 * SQLite Web Worker
 * Handles all database operations in a separate thread to prevent UI blocking
 */

let sqlite3 = null;
let db = null;
let isInitialized = false;
let currentMode = "memory";

// SQLite-WASM CDN URL
const SQLITE_WASM_CDN =
  "https://cdn.jsdelivr.net/npm/@sqlite.org/sqlite-wasm@3.46.1-build1/sqlite-wasm/jswasm/";
const GPS_ACTIVE_POINT_META_KEY = "gps_active_point";

function getFieldValue(record, fieldName) {
  if (!record || !fieldName) {
    return null;
  }

  const candidates = [
    fieldName,
    fieldName.toLowerCase(),
    fieldName.toUpperCase(),
  ];
  for (const key of candidates) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      const value = record[key];
      if (value === null || value === undefined || value === "") {
        return null;
      }
      return String(value);
    }
  }
  return null;
}

function safeParseJson(text) {
  if (typeof text !== "string") {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    console.warn("Failed to parse payload JSON", error);
    return null;
  }
}

function normalizePayloadRecord(record) {
  if (!record || typeof record !== "object") {
    return record;
  }
  const normalized = {};
  for (const [key, value] of Object.entries(record)) {
    normalized[key] = value;
    const lower = key.toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(normalized, lower)) {
      normalized[lower] = value;
    }
  }
  return normalized;
}

function ensurePayloadStorageSchema(targetDb = db) {
  if (!targetDb) {
    return;
  }

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS bvl_api_payloads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint TEXT NOT NULL,
      key TEXT NOT NULL,
      primary_ref TEXT,
      secondary_ref TEXT,
      tertiary_ref TEXT,
      payload_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_bvl_api_payloads_endpoint ON bvl_api_payloads(endpoint);
    CREATE INDEX IF NOT EXISTS idx_bvl_api_payloads_key_primary ON bvl_api_payloads(key, primary_ref);
    CREATE INDEX IF NOT EXISTS idx_bvl_api_payloads_secondary ON bvl_api_payloads(key, secondary_ref);
    CREATE INDEX IF NOT EXISTS idx_bvl_api_payloads_primary ON bvl_api_payloads(primary_ref);
  `);

  const version = targetDb.selectValue("PRAGMA user_version") || 0;
  if (version < 3) {
    targetDb.exec("PRAGMA user_version = 3");
  }
}

function ensureMediumProfileTables(targetDb = db) {
  if (!targetDb) {
    return;
  }

  targetDb.exec(`
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
  `);
}

function hasColumn(targetDb, tableName, columnName) {
  if (!targetDb) {
    return false;
  }
  const sql = `SELECT 1 FROM pragma_table_info('${tableName}') WHERE name = '${columnName}' LIMIT 1`;
  return Boolean(targetDb.selectValue(sql));
}

function hasTable(targetDb, tableName) {
  if (!targetDb || !tableName) {
    return false;
  }
  const sql = `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '${tableName}' LIMIT 1`;
  return Boolean(targetDb.selectValue(sql));
}

function ensureMediumApprovalColumn(targetDb = db) {
  if (!targetDb) {
    return;
  }
  if (hasColumn(targetDb, "mediums", "zulassungsnummer")) {
    return;
  }
  targetDb.exec("ALTER TABLE mediums ADD COLUMN zulassungsnummer TEXT");
}

function ensureLookupTables(targetDb = db) {
  if (!targetDb) {
    return;
  }

  const ensureEppoTable = () => {
    targetDb.exec("DROP TABLE IF EXISTS lookup_eppo_codes");
    targetDb.exec(`
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
    `);
  };

  if (!hasColumn(targetDb, "lookup_eppo_codes", "language")) {
    ensureEppoTable();
  } else {
    targetDb.exec(`
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
    `);
  }

  targetDb.exec(`
    CREATE INDEX IF NOT EXISTS idx_lookup_eppo_name ON lookup_eppo_codes(name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_lookup_eppo_dtcode ON lookup_eppo_codes(dtcode);
    CREATE INDEX IF NOT EXISTS idx_lookup_eppo_language ON lookup_eppo_codes(language);

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
  `);

  const enrichedColumns = [
    { name: "dt_label", type: "TEXT" },
    { name: "language_label", type: "TEXT" },
    { name: "authority", type: "TEXT" },
    { name: "name_de", type: "TEXT" },
    { name: "name_en", type: "TEXT" },
    { name: "name_la", type: "TEXT" },
  ];
  for (const column of enrichedColumns) {
    if (!hasColumn(targetDb, "lookup_eppo_codes", column.name)) {
      targetDb.exec(
        `ALTER TABLE lookup_eppo_codes ADD COLUMN ${column.name} ${column.type}`
      );
    }
  }
}

function ensureGpsPointTable(targetDb = db) {
  if (!targetDb) {
    return;
  }
  targetDb.exec(`
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
  `);
}

function generateGpsPointId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `gps_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function mapGpsPointRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: String(row.id),
    name: row.name != null ? String(row.name) : "",
    description: row.description ?? null,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    source: row.source ?? null,
    created_at: row.created_at || new Date().toISOString(),
    updated_at: row.updated_at || new Date().toISOString(),
  };
}

function readGpsPointById(id) {
  if (!db || !id) {
    return null;
  }
  let record = null;
  db.exec({
    sql: `SELECT id, name, description, latitude, longitude, source, created_at, updated_at
           FROM gps_points
           WHERE id = ?
           LIMIT 1`,
    bind: [id],
    rowMode: "object",
    callback: (row) => {
      if (!record) {
        record = mapGpsPointRow(row);
      }
    },
  });
  return record;
}

async function listGpsPoints() {
  if (!db) {
    throw new Error("Database not initialized");
  }
  ensureGpsPointTable();
  const rows = [];
  db.exec({
    sql: `SELECT id, name, description, latitude, longitude, source, created_at, updated_at
          FROM gps_points
          ORDER BY datetime(updated_at) DESC`,
    rowMode: "object",
    callback: (row) => {
      rows.push(mapGpsPointRow(row));
    },
  });
  const activePointId = getMetaValue(GPS_ACTIVE_POINT_META_KEY);
  return { rows, activePointId: activePointId || null };
}

async function upsertGpsPoint(payload = {}) {
  if (!db) {
    throw new Error("Database not initialized");
  }
  ensureGpsPointTable();

  const id = String(payload.id || generateGpsPointId());
  const name = String(payload.name ?? "").trim();
  if (!name) {
    throw new Error("GPS-Punkt benötigt einen Namen.");
  }
  const latitude = Number(payload.latitude);
  const longitude = Number(payload.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error("GPS-Punkt hat ungültige Koordinaten.");
  }
  const description =
    payload.description != null ? String(payload.description) : null;
  const source = payload.source != null ? String(payload.source) : null;
  const now = new Date().toISOString();

  const exists = db.selectValue(
    "SELECT 1 FROM gps_points WHERE id = ? LIMIT 1",
    [id]
  );
  if (exists) {
    const stmt = db.prepare(
      `UPDATE gps_points
       SET name = ?, description = ?, latitude = ?, longitude = ?, source = ?, updated_at = ?
       WHERE id = ?`
    );
    stmt.bind([name, description, latitude, longitude, source, now, id]);
    stmt.step();
    stmt.finalize();
  } else {
    const stmt = db.prepare(
      `INSERT INTO gps_points (id, name, description, latitude, longitude, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    stmt.bind([id, name, description, latitude, longitude, source, now, now]);
    stmt.step();
    stmt.finalize();
  }

  const row = readGpsPointById(id);
  if (!row) {
    throw new Error("GPS-Punkt konnte nicht gelesen werden.");
  }
  return row;
}

async function deleteGpsPoint(payload = {}) {
  if (!db) {
    throw new Error("Database not initialized");
  }
  ensureGpsPointTable();
  const id = String(payload.id ?? "").trim();
  if (!id) {
    throw new Error("ID für GPS-Punkt fehlt.");
  }
  const stmt = db.prepare("DELETE FROM gps_points WHERE id = ?");
  stmt.bind([id]);
  stmt.step();
  stmt.finalize();
  const activePointId = getMetaValue(GPS_ACTIVE_POINT_META_KEY);
  if (activePointId === id) {
    deleteMetaValue(GPS_ACTIVE_POINT_META_KEY);
  }
  return { success: true };
}

async function setActiveGpsPointId(payload = {}) {
  if (!db) {
    throw new Error("Database not initialized");
  }
  ensureGpsPointTable();
  const id =
    payload && typeof payload.id === "string" ? payload.id.trim() : null;
  if (id) {
    const exists = db.selectValue(
      "SELECT 1 FROM gps_points WHERE id = ? LIMIT 1",
      [id]
    );
    if (!exists) {
      throw new Error("GPS-Punkt wurde nicht gefunden.");
    }
    setMetaValue(GPS_ACTIVE_POINT_META_KEY, id);
    return { activePointId: id };
  }
  deleteMetaValue(GPS_ACTIVE_POINT_META_KEY);
  return { activePointId: null };
}

async function getActiveGpsPointId() {
  if (!db) {
    throw new Error("Database not initialized");
  }
  const activePointId = getMetaValue(GPS_ACTIVE_POINT_META_KEY);
  return { activePointId: activePointId || null };
}

function setMetaValue(key, value, targetDb = db) {
  if (!targetDb || !key) {
    return;
  }
  const stmt = targetDb.prepare(
    "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)"
  );
  stmt
    .bind([key, typeof value === "string" ? value : JSON.stringify(value)])
    .step();
  stmt.finalize();
}

function deleteMetaValue(key, targetDb = db) {
  if (!targetDb || !key) {
    return;
  }
  const stmt = targetDb.prepare("DELETE FROM meta WHERE key = ?");
  stmt.bind([key]).step();
  stmt.finalize();
}

function getMetaValue(key, targetDb = db) {
  if (!targetDb || !key) {
    return null;
  }
  const value = targetDb.selectValue("SELECT value FROM meta WHERE key = ?", [
    key,
  ]);
  return value ?? null;
}

function openDatabaseFromBytes(bytes) {
  if (!sqlite3) {
    throw new Error("SQLite not initialized");
  }
  const remoteDb = new sqlite3.oo1.DB();
  const scope = sqlite3.wasm.scopedAllocPush();
  try {
    const pData = sqlite3.wasm.allocFromTypedArray(bytes);
    const pSchema = sqlite3.wasm.allocCString("main");
    const flags =
      (sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE || 0) |
      (sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE || 0);
    const rc = sqlite3.capi.sqlite3_deserialize(
      remoteDb.pointer,
      pSchema,
      pData,
      bytes.byteLength,
      bytes.byteLength,
      flags
    );
    if (rc !== sqlite3.capi.SQLITE_OK) {
      remoteDb.close();
      throw new Error(
        `sqlite3_deserialize failed: ${
          sqlite3.capi.sqlite3_js_rc_str(rc) || rc
        }`
      );
    }
  } finally {
    sqlite3.wasm.scopedAllocPop(scope);
  }
  return remoteDb;
}

// Message handler
self.onmessage = async function (event) {
  const { id, action, payload } = event.data;

  try {
    let result;

    switch (action) {
      case "init":
        result = await initDatabase(payload);
        break;
      case "importSnapshot":
        result = await importSnapshot(payload);
        break;
      case "exportSnapshot":
        result = await exportSnapshot();
        break;
      case "upsertMedium":
        result = await upsertMedium(payload);
        break;
      case "deleteMedium":
        result = await deleteMedium(payload);
        break;
      case "listMediums":
        result = await listMediums();
        break;
      case "listHistory":
        result = await listHistory(payload);
        break;
      case "getHistoryEntry":
        result = await getHistoryEntry(payload);
        break;
      case "appendHistoryEntry":
        result = await appendHistoryEntry(payload);
        break;
      case "deleteHistoryEntry":
        result = await deleteHistoryEntry(payload);
        break;
      case "exportDB":
        result = await exportDB();
        break;
      case "importDB":
        result = await importDB(payload);
        break;
      case "importBvlDataset":
        result = await importBvlDataset(payload);
        break;
      case "importBvlSqlite":
        result = await importBvlSqlite(payload);
        break;
      case "getBvlMeta":
        result = await getBvlMeta(payload);
        break;
      case "setBvlMeta":
        result = await setBvlMeta(payload);
        break;
      case "appendBvlSyncLog":
        result = await appendBvlSyncLog(payload);
        break;
      case "listBvlSyncLog":
        result = await listBvlSyncLog(payload);
        break;
      case "queryZulassung":
        result = await queryZulassung(payload);
        break;
      case "listBvlCultures":
        result = await listBvlCultures(payload);
        break;
      case "listBvlSchadorg":
        result = await listBvlSchadorg(payload);
        break;
      case "importLookupEppo":
        result = await importLookupEppo(payload);
        break;
      case "importLookupBbch":
        result = await importLookupBbch(payload);
        break;
      case "searchEppoCodes":
        result = await searchEppoCodes(payload);
        break;
      case "searchBbchStages":
        result = await searchBbchStages(payload);
        break;
      case "listLookupLanguages":
        result = listLookupLanguages();
        break;
      case "getLookupStats":
        result = await getLookupStats();
        break;
      case "listGpsPoints":
        result = await listGpsPoints();
        break;
      case "upsertGpsPoint":
        result = await upsertGpsPoint(payload);
        break;
      case "deleteGpsPoint":
        result = await deleteGpsPoint(payload);
        break;
      case "setActiveGpsPointId":
        result = await setActiveGpsPointId(payload);
        break;
      case "getActiveGpsPointId":
        result = await getActiveGpsPointId();
        break;
      case "diagnoseBvlSchema":
        result = await diagnoseBvlSchema();
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error.message || String(error),
    });
  }
};

/**
 * Initialize SQLite database
 */
async function initDatabase(options = {}) {
  if (isInitialized) {
    return { success: true, message: "Already initialized" };
  }

  try {
    // Load SQLite WASM module
    const sqlite3InitModule = await import(
      SQLITE_WASM_CDN + "sqlite3.mjs"
    ).then((m) => m.default);

    sqlite3 = await sqlite3InitModule({
      print: console.log,
      printErr: console.error,
      locateFile: (file) => SQLITE_WASM_CDN + file,
    });

    // Determine storage mode
    const mode = options.mode || detectMode();
    db = createDatabaseInstance(mode);
    currentMode = mode;

    configureDatabase();

    // Apply schema for freshly created databases
    await applySchema();

    isInitialized = true;

    return {
      success: true,
      mode,
      message: `Database initialized in ${mode} mode`,
    };
  } catch (error) {
    console.error("Failed to initialize database:", error);
    throw new Error(`Database initialization failed: ${error.message}`);
  }
}

/**
 * Detect best storage mode
 */
function detectMode() {
  if (typeof sqlite3?.opfs !== "undefined") {
    return "opfs";
  }
  return "memory";
}

function createDatabaseInstance(mode = "memory") {
  if (mode === "opfs" && sqlite3?.opfs) {
    return new sqlite3.oo1.OpfsDb("/pflanzenschutz.sqlite");
  }
  return new sqlite3.oo1.DB();
}

function configureDatabase(targetDb = db) {
  if (!targetDb) {
    throw new Error("Database not initialized");
  }
  targetDb.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA temp_store = MEMORY;
    PRAGMA cache_size = -20000;
  `);
}

/**
 * Apply database schema
 */
async function applySchema() {
  if (!db) throw new Error("Database not initialized");

  // Check current version
  const currentVersion = db.selectValue("PRAGMA user_version") || 0;

  if (currentVersion === 0) {
    // Apply initial schema
    const schemaSql = `
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS measurement_methods (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        type TEXT NOT NULL,
        unit TEXT NOT NULL,
        requires TEXT,
        config TEXT
      );
      
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
        code TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        language TEXT,
        dtcode TEXT,
        preferred INTEGER DEFAULT 1,
        dt_label TEXT,
        language_label TEXT,
        authority TEXT,
        name_de TEXT,
        name_en TEXT,
        name_la TEXT
      );
      
      CREATE INDEX IF NOT EXISTS idx_lookup_eppo_name ON lookup_eppo_codes(name COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_lookup_eppo_dtcode ON lookup_eppo_codes(dtcode);
      
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

      CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        header_json TEXT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS history_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        history_id INTEGER NOT NULL,
        medium_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        FOREIGN KEY(history_id) REFERENCES history(id) ON DELETE CASCADE
      );
      
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
      
      PRAGMA user_version = 1;
    `;

    db.exec(schemaSql);
  }

  // Migration to version 2: Add BVL tables
  if (currentVersion < 2) {
    console.log("Migrating database to version 2...");

    db.exec("BEGIN TRANSACTION");

    try {
      // Drop all existing BVL tables first
      db.exec(`
        PRAGMA foreign_keys = OFF;
  DROP TABLE IF EXISTS bvl_lookup_schadorg;
  DROP TABLE IF EXISTS bvl_lookup_kultur;
  DROP TABLE IF EXISTS bvl_awg_wartezeit;
  DROP TABLE IF EXISTS bvl_awg_aufwand;
  DROP TABLE IF EXISTS bvl_awg_schadorg;
  DROP TABLE IF EXISTS bvl_awg_kultur;
  DROP TABLE IF EXISTS bvl_awg;
  DROP TABLE IF EXISTS bvl_mittel;
  DROP TABLE IF EXISTS bvl_meta;
  DROP TABLE IF EXISTS bvl_sync_log;
      `);

      // Create new BVL schema
      db.exec(`
        CREATE TABLE bvl_meta (
          key TEXT PRIMARY KEY,
          value TEXT
        );
        
        CREATE TABLE bvl_mittel (
          kennr TEXT PRIMARY KEY,
          name TEXT,
          formulierung TEXT,
          zul_erstmalig TEXT,
          zul_ende TEXT,
          geringes_risiko INTEGER,
          payload_json TEXT
        );
        
        CREATE TABLE bvl_awg (
          awg_id TEXT PRIMARY KEY,
          kennr TEXT REFERENCES bvl_mittel(kennr) ON DELETE CASCADE,
          status_json TEXT,
          zulassungsende TEXT
        );
        
        CREATE TABLE bvl_awg_kultur (
          awg_id TEXT REFERENCES bvl_awg(awg_id) ON DELETE CASCADE,
          kultur TEXT,
          ausgenommen INTEGER,
          sortier_nr INTEGER,
          PRIMARY KEY (awg_id, kultur, ausgenommen)
        );
        
        CREATE TABLE bvl_awg_schadorg (
          awg_id TEXT REFERENCES bvl_awg(awg_id) ON DELETE CASCADE,
          schadorg TEXT,
          ausgenommen INTEGER,
          sortier_nr INTEGER,
          PRIMARY KEY (awg_id, schadorg, ausgenommen)
        );
        
        CREATE TABLE bvl_awg_aufwand (
          awg_id TEXT REFERENCES bvl_awg(awg_id) ON DELETE CASCADE,
          aufwand_bedingung TEXT,
          sortier_nr INTEGER,
          mittel_menge REAL,
          mittel_einheit TEXT,
          wasser_menge REAL,
          wasser_einheit TEXT,
          payload_json TEXT,
          PRIMARY KEY (awg_id, aufwand_bedingung, sortier_nr)
        );
        
        CREATE TABLE bvl_awg_wartezeit (
          awg_wartezeit_nr INTEGER,
          awg_id TEXT REFERENCES bvl_awg(awg_id) ON DELETE CASCADE,
          kultur TEXT,
          sortier_nr INTEGER,
          tage INTEGER,
          bemerkung_kode TEXT,
          anwendungsbereich TEXT,
          erlaeuterung TEXT,
          payload_json TEXT,
          PRIMARY KEY (awg_wartezeit_nr, awg_id)
        );
        
        CREATE TABLE bvl_sync_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          synced_at TEXT,
          ok INTEGER,
          message TEXT,
          payload_hash TEXT
        );

        CREATE TABLE bvl_lookup_kultur (
          code TEXT PRIMARY KEY,
          label TEXT
        );

        CREATE TABLE bvl_lookup_schadorg (
          code TEXT PRIMARY KEY,
          label TEXT
        );
        
        CREATE INDEX idx_awg_kennr ON bvl_awg(kennr);
        CREATE INDEX idx_awg_kultur_kultur ON bvl_awg_kultur(kultur);
        CREATE INDEX idx_awg_schadorg_schadorg ON bvl_awg_schadorg(schadorg);
        CREATE INDEX idx_awg_aufwand_awg ON bvl_awg_aufwand(awg_id);
        CREATE INDEX idx_awg_wartezeit_awg ON bvl_awg_wartezeit(awg_id);
        CREATE INDEX idx_lookup_kultur_label ON bvl_lookup_kultur(label);
        CREATE INDEX idx_lookup_schadorg_label ON bvl_lookup_schadorg(label);
        
        PRAGMA foreign_keys = ON;
        PRAGMA user_version = 2;
      `);

      db.exec("COMMIT");
      console.log("Database migrated to version 2 successfully");
    } catch (error) {
      db.exec("ROLLBACK");
      console.error("Migration to version 2 failed:", error);
      throw error;
    }
  }

  if (currentVersion < 3) {
    console.log("Migrating database to version 3...");
    db.exec("BEGIN TRANSACTION");
    try {
      ensurePayloadStorageSchema(db);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      console.error("Migration to version 3 failed:", error);
      throw error;
    }
  }

  let postMigrationVersion = db.selectValue("PRAGMA user_version") || 0;
  const needsApprovalColumn = !hasColumn(db, "mediums", "zulassungsnummer");
  if (needsApprovalColumn || postMigrationVersion < 4) {
    console.log("Migrating database to version 4...");
    db.exec("BEGIN TRANSACTION");
    try {
      if (needsApprovalColumn) {
        ensureMediumApprovalColumn(db);
      }
      db.exec("PRAGMA user_version = 4");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      console.error("Migration to version 4 failed:", error);
      throw error;
    }
  }

  postMigrationVersion = db.selectValue("PRAGMA user_version") || 0;
  if (postMigrationVersion < 5) {
    console.log("Migrating database to version 5...");
    db.exec("BEGIN TRANSACTION");
    try {
      ensureLookupTables(db);
      db.exec("PRAGMA user_version = 5");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      console.error("Migration to version 5 failed:", error);
      throw error;
    }
  }

  postMigrationVersion = db.selectValue("PRAGMA user_version") || 0;
  const gpsTableMissing = !hasTable(db, "gps_points");
  if (gpsTableMissing || postMigrationVersion < 6) {
    console.log("Migrating database to version 6...");
    db.exec("BEGIN TRANSACTION");
    try {
      ensureGpsPointTable(db);
      db.exec("PRAGMA user_version = 6");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      console.error("Migration to version 6 failed:", error);
      throw error;
    }
  }

  postMigrationVersion = db.selectValue("PRAGMA user_version") || 0;
  const profileTablesMissing =
    !hasTable(db, "medium_profiles") || !hasTable(db, "medium_profile_mediums");
  if (profileTablesMissing || postMigrationVersion < 7) {
    console.log("Migrating database to version 7...");
    db.exec("BEGIN TRANSACTION");
    try {
      ensureMediumProfileTables(db);
      db.exec("PRAGMA user_version = 7");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      console.error("Migration to version 7 failed:", error);
      throw error;
    }
  }
}

/**
 * Import a complete snapshot from JSON format
 */
async function importSnapshot(snapshot) {
  if (!db) throw new Error("Database not initialized");

  db.exec("BEGIN TRANSACTION");

  try {
    // Clear existing data
    db.exec(`
      DELETE FROM history_items;
      DELETE FROM history;
      DELETE FROM mediums;
      DELETE FROM measurement_methods;
      DELETE FROM meta WHERE key IN ('version','company','defaults','fieldLabels','measurementMethods');
    `);

    // Import meta data
    if (snapshot.meta) {
      const metaEntries = {
        version: snapshot.meta.version || 1,
        company: JSON.stringify(snapshot.meta.company || {}),
        defaults: JSON.stringify(snapshot.meta.defaults || {}),
        fieldLabels: JSON.stringify(snapshot.meta.fieldLabels || {}),
        measurementMethods: JSON.stringify(
          snapshot.meta.measurementMethods || []
        ),
      };

      const stmt = db.prepare(
        "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)"
      );
      for (const [key, value] of Object.entries(metaEntries)) {
        stmt
          .bind([
            key,
            typeof value === "string" ? value : JSON.stringify(value),
          ])
          .step();
        stmt.reset();
      }
      stmt.finalize();

      // Import measurement methods
      if (
        snapshot.meta.measurementMethods &&
        Array.isArray(snapshot.meta.measurementMethods)
      ) {
        const methodStmt = db.prepare(
          "INSERT OR REPLACE INTO measurement_methods (id, label, type, unit, requires, config) VALUES (?, ?, ?, ?, ?, ?)"
        );
        for (const method of snapshot.meta.measurementMethods) {
          methodStmt
            .bind([
              method.id,
              method.label,
              method.type,
              method.unit,
              JSON.stringify(method.requires || []),
              JSON.stringify(method.config || {}),
            ])
            .step();
          methodStmt.reset();
        }
        methodStmt.finalize();
      }
    }

    // Import mediums
    if (snapshot.mediums && Array.isArray(snapshot.mediums)) {
      const mediumStmt = db.prepare(
        "INSERT OR REPLACE INTO mediums (id, name, unit, method_id, value, zulassungsnummer) VALUES (?, ?, ?, ?, ?, ?)"
      );
      for (const medium of snapshot.mediums) {
        const approvalNumber =
          medium.zulassungsnummer ??
          medium.approvalNumber ??
          medium.zulassung ??
          null;

        mediumStmt
          .bind([
            medium.id,
            medium.name,
            medium.unit,
            medium.methodId || medium.method_id,
            medium.value,
            approvalNumber,
          ])
          .step();
        mediumStmt.reset();
      }
      mediumStmt.finalize();
    }

    // Import medium profiles
    if (snapshot.mediumProfiles && Array.isArray(snapshot.mediumProfiles)) {
      ensureMediumProfileTables();
      db.exec("DELETE FROM medium_profile_mediums");
      db.exec("DELETE FROM medium_profiles");

      const profileStmt = db.prepare(
        "INSERT INTO medium_profiles (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)"
      );
      const linkStmt = db.prepare(
        "INSERT INTO medium_profile_mediums (profile_id, medium_id, sort_order) VALUES (?, ?, ?)"
      );
      for (const profile of snapshot.mediumProfiles) {
        const id = String(profile.id || "").trim();
        if (!id) {
          continue;
        }
        const name = String(profile.name || "Profil ohne Namen");
        const createdAt =
          profile.createdAt || profile.created_at || new Date().toISOString();
        const updatedAt = profile.updatedAt || profile.updated_at || createdAt;

        profileStmt.bind([id, name, createdAt, updatedAt]).step();
        profileStmt.reset();

        const mediumIds = Array.isArray(profile.mediumIds)
          ? profile.mediumIds
          : [];
        mediumIds.forEach((mediumId, index) => {
          if (!mediumId) {
            return;
          }
          linkStmt.bind([id, String(mediumId), index]).step();
          linkStmt.reset();
        });
      }
      profileStmt.finalize();
      linkStmt.finalize();
    }

    // Import history
    if (snapshot.history && Array.isArray(snapshot.history)) {
      const historyStmt = db.prepare(
        "INSERT INTO history (created_at, header_json) VALUES (?, ?)"
      );
      const itemsStmt = db.prepare(
        "INSERT INTO history_items (history_id, medium_id, payload_json) VALUES (?, ?, ?)"
      );

      for (const entry of snapshot.history) {
        const header = entry.header ? { ...entry.header } : { ...entry };
        delete header.items;
        const createdAt =
          entry.savedAt ||
          header.savedAt ||
          header.createdAt ||
          new Date().toISOString();
        if (!header.createdAt) {
          header.createdAt = createdAt;
        }

        historyStmt.bind([createdAt, JSON.stringify(header)]).step();
        const historyId = db.selectValue("SELECT last_insert_rowid()");
        historyStmt.reset();

        const items =
          entry.items && Array.isArray(entry.items) ? entry.items : [];
        for (const item of items) {
          itemsStmt
            .bind([
              historyId,
              item.mediumId || item.medium_id || "",
              JSON.stringify(item),
            ])
            .step();
          itemsStmt.reset();
        }
      }

      historyStmt.finalize();
      itemsStmt.finalize();
    }

    db.exec("COMMIT");
    return { success: true, message: "Snapshot imported successfully" };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * Export complete database as JSON snapshot
 */
async function exportSnapshot() {
  if (!db) throw new Error("Database not initialized");

  const snapshot = {
    meta: {
      version: 1,
      company: {},
      defaults: {},
      fieldLabels: {},
      measurementMethods: [],
    },
    mediums: [],
    mediumProfiles: [],
    history: [],
  };

  // Export meta
  db.exec({
    sql: "SELECT key, value FROM meta",
    callback: (row) => {
      const key = row[0];
      const value = row[1];
      try {
        const parsed = JSON.parse(value);
        if (key === "company") snapshot.meta.company = parsed;
        else if (key === "defaults") snapshot.meta.defaults = parsed;
        else if (key === "fieldLabels") snapshot.meta.fieldLabels = parsed;
        else if (key === "version") snapshot.meta.version = parsed;
      } catch (e) {
        console.warn(`Failed to parse meta key ${key}:`, e);
      }
    },
  });

  // Export measurement methods
  db.exec({
    sql: "SELECT id, label, type, unit, requires, config FROM measurement_methods",
    callback: (row) => {
      snapshot.meta.measurementMethods.push({
        id: row[0],
        label: row[1],
        type: row[2],
        unit: row[3],
        requires: JSON.parse(row[4] || "[]"),
        config: JSON.parse(row[5] || "{}"),
      });
    },
  });

  // Export mediums
  db.exec({
    sql: "SELECT id, name, unit, method_id, value, zulassungsnummer FROM mediums",
    callback: (row) => {
      snapshot.mediums.push({
        id: row[0],
        name: row[1],
        unit: row[2],
        methodId: row[3],
        value: row[4],
        zulassungsnummer: row[5] || null,
      });
    },
  });

  // Export medium profiles
  const profileMap = new Map();
  db.exec({
    sql: `SELECT id, name, created_at, updated_at
          FROM medium_profiles
          ORDER BY name COLLATE NOCASE`,
    rowMode: "object",
    callback: (row) => {
      profileMap.set(row.id, {
        id: String(row.id),
        name: String(row.name ?? ""),
        createdAt: row.created_at || new Date().toISOString(),
        updatedAt: row.updated_at || new Date().toISOString(),
        mediumIds: [],
      });
    },
  });

  if (profileMap.size) {
    db.exec({
      sql: `SELECT profile_id, medium_id, sort_order
            FROM medium_profile_mediums
            ORDER BY profile_id, sort_order, rowid`,
      rowMode: "object",
      callback: (row) => {
        const profile = profileMap.get(row.profile_id);
        if (profile) {
          profile.mediumIds.push(String(row.medium_id));
        }
      },
    });
  }

  snapshot.mediumProfiles = Array.from(profileMap.values());

  // Export history
  const historyMap = new Map();
  db.exec({
    sql: "SELECT id, created_at, header_json FROM history ORDER BY created_at DESC",
    callback: (row) => {
      historyMap.set(row[0], {
        header: JSON.parse(row[2] || "{}"),
        items: [],
      });
    },
  });

  // Export history items
  db.exec({
    sql: "SELECT history_id, medium_id, payload_json FROM history_items",
    callback: (row) => {
      const historyId = row[0];
      if (historyMap.has(historyId)) {
        historyMap.get(historyId).items.push(JSON.parse(row[2]));
      }
    },
  });

  snapshot.history = Array.from(historyMap.values()).map((entry) => ({
    ...entry.header,
    items: entry.items,
  }));
  return snapshot;
}

/**
 * CRUD operations for mediums
 */
async function upsertMedium(medium) {
  if (!db) throw new Error("Database not initialized");

  const stmt = db.prepare(
    "INSERT OR REPLACE INTO mediums (id, name, unit, method_id, value, zulassungsnummer) VALUES (?, ?, ?, ?, ?, ?)"
  );
  stmt
    .bind([
      medium.id,
      medium.name,
      medium.unit,
      medium.methodId || medium.method_id,
      medium.value,
      medium.zulassungsnummer ??
        medium.approvalNumber ??
        medium.zulassung ??
        null,
    ])
    .step();
  stmt.finalize();

  return { success: true, id: medium.id };
}

async function deleteMedium(id) {
  if (!db) throw new Error("Database not initialized");

  const stmt = db.prepare("DELETE FROM mediums WHERE id = ?");
  stmt.bind([id]).step();
  stmt.finalize();

  return { success: true };
}

async function listMediums() {
  if (!db) throw new Error("Database not initialized");

  const mediums = [];
  db.exec({
    sql: "SELECT id, name, unit, method_id, value, zulassungsnummer FROM mediums",
    callback: (row) => {
      mediums.push({
        id: row[0],
        name: row[1],
        unit: row[2],
        methodId: row[3],
        value: row[4],
        zulassungsnummer: row[5] || null,
      });
    },
  });

  return mediums;
}

/**
 * History operations with paging
 */
async function listHistory({
  page = 1,
  pageSize = 50,
  filters = {},
  sortDirection = "desc",
} = {}) {
  if (!db) throw new Error("Database not initialized");

  const sanitizedDirection =
    String(sortDirection).toLowerCase() === "asc" ? "ASC" : "DESC";

  const normalizedPageSize = Number.isFinite(Number(pageSize))
    ? Math.max(1, Number(pageSize))
    : 50;
  const normalizedPage = Number.isFinite(Number(page))
    ? Math.max(1, Number(page))
    : 1;
  const offset = (normalizedPage - 1) * normalizedPageSize;

  const historyDateExpr = `COALESCE(
    NULLIF(json_extract(header_json, '$.dateIso'), ''),
    CASE
      WHEN json_extract(header_json, '$.datum') GLOB '__.__.____'
      THEN substr(json_extract(header_json, '$.datum'), 7, 4) || '-' ||
           substr(json_extract(header_json, '$.datum'), 4, 2) || '-' ||
           substr(json_extract(header_json, '$.datum'), 1, 2)
      ELSE NULL
    END,
    created_at
  )`;

  const whereParts = [];
  const whereParams = [];

  if (filters.startDate) {
    whereParts.push(`datetime(${historyDateExpr}) >= datetime(?)`);
    whereParams.push(filters.startDate);
  }

  if (filters.endDate) {
    whereParts.push(`datetime(${historyDateExpr}) <= datetime(?)`);
    whereParams.push(filters.endDate);
  }

  const textFilters = [
    ["creator", "$.ersteller"],
    ["location", "$.standort"],
    ["crop", "$.kultur"],
    ["usageType", "$.usageType"],
    ["eppoCode", "$.eppoCode"],
    ["invekos", "$.invekos"],
    ["bbch", "$.bbch"],
  ];

  textFilters.forEach(([key, jsonPath]) => {
    const value = filters?.[key];
    if (typeof value === "string" && value.trim()) {
      whereParts.push(
        `LOWER(json_extract(header_json, '${jsonPath}')) LIKE LOWER(?)`
      );
      whereParams.push(`%${value.trim()}%`);
    }
  });

  if (typeof filters?.text === "string" && filters.text.trim()) {
    const textValue = `%${filters.text.trim()}%`;
    const jsonTargets = [
      "$.ersteller",
      "$.standort",
      "$.kultur",
      "$.usageType",
      "$.eppoCode",
      "$.invekos",
      "$.bbch",
      "$.gps",
    ];
    const textClauses = jsonTargets.map(
      (path) => `LOWER(json_extract(header_json, '${path}')) LIKE LOWER(?)`
    );
    whereParts.push(`(${textClauses.join(" OR ")})`);
    for (let i = 0; i < jsonTargets.length; i += 1) {
      whereParams.push(textValue);
    }
  }

  const whereSql = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

  const history = [];
  const queryConfig = {
    sql: `
      SELECT id, created_at, header_json
      FROM history
      ${whereSql}
      ORDER BY datetime(${historyDateExpr}) ${sanitizedDirection}, rowid ${sanitizedDirection}
      LIMIT ${normalizedPageSize} OFFSET ${offset}
    `,
    callback: (row) => {
      const header = JSON.parse(row[2] || "{}");
      history.push({
        id: row[0],
        ...header,
      });
    },
  };
  if (whereParams.length) {
    queryConfig.bind = [...whereParams];
  }
  db.exec(queryConfig);

  const totalCount = db.selectValue(
    `SELECT COUNT(*) FROM history ${whereSql}`,
    whereParams.length ? [...whereParams] : undefined
  );

  return {
    items: history,
    page: normalizedPage,
    pageSize: normalizedPageSize,
    totalCount: Number(totalCount) || 0,
    totalPages: Math.ceil((Number(totalCount) || 0) / normalizedPageSize),
  };
}

async function getHistoryEntry(id) {
  if (!db) throw new Error("Database not initialized");

  let entry = null;

  db.exec({
    sql: "SELECT id, created_at, header_json FROM history WHERE id = ?",
    bind: [id],
    callback: (row) => {
      const header = JSON.parse(row[2] || "{}");
      entry = {
        id: row[0],
        ...header,
        items: [],
      };
    },
  });

  if (!entry) {
    throw new Error("History entry not found");
  }

  db.exec({
    sql: "SELECT medium_id, payload_json FROM history_items WHERE history_id = ?",
    bind: [id],
    callback: (row) => {
      entry.items.push(JSON.parse(row[1]));
    },
  });

  return entry;
}

async function appendHistoryEntry(entry) {
  if (!db) throw new Error("Database not initialized");

  db.exec("BEGIN TRANSACTION");

  try {
    const header = entry.header ? { ...entry.header } : { ...entry };
    delete header.items;
    const createdAt =
      entry.savedAt ||
      header.savedAt ||
      header.createdAt ||
      new Date().toISOString();
    if (!header.createdAt) {
      header.createdAt = createdAt;
    }

    const stmt = db.prepare(
      "INSERT INTO history (created_at, header_json) VALUES (?, ?)"
    );
    stmt.bind([createdAt, JSON.stringify(header)]).step();
    const historyId = db.selectValue("SELECT last_insert_rowid()");
    stmt.finalize();

    const items = entry.items && Array.isArray(entry.items) ? entry.items : [];
    if (items.length) {
      const itemStmt = db.prepare(
        "INSERT INTO history_items (history_id, medium_id, payload_json) VALUES (?, ?, ?)"
      );
      for (const item of items) {
        itemStmt
          .bind([
            historyId,
            item.mediumId || item.medium_id || "",
            JSON.stringify(item),
          ])
          .step();
        itemStmt.reset();
      }
      itemStmt.finalize();
    }

    db.exec("COMMIT");
    return { success: true, id: historyId };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

async function deleteHistoryEntry(id) {
  if (!db) throw new Error("Database not initialized");

  // CASCADE will handle history_items deletion
  const stmt = db.prepare("DELETE FROM history WHERE id = ?");
  stmt.bind([id]).step();
  stmt.finalize();

  return { success: true };
}

/**
 * Export database as binary SQLite file
 */
async function exportDB() {
  if (!db) throw new Error("Database not initialized");

  const exported = sqlite3.capi.sqlite3_js_db_export(db.pointer);
  return { data: Array.from(exported) };
}

/**
 * Import database from binary SQLite file
 */
async function importDB(data) {
  if (!db) throw new Error("Database not initialized");
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

  if (currentMode === "opfs" && sqlite3?.oo1?.OpfsDb && sqlite3?.opfs) {
    // Import directly into OPFS-backed database
    db.close();
    await sqlite3.oo1.OpfsDb.importDb("/pflanzenschutz.sqlite", bytes);
    db = createDatabaseInstance("opfs");
    configureDatabase();
    await applySchema();
    currentMode = "opfs";
    isInitialized = true;
    return { success: true, mode: "opfs" };
  }

  // In-memory fallback using sqlite3_deserialize
  db.close();
  const newDb = new sqlite3.oo1.DB();
  const scope = sqlite3.wasm.scopedAllocPush();
  try {
    const pData = sqlite3.wasm.allocFromTypedArray(bytes);
    const pSchema = sqlite3.wasm.allocCString("main");
    const flags =
      (sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE || 0) |
      (sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE || 0);
    const rc = sqlite3.capi.sqlite3_deserialize(
      newDb.pointer,
      pSchema,
      pData,
      bytes.byteLength,
      bytes.byteLength,
      flags
    );
    if (rc !== sqlite3.capi.SQLITE_OK) {
      newDb.close();
      throw new Error(
        `sqlite3_deserialize failed: ${
          sqlite3.capi.sqlite3_js_rc_str(rc) || rc
        }`
      );
    }
  } finally {
    sqlite3.wasm.scopedAllocPop(scope);
  }

  db = newDb;
  configureDatabase();
  await applySchema();
  currentMode = "memory";
  isInitialized = true;
  return { success: true, mode: "memory" };
}

/**
 * BVL-related functions
 */

async function importBvlDataset(payload) {
  if (!db) throw new Error("Database not initialized");

  const {
    mittel,
    awg,
    awg_kultur,
    awg_schadorg,
    awg_aufwand,
    awg_wartezeit,
    culturesLookup,
    pestsLookup,
    apiPayloads = [],
    payloadCounts = {},
  } = payload;
  const debug = payload.debug || false;

  ensurePayloadStorageSchema();
  db.exec("BEGIN TRANSACTION");

  try {
    // Clear existing BVL data
    db.exec(`
      DELETE FROM bvl_awg_wartezeit;
      DELETE FROM bvl_awg_aufwand;
      DELETE FROM bvl_awg_schadorg;
      DELETE FROM bvl_awg_kultur;
      DELETE FROM bvl_awg;
      DELETE FROM bvl_mittel;
      DELETE FROM bvl_lookup_kultur;
      DELETE FROM bvl_lookup_schadorg;
      DELETE FROM bvl_api_payloads;
    `);

    let counts = {};

    // Import mittel
    if (mittel && mittel.length > 0) {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO bvl_mittel 
        (kennr, name, formulierung, zul_erstmalig, zul_ende, geringes_risiko, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (const item of mittel) {
        stmt
          .bind([
            item.kennr,
            item.name,
            item.formulierung,
            item.zul_erstmalig,
            item.zul_ende,
            item.geringes_risiko,
            item.payload_json,
          ])
          .step();
        stmt.reset();
      }
      stmt.finalize();
      counts.mittel = mittel.length;
      if (debug) console.debug(`Imported ${mittel.length} mittel`);
    }

    // Import awg
    if (awg && awg.length > 0) {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO bvl_awg 
        (awg_id, kennr, status_json, zulassungsende)
        VALUES (?, ?, ?, ?)
      `);

      for (const item of awg) {
        stmt
          .bind([
            item.awg_id,
            item.kennr,
            item.status_json,
            item.zulassungsende,
          ])
          .step();
        stmt.reset();
      }
      stmt.finalize();
      counts.awg = awg.length;
      if (debug) console.debug(`Imported ${awg.length} awg`);
    }

    // Import awg_kultur
    if (awg_kultur && awg_kultur.length > 0) {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO bvl_awg_kultur 
        (awg_id, kultur, ausgenommen, sortier_nr)
        VALUES (?, ?, ?, ?)
      `);

      for (const item of awg_kultur) {
        stmt
          .bind([item.awg_id, item.kultur, item.ausgenommen, item.sortier_nr])
          .step();
        stmt.reset();
      }
      stmt.finalize();
      counts.awg_kultur = awg_kultur.length;
      if (debug) console.debug(`Imported ${awg_kultur.length} awg_kultur`);
    }

    // Import awg_schadorg
    if (awg_schadorg && awg_schadorg.length > 0) {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO bvl_awg_schadorg 
        (awg_id, schadorg, ausgenommen, sortier_nr)
        VALUES (?, ?, ?, ?)
      `);

      for (const item of awg_schadorg) {
        stmt
          .bind([item.awg_id, item.schadorg, item.ausgenommen, item.sortier_nr])
          .step();
        stmt.reset();
      }
      stmt.finalize();
      counts.awg_schadorg = awg_schadorg.length;
      if (debug) console.debug(`Imported ${awg_schadorg.length} awg_schadorg`);
    }

    // Import awg_aufwand
    if (awg_aufwand && awg_aufwand.length > 0) {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO bvl_awg_aufwand 
        (awg_id, aufwand_bedingung, sortier_nr, mittel_menge, mittel_einheit, 
         wasser_menge, wasser_einheit, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const item of awg_aufwand) {
        stmt
          .bind([
            item.awg_id,
            item.aufwand_bedingung,
            item.sortier_nr,
            item.mittel_menge,
            item.mittel_einheit,
            item.wasser_menge,
            item.wasser_einheit,
            item.payload_json,
          ])
          .step();
        stmt.reset();
      }
      stmt.finalize();
      counts.awg_aufwand = awg_aufwand.length;
      if (debug) console.debug(`Imported ${awg_aufwand.length} awg_aufwand`);
    }

    // Import awg_wartezeit
    if (awg_wartezeit && awg_wartezeit.length > 0) {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO bvl_awg_wartezeit 
        (awg_wartezeit_nr, awg_id, kultur, sortier_nr, tage, 
         bemerkung_kode, anwendungsbereich, erlaeuterung, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const item of awg_wartezeit) {
        stmt
          .bind([
            item.awg_wartezeit_nr,
            item.awg_id,
            item.kultur,
            item.sortier_nr,
            item.tage,
            item.bemerkung_kode,
            item.anwendungsbereich,
            item.erlaeuterung,
            item.payload_json,
          ])
          .step();
        stmt.reset();
      }
      stmt.finalize();
      counts.awg_wartezeit = awg_wartezeit.length;
      if (debug)
        console.debug(`Imported ${awg_wartezeit.length} awg_wartezeit`);
    }

    if (culturesLookup && culturesLookup.length > 0) {
      const stmt = db.prepare(
        `
        INSERT OR REPLACE INTO bvl_lookup_kultur (code, label)
        VALUES (?, ?)
      `
      );

      for (const item of culturesLookup) {
        stmt.bind([item.code, item.label]).step();
        stmt.reset();
      }
      stmt.finalize();
      counts.lookup_kultur = culturesLookup.length;
      if (debug)
        console.debug(`Imported ${culturesLookup.length} lookup_kultur`);
    }

    if (pestsLookup && pestsLookup.length > 0) {
      const stmt = db.prepare(
        `
        INSERT OR REPLACE INTO bvl_lookup_schadorg (code, label)
        VALUES (?, ?)
      `
      );

      for (const item of pestsLookup) {
        stmt.bind([item.code, item.label]).step();
        stmt.reset();
      }
      stmt.finalize();
      counts.lookup_schadorg = pestsLookup.length;
      if (debug)
        console.debug(`Imported ${pestsLookup.length} lookup_schadorg`);
    }

    if (apiPayloads && apiPayloads.length > 0) {
      const stmt = db.prepare(
        `
        INSERT INTO bvl_api_payloads
        (endpoint, key, primary_ref, secondary_ref, tertiary_ref, payload_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `
      );

      for (const item of apiPayloads) {
        stmt
          .bind([
            item.endpoint,
            item.key || item.endpoint,
            item.primary_ref || null,
            item.secondary_ref || null,
            item.tertiary_ref || null,
            item.payload_json,
          ])
          .step();
        stmt.reset();
      }
      stmt.finalize();
      counts.api_payloads = apiPayloads.length;
      if (payloadCounts && typeof payloadCounts === "object") {
        counts.payload_breakdown = payloadCounts;
      }
      if (debug)
        console.debug(`Imported ${apiPayloads.length} generic payload rows`);
    }

    db.exec("COMMIT");
    return { success: true, counts };
  } catch (error) {
    db.exec("ROLLBACK");
    console.error("Failed to import BVL dataset:", error);
    throw error;
  }
}

async function importBvlSqlite(payload) {
  if (!db) throw new Error("Database not initialized");
  if (!sqlite3) throw new Error("SQLite not initialized");

  const { data, manifest } = payload;

  if (!data || !(data instanceof Uint8Array || data instanceof Array)) {
    throw new Error("Invalid data: expected Uint8Array or Array");
  }

  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

  // Create a temporary in-memory database with the imported data
  const remoteDb = new sqlite3.oo1.DB();

  // Deserialize the database
  const scope = sqlite3.wasm.scopedAllocPush();
  try {
    const pData = sqlite3.wasm.allocFromTypedArray(bytes);
    const pSchema = sqlite3.wasm.allocCString("main");
    const flags =
      (sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE || 0) |
      (sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE || 0);
    const rc = sqlite3.capi.sqlite3_deserialize(
      remoteDb.pointer,
      pSchema,
      pData,
      bytes.byteLength,
      bytes.byteLength,
      flags
    );
    if (rc !== sqlite3.capi.SQLITE_OK) {
      remoteDb.close();
      throw new Error(
        `sqlite3_deserialize failed: ${
          sqlite3.capi.sqlite3_js_rc_str(rc) || rc
        }`
      );
    }
  } finally {
    sqlite3.wasm.scopedAllocPop(scope);
  }

  // Get list of BVL tables from remote database
  const bvlTables = [];
  remoteDb.exec({
    sql: "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'bvl_%' ORDER BY name",
    callback: (row) => {
      bvlTables.push(row[0]);
    },
  });

  const tablePriority = {
    bvl_meta: 10,
    bvl_lookup_kultur: 20,
    bvl_lookup_schadorg: 20,
    bvl_mittel: 30,
    bvl_awg: 40,
    bvl_awg_kultur: 50,
    bvl_awg_schadorg: 50,
    bvl_awg_aufwand: 60,
    bvl_awg_wartezeit: 60,
  };

  bvlTables.sort((a, b) => {
    const pa = Object.prototype.hasOwnProperty.call(tablePriority, a)
      ? tablePriority[a]
      : 1000;
    const pb = Object.prototype.hasOwnProperty.call(tablePriority, b)
      ? tablePriority[b]
      : 1000;
    if (pa !== pb) {
      return pa - pb;
    }
    return a.localeCompare(b);
  });

  console.log(
    `Found ${bvlTables.length} BVL tables in remote database:`,
    bvlTables
  );

  // Begin transaction on main database
  db.exec("BEGIN TRANSACTION");

  try {
    const counts = {};

    // Import each BVL table
    for (const tableName of bvlTables) {
      // Skip sync log as we don't want to overwrite it
      if (tableName === "bvl_sync_log") {
        continue;
      }

      // Get column names from remote table
      const columns = [];
      remoteDb.exec({
        sql: `PRAGMA table_info(${tableName})`,
        callback: (row) => {
          columns.push(row[1]); // column name
        },
      });

      if (columns.length === 0) {
        console.warn(`Table ${tableName} has no columns, skipping`);
        continue;
      }

      // Check if table exists in main database
      let tableExists = false;
      db.exec({
        sql: "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
        bind: [tableName],
        callback: () => {
          tableExists = true;
        },
      });

      if (!tableExists) {
        // Create the table by copying schema from remote
        const createSql = remoteDb.selectValue(
          `SELECT sql FROM sqlite_master WHERE type='table' AND name = ?`,
          [tableName]
        );
        if (createSql) {
          console.log(`Creating table ${tableName}`);
          db.exec(createSql);
        } else {
          console.warn(
            `Could not get CREATE statement for ${tableName}, skipping`
          );
          continue;
        }
      }

      // Get columns that exist in main table
      const mainColumns = [];
      db.exec({
        sql: `PRAGMA table_info(${tableName})`,
        callback: (row) => {
          mainColumns.push(row[1]);
        },
      });

      // Find common columns
      const commonColumns = columns.filter((col) => mainColumns.includes(col));

      if (commonColumns.length === 0) {
        console.warn(
          `No common columns between remote and main ${tableName}, skipping`
        );
        continue;
      }

      const colList = commonColumns.join(", ");

      let hasForeignKey = 0;
      db.exec({
        sql: `SELECT COUNT(*) FROM pragma_foreign_key_list('${tableName}')`,
        callback: (row) => {
          hasForeignKey = Number(row[0]) || 0;
        },
      });

      if (hasForeignKey > 0) {
        db.exec("PRAGMA defer_foreign_keys = ON");
      }

      try {
        db.exec(`DELETE FROM ${tableName}`);

        // Copy data row by row from remote database
        const rows = [];
        remoteDb.exec({
          sql: `SELECT ${colList} FROM ${tableName}`,
          callback: (row) => {
            rows.push([...row]);
          },
        });

        if (rows.length > 0) {
          const placeholders = commonColumns.map(() => "?").join(", ");
          const insertSql = `INSERT OR REPLACE INTO ${tableName} (${colList}) VALUES (${placeholders})`;
          const stmt = db.prepare(insertSql);

          for (const row of rows) {
            stmt.bind(row).step();
            stmt.reset();
          }
          stmt.finalize();

          counts[tableName] = rows.length;
          console.log(`Imported ${rows.length} rows into ${tableName}`);
        } else {
          counts[tableName] = 0;
        }
      } finally {
        if (hasForeignKey > 0) {
          db.exec("PRAGMA defer_foreign_keys = OFF");
        }
      }
    }

    // Update metadata from manifest
    if (manifest) {
      const metaUpdates = {
        dataSource: `pflanzenschutzliste-data@${manifest.version}`,
        lastSyncIso: new Date().toISOString(),
        lastSyncHash: manifest.hash || manifest.version,
      };

      if (manifest.counts || manifest.tables) {
        metaUpdates.lastSyncCounts = JSON.stringify(
          manifest.counts || manifest.tables || {}
        );
      }

      if (manifest.api_version) {
        metaUpdates.apiStand = manifest.api_version;
      } else if (manifest.build && manifest.build.finished_at) {
        metaUpdates.apiStand = manifest.build.finished_at;
      }

      const metaStmt = db.prepare(
        "INSERT OR REPLACE INTO bvl_meta (key, value) VALUES (?, ?)"
      );
      for (const [key, value] of Object.entries(metaUpdates)) {
        metaStmt
          .bind([
            key,
            typeof value === "string" ? value : JSON.stringify(value),
          ])
          .step();
        metaStmt.reset();
      }
      metaStmt.finalize();
    }

    // Verify database integrity
    const integrityResult = db.selectValue("PRAGMA integrity_check");
    if (integrityResult !== "ok") {
      throw new Error(`Database integrity check failed: ${integrityResult}`);
    }

    db.exec("COMMIT");
    remoteDb.close();

    console.log("BVL SQLite import complete", counts);
    return { success: true, counts };
  } catch (error) {
    db.exec("ROLLBACK");
    remoteDb.close();
    console.error("Failed to import BVL SQLite:", error);
    throw error;
  }
}

async function getBvlMeta(key) {
  if (!db) throw new Error("Database not initialized");

  let value = null;
  db.exec({
    sql: "SELECT value FROM bvl_meta WHERE key = ?",
    bind: [key],
    callback: (row) => {
      value = row[0];
    },
  });

  return value;
}

async function setBvlMeta(payload) {
  if (!db) throw new Error("Database not initialized");

  const { key, value } = payload;

  const stmt = db.prepare(
    "INSERT OR REPLACE INTO bvl_meta (key, value) VALUES (?, ?)"
  );
  stmt.bind([key, value]).step();
  stmt.finalize();

  return { success: true };
}

async function appendBvlSyncLog(payload) {
  if (!db) throw new Error("Database not initialized");

  const { synced_at, ok, message, payload_hash } = payload;

  const stmt = db.prepare(`
    INSERT INTO bvl_sync_log (synced_at, ok, message, payload_hash)
    VALUES (?, ?, ?, ?)
  `);
  stmt.bind([synced_at, ok, message, payload_hash]).step();
  stmt.finalize();

  return { success: true };
}

async function listBvlSyncLog(payload) {
  if (!db) throw new Error("Database not initialized");

  const limit = payload?.limit || 10;
  const logs = [];

  db.exec({
    sql: "SELECT id, synced_at, ok, message, payload_hash FROM bvl_sync_log ORDER BY id DESC LIMIT ?",
    bind: [limit],
    callback: (row) => {
      logs.push({
        id: row[0],
        synced_at: row[1],
        ok: row[2],
        message: row[3],
        payload_hash: row[4],
      });
    },
  });

  return logs;
}

async function queryZulassung(payload) {
  if (!db) throw new Error("Database not initialized");

  const { culture, pest, text, includeExpired } = payload || {};

  let sql = `
    SELECT DISTINCT
      m.kennr,
      m.name,
      m.formulierung,
      m.zul_ende,
      m.geringes_risiko,
      a.awg_id,
      a.status_json,
      a.zulassungsende
    FROM bvl_mittel m
    JOIN bvl_awg a ON m.kennr = a.kennr
  `;

  const conditions = [];
  const bindings = [];

  if (culture) {
    sql += ` JOIN bvl_awg_kultur ak ON a.awg_id = ak.awg_id `;
    conditions.push("ak.kultur = ?");
    bindings.push(culture);
  }

  if (pest) {
    sql += ` JOIN bvl_awg_schadorg aso ON a.awg_id = aso.awg_id `;
    conditions.push("aso.schadorg = ?");
    bindings.push(pest);
  }

  if (text) {
    const searchTerm = text.toLowerCase();
    const textPattern = `%${searchTerm}%`;
    conditions.push(`(
      LOWER(m.name) LIKE ? OR LOWER(m.kennr) LIKE ? OR
      EXISTS (
        SELECT 1
        FROM bvl_awg_kultur ak_filter
        LEFT JOIN bvl_lookup_kultur lk_filter ON lk_filter.code = ak_filter.kultur
        WHERE ak_filter.awg_id = a.awg_id
          AND (
            LOWER(ak_filter.kultur) LIKE ? OR
            LOWER(IFNULL(lk_filter.label, '')) LIKE ?
          )
      ) OR
      EXISTS (
        SELECT 1
        FROM bvl_awg_schadorg aso_filter
        LEFT JOIN bvl_lookup_schadorg ls_filter ON ls_filter.code = aso_filter.schadorg
        WHERE aso_filter.awg_id = a.awg_id
          AND (
            LOWER(aso_filter.schadorg) LIKE ? OR
            LOWER(IFNULL(ls_filter.label, '')) LIKE ?
          )
      )
    )`);
    bindings.push(
      textPattern,
      textPattern,
      textPattern,
      textPattern,
      textPattern,
      textPattern
    );
  }

  if (!includeExpired) {
    conditions.push("(m.zul_ende IS NULL OR m.zul_ende >= date('now'))");
  }

  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }

  sql += " ORDER BY m.name";

  const results = [];

  const payloadCache = new Map();
  const addressCache = new Map();

  const normalizeRef = (value) => {
    if (value === null || value === undefined) {
      return null;
    }
    const str = String(value).trim();
    return str === "" ? null : str;
  };

  const getPayloadsForKey = (
    key,
    { primaryRef = null, secondaryRef = null } = {}
  ) => {
    const normalizedPrimary = normalizeRef(primaryRef);
    const normalizedSecondary = normalizeRef(secondaryRef);
    const cacheKey = `${key}|${normalizedPrimary ?? ""}|${normalizedSecondary ?? ""}`;
    if (payloadCache.has(cacheKey)) {
      return payloadCache.get(cacheKey);
    }

    const payloads = [];
    db.exec({
      sql: `
        SELECT payload_json, primary_ref, secondary_ref, tertiary_ref
        FROM bvl_api_payloads
        WHERE key = ?
          AND (? IS NULL OR primary_ref = ?)
          AND (? IS NULL OR secondary_ref = ?)
        ORDER BY id
      `,
      bind: [
        key,
        normalizedPrimary,
        normalizedPrimary,
        normalizedSecondary,
        normalizedSecondary,
      ],
      callback: (row) => {
        const payload = normalizePayloadRecord(safeParseJson(row[0]) || {});
        payload.__meta = {
          primary_ref: row[1],
          secondary_ref: row[2],
          tertiary_ref: row[3],
        };
        payloads.push(payload);
      },
    });

    payloadCache.set(cacheKey, payloads);
    return payloads;
  };

  const getFirstPayload = (key, refs = {}) => {
    const list = getPayloadsForKey(key, refs);
    return list.length > 0 ? list[0] : null;
  };

  const getAdresseByNumber = (adresseNr) => {
    const normalized = normalizeRef(adresseNr);
    if (!normalized) {
      return null;
    }
    if (addressCache.has(normalized)) {
      return addressCache.get(normalized);
    }
    const payload = getFirstPayload("adresse", { primaryRef: normalized });
    addressCache.set(normalized, payload);
    return payload;
  };

  db.exec({
    sql,
    bind: bindings,
    callback: (row) => {
      results.push({
        kennr: row[0],
        name: row[1],
        formulierung: row[2],
        zul_ende: row[3],
        geringes_risiko: row[4],
        awg_id: row[5],
        status_json: row[6],
        zulassungsende: row[7],
      });
    },
  });

  // Enrich each result with detailed information
  for (const result of results) {
    // Get cultures
    result.kulturen = [];
    db.exec({
      sql: `
        SELECT ak.kultur, ak.ausgenommen, ak.sortier_nr, IFNULL(lk.label, ak.kultur) as label
        FROM bvl_awg_kultur ak
        LEFT JOIN bvl_lookup_kultur lk ON lk.code = ak.kultur
        WHERE ak.awg_id = ? 
        ORDER BY ak.sortier_nr
      `,
      bind: [result.awg_id],
      callback: (row) => {
        result.kulturen.push({
          kultur: row[0],
          ausgenommen: row[1],
          sortier_nr: row[2],
          label: row[3],
        });
      },
    });

    // Get schadorganismen
    result.schadorganismen = [];
    db.exec({
      sql: `
        SELECT aso.schadorg, aso.ausgenommen, aso.sortier_nr, IFNULL(ls.label, aso.schadorg) as label
        FROM bvl_awg_schadorg aso
        LEFT JOIN bvl_lookup_schadorg ls ON ls.code = aso.schadorg
        WHERE aso.awg_id = ? 
        ORDER BY aso.sortier_nr
      `,
      bind: [result.awg_id],
      callback: (row) => {
        result.schadorganismen.push({
          schadorg: row[0],
          ausgenommen: row[1],
          sortier_nr: row[2],
          label: row[3],
        });
      },
    });

    // Get aufwände
    result.aufwaende = [];
    db.exec({
      sql: `
        SELECT aufwand_bedingung, sortier_nr, mittel_menge, mittel_einheit,
               wasser_menge, wasser_einheit, payload_json
        FROM bvl_awg_aufwand 
        WHERE awg_id = ? 
        ORDER BY sortier_nr
      `,
      bind: [result.awg_id],
      callback: (row) => {
        result.aufwaende.push({
          aufwand_bedingung: row[0],
          sortier_nr: row[1],
          mittel_menge: row[2],
          mittel_einheit: row[3],
          wasser_menge: row[4],
          wasser_einheit: row[5],
          payload_json: row[6],
        });
      },
    });

    // Get wartezeiten
    result.wartezeiten = [];
    db.exec({
      sql: `
        SELECT w.awg_wartezeit_nr, w.kultur, w.sortier_nr, w.tage, 
               w.bemerkung_kode, w.anwendungsbereich, w.erlaeuterung, w.payload_json,
               IFNULL(lk.label, w.kultur) as kultur_label
        FROM bvl_awg_wartezeit w
        LEFT JOIN bvl_lookup_kultur lk ON lk.code = w.kultur
        WHERE w.awg_id = ? 
        ORDER BY w.sortier_nr
      `,
      bind: [result.awg_id],
      callback: (row) => {
        result.wartezeiten.push({
          awg_wartezeit_nr: row[0],
          kultur: row[1],
          sortier_nr: row[2],
          tage: row[3],
          bemerkung_kode: row[4],
          anwendungsbereich: row[5],
          erlaeuterung: row[6],
          payload_json: row[7],
          kultur_label: row[8],
        });
      },
    });

    result.wirkstoffe = getPayloadsForKey("wirkstoff", {
      primaryRef: result.kennr,
    });
    result.wirkstoff_gehalt = getPayloadsForKey("wirkstoff_gehalt", {
      primaryRef: result.kennr,
    });
    result.zusatzstoffe = getPayloadsForKey("zusatzstoff", {
      primaryRef: result.kennr,
    });
    result.zusatzstoff_vertrieb = getPayloadsForKey("zusatzstoff_vertrieb", {
      primaryRef: result.kennr,
    });
    result.parallelimporte_gueltig = getPayloadsForKey(
      "parallelimport_gueltig",
      {
        primaryRef: result.kennr,
      }
    );
    result.parallelimporte_abgelaufen = getPayloadsForKey(
      "parallelimport_abgelaufen",
      { primaryRef: result.kennr }
    );
    result.staerkung = getPayloadsForKey("staerkung", {
      primaryRef: result.kennr,
    });
    result.staerkung_vertrieb = getPayloadsForKey("staerkung_vertrieb", {
      primaryRef: result.kennr,
    });

    const vertriebseintraege = getPayloadsForKey("mittel_vertrieb", {
      primaryRef: result.kennr,
    }).map((payload) => {
      const adresseNr =
        getFieldValue(payload, "adresse_nr") ||
        getFieldValue(payload, "vertriebsfirma_nr") ||
        getFieldValue(payload, "vertriebsfirma_adresse_nr") ||
        getFieldValue(payload, "hersteller_nr") ||
        getFieldValue(payload, "hersteller_adresse_nr") ||
        getFieldValue(payload, "zulassungsinhaber_adresse_nr") ||
        getFieldValue(payload, "zulassungsinhaber_nr") ||
        null;
      const adresse = getAdresseByNumber(adresseNr);
      const enriched = { ...payload };
      if (adresse) {
        enriched.adresse = adresse;
        enriched.adresse_nr =
          adresseNr !== null && adresseNr !== undefined ? adresseNr : null;
      }
      return enriched;
    });
    result.vertrieb = vertriebseintraege;

    result.gefahrhinweise = getPayloadsForKey("ghs_gefahrenhinweise", {
      primaryRef: result.kennr,
    });
    result.gefahrensymbole = getPayloadsForKey("ghs_gefahrensymbole", {
      primaryRef: result.kennr,
    });
    result.sicherheitshinweise = getPayloadsForKey("ghs_sicherheitshinweise", {
      primaryRef: result.kennr,
    });
    result.signalwoerter = getPayloadsForKey("ghs_signalwoerter", {
      primaryRef: result.kennr,
    });
    result.hinweise = getPayloadsForKey("hinweis", {
      primaryRef: result.kennr,
    });

    result.antraege = getPayloadsForKey("antrag", { primaryRef: result.kennr });

    const auflagenPayloads = [
      ...getPayloadsForKey("auflagen", { primaryRef: result.kennr }),
      ...getPayloadsForKey("auflagen", { secondaryRef: result.awg_id }),
    ];

    result.auflagen = auflagenPayloads.map((auflage) => {
      const nummer = getFieldValue(auflage, "auflagenr");
      const reduzierungen = nummer
        ? getPayloadsForKey("auflage_redu", { primaryRef: nummer })
        : [];
      return {
        ...auflage,
        reduzierung: reduzierungen,
      };
    });

    result.awg_bemerkungen = getPayloadsForKey("awg_bem", {
      primaryRef: result.awg_id,
    });
    result.awg_partner = getPayloadsForKey("awg_partner", {
      primaryRef: result.awg_id,
    });
    result.awg_partner_aufwand = getPayloadsForKey("awg_partner_aufwand", {
      primaryRef: result.awg_id,
    });
    result.awg_verwendungszwecke = getPayloadsForKey("awg_verwendungszweck", {
      primaryRef: result.awg_id,
    });
    result.awg_wartezeit_ausnahmen = getPayloadsForKey(
      "awg_wartezeit_ausg_kultur",
      { primaryRef: result.awg_id }
    );
    result.awg_zeitpunkte = getPayloadsForKey("awg_zeitpunkt", {
      primaryRef: result.awg_id,
    });
    result.awg_zulassung = getPayloadsForKey("awg_zulassung", {
      primaryRef: result.awg_id,
    });
  }

  return results;
}

async function listBvlCultures(payload) {
  if (!db) throw new Error("Database not initialized");

  const withCount = payload?.withCount || false;
  const cultures = [];

  let sql;

  if (withCount) {
    sql = `
      SELECT ak.kultur, IFNULL(lk.label, ak.kultur) AS label, COUNT(*) AS count
      FROM bvl_awg_kultur ak
      LEFT JOIN bvl_lookup_kultur lk ON lk.code = ak.kultur
      WHERE ak.ausgenommen = 0
  GROUP BY ak.kultur, label
  ORDER BY label COLLATE NOCASE
    `;
  } else {
    sql = `
      SELECT DISTINCT ak.kultur, IFNULL(lk.label, ak.kultur) AS label
      FROM bvl_awg_kultur ak
      LEFT JOIN bvl_lookup_kultur lk ON lk.code = ak.kultur
  WHERE ak.ausgenommen = 0
  ORDER BY label COLLATE NOCASE
    `;
  }

  db.exec({
    sql,
    callback: (row) => {
      if (withCount) {
        cultures.push({ code: row[0], label: row[1], count: row[2] });
      } else {
        cultures.push({ code: row[0], label: row[1] });
      }
    },
  });

  return cultures;
}

async function listBvlSchadorg(payload) {
  if (!db) throw new Error("Database not initialized");

  const withCount = payload?.withCount || false;
  const schadorg = [];

  let sql;

  if (withCount) {
    sql = `
      SELECT aso.schadorg, IFNULL(ls.label, aso.schadorg) AS label, COUNT(*) AS count
      FROM bvl_awg_schadorg aso
      LEFT JOIN bvl_lookup_schadorg ls ON ls.code = aso.schadorg
      WHERE aso.ausgenommen = 0
  GROUP BY aso.schadorg, label
  ORDER BY label COLLATE NOCASE
    `;
  } else {
    sql = `
      SELECT DISTINCT aso.schadorg, IFNULL(ls.label, aso.schadorg) AS label
      FROM bvl_awg_schadorg aso
      LEFT JOIN bvl_lookup_schadorg ls ON ls.code = aso.schadorg
  WHERE aso.ausgenommen = 0
  ORDER BY label COLLATE NOCASE
    `;
  }

  db.exec({
    sql,
    callback: (row) => {
      if (withCount) {
        schadorg.push({ code: row[0], label: row[1], count: row[2] });
      } else {
        schadorg.push({ code: row[0], label: row[1] });
      }
    },
  });

  return schadorg;
}

async function importLookupEppo(payload = {}) {
  if (!db) throw new Error("Database not initialized");
  if (!sqlite3) throw new Error("SQLite not initialized");

  const { data } = payload;
  if (!data) {
    throw new Error("Keine Daten zum Importieren übergeben");
  }

  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const remoteDb = openDatabaseFromBytes(bytes);

  const rows = [];
  const metadataById = new Map();
  let uniqueCodeCount = 0;
  try {
    remoteDb.exec({
      sql: `
        WITH localized AS (
          SELECT
            codeid,
            MAX(CASE WHEN UPPER(codelang) = 'DE' THEN TRIM(fullname) END) AS name_de,
            MAX(CASE WHEN UPPER(codelang) = 'EN' THEN TRIM(fullname) END) AS name_en,
            MAX(CASE WHEN UPPER(codelang) = 'LA' THEN TRIM(fullname) END) AS name_la
          FROM t_names
          WHERE fullname IS NOT NULL AND LENGTH(TRIM(fullname)) > 0
          GROUP BY codeid
        )
        SELECT
          c.codeid,
          UPPER(TRIM(c.eppocode)) AS code,
          CASE
            WHEN c.dtcode IS NOT NULL AND LENGTH(TRIM(c.dtcode)) > 0
              THEN UPPER(TRIM(c.dtcode))
            ELSE NULL
          END AS dtcode,
          dt.libtype AS dt_label,
          loc.name_de,
          loc.name_en,
          loc.name_la,
          TRIM(
            COALESCE(
              loc.name_de,
              loc.name_en,
              loc.name_la,
              c.eppocode
            )
          ) AS fallback_name
        FROM t_codes c
        LEFT JOIN t_datatypes dt ON UPPER(TRIM(dt.dtcode)) = UPPER(TRIM(c.dtcode))
        LEFT JOIN localized loc ON loc.codeid = c.codeid
        WHERE c.eppocode IS NOT NULL
          AND LENGTH(TRIM(c.eppocode)) > 0;
      `,
      callback: (row) => {
        const codeId = row && row[0] != null ? Number(row[0]) : null;
        const code = row && row[1] ? String(row[1]).trim().toUpperCase() : "";
        if (!codeId || !code) {
          return;
        }
        const normalizeName = (value) => {
          if (!value) {
            return null;
          }
          const trimmed = String(value).trim();
          return trimmed.length ? trimmed : null;
        };
        const fallbackName = normalizeName(row[7]) || code;
        metadataById.set(codeId, {
          codeId,
          code,
          dtcode: normalizeName(row[2]) || null,
          dtLabel: normalizeName(row[3]),
          nameDe: normalizeName(row[4]),
          nameEn: normalizeName(row[5]),
          nameLa: normalizeName(row[6]),
          fallbackName,
        });
      },
    });

    const codesWithEntries = new Set();
    remoteDb.exec({
      sql: `
        WITH ranked AS (
          SELECT
            n.codeid,
            CASE
              WHEN n.codelang IS NULL OR LENGTH(TRIM(n.codelang)) = 0
                THEN ''
              ELSE UPPER(TRIM(n.codelang))
            END AS language,
            TRIM(n.fullname) AS fullname,
            n.idauth AS authority_id,
            ROW_NUMBER() OVER (
              PARTITION BY n.codeid,
                CASE
                  WHEN n.codelang IS NULL OR LENGTH(TRIM(n.codelang)) = 0
                    THEN ''
                  ELSE UPPER(TRIM(n.codelang))
                END
              ORDER BY
                CASE WHEN IFNULL(n.preferred, 0) = 1 THEN 0 ELSE 1 END,
                LENGTH(TRIM(n.fullname)),
                TRIM(n.fullname)
            ) AS lang_rank
          FROM t_names n
          JOIN t_codes c ON c.codeid = n.codeid
          WHERE c.eppocode IS NOT NULL
            AND LENGTH(TRIM(c.eppocode)) > 0
            AND n.fullname IS NOT NULL
            AND LENGTH(TRIM(n.fullname)) > 0
            AND (n.status IS NULL OR n.status != 'R')
        )
        SELECT
          r.codeid,
          r.language,
          r.fullname,
          lang.language AS language_label,
          auth.authdesc AS authority
        FROM ranked r
        LEFT JOIN t_langs lang ON UPPER(IFNULL(lang.codelang, '')) = r.language
        LEFT JOIN t_authorities auth ON auth.idauth = r.authority_id
        WHERE r.lang_rank = 1;
      `,
      callback: (row) => {
        if (!row || row[0] == null) {
          return;
        }
        const codeId = Number(row[0]);
        const meta = metadataById.get(codeId);
        if (!meta) {
          return;
        }
        const language = row[1] ? String(row[1]).trim().toUpperCase() : "";
        const nameValue = row[2] ? String(row[2]).trim() : "";
        rows.push({
          code: meta.code,
          name: nameValue || meta.fallbackName || meta.code,
          language,
          dtcode: meta.dtcode,
          dtLabel: meta.dtLabel,
          languageLabel: row[3] ? String(row[3]).trim() : null,
          authority: row[4] ? String(row[4]).trim() : null,
          nameDe: meta.nameDe,
          nameEn: meta.nameEn,
          nameLa: meta.nameLa,
        });
        codesWithEntries.add(codeId);
      },
    });

    for (const meta of metadataById.values()) {
      if (codesWithEntries.has(meta.codeId)) {
        continue;
      }
      rows.push({
        code: meta.code,
        name: meta.fallbackName || meta.code,
        language: "",
        dtcode: meta.dtcode,
        dtLabel: meta.dtLabel,
        languageLabel: null,
        authority: null,
        nameDe: meta.nameDe,
        nameEn: meta.nameEn,
        nameLa: meta.nameLa,
      });
    }
    uniqueCodeCount = metadataById.size;
  } finally {
    remoteDb.close();
  }

  db.exec("BEGIN TRANSACTION");
  try {
    ensureLookupTables(db);
    db.exec("DELETE FROM lookup_eppo_codes");
    if (rows.length) {
      const stmt = db.prepare(
        `INSERT OR REPLACE INTO lookup_eppo_codes (
          code,
          name,
          language,
          dtcode,
          preferred,
          dt_label,
          language_label,
          authority,
          name_de,
          name_en,
          name_la
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const row of rows) {
        stmt
          .bind([
            row.code,
            row.name,
            row.language || "",
            row.dtcode,
            1,
            row.dtLabel,
            row.languageLabel,
            row.authority,
            row.nameDe,
            row.nameEn,
            row.nameLa,
          ])
          .step();
        stmt.reset();
      }
      stmt.finalize();
    }
    setMetaValue("lookup:eppo:lastImport", new Date().toISOString());
    setMetaValue("lookup:eppo:count", String(uniqueCodeCount || rows.length));
    db.exec("COMMIT");
    return { success: true, count: rows.length };
  } catch (error) {
    db.exec("ROLLBACK");
    console.error("EPPO-Lookup-Import fehlgeschlagen", error);
    throw error;
  }
}

async function importLookupBbch(payload = {}) {
  if (!db) throw new Error("Database not initialized");
  if (!sqlite3) throw new Error("SQLite not initialized");

  const { data } = payload;
  if (!data) {
    throw new Error("Keine Daten zum Importieren übergeben");
  }

  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const remoteDb = openDatabaseFromBytes(bytes);
  const rows = [];

  try {
    remoteDb.exec({
      sql: `
        SELECT * FROM (
          SELECT
            COALESCE(
              NULLIF(TRIM(bbch_code), ''),
              CASE
                WHEN principal_stage IS NOT NULL THEN printf('%02d%02d', principal_stage, IFNULL(secondary_stage, 0))
                ELSE NULL
              END
            ) AS code,
            TRIM(COALESCE(label_de, uri)) AS label,
            principal_stage,
            secondary_stage,
            definition_1,
            definition_2,
            kind
          FROM bbch_stage
        ) WHERE code IS NOT NULL
      `,
      callback: (row) => {
        if (!row || !row[0]) {
          return;
        }
        const definitionParts = [row[4], row[5]]
          .filter((part) => part && String(part).trim().length)
          .map((part) => String(part).trim());
        rows.push({
          code: row[0],
          label: row[1] || row[0],
          principal: row[2] != null ? Number(row[2]) : null,
          secondary: row[3] != null ? Number(row[3]) : null,
          definition: definitionParts.join("\n"),
          kind: row[6] || null,
        });
      },
    });
  } finally {
    remoteDb.close();
  }

  db.exec("BEGIN TRANSACTION");
  try {
    ensureLookupTables(db);
    db.exec("DELETE FROM lookup_bbch_stages");
    if (rows.length) {
      const stmt = db.prepare(
        `INSERT OR REPLACE INTO lookup_bbch_stages
        (code, label, principal_stage, secondary_stage, definition, kind)
        VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const row of rows) {
        stmt
          .bind([
            row.code,
            row.label,
            row.principal,
            row.secondary,
            row.definition || null,
            row.kind,
          ])
          .step();
        stmt.reset();
      }
      stmt.finalize();
    }
    setMetaValue("lookup:bbch:lastImport", new Date().toISOString());
    setMetaValue("lookup:bbch:count", String(rows.length));
    db.exec("COMMIT");
    return { success: true, count: rows.length };
  } catch (error) {
    db.exec("ROLLBACK");
    console.error("BBCH-Lookup-Import fehlgeschlagen", error);
    throw error;
  }
}

function searchEppoCodes(params = {}) {
  if (!db) throw new Error("Database not initialized");
  ensureLookupTables(db);

  const query = (params.query || "").trim();
  const limit = Math.min(Math.max(Number(params.limit) || 10, 1), 50);
  const offset = Math.max(Number(params.offset) || 0, 0);
  const languageParam = (params.language || "").trim().toUpperCase();
  const hasLanguageFilter = languageParam.length > 0;
  const results = [];

  if (hasLanguageFilter && languageParam === "DE") {
    return searchGermanEppoCodes({ query, limit, offset });
  }

  const selectClause = `
    SELECT
      code,
      name,
      dtcode,
      language,
      dt_label,
      language_label,
      authority,
      name_de,
      name_en,
      name_la
    FROM lookup_eppo_codes
  `;

  const languageCondition = "UPPER(IFNULL(language, '')) = ?";
  const appendLanguageFilter = (binds) => {
    if (hasLanguageFilter) {
      binds.push(languageParam);
    }
  };

  if (!query) {
    const whereClause = hasLanguageFilter ? `WHERE ${languageCondition}` : "";
    const rowBinds = [];
    appendLanguageFilter(rowBinds);
    rowBinds.push(limit, offset);

    db.exec({
      sql: `${selectClause}
        ${whereClause}
        ORDER BY name
        LIMIT ? OFFSET ?
      `,
      bind: rowBinds,
      callback: (row) => {
        results.push({
          code: row[0],
          name: row[1],
          dtcode: row[2] || null,
          language: row[3] || null,
          dtLabel: row[4] || null,
          languageLabel: row[5] || null,
          authority: row[6] || null,
          nameDe: row[7] || null,
          nameEn: row[8] || null,
          nameLa: row[9] || null,
        });
      },
    });

    const totalQuery = hasLanguageFilter
      ? `SELECT COUNT(*) FROM lookup_eppo_codes WHERE ${languageCondition}`
      : "SELECT COUNT(*) FROM lookup_eppo_codes";
    const totalBinds = [];
    appendLanguageFilter(totalBinds);
    const total = Number(db.selectValue(totalQuery, totalBinds)) || 0;
    return { rows: results, total };
  }

  const upper = query.toUpperCase();
  const likeTerm = `%${upper}%`;

  const whereParts = ["(code LIKE ? OR UPPER(name) LIKE ?)"];
  if (hasLanguageFilter) {
    whereParts.push(languageCondition);
  }
  const whereClause = `WHERE ${whereParts.join(" AND ")}`;

  const totalBinds = [likeTerm, likeTerm];
  appendLanguageFilter(totalBinds);
  const total =
    Number(
      db.selectValue(
        `SELECT COUNT(*) FROM lookup_eppo_codes ${whereClause}`,
        totalBinds
      )
    ) || 0;

  const rowBinds = [likeTerm, likeTerm];
  appendLanguageFilter(rowBinds);
  rowBinds.push(`${upper}%`, limit, offset);

  db.exec({
    sql: `${selectClause}
      ${whereClause}
      ORDER BY CASE WHEN code LIKE ? THEN 0 ELSE 1 END, name
      LIMIT ? OFFSET ?
    `,
    bind: rowBinds,
    callback: (row) => {
      results.push({
        code: row[0],
        name: row[1],
        dtcode: row[2] || null,
        language: row[3] || null,
        dtLabel: row[4] || null,
        languageLabel: row[5] || null,
        authority: row[6] || null,
        nameDe: row[7] || null,
        nameEn: row[8] || null,
        nameLa: row[9] || null,
      });
    },
  });

  return { rows: results, total };
}

function searchGermanEppoCodes(params = {}) {
  const query = (params.query || "").trim();
  const limit = Math.min(Math.max(Number(params.limit) || 10, 1), 50);
  const offset = Math.max(Number(params.offset) || 0, 0);
  const results = [];
  const germanSourceSql = getGermanLookupSelectSql();
  const germanTable = `(${germanSourceSql}) AS german_lookup`;

  if (!query) {
    db.exec({
      sql: `
        SELECT code, name, dtcode, language, dt_label, language_label, authority, name_de, name_en, name_la
        FROM ${germanTable}
        ORDER BY name
        LIMIT ? OFFSET ?
      `,
      bind: [limit, offset],
      callback: (row) => {
        if (!row) {
          return;
        }
        results.push({
          code: row[0],
          name: row[1],
          dtcode: row[2] || null,
          language: row[3] || "DE",
          dtLabel: row[4] || null,
          languageLabel: row[5] || "Deutsch",
          authority: row[6] || null,
          nameDe: row[7] || null,
          nameEn: row[8] || null,
          nameLa: row[9] || null,
        });
      },
    });
    const total =
      Number(
        db.selectValue(
          `SELECT COUNT(*) FROM (${germanSourceSql}) AS german_lookup`
        )
      ) || 0;
    return { rows: results, total };
  }

  const upper = query.toUpperCase();
  const likeTerm = `%${upper}%`;
  const total =
    Number(
      db.selectValue(
        `SELECT COUNT(*) FROM ${germanTable} WHERE code LIKE ? OR UPPER(name) LIKE ?`,
        [likeTerm, likeTerm]
      )
    ) || 0;

  const rowBinds = [likeTerm, likeTerm, `${upper}%`, limit, offset];

  db.exec({
    sql: `
      SELECT code, name, dtcode, language, dt_label, language_label, authority, name_de, name_en, name_la
      FROM ${germanTable}
      WHERE code LIKE ? OR UPPER(name) LIKE ?
      ORDER BY CASE WHEN code LIKE ? THEN 0 ELSE 1 END, name
      LIMIT ? OFFSET ?
    `,
    bind: rowBinds,
    callback: (row) => {
      if (!row) {
        return;
      }
      results.push({
        code: row[0],
        name: row[1],
        dtcode: row[2] || null,
        language: row[3] || "DE",
        dtLabel: row[4] || null,
        languageLabel: row[5] || "Deutsch",
        authority: row[6] || null,
        nameDe: row[7] || null,
        nameEn: row[8] || null,
        nameLa: row[9] || null,
      });
    },
  });

  return { rows: results, total };
}

function listLookupLanguages() {
  if (!db) throw new Error("Database not initialized");
  ensureLookupTables(db);

  const languages = [];
  db.exec({
    sql: `
      SELECT
        UPPER(IFNULL(language, '')) AS language_code,
        MAX(language_label) AS language_label,
        COUNT(*) AS entry_count
      FROM lookup_eppo_codes
      GROUP BY UPPER(IFNULL(language, ''))
      ORDER BY CASE WHEN language_code = '' THEN 0 ELSE 1 END, language_code;
    `,
    callback: (row) => {
      if (!row) {
        return;
      }
      const language = row[0] ? String(row[0]).trim().toUpperCase() : "";
      const label = row[1] ? String(row[1]).trim() : null;
      const count = row[2] != null ? Number(row[2]) : 0;
      languages.push({ language, label, count });
    },
  });

  const germanCount =
    Number(
      db.selectValue(
        `SELECT COUNT(*) FROM (${getGermanLookupSelectSql()}) AS german_lookup`
      )
    ) || 0;
  if (germanCount > 0) {
    const existingGerman = languages.find(
      (entry) => (entry.language || "").toUpperCase() === "DE"
    );
    if (existingGerman) {
      const normalizedLabel = existingGerman.label
        ? existingGerman.label.trim()
        : "";
      existingGerman.label = normalizedLabel || "Deutsch";
      existingGerman.count = germanCount;
    } else {
      languages.push({ language: "DE", label: "Deutsch", count: germanCount });
    }
  }

  languages.sort((a, b) => {
    const score = (code) => (code === "" ? 0 : 1);
    const delta = score(a.language || "") - score(b.language || "");
    if (delta !== 0) {
      return delta;
    }
    return (a.language || "").localeCompare(b.language || "");
  });

  return languages.map((entry) => {
    const language = entry.language || "";
    const label =
      entry.label && entry.label.length
        ? entry.label
        : language || "Ohne Sprachcode";
    return {
      language,
      label,
      count: entry.count,
    };
  });
}

function getGermanLookupSelectSql() {
  return `
    SELECT
      code,
      name,
      dtcode,
      language,
      dt_label,
      language_label,
      authority,
      name_de,
      name_en,
      name_la
    FROM lookup_eppo_codes
    WHERE UPPER(IFNULL(language, '')) = 'DE'
    UNION ALL
    SELECT
      code,
      name_de AS name,
      dtcode,
      'DE' AS language,
      dt_label,
      'Deutsch' AS language_label,
      authority,
      name_de,
      name_en,
      name_la
    FROM lookup_eppo_codes
    WHERE TRIM(IFNULL(name_de, '')) <> ''
      AND UPPER(IFNULL(language, '')) <> 'DE'
  `;
}

function searchBbchStages(params = {}) {
  if (!db) throw new Error("Database not initialized");
  ensureLookupTables(db);

  const query = (params.query || "").trim();
  const limit = Math.min(Math.max(Number(params.limit) || 10, 1), 50);
  const offset = Math.max(Number(params.offset) || 0, 0);
  const results = [];
  const orderClause = "ORDER BY label";

  if (!query) {
    db.exec({
      sql: `
        SELECT code, label, principal_stage, secondary_stage, definition, kind
        FROM lookup_bbch_stages
        ${orderClause}
        LIMIT ? OFFSET ?
      `,
      bind: [limit, offset],
      callback: (row) => {
        results.push({
          code: row[0],
          label: row[1],
          principalStage: row[2] != null ? Number(row[2]) : null,
          secondaryStage: row[3] != null ? Number(row[3]) : null,
          definition: row[4] || null,
          kind: row[5] || null,
        });
      },
    });
    const total =
      Number(db.selectValue("SELECT COUNT(*) FROM lookup_bbch_stages")) || 0;
    return { rows: results, total };
  }

  const likeTerm = `%${query.toUpperCase()}%`;
  const total =
    Number(
      db.selectValue(
        `SELECT COUNT(*) FROM lookup_bbch_stages WHERE code LIKE ? OR UPPER(label) LIKE ?`,
        [likeTerm, likeTerm]
      )
    ) || 0;
  db.exec({
    sql: `
      SELECT code, label, principal_stage, secondary_stage, definition, kind
      FROM lookup_bbch_stages
      WHERE code LIKE ? OR UPPER(label) LIKE ?
      ${orderClause}
      LIMIT ? OFFSET ?
    `,
    bind: [likeTerm, likeTerm, limit, offset],
    callback: (row) => {
      results.push({
        code: row[0],
        label: row[1],
        principalStage: row[2] != null ? Number(row[2]) : null,
        secondaryStage: row[3] != null ? Number(row[3]) : null,
        definition: row[4] || null,
        kind: row[5] || null,
      });
    },
  });

  return { rows: results, total };
}

function getLookupStats() {
  if (!db) throw new Error("Database not initialized");
  ensureLookupTables(db);

  const eppoCount =
    Number(db.selectValue("SELECT COUNT(*) FROM lookup_eppo_codes")) || 0;
  const bbchCount =
    Number(db.selectValue("SELECT COUNT(*) FROM lookup_bbch_stages")) || 0;

  return {
    eppo: {
      count: eppoCount,
      lastImport: getMetaValue("lookup:eppo:lastImport"),
    },
    bbch: {
      count: bbchCount,
      lastImport: getMetaValue("lookup:bbch:lastImport"),
    },
  };
}

async function diagnoseBvlSchema() {
  if (!db) throw new Error("Database not initialized");

  const schema = {};
  const tables = [
    "bvl_mittel",
    "bvl_awg",
    "bvl_awg_kultur",
    "bvl_awg_schadorg",
    "bvl_awg_aufwand",
    "bvl_awg_wartezeit",
    "bvl_meta",
    "bvl_sync_log",
    "bvl_lookup_kultur",
    "bvl_lookup_schadorg",
  ];

  for (const table of tables) {
    schema[table] = {
      columns: [],
      indices: [],
    };

    // Get column info
    db.exec({
      sql: `PRAGMA table_info(${table})`,
      callback: (row) => {
        schema[table].columns.push({
          cid: row[0],
          name: row[1],
          type: row[2],
          notnull: row[3],
          dflt_value: row[4],
          pk: row[5],
        });
      },
    });

    // Get indices
    db.exec({
      sql: `PRAGMA index_list(${table})`,
      callback: (row) => {
        schema[table].indices.push({
          seq: row[0],
          name: row[1],
          unique: row[2],
          origin: row[3],
          partial: row[4],
        });
      },
    });
  }

  const userVersion = db.selectValue("PRAGMA user_version");

  return {
    user_version: userVersion,
    tables: schema,
  };
}
