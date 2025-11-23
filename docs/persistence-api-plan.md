# Persistenz-API-Plan

> Rahmen: Neutral geführte Anwendung **Pflanzenschutz-Aufzeichnung**.

> Ergänzung zu `persistence-plan.md` und `sqlite-schema-update.md`. Ziel: konkrete Anpassungen an Frontend-APIs (Schritt 1.4 der Task-Liste).

## 1. State-Slice-Erweiterungen

```typescript
interface TemplateField {
  id: string;
  templateId: string;
  type: "label" | "number" | "text";
  name: string; // technische Kennung
  label: string;
  placeholder: string;
  required: boolean;
  validation: Record<string, unknown>;
  defaultValue: string | number | null;
  layout: LayoutConfig; // Raster, Position, Größe, Layer
  printStyles: Record<string, unknown>;
  ordinal: number;
  createdAt: string;
  updatedAt: string;
}

interface TemplateDefinition {
  id: string;
  name: string;
  description: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  layout: LayoutMeta; // A4, Raster etc.
  metadata: Record<string, unknown>;
  fields: TemplateField[];
  history: TemplateHistoryEntry[];
}

interface ApplicationValue {
  fieldId: string;
  valueText?: string | null;
  valueNumber?: number | null;
  valueJson?: unknown;
}

interface ApplicationRecord {
  id: string;
  templateId: string;
  templateVersion: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
  exportHash: string | null;
  values: ApplicationValue[];
}

interface BackupEntry {
  id: number;
  filename: string;
  hash: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}

interface ExportLog {
  id: number;
  hash: string;
  filters: Record<string, unknown>;
  createdAt: string;
  createdBy: string;
  filePath: string;
}

interface AppState {
  // bestehende Slices …
  templates: {
    items: TemplateDefinition[];
    activeTemplateId: string | null;
    editorState: EditorTransientState; // Ausgewähltes Feld, Undo-Stack …
    loading: boolean;
  };
  applicationRecords: {
    items: ApplicationRecord[];
    activeRecordId: string | null;
    filters: RecordFilterState;
    loading: boolean;
  };
  backups: BackupEntry[];
  exports: ExportLog[];
}
```

### Transiente Editor-Daten

- Nicht persistente Informationen (z. B. selektierte Felder, Raster-Einstellungen) liegen im State, werden aber nicht in SQLite gespeichert.

## 2. Public API (`core/database.ts`)

| Funktion                                 | Zweck                                                                    | Bemerkungen                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `applyDatabase(snapshot)`                | Bestehende Funktion → um Templates/Records erweitern                     | History-Liste durch neue Struktur ersetzen                              |
| `getDatabaseSnapshot()`                  | Snapshot inkl. Templates, Records, Backups, Exports                      | Double-Write: solange Legacy-Daten existieren, beide Strukturen liefern |
| `listTemplates()`                        | State-Selector; `templates.items` bereits geladen? sonst Worker anfragen | Rückgabe: `TemplateDefinition[]`                                        |
| `getTemplateById(id)`                    | Einzelne Vorlage inkl. Fields/History                                    |                                                                         |
| `saveTemplate(template)`                 | Upsert; legt neue Version an (version++), erzeugt History-Eintrag        | Worker-Funktion `saveTemplate` verwenden                                |
| `deleteTemplate(id)`                     | Löscht Template + Felder + History                                       | Vor dem Löschen prüfen, ob Records existieren                           |
| `duplicateTemplate(id, overrides)`       | Hilfsfunktion für UI                                                     |                                                                         |
| `listApplicationRecords(filters)`        | Zeit-/Template-Filter; optional Paginierung                              | Worker `listApplicationRecords`                                         |
| `saveApplicationRecord(record)`          | Upsert; speichert Werte; aktualisiert `export_hash=null`                 |                                                                         |
| `deleteApplicationRecord(id)`            | Löscht Record + Werte                                                    |                                                                         |
| `mergeApplicationRecords(sourceRecords)` | Client-seitiger Merge (z. B. beim Import ohne SQLite)                    |                                                                         |
| `listBackups()`                          | Liste aus `backups`-Tabelle                                              |                                                                         |
| `createBackupEntry(metadata)`            | Speichert neue Backup-Metadaten nach erfolgreichem Export                |                                                                         |
| `removeBackup(id)`                       | Entfernt Eintrag                                                         |                                                                         |
| `listExportLogs()`                       | `exports`-Tabelle                                                        |                                                                         |
| `appendExportLog(log)`                   | Beim Export aufrufen                                                     |                                                                         |

## 3. Storage-Layer (`core/storage/sqlite.ts` + Worker)

### Neue Worker-Actions

| Action                    | Payload                                  | Ergebnis                           |
| ------------------------- | ---------------------------------------- | ---------------------------------- |
| `listTemplates`           | `{ includeHistory?: boolean }`           | Liste Templates + Felder           |
| `getTemplate`             | `{ id }`                                 | Template-Objekt                    |
| `saveTemplate`            | `{ template, fields, diff }`             | `{ id, version }`                  |
| `deleteTemplate`          | `{ id }`                                 | `void`                             |
| `listApplicationRecords`  | `{ filters }`                            | `{ records: ApplicationRecord[] }` |
| `saveApplicationRecord`   | `{ record }`                             | `{ id }`                           |
| `deleteApplicationRecord` | `{ id }`                                 | `void`                             |
| `mergeBackups`            | `{ files: Snapshot[] }`                  | `{ mergedSnapshot }`               |
| `listBackups`             | `void`                                   | `BackupEntry[]`                    |
| `saveBackupEntry`         | `{ filename, hash, metadata }`           | `{ id }`                           |
| `deleteBackupEntry`       | `{ id }`                                 | `void`                             |
| `listExportLogs`          | `void`                                   | `ExportLog[]`                      |
| `saveExportLog`           | `{ hash, filters, createdBy, filePath }` | `{ id }`                           |

### Anpassungen bestehender Methoden

- `importSnapshot`/`exportSnapshot` → neues Format lesen/schreiben.
- `appendHistoryEntry`/`listHistory` → Legacy-Code beibehalten, aber Aufrufstellen perspektivisch entfernen.
- Migrationstrigger im Worker: nach `user_version`-Update Prüfen der Meta-Flags (`templates_initialized`, `application_records_initialized`) und ggf. automatische Migration start.

## 4. Event- und State-Verknüpfung

- Neue Events definieren: `templates:updated`, `records:updated`, `backups:updated`, `exports:updated`.
- `state.ts`: Helper `setTemplates`, `upsertTemplate`, `removeTemplate`, analog für Records, Backups, Exports.
- Vorlagendesigner sendet nach Save → `emit('templates:updated', templateId)`; Berechnungsbereich reagiert und lädt geänderte Strukturen nach.

## 5. Zusammenfassung Double-Write Phase

1. Beim Laden vorhandener DB:
   - Falls `templates_initialized=false`: Default-Template aus Legacy-Daten erzeugen, `true` setzen.
   - Legacy `history` in `application_records` kopieren, Flag setzen.
2. Solange UI noch altes Formular nutzt, schreiben wir History sowohl nach `history` als auch `application_records` (Hilfsfunktion `saveCompatHistory`).
3. Nach Abschluss der UI-Migration deaktivieren wir Legacy-Schreibpfade.

## 6. Nächste Schritte

1. SQLite-Worker um Actions + SQL erweitern (`sqliteWorker.js`).
2. `core/storage/sqlite.ts` Methoden implementieren.
3. `core/database.ts` refaktorieren.
4. `core/state.ts` neue Slices und Actions ergänzen.
5. Alte Features (History, Reporting) temporär auf neue API spiegeln.

Dieses Dokument dient als Blaupause für die Implementierung der Persistenz-Anpassungen.
