# Persistenz- und Datenmodell-Plan

> Gilt für die neutrale Anwendung **Pflanzenschutz-Aufzeichnung**.

## 1. Status quo (Stand November 2025)

| Bereich           | Tabellen / Strukturen                                                               | Inhalt                                                                    | Bemerkungen                                                                  |
| ----------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Metadaten         | `meta`                                                                              | Key/Value (`version`, `company`, `defaults`, `fieldLabels`, …)            | JSON-Werte als Text gespeichert                                              |
| Methoden & Mittel | `measurement_methods`, `mediums`                                                    | Stammdaten für Berechnung (Methode, Einheit, Faktor)                      | Methoden-Konfiguration bislang statisch                                      |
| Historie          | `history`, `history_items`                                                          | Berechnungskopf (Header JSON) + Detailzeilen (payload JSON pro Medium)    | Header enthält feste Felder (`ersteller`, `standort`, `kultur`, `kisten`, …) |
| BVL-Daten         | Diverse `bvl_*` Tabellen (Meta, Mittel, AWG, Lookup, Sync Log) + `bvl_api_payloads` | Vollständiger Import der amtlichen Datensätze, Synchronisationsprotokolle | Eigene Domäne, darf vom Template-Refactoring unbeeinflusst bleiben           |
| Storage-Formate   | SQLite-Binärdatei (OPFS / File API), JSON-Snapshot (Export), LocalStorage-Fallback  | Snapshot enthält identischen Aufbau wie DB                                | Kein Trennungsmerkmal zwischen BVL- und Anwenderdaten                        |

### Ableitungen

- Historieneinträge sind fest auf die bestehenden Formularfelder ausgerichtet; freie Felder sind nicht möglich.
- Templates existieren nicht als Entität; Labels und Defaults sind im `meta` JSON verschachtelt.
- Backups/Exporte bilden den kompletten Zustand ab – gezielte Zeitraumauswahl oder Zusammenführung mehrerer Dateien nur manuell möglich.
- Datenschutz/Nachweispflicht: Es gibt keinen Mechanismus zur Nachverfolgung, wann Daten angelegt/geändert/gelöscht wurden.

## 2. Ziel-Anforderungen

1. **Flexible Templates**
   - User definieren beliebig viele Felder (Typen: Label, Zahl, Text; später erweiterbar) + Layout (Position, Größe, Layer).
   - Templates versionierbar; Änderungen nachvollziehbar (Audit / Änderungsverlauf).
2. **Datenerfassung**
   - Anwendungen speichern Werte als `{ templateId, fieldId -> value }` plus Pflicht-Metadaten (Zeit, Benutzer, Notizen).
   - Struktur muss langlebig und maschinenlesbar sein (min. 3 Jahre).
3. **Merge/Export**
   - Backups sollen teilbare JSON/ZIP-Dateien sein.
   - Merge-Funktion muss mehrere Backups (z. B. unterschiedliche Zeiträume) verlustfrei zusammenführen können.
   - Exportfilter: Zeitraum, Template, Felder, optional BVL-Referenzen.
4. **Trennung der Domänen**
   - BVL-Stammdaten bleiben unabhängig von Anwender-daten (keine Kaskaden beim Merge).
5. **Integrität**
   - Prüfsummen (SHA-256) pro Backup/Export.
   - Möglichkeit zur optionalen Signatur und Audit-Log (wer hat exportiert, wann).

## 3. Vorgeschlagene Schema-Erweiterungen

```mermaid
erDiagram
    templates ||--o{ template_fields : enthält
    templates {
        string id PK
        string name
        string description
        int version
        string created_at
        string updated_at
        string layout_json   // Grid, Raster, Toolbar-Einstellungen
        string metadata_json // z. B. Theme, Papierformat
    }
    template_fields {
        string id PK
        string template_id FK
        string type
        string name
        string label
        string placeholder
        bool required
        string validation_json
        string default_value
        string layout_json    // Position, size, layer
        string print_styles   // Schrift, Formatierungen
        int ordinal           // Reihenfolge (Fallback)
        string created_at
        string updated_at
    }
    template_history {
        integer id PK
        string template_id FK
        int version
        string diff_json      // Unterschiede zur Vorversion
        string created_at
    }
    application_records ||--o{ application_values : enthält
    application_records {
        string id PK
        string template_id FK
        string template_version
        string created_at
        string created_by
        string updated_at
        string metadata_json  // z. B. Notizen, Standort-Infos außerhalb der Felder
        string export_hash    // Letzte Export-Prüfsumme
    }
    application_values {
        integer id PK
        string record_id FK
        string field_id       // verweist auf template_fields.id
        string value_text
        real value_number
        string value_json     // für komplexere Typen später
    }
    backups {
        integer id PK
        string filename
        string hash
        string created_at
        string metadata_json  // Quelle, Zeitraum, Notizen
    }
    exports {
        integer id PK
        string hash
        string filters_json
        string created_at
        string created_by
        string file_path
    }
```

### Übergangsregeln

- Bestehende History-Daten werden in `application_records` migriert:
  - Für jeden Datensatz wird automatisch ein Default-Template erzeugt (`default-template-v1`).
  - Die bisherigen Header-Felder werden als `template_fields` mit fixem Layout aufgenommen.
- `history_items` werden in `application_values` überführt (Mapping Mittel-ID → Field-ID).
- `meta.fieldLabels` und `defaults.form` werden auf das neue Template migriert.

## 4. Migration (Stufe 1 → 3)

| Stufe           | Ziel                                                               | Maßnahmen                                                                                 |
| --------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| 1. Vorbereitend | Schema erweitern, alte Funktionen weiter nutzbar                   | Neue Tabellen anlegen, Migrations-Skripte vorbereiten, State-Management kompatibel halten |
| 2. Double-Write | Neue UI schreibt in neues Format, liest aber bei Bedarf alte Daten | Formulare speichern parallel in `application_records`; Export nutzt neue Struktur         |
| 3. Umschalten   | Legacy-Struktur wird entfernt/ eingefroren                         | Historie-Feature liest nur noch neues Format, alte Tabellen optional archiviert           |

## 5. Auswirkungen auf Frontend-APIs

| Modul                             | Anpassung                                                                                                                           |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `core/database.ts`                | Neue CRUD-Methoden für Templates, Records, Backups, Exporte (z. B. `listTemplates`, `saveTemplate`, `listRecords`, `mergeBackups`). |
| `core/state.ts`                   | Neues Slice für Templates (`templates`, `activeTemplateId`, `templateEditorState`), Records, Export-Status.                         |
| `core/storage/sqlite.ts` & Worker | SQL-Statements ergänzen, Migrationen hinzufügen, Query-Helper für neue Tabellen.                                                    |
| `features/calculation`            | Formular-Rendering auf Template-Definition umstellen, History-API refaktorisieren.                                                  |
| `features/history`                | Anzeige neu strukturieren (Zeitstrahl, Filter), `application_records` verwenden.                                                    |
| `features/reporting/print`        | Rendering-Engine auf Layout-JSON aufbauen.                                                                                          |
| `features/settings`               | Template-Verwaltung + globale Optionen (Theme).                                                                                     |
| `features/merge-export` (neu)     | UI + API-Aufrufe für Backups, Merge, Export.                                                                                        |

## 6. Offene Fragen / ToDos

- Benutzerkonzept: Muss gespeichert werden, wer einen Datensatz angelegt hat? (Aktuell keine Accounts → optionaler Textinput "Erfasst von" pro Record.)
- Versionsspeicherung: Reicht `template_version` als `int` oder braucht es semantische Versionen (major/minor)?
- Aufbewahrungspflicht: Braucht es automatisierte Erinnerungen / Löschkonzepte nach 3 Jahren? (Derzeit nicht geplant.)
- Signaturen: Welche Verfahren reichen Behörden? Planung für spätere Erweiterung.

---

Dieses Dokument deckt Schritt 1.1 bis 1.3 der Task-Liste ab und dient als Grundlage für die Umsetzung der weiteren Schritte.
