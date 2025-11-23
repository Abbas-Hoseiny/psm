# SQLite-Schema-Update (Version 4 → 5)

> Zielsystem: Datenhaltung der Anwendung **Pflanzenschutz-Aufzeichnung**.

> Arbeitsgrundlage für Schritt 1.3 der Task-Liste

## 1. Versionsstrategie

- `PRAGMA user_version` wird von aktuell `3` auf `5` angehoben.
- Migration erfolgt in zwei Etappen:
  1. `user_version = 4`: Anlage der neuen Tabellen (Templates, Application Records, Backups, Exports) ohne bestehende Daten anzufassen.
  2. `user_version = 5`: Einführung von Views und Hilfs-Indices, Anpassung des JSON-Snapshots und Vorbereitung für Double-Write der neuen UI.
- Alte Tabellen (`history`, `history_items`) bleiben vorerst bestehen; eine spätere Version `6` entfernt sie nach erfolgreicher Umschaltung.

## 2. Neue Tabellen & Indizes

```sql
-- 1) Template-Definitionen
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  layout_json TEXT NOT NULL,
  metadata_json TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS template_fields (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  label TEXT NOT NULL,
  placeholder TEXT DEFAULT '',
  required INTEGER DEFAULT 0,
  validation_json TEXT DEFAULT '{}',
  default_value TEXT,
  layout_json TEXT NOT NULL,
  print_styles TEXT DEFAULT '{}',
  ordinal INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_template_fields_template
  ON template_fields(template_id, ordinal);

CREATE TABLE IF NOT EXISTS template_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  diff_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 2) Anwendungserfassungen
CREATE TABLE IF NOT EXISTS application_records (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES templates(id),
  template_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT DEFAULT '',
  updated_at TEXT NOT NULL,
  metadata_json TEXT DEFAULT '{}',
  export_hash TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS application_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id TEXT NOT NULL REFERENCES application_records(id) ON DELETE CASCADE,
  field_id TEXT NOT NULL,
  value_text TEXT,
  value_number REAL,
  value_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_application_values_record
  ON application_values(record_id);

CREATE INDEX IF NOT EXISTS idx_application_values_field
  ON application_values(field_id);

-- 3) Backups & Exporte
CREATE TABLE IF NOT EXISTS backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  metadata_json TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS exports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hash TEXT NOT NULL,
  filters_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT DEFAULT '',
  file_path TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_exports_created_at
  ON exports(created_at DESC);
```

### Zusätzliche Views

```sql
CREATE VIEW IF NOT EXISTS vw_template_with_fields AS
SELECT
  t.id AS template_id,
  t.name,
  t.version,
  json_group_array(
    json_object(
      'id', f.id,
      'type', f.type,
      'name', f.name,
      'label', f.label,
      'layout', f.layout_json,
      'required', f.required,
      'ordinal', f.ordinal
    )
  ) AS fields_json
FROM templates t
LEFT JOIN template_fields f ON f.template_id = t.id
GROUP BY t.id;
```

Die View erleichtert Ladeoperationen im Worker ohne mehrere Roundtrips.

## 3. Migration (user_version 3 → 4)

```sql
BEGIN TRANSACTION;

-- Tabellen anlegen (siehe Abschnitt 2)
-- ...

PRAGMA user_version = 4;
COMMIT;
```

## 4. Migration (user_version 4 → 5)

```sql
BEGIN TRANSACTION;

-- Hilfs-Indices/View sicherstellen
-- ...

-- Snapshot-Metadaten vorbereiten
INSERT INTO meta(key, value)
SELECT 'templates_initialized', 'false'
WHERE NOT EXISTS (SELECT 1 FROM meta WHERE key = 'templates_initialized');

INSERT INTO meta(key, value)
SELECT 'application_records_initialized', 'false'
WHERE NOT EXISTS (SELECT 1 FROM meta WHERE key = 'application_records_initialized');

PRAGMA user_version = 5;
COMMIT;
```

> Die Flags dienen dem Worker zur Steuerung, ob eine automatische Migration (Default-Template erzeugen, History portieren) bereits durchgeführt wurde.

## 5. JSON-Snapshot-Erweiterung

Neues Exportformat (oberer Level):

```json
{
  "meta": { ... },
  "templates": [
    {
      "id": "tpl-001",
      "name": "Standard",
      "version": 2,
      "layout": { ... },
      "metadata": { ... },
      "fields": [
        {
          "id": "fld-001",
          "type": "number",
          "name": "kisten",
          "label": "Anzahl Kisten",
          "placeholder": "",
          "required": true,
          "validation": { "min": 0 },
          "defaultValue": null,
          "layout": { ... },
          "printStyles": { ... },
          "ordinal": 1
        }
      ],
      "history": [
        {
          "version": 1,
          "diff": { ... },
          "createdAt": "2025-11-12T08:00:00Z"
        }
      ]
    }
  ],
  "applicationRecords": [
    {
      "id": "rec-20251112-001",
      "templateId": "tpl-001",
      "templateVersion": 2,
      "createdAt": "2025-11-12T09:15:00Z",
      "createdBy": "Max Mustermann",
      "updatedAt": "2025-11-12T09:20:00Z",
      "metadata": { "notes": "Abendspritze" },
      "exportHash": null,
      "values": [
        {
          "fieldId": "fld-001",
          "valueText": "42",
          "valueNumber": 42,
          "valueJson": null
        }
      ]
    }
  ],
  "backups": [ ... ],
  "exports": [ ... ],
  "bvl": { ... }
}
```

- Historische Struktur (`history`, `history_items`) bleibt für Rückwärtskompatibilität enthalten, bis Version 6 aktiv wird.
- Neue Exporte enthalten sowohl alte als auch neue Bereiche, solange Double-Write aktiv ist.

## 6. Worker-Anpassungen

- `initDatabase` prüft `user_version` und ruft die entsprechenden Migrationen.
- Neue Helper-Methoden:
  - `listTemplates`, `getTemplateById`, `saveTemplate`, `deleteTemplate`
  - `listApplicationRecords`, `saveApplicationRecord`, `deleteApplicationRecord`
  - `createBackupEntry`, `listBackups`, `saveExportLog`
- Snapshots: `exportSnapshot` ergänzt neue Arrays, `importSnapshot` schreibt in die neuen Tabellen.

## 7. Folgearbeiten

- Skripte/Tests für die Migration (`sqliteWorker.mjs` Unit Tests).
- Dokumentation (README, Architektur) aktualisieren.
- Plan für Version 6 (Entfernung der Legacy-Tabellen) vorbereiten.
