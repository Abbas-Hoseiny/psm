# Task: "All in SQLite" Migration

## Zielsetzung

Alle persistenten Datenbereiche – außer Lookup- und Zulassungs-Caches – sollen direkt in `pflanzenschutz.sqlite` geschrieben und daraus gelesen werden. Browser-Lokalspeicher und JSON-Snapshots dienen nur noch als Import/Export-Formate, nicht als Primärspeicher. Gleichzeitig darf kein Feature versehentlich komplette Tabellen in den Browser-Speicher laden.

## Arbeitspakete & Checks

### 1. Bestandsaufnahme & Datenfluss-Dokumentation

- [x] **Inventar anlegen**: Für jeden Bereich (Calculation, History, Reporting, Documentation/Archive, Settings, Company/Defaults, Mediums & Profiles, Starfield, GPS, Import/Export, Misc UI) den aktuellen Speicherpfad notieren (`getDatabaseSnapshot`, LocalStorage, SQLite-Worker etc.).
- [x] **Nebenwirkungen erfassen**: Prüfen, welche Module State-Slices wie `state.history`/`state.mediums` direkt konsumieren (z. B. Print, Reporting, Import-Duplikatprüfung) und ob sie Full-Loads voraussetzen.
- [x] **Konflikte flaggen**: Alte Logik wie `saveDatabase(snapshot)` oder `applyDatabase` markieren, damit später entschieden wird, ob sie entfallen oder nur noch für Imports genutzt werden.

#### Ergebnis Bestandsaufnahme (24.11.2025)

| Bereich                                               | Aktuelle Speicherung & Pfad                                                                                                                                                                                                 | Hauptkonsumenten / Nebenwirkungen                                                                                                                 | Konflikte & benötigte Worker-APIs                                                                                                                                                                            |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Calculation → History Save                            | `persistHistory` in `src/scripts/features/calculation/index.ts` schreibt über `getDatabaseSnapshot` → `saveDatabase`; komplette History liegt parallel in `state.history`.                                                  | History-/Reporting-Module erwarten synchrone `state.history` Arrays; Druck-Funktionen (`printEntriesChunked`) ziehen sofort alles in den Browser. | Neuer Worker-Call `appendHistoryEntry` + paginierte Loader (`listHistoryEntriesPaged`). UI-State darf nur letzte Berechnung halten; History muss via Worker-queries laufen, sonst bleibt Full-Load bestehen. |
| History UI                                            | `src/scripts/features/history/index.ts` rendert direkt aus `state.history`; Löschen entfernt Array-Eintrag und ruft erneut `saveDatabase`.                                                                                  | Virtualliste reduziert DOM, aber nicht RAM; Export/Print lädt immer alle Items.                                                                   | Braucht Cursor-basierte Loader (limit/offset) + Events vom Worker. State hält nur sichtbaren Ausschnitt + Auswahl.                                                                                           |
| Reporting                                             | `src/scripts/features/reporting/index.ts` filtert `state.history`; keine eigenen Worker-Abfragen.                                                                                                                           | Jeder Filterlauf kopiert die komplette History in `currentEntries`, was bei >5k Einträgen teuer wird.                                             | Reporting muss `listHistoryEntries` mit Datumsfiltern direkt im Worker nutzen; History-Cache nur für aktuelle Seite.                                                                                         |
| Documentation/Archive                                 | Mischung aus Worker (`listHistoryEntries`, `exportHistoryRange`) und altem Snapshot-Speicher (`persistHistoryChanges` wenn Treiber ≠ sqlite). `state.history` wird weiterhin beschnitten (`pruneStateHistoryBySignatures`). | Archive-UI funktioniert nur zuverlässig, wenn `state.history` aktuell ist; sonst bleiben Karten sichtbar.                                         | Sobald alle Bereiche SQLite nutzen, `persistHistoryChanges` entfernen und State-Synchronisierung auf gezielte Fetches umstellen (`loadArchiveLogs(limit)`).                                                  |
| Settings (Mediums, MeasurementMethods)                | `src/scripts/features/settings/index.ts` hält alle Mittel/Methoden im State und speichert über `saveDatabase`.                                                                                                              | Calculation, History, Reporting, Import (Duplikat-Hinweise) greifen direkt auf `state.mediums` und `state.measurementMethods` zu.                 | Worker-CRUD (`listMediums`, `upsertMedium`, `deleteMedium`, `listMeasurementMethods`) + Cache-Schicht, die nur sichtbare Zeilen hält.                                                                        |
| Medium Profiles                                       | Ebenfalls State-Arrays + Snapshot-Speicher (`settings/index.ts`).                                                                                                                                                           | Calculation lädt jedes Profil in die Selectbox; Profile enthalten `mediumIds`, müssen daher konsistent mit Mediums bleiben.                       | Worker-Relationstabelle `medium_profile_items`; API `upsertMediumProfile`, `listProfiles`, `deleteProfile`. State nur als Auswahl-Cache.                                                                     |
| Company/Defaults/Field Labels                         | `applyDatabase` (`src/scripts/core/database.ts`) kopiert JSON-Meta in `state.company`, `state.defaults`, `state.fieldLabels`; Settings-Formulare schreiben State + Snapshot.                                                | Alle Formulare greifen synchron auf State zu (z. B. Calculation-Form defaults, Print-Header).                                                     | Benötigt Settings-Worker (`loadMeta`, `updateCompany`, `updateDefaults`, `updateFieldLabels`) + Broadcast an State nach erfolgreichem Write.                                                                 |
| Import/Export                                         | `src/scripts/features/importMerge/index.ts` lädt ZIP→Snapshot, mapt ins State und ruft `saveDatabase`; Duplicate-Check geht schon via Worker (`exportHistoryRange`).                                                        | Während Import werden komplette Medium-/History-Listen in Memory gehalten, was bei großen Dateien teuer ist.                                      | Import muss Worker-Bulk-Inserts nutzen (`insertHistoryEntries`, `upsertMediums`) + anschließendes `persistSqliteDatabaseFile`. Snapshot-Code nur noch für Legacy-JSON-Imports.                               |
| GPS                                                   | `src/scripts/core/database.ts` + `workerUpsertGpsPoint` persistieren bereits direkt in SQLite; State ist nur Cache.                                                                                                         | Dient als Blaupause für andere Domains (optimistische Updates, Worker-IDs, selektives Laden).                                                     | Keine Konflikte – lediglich API-Signaturen als Referenz für neue CRUD-Endpunkte nutzen.                                                                                                                      |
| Lookup/Zulassung Caches                               | `src/scripts/core/bvlDataset.ts` verwendet LocalStorage für Manifest-URL und Keep-Alive; Zulassungssync speichert Daten in Indexed Fallback.                                                                                | Vom Scope ausgenommen, deshalb unverändert lassen.                                                                                                | Sicherstellen, dass neue Boot-Migration diese Keys nicht anfasst.                                                                                                                                            |
| UI/Ephemerals (calcContext, notifications, starfield) | Liegen ausschließlich im In-Memory-State, keine Persistenz.                                                                                                                                                                 | Keine Auswirkungen auf SQLite-Migration.                                                                                                          | Unverändert lassen; nur darauf achten, dass sie nicht versehentlich in Snapshots landen.                                                                                                                     |

**Zusätzliche Beobachtungen**

- `applyDatabase` und `getDatabaseSnapshot` (`src/scripts/core/database.ts`) sind aktuell Dreh- und Angelpunkt sämtlicher Persistenz. Nach der Migration sollen sie nur noch Import/Export bedienen, sonst drohen Doppelquellen.
- Mehrere Module (Calculation, History, Documentation) prüfen `getActiveDriverKey` und behandeln Nicht-SQLite-Fälle unterschiedlich. In einer „all in SQLite“-Welt können diese Branches entfallen, müssen aber koordiniert entfernt werden, sobald Boot-Migration abgeschlossen ist.
- `state.history`, `state.mediums`, `state.mediumProfiles` und `state.measurementMethods` wachsen ungebremst und blockieren Garbage Collection. Diese Arrays müssen auf selektive Seiten- oder Suchergebnisse reduziert werden, sobald Worker-Lesewege stehen.

### 2. SQLite-Schema & Worker-Erweiterungen planen

- [x] **Tabellen-Abgleich**: Sicherstellen, dass alle Datenbereiche Tabellen/Views besitzen (z. B. `medium_profiles`, `settings_meta`, `archives_logs`). Fehlende Tabellen samt Indizes planen.
- [x] **CRUD-API festlegen**: Pro Domäne Worker-Methoden definieren (`upsertMedium`, `saveSettings`, `appendHistoryEntry`, `listReportsPaged`, …) inklusive Parameter- und Rückgabe-Contracts.
- [x] **Transaktions- & Persist-Strategie**: Beschreiben, wie Write-Batches (z. B. Calculation speichert History + Medium-Updates) in einer Worker-Transaktion ausgeführt werden und wann `persistSqliteDatabaseFile()` getriggert wird.
- [x] **Paging/Streaming-Vorgaben**: Für Listen (History, Reports, Documentation) Limit/Offset- oder Cursor-Schnittstellen planen, um Full-Loads zu verhindern.

#### Tabellen-Abgleich & neue Strukturen

| Domäne                          | Bestehende Tabellen                                                           | Erweiterungen / neue Tabellen                                                                                                                                                                                          | Notizen                                                                                        |
| ------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| History                         | `history`, `history_items`                                                    | Zusätzliche Indizes auf `history.created_at` (ASC) und `history.header_json->creator/crop` via generated columns oder trigram Index, damit Filter performant bleiben.                                                  | Optional `history_tags` (history_id, key, value) falls spätere Filter ausgebaut werden sollen. |
| Mediums & Methoden              | `measurement_methods`, `mediums`, `medium_profiles`, `medium_profile_mediums` | Ergänze `created_at`/`updated_at` Spalten für `mediums`, `measurement_methods`. `medium_profile_mediums.sort_order` bereits vorhanden – sicherstellen, dass Default greift.                                            | Trigger, um `updated_at` automatisch zu setzen.                                                |
| Company/Defaults/Field Labels   | Aktuell nur `meta` JSON Key-Value                                             | Unterteile Meta-Keys (`meta:key='company'`, `'defaults'`, `'field_labels'`, `'app_settings'`) und speichere strukturierte JSON. Optional separate Tabelle `app_defaults` (key TEXT PRIMARY KEY, value TEXT).           | Klare Schema-Dokumentation, damit Worker typed payloads liefern kann.                          |
| Archive Logs                    | Noch nicht in SQLite                                                          | Neue Tabelle `archive_logs` mit Spalten `id TEXT PK`, `archived_at TEXT`, `start_date TEXT`, `end_date TEXT`, `entry_count INTEGER`, `file_name TEXT`, `storage_hint TEXT`, `note TEXT`. Index auf `archived_at DESC`. | Ermöglicht serverlose Auditliste und Filter ohne State-Array.                                  |
| Reporting Views                 | keine                                                                         | Materialisierte View `history_with_items` (JOIN + aggregated JSON) oder `history_summary_view` (projection mit flatten header fields) zum schnellen Reporting.                                                         | View liefert Felder `creator`, `location`, `crop`, `date_iso`, `kisten`.                       |
| Import/Export Jobs              | keine                                                                         | Tabelle `import_jobs` (`id`, `started_at`, `status`, `payload_json`) zum Debuggen optional.                                                                                                                            | Hilft bei Fehlersuche, kann später entfernt werden.                                            |
| Settings (Starfield prefs etc.) | keine                                                                         | Falls Starfield/Theme Settings persistiert werden sollen → Tabelle `user_prefs (key TEXT PRIMARY KEY, value TEXT NOT NULL)`                                                                                            | Kleines Key-Value-Schema.                                                                      |
| GPS                             | bereits `gps_points`                                                          | keine Änderungen nötig.                                                                                                                                                                                                | Kann Format als Referenz dienen.                                                               |

#### Worker-APIs pro Domäne

- **History / Reporting / Documentation**
  - `appendHistoryEntry({ header, items, createdAt })` → führt INSERT in `history` + `history_items` in einer Transaktion durch und gibt `historyId` zurück.
  - `listHistoryEntriesPaged({ cursor?, pageSize, filters })` → gibt `items`, `nextCursor`, `totalCount` (optional) zurück; nutzt Indexe auf Datum + JSON-Extract-Felder.
  - `deleteHistoryEntries({ ids })`, `deleteHistoryRange({ filters })` (existiert teilweise) sowie `exportHistoryRange` (bestehend, aber Items bereits JSON-geparsed).
  - `getHistoryEntryDetail(id)` liefert Header + Items ohne zusätzliche Transformation im UI.
  - `listArchiveLogs({ limit, offset })`, `insertArchiveLog(logEntry)`, `pruneArchiveLog(id)` über neue Tabelle.
- **Calculation Support**
  - `getMediumTable({ profileId?, searchTerm?, limit, offset })` → serverseitige Filterung, damit Calc-UI nur sichtbare Zeilen lädt.
  - `listMeasurementMethods()`, `upsertMeasurementMethod(payload)`, `deleteMeasurementMethod(id)`.
- **Settings & Meta**
  - `loadMeta()` → liefert `company`, `defaults`, `fieldLabels`, `appSettings` aus `meta` Tabelle.
  - `updateCompanyProfile(partial)`, `updateDefaults(partial)`, `updateFieldLabels(partial)` → schreiben JSON-merge in Meta; Worker ack liefert neue Version.
  - `listMediumsPaged`, `upsertMedium`, `deleteMedium`, `listMediumProfiles`, `upsertMediumProfile({ profile, mediumIds })`, `deleteMediumProfile(id)`.
- **Import/Export**
  - `bulkInsertHistoryEntries(entries)` → nimmt Array von History-Payloads, nutzt Prepared Statements + `BEGIN IMMEDIATE` zur Beschleunigung.
  - `bulkUpsertMediums(mediums)` und `bulkUpsertMeasurementMethods(methods)`.
  - `persistSqliteDatabaseFile()` auf Worker-Seite triggerbar (Brücke zu `persistSqliteDatabaseFile` im Main Thread bleibt bestehen, aber Worker informiert bei dirty state).
- **Misc Prefs / Starfield**
  - `getUserPref(key)` / `setUserPref({ key, value })` falls Animationseinstellungen persistiert werden sollen.

Alle neuen Worker-Methoden sollen typisierte Payloads erwarten (z. B. `MediumPayload` ohne UI-spezifische Felder) und ausschließlich serialisierbare Ergebnisse zurückgeben.

#### Transaktions- & Persist-Strategie

- Jede schreibende Worker-API kapselt SQL in `BEGIN IMMEDIATE … COMMIT`. Für zusammengesetzte Writes (z. B. Calculation speichert Header + Items + optional Archive-Log) werden Helper wie `withTransaction(async (db) => { ... })` im Worker eingeführt.
- Worker führt nach erfolgreicher Transaktion `postMessage({ type: "db-dirty" })` an den Main Thread. Das Hauptmodul debounced `persistSqliteDatabaseFile()` (z. B. 1s) damit nicht jede einzelne Operation direkt den OPFS-Write triggert.
- Fehlerfälle: Bei Exceptions innerhalb einer Transaktion `ROLLBACK` ausführen und einen serialisierten Fehler mit Kontext (SQLITE_CONSTRAINT etc.) propagieren, damit UI gerichtetes Feedback geben kann.
- Bulk-Operationen (Import) laufen mit `PRAGMA synchronous = NORMAL` + `journal_mode = WAL` während des Jobs und setzen im Anschluss wieder ursprüngliche Werte, um UI nicht zu blockieren. Während solcher Jobs wird eine Busy-Flag im State gesetzt, damit weitere Writes warten.

#### Paging- & Streaming-Vorgaben

- History/Reporting/Documentation verwenden Cursor-basierte Pagination: `cursor = { createdAt, id }` (lexikografisch). Dadurch kann der Worker `WHERE (created_at < :createdAt OR (created_at = :createdAt AND id < :id)) ORDER BY created_at DESC LIMIT :pageSize` nutzen.
- Settings-Tabellen (`mediums`, `measurement_methods`) erhalten limit/offset-Endpunkte plus `totalCount`, damit UI Virtual-Lists nur sichtbare Zeilen rendern. Suche (Name, Methode) wird über `WHERE name LIKE ? COLLATE NOCASE` realisiert.
- Archive-Logs liefern standardmäßig letzte 50 Einträge, weitere Seiten via Cursor. Dokumentation-Feature nutzt selektiv `listHistoryEntriesPaged` statt `state.history`.
- Reporting benutzt Worker-Filter, die ausschließlich aggregierte Header-Daten liefern (Items optional lazy via `getHistoryEntryDetail`). Für Druckvorgänge ruft das UI `streamHistoryEntries(filters, onChunk)` auf, wobei der Worker JSON in Batches (z. B. 100 Einträge) postet, um den Browser nicht zu überlasten.

### 3. Feature-Module auf direkte SQLite-Nutzung umbauen

- [x] **Calculation/History**: `saveDatabase`-Pfad eliminieren; stattdessen Worker-Calls für History-Einträge + benötigte Meta-Daten. Sicherstellen, dass UI nur die aktuelle Berechnung + zuletzt gespeicherte ID im State hält.
- [x] **Settings/Company/Defaults**: Formulare sollen direkt `upsertSettings`/`updateCompanyProfile` im Worker triggern; State aktualisiert sich über gezielte `loadSettings`-Reads statt Snapshot.
- [x] **Mediums & Profiles**: CRUD-Operationen gegen SQLite statt State-Manipulation; Virtual-List darf nur sichtbare Zeilen halten.
- [x] **Documentation/Archive**: Delete/Archive-Operationen ausschließlich über Worker-API; UI-State synchronisiert sich durch selektive Fetches (z. B. `listArchiveLogs(limit)`).
- [x] **Reporting/Import/Export**: Exporte lesen Daten über Worker-Ranges; Importe schreiben über dedizierte Insert-Endpunkte + anschließendes File-Persist. Prüfen, ob Altcode, der ganze Snapshots baut, entfernt werden kann.
- [x] **Starfield/GPS/sonstige Features**: GPS ist schon SQLite-basiert -> als Referenz nutzen; Starfield/visual prefs ggf. neue Tabelle oder Settings-Feld.
- [x] **State-Management anpassen**: `state.history`, `state.mediums` etc. nur noch als Cache/Page-Slice pflegen; Konsumenten auf neue Loader-Hooks umstellen, damit keine Full-Array-Kopien entstehen.

#### Umsetzung pro Modul

**Calculation & History (`src/scripts/features/calculation|history`)**

- Entferne `getDatabaseSnapshot/saveDatabase`, ersetze durch neuen Hook `useHistoryPersistence` mit Methoden `saveCalculationResult`, `loadHistoryPage`, `deleteHistoryEntries` (Worker-gestützt).
- Calculation speichert nur noch das aktuelle Ergebnis (`calcContext`) im State; beim Klick auf „Speichern“ ruft sie `appendHistoryEntry` und leert lokale Measurement-Zwischenspeicher.
- History-Komponente initialisiert sich mit `loadHistoryPage({ limit: 100 })`, hält Cursor im lokalen Zustand und synchronisiert Auswahl via Worker-Rückmeldungen. Virtualliste bekommt `onRequestMore` Callback, der weitere Seiten nachlädt.
- Druck/Export-Routinen nutzen `streamHistoryEntries(filters)` statt `state.history`, wodurch der Browser nur jeweils 50–100 Einträge gleichzeitig verarbeitet.

**Reporting (`src/scripts/features/reporting`)**

- Filterformular ruft `listHistoryEntriesPaged` mit Datumsgrenzen; `currentEntries` wird durch Worker-Result ersetzt.
- Für Druck wird `fetchReportChunk` wiederholt aufgerufen, bis alle Cursor-Blöcke angekommen sind. UI zeigt Busy-Indicator solange Worker streamt.

**Settings & Meta (`src/scripts/features/settings`, `core/database.ts`)**

- Settings-Formulare nutzen neue Services `settingsRepository.upsertMedium`, `settingsRepository.upsertProfile`, `settingsRepository.updateCompany`. Jede Aktion aktualisiert eine lokale ViewModel-Liste, die über `watchMediums`/`watchProfiles` vom Worker gespeist wird.
- Measurement-Methods- und Default-Formular triggern `updateDefaults` etc.; State-Updates laufen ausschließlich über `patchState` mit Worker-Daten, nicht über direkte Mutationen.
- Medium-Tabelle verwendet Cursor + Paginierung; Select-all/Profilfunktionen interagieren mit einer `selectionStore`, die IDs zwischenhält.

**Documentation/Archive (`src/scripts/features/documentation`)**

- Listen/Filter laden ausschließlich über `listHistoryEntriesPaged`; `state.history` wird nicht mehr direkt manipuliert. Archive-Logs kommen aus neuer Tabelle `archive_logs` via `loadArchiveLogs(limit)`, UI hält nur sichtbare Items.
- Archivierung ruft `archiveEntries({ filters, removeAfterExport })`, die Worker-seitig Export, optionales Löschen, Log-Insert und Dateipersist zusammenfasst. UI reagiert auf `archive:progress` Events.

**Import/Export (`src/scripts/features/importMerge`)**

- ZIP-Import parst Dateien im Worker (per transferable ArrayBuffer) und nutzt `bulkInsertHistoryEntries` + `bulkUpsertMediums`. UI verarbeitet nur Preview-Infos (z. B. Anzahl, Konflikte), nicht den kompletten Datensatz.
- Export-Funktionen (History Range, Komplett-Backup) fragen den Worker nach Streams/Binary Blobs; Main Thread bekommt nur `Uint8Array` Chunks zum Download.

**Medium Profiles & Virtual Lists**

- Profile-UI ruft `listMediumProfiles` paginiert und hält lediglich aktive Auswahl (`editingProfileId`, `selectedMediumIds`). Änderungen laufen über `upsertMediumProfile` und warten auf Worker-Antwort, bevor die UI aktualisiert wird.
- Medium-Tabelle nutzt `virtualList` + `onScrollEnd` um neue Seiten vom Worker anzufordern; `state.mediums` reduziert sich auf `visibleMediums` (letzte Page) + `totalCount`.

**Starfield / Sonstige Prefs**

- Optionale Nutzerpräferenzen (Starfield aktiv? Theme?) werden über `userPrefs` Worker-API gespeichert. UI liest bei Start `getUserPref` und subscribed auf Änderungen.

**State-Management Anpassungen**

- Führe ein `dataCache`-Modul ein, das pro Domäne `useListController` bereitstellt (hält Cursor, Items, Busy-Flags) und Worker-Ergebnisse in den App-State mapped (`state.historyPage`, `state.mediumPage` etc.).
- Entferne globale Arrays (`state.history`, `state.mediums`, `state.mediumProfiles`) zugunsten schlanker Slices: `{ items: HistoryEntry[], cursor: Cursor | null, totalCount }`.
- EventBus erweitert um `database:update:<domain>` Nachrichten, damit Komponenten gezielt reagieren können.

### 4. Migration & Sicherheit

- [x] **Boot-Migration**: Script schreiben, das beim ersten Start mit Legacy-Snapshot vorhandene JSON/LocalStorage-Daten einliest, in SQLite schreibt und danach ein Flag (`meta.migrated_all_sqlite`) setzt.
- [x] **Fallback-Abschaltung**: Nach erfolgreicher Migration `getDatabaseSnapshot`/`saveDatabase` nur noch in Import/Export verwenden; LocalStorage/Fallback-Treiber deaktivieren oder klar als "Notfall, read-only" markieren.
- [x] **Validierungs-Checks**: Für jede Domäne CRUD-Flow testen (happy path + Fehlerfälle). Automatisierte Tests oder manuelle Checkliste (Create, Update, Delete, Export/Import, Archive) festhalten.
- [x] **Performance/Memory Monitoring**: Browser-DevTools nutzen, um zu bestätigen, dass keine großen Arrays im Heap verbleiben; ggf. Logging einbauen (Warnung, wenn >N Datensätze in State landen).
- [x] **Rollback-Plan**: Notieren, wie im Fehlerfall auf vorherige Version zurückgesprungen werden kann (Backup der SQLite-Datei, Export-Funktion intakt, Feature-flag toggles).

#### Checkliste & Maßnahmen

**Boot-Migration**

1. Beim Start prüft `startup/index.ts` via Worker `meta.migrated_all_sqlite`.
2. Falls `false`, wird der bisherige Snapshot geladen (`openDatabase` oder LocalStorage-Fallback), serverseitig mit `legacySnapshotToSqlite(snapshot)` migriert:
   - `importSnapshot` (bereits vorhanden) wird aufgerufen, anschließend `persistSqliteDatabaseFile()`.
   - LocalStorage-Schlüssel (`pflanzenschutzliste:database`) und JSON-Datei-Hinweise werden gelöscht.
3. Nach erfolgreicher Migration setzt der Worker `meta.migrated_all_sqlite = true` und postet Event `migration:complete`.
4. UI zeigt Hinweis/Toast mit Backup-Empfehlung.

**Fallback-Abschaltung**

- `detectPreferredDriver()` priorisiert SQLite; `fileSystem` und `localStorage` Treiber bleiben implementiert, aber `setActiveDriver` verweigert Nicht-SQLite-Optionen, sobald Migration durch ist (Config-Flag `FORCE_SQLITE=true`).
- `getDatabaseSnapshot`/`saveDatabase` bleiben für Import/Export (JSON-Backup) verfügbar, aber Aufrufer (Calculation, Settings, History, Import) entfernen ihre direkten Verwendungen.
- Startup zeigt Warnung, falls Browser kein SQLite/OPFS unterstützt (UI blockiert, verweist auf kompatiblen Browser).

**Validierungs- und Regressionstests**

- Pro Domäne Checkliste erstellen (manuell oder Playwright-Skripte):
  1. Calculation speichern ⇒ History-Eintrag sichtbar? (Worker-Insert, UI-Refresh)
  2. History löschen (einzeln + Range) ⇒ SQLite reduziert, Dateigröße shrinkt?
  3. Settings CRUD (Medium, Methode, Profil) ⇒ sofortiger Worker-Ack, UI-Reload.
  4. Documentation Archive exportieren & wieder importieren ⇒ keine Duplikate, Logs geschrieben.
  5. Import großer ZIP ⇒ Worker-streamed, Browser-RAM stabil (<250 MB bei 10k Einträgen).
- Automatisierte Tests: Unit-Tests für Worker-SQL Routen, Integrationstest (Vitest/Playwright) für Import/Export Flow.

**Performance & Monitoring**

- Nach Migration DevTools-Profile aufnehmen: Timeline/Memory beim Scrollen durch History/Reporting, Import, Archive.
- Logging-Hooks: In dev-Builds `warnIfLargeState(sliceName, size)` feuert, wenn Cache >1 000 Einträge hält; hilft, vergessene Loader aufzuspüren.
- Optional: Telemetrie-Flag (`window.__PSL_DEBUG = true`) erlaubt Logging der Cursor/Fetch-Zeiten.

**Rollback-Plan**

- Vor Migration automatisches JSON-Backup erzeugen (`auto-backup-YYYYMMDD.json`) und Nutzer auffordern, Datei manuell zu sichern.
- SQLite-Datei nach jedem Persist in OPFS-Kopie duplizieren (`pflanzenschutz.sqlite.bak`) – begrenzt auf letzten Stand.
- Feature-Flag `ENABLE_SQLITE_ONLY` erlaubt (zur Not) Reaktivierung des alten Snapshot-Treibers – allerdings read-only, um Datenverlust zu vermeiden.
- Dokumentierte Schritte für Support: 1) Export, 2) Neue Version öffnen, 3) Import; falls Fehler, alte Version + Backup wiederherstellen.

### 5. Abschluss & Kommunikation

- [ ] **Dokumentation aktualisieren**: `DOKUMENTATION.md`, `ARCHITEKTUR.md` und `ASTRO-MIGRATION-STATUS.md` auf den neuen Speicherpfad anpassen.
- [ ] **Release-Notes vorbereiten**: Nutzer:innen informieren, dass lokale Snapshots entfallen und SQLite zur Pflicht wird; Hinweise zu Backup/Export geben.
- [ ] **QA-Abnahmen**: Finalen Testlauf mit realistischem Datensatz durchführen, Import/Export + Archivierung + Reporting prüfen und Ergebnisse protokollieren.
