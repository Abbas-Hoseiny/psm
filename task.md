# BVL Zulassungsdaten Integration – Auftrag v3

## Zielbild
- Zulassungsdatenbank funktioniert stabil im Browser (OPFS oder Memory) und ersetzt bestehende Daten ohne Constraint-Fehler.
- Nutzer sehen beim Sync einen Fortschrittsbalken (mehrstufig: Laden, Verarbeiten, Schreiben, Fertig) und erhalten klare Status- sowie Fehlerhinweise.
- Detaillierte Debug-Informationen (Konsole + optionales Log-Panel) erleichtern das Nachvollziehen von Importproblemen.
- UI liefert korrekte Filterergebnisse inklusive Mehrfach-Aufwände und Mehrfach-Wartezeiten.

## Ziel-Endpoints (maximal 6)
1. `mittel`
2. `awg`
3. `awg_kultur`
4. `awg_schadorg`
5. `awg_aufwand`
6. `awg_wartezeit`

## Architektur-Erweiterungen (Pflicht)
- Core-Modul `assets/js/core/bvlClient.js` (Pagination, Timeout, Error-Klassen, SHA-256 Hashing).
- Sync-Orchestrator `assets/js/core/bvlSync.js` mit Fortschritts-Callbacks, Diff-Erkennung, strukturierten Ergebnissen und erweitertem Logging.
- SQLite-WASM Migration auf `user_version = 2`, die ALLE bisherigen `bvl_*` Tabellen konsequent droppt und nach neuem Schema erstellt (siehe unten).
- Worker-Aktionsset (Import, Meta, Sync-Log, Query, Lookups, Diagnostics) in `assets/js/core/storage/sqliteWorker.js`; Wrapper in `assets/js/core/storage/sqlite.js`.
- State-Slice `zulassung` mit Progress- und Debug-Infos.
- Feature-Modul `assets/js/features/zulassung/index.js` inkl. Fortschrittsbalken, Statusbanner, optionaler Debug-Konsole.
- Shell & Bootstrap Anpassungen (Tab sichtbar bei aktiver DB, Initialisierung mit Lookups und letztem Sync).

## SQLite Schema (Version 2 – Full Rebuild)
Migration verlangt, dass beim Sprung `<2 -> 2` zuerst alle BVL-Tabellen und Indizes entfernt werden:
```
PRAGMA foreign_keys = OFF;
DROP TABLE IF EXISTS bvl_awg_wartezeit;
DROP TABLE IF EXISTS bvl_awg_aufwand;
DROP TABLE IF EXISTS bvl_awg_schadorg;
DROP TABLE IF EXISTS bvl_awg_kultur;
DROP TABLE IF EXISTS bvl_awg;
DROP TABLE IF EXISTS bvl_mittel;
DROP TABLE IF EXISTS bvl_meta;
DROP TABLE IF EXISTS bvl_sync_log;
```
Anschließend neu erstellen:
```
Table bvl_meta
- key TEXT PRIMARY KEY
- value TEXT

Table bvl_mittel
- kennr TEXT PRIMARY KEY
- name TEXT
- formulierung TEXT
- zul_erstmalig TEXT
- zul_ende TEXT
- geringes_risiko INTEGER
- payload_json TEXT

Table bvl_awg
- awg_id TEXT PRIMARY KEY
- kennr TEXT REFERENCES bvl_mittel(kennr) ON DELETE CASCADE
- status_json TEXT
- zulassungsende TEXT

Table bvl_awg_kultur
- awg_id TEXT REFERENCES bvl_awg(awg_id) ON DELETE CASCADE
- kultur TEXT
- ausgenommen INTEGER
- sortier_nr INTEGER
- PRIMARY KEY (awg_id, kultur, ausgenommen)

Table bvl_awg_schadorg
- awg_id TEXT REFERENCES bvl_awg(awg_id) ON DELETE CASCADE
- schadorg TEXT
- ausgenommen INTEGER
- sortier_nr INTEGER
- PRIMARY KEY (awg_id, schadorg, ausgenommen)

Table bvl_awg_aufwand
- awg_id TEXT REFERENCES bvl_awg(awg_id) ON DELETE CASCADE
- aufwand_bedingung TEXT
- sortier_nr INTEGER
- mittel_menge REAL
- mittel_einheit TEXT
- wasser_menge REAL
- wasser_einheit TEXT
- payload_json TEXT
- PRIMARY KEY (awg_id, aufwand_bedingung, sortier_nr)

Table bvl_awg_wartezeit
- awg_wartezeit_nr INTEGER
- awg_id TEXT REFERENCES bvl_awg(awg_id) ON DELETE CASCADE
- kultur TEXT
- sortier_nr INTEGER
- tage INTEGER
- bemerkung_kode TEXT
- anwendungsbereich TEXT
- erlaeuterung TEXT
- payload_json TEXT
- PRIMARY KEY (awg_wartezeit_nr, awg_id)

Table bvl_sync_log
- id INTEGER PRIMARY KEY AUTOINCREMENT
- synced_at TEXT
- ok INTEGER
- message TEXT
- payload_hash TEXT
```
Indizes (Pflicht):
```
idx_awg_kennr ON bvl_awg(kennr)
idx_awg_kultur_kultur ON bvl_awg_kultur(kultur)
idx_awg_schadorg_schadorg ON bvl_awg_schadorg(schadorg)
idx_awg_aufwand_awg ON bvl_awg_aufwand(awg_id)
idx_awg_wartezeit_awg ON bvl_awg_wartezeit(awg_id)
```
Zum Schluss `PRAGMA foreign_keys = ON; PRAGMA user_version = 2;` setzen.

## Aufgabenpakete

### 1. Core Utilities & Diagnostics
- `bvlClient.fetchCollection` mit serverseitiger Pagination, `AbortController` Timeout (30 s), Retries (max. 2 bei 5xx), sauberen Fehlertypen (`NetworkError`, `HttpError`, `ParseError`).
- `bvlClient.hashData` (SHA-256 Hex); separat `computeDatasetHashes` (per Endpoint und Gesamt).
- `bvlSync.syncBvlData` akzeptiert `onProgress({ step, percent, message })` und `onLog(entry)` callbacks.
- Fortschritts-Schritte mindestens: `start`, `fetch:<endpoint>`, `transform`, `write`, `verify`, `done`.
- Sync nutzt `bvl_meta` (`lastSyncHash`, `lastSyncIso`, `lastSyncCounts`, `lastError`), schreibt Einträge ins `bvl_sync_log` (mit Hash, Counts, Dauer, Fehlermeldung).
- Bei Fehlern differenzierte Messages inkl. HTTP-Status, Endpoint, Fetch-Versuche, ggf. verkürzter Response-Body.

### 2. SQLite Worker & Wrapper
- Migration wie oben beschrieben implementieren (Transaktion, Drop&Create, Version setzen).
- Aktionen erweitern:
  - `importBvlDataset(payload, meta)` (payload als Objekt mit Arrays pro Tabelle; Worker verifiziert Pflichtfelder, logged counts, nutzt `REPLACE`).
  - `getBvlMeta`, `setBvlMeta`, `appendBvlSyncLog`, `listBvlSyncLog({ limit })`.
  - `queryZulassung(params)` mit vollständigen JOINs und strukturierter Antwort (Pro Anwendung: Mittel, Status, Kulturen inkl. Ausnahmen, Schadorganismen, Aufwände sortiert nach `sortier_nr`, Wartezeiten sortiert nach `sortier_nr`).
  - `listBvlCultures`, `listBvlSchadorg` (distinct, sortiert, optional Trefferanzahl).
  - `diagnoseBvlSchema()` gibt `PRAGMA table_info`, Indexliste und user_version aus (für Debug-Panel).
- Wrapper `sqlite.js` erhält Promise-basierte Helfer für alle neuen Aktionen.

### 3. State Management
- Slice `zulassung` Struktur:
```
zulassung: {
  filters: { culture: null, pest: null, text: '', includeExpired: false },
  results: [],
  lastSync: null,
  lastResultCounts: null,
  busy: false,
  progress: { step: null, percent: 0, message: '' },
  error: null,
  logs: [],
  debug: { schema: null, lastSyncLog: [] },
  lookups: { cultures: [], pests: [] }
}
```
- Actions/Reducers zum Aktualisieren von Fortschritt, Fehlern, Logs.
- `resetState` berücksichtigt neue Felder; `createInitialDatabase` setzt `zulassung.lastSync` basierend auf `bvl_meta`.

### 4. UI Modul "Zulassung"
- Fortschrittsbalken (z. B. unter Buttons), der Prozent und Text aus `state.zulassung.progress` anzeigt. Verwendet CSS-Animation, pseudo-balken in `components.css` oder `layout.css`.
- Debug-Sektion (collapsible) zeigt letzte Sync-Log-Einträge, Schema-Infos (Tabellen, Spalten) und aktuelle Filter-Parameter.
- Update-Button steuert Sync; zeigt Busy-Zustand (disabled + Spinner). Nach Abschluss Toast/Alert mit Status.
- Bei Fehlern rotes Alert-Feld mit detaillierter Nachricht + Link „Details einblenden“ (zeigt Debug-Daten).
- Ergebnisliste unterstützt Mehrzeilen-Aufwände, Wartezeiten; Ausnahmen visuell absetzen (z. B. rotes Tag „ausgenommen“).
- UX: Filter bleiben verfügbar während Sync, aber Suchen-Button disabled solange Busy.
- „Keine Daten“ Hinweis inklusive Button zum Sync.

### 5. Shell & Bootstrap
- `features/shell/index.js`: Tab-Eintrag `{ id: 'zulassung', label: 'Zulassung' }`, Tab sichtbar wenn `app.hasDatabase` true.
- `core/bootstrap.js`: `initZulassung` importieren, Worker-Aktionsverfügbarkeit prüfen, Debug-Infos initial laden (`diagnoseBvlSchema`).
- `features/startup/index.js`: Nach `database:connected` -> Meta/Logs laden, Lookups aktualisieren.

### 6. Fehler- & Offline-Verhalten
- Sync bricht bei Timeout ab und zeigt Nutzerfreundliche Meldung. `Retry`-Button im Fehlerbanner.
- Pro Endpoint werden Fetch-Zeiten gemessen und im Debug-Log gespeichert.
- Bei Browser ohne FileSystem/OPFS klarer Hinweis (Banner) und Fallback auf Memory.
- Offline: `fetchCollection` erkennt `navigator.onLine === false` vor Start.

### 7. Tests (manuell + Debug)
1. First-run im frischen Browser -> Tab zeigt Hinweis, Sync läuft durch, keine SQL-Fehler; Progress-Bar wechselt sichtbar durch Schritte.
2. `diagnoseBvlSchema` im Debug-Panel zeigt Spalte `sortier_nr` in `bvl_awg_kultur` und `bvl_awg_schadorg`.
3. Filter `Kultur=SALAT`, `Schadorganismus=LAUS` liefert Treffer, Aufwände sortiert, Ausnahmen markiert.
4. Beispiel `awg_id 050498-63/02-001` zeigt mehrere Wartezeiten.
5. Zweiter Sync ohne Änderungen -> Status „Keine Aktualisierung“, Progress läuft dennoch durch, Log-Eintrag mit `ok=1` und `status=no-change`.
6. Simulierter HTTP-Fehler (Endpoint 404 via devtools response override) -> Fehlerbanner, Debug-Panel zeigt Endpoint/Status.
7. Offline (DevTools) -> Sync bricht sofort mit Offline-Hinweis ab, bestehende Daten bleiben.
8. Browser-Reload -> `lastSync`, `progress` zurückgesetzt, Daten weiter vorhanden.

## Debug & Logging Anforderungen
- `bvlSync` ruft `onLog` mit Objekten `{ level, message, data, timestamp }`; UI speichert letzte 50 Einträge.
- Worker schreibt `console.debug` Meldungen nur bei `payload.debug === true` (optional Toggle im Debug-Panel).
- Fehler-Objekte enthalten `endpoint`, `attempt`, `status`, `detail`.

## Annahmen / Hinweise
- BVL-Daten werden immer komplett ersetzt (kein Delta); Drop&Rebuild ist unkritisch.
- Kultur- und Schadorganismus-Codes bleiben unverändert; Klartext-Mapping ist Folgeaufgabe.
- Frontend bleibt ASCII-only (keine Emojis), Kommentierung sparsam und nur wo Logik schwer erkennbar.
- Netlify Preview soll wie gewohnt entstehen; Progress-Bar und Debug-Ausgaben müssen auch in Preview funktionieren.

## Definition of Done
- Migration v2 erstellt Tabellen exakt nach obigem Schema (inkl. `sortier_nr`) und wird bei bestehenden Datenbanken erfolgreich ausgeführt.
- Sync-Prozess liefert nachvollziehbare Logs, Fortschrittsanzeige, stabile UI; keine `SQLITE_CONSTRAINT` oder „no column named“ Fehler mehr.
- UX-Elemente (Fortschrittsbalken, Fehlerbanner, Debug-Panel) funktionieren in Desktop & Mobile.
- Manuelle Tests aus Abschnitt 7 dokumentiert (z. B. im PR-Beschreibung). README oder Settings erklärt kurz neuen Tab und Sync-Prozess.
- Bestehende Features (Berechnung, Historie, Einstellungen) unverändert funktionsfähig.
