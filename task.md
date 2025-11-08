# BVL Zulassungsdaten Integration – Auftrag v2

## Zielbild
- Nutzer koennen im Bereich "Zulassungs-Datenbank" zugelassene Mittel nach Kultur/Schadorganismus filtern und Details wie Aufwand, Wartezeit, Zulassungsstatus sehen.
- Daten werden aus BVL OpenAPI Endpunkten geladen, lokal in SQLite-WASM persistiert und ersetzen bestehende Datensaetze ohne Primaerschluessel-Konflikte.
- Ein Update-Button stoesst den Sync an, zeigt Fortschritt, Ergebnisstatus (aktualisiert / unveraendert / Fehler) und aktualisiert den Zeitstempel.

## Ziel-Endpoints (maximal 6)
1. `mittel`
2. `awg`
3. `awg_kultur`
4. `awg_schadorg`
5. `awg_aufwand`
6. `awg_wartezeit`

## Architektur-Erweiterungen
- Neues Core-Modul `assets/js/core/bvlClient.js` fuer API-Zugriffe mit Pagination, Timeout, Fehlerklassifizierung, Hashing.
- Sync-Orchestrator `assets/js/core/bvlSync.js` fuer orchestrierte Datenerfassung, Diff-Erkennung, Import und Logging.
- SQLite-WASM Schema-Migration (`user_version = 2`) fuer robuste Tabellen und eindeutige Schluessel.
- Erweiterte Worker-Actions (Import, Meta, Query, Lookup) in `sqliteWorker.js` plus Wrapper in `sqlite.js`.
- State-Slice `zulassung` fuer Filter, Ergebnisse, Busy/Error, letzte Aktualisierung und Lookup-Caches.
- Feature-Modul `assets/js/features/zulassung/index.js` mit Filter-UI, Ergebnisliste, Update-Button, Statusmeldungen.
- Shell Navigation um Tab "Zulassung" erweitern, sichtbar nur bei verbundener Datenbank.

## SQLite Schema (Version 2)
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
- Zusaetzliche Indizes: `idx_awg_kennr` auf `bvl_awg(kennr)`, `idx_awg_kultur_kultur`, `idx_awg_schadorg_schadorg`, `idx_awg_aufwand_awg`, `idx_awg_wartezeit_awg`.

## Aufgabenpakete fuer den Coding-Agent

### 1. Core Utilities
- `assets/js/core/bvlClient.js`:
  - `fetchCollection(endpoint, { query, signal })` mit `Accept: application/json`, automatischem Redirect-Handling.
  - Pagination via `links.next`, Timeout (30 s) ueber `AbortController`, differenzierte Fehler (Network, HTTP >= 400, Parse).
  - `hashData(payload)` (SHA-256 Hex) fuer deterministische Diff-Erkennung.
- `assets/js/core/bvlSync.js`:
  - `syncBvlData({ endpoints?, onProgress? })`: Meta lesen -> Endpunkte laden -> Hash bilden.
  - Bei gleichem Hash: Sync-Log `no-change`, Rueckgabe `{ status: 'no-change' }`.
  - Transformierte Datensaetze an Worker `importBvlDataset` uebergeben (Transaction, FULL REPLACE).
  - Meta (`lastSyncHash`, `lastSyncIso`) aktualisieren, Log schreiben.
  - Rueckgabe `{ status: 'updated', counts, message }` oder `{ status: 'failed', error }`.

### 2. SQLite Worker & Treiber
- `sqliteWorker.js` Migration:
  - Bei `user_version < 2` alle bisherigen `bvl_*` Tabellen (falls vorhanden) droppen und neues Schema anlegen, `PRAGMA user_version = 2`.
- Neue Worker-Actions:
  - `importBvlDataset(payload)` – erwartet Arrays fuer jede Tabelle, setzt alle Primaerschluessel korrekt (inkl. `awg_wartezeit_nr`).
  - `getBvlMeta`, `setBvlMeta`, `appendBvlSyncLog`.
  - `queryZulassung(params)` – JOINs liefern mehrere Aufwaende und Wartezeiten je Anwendung; Ausnahmen (`ausgenommen = 1`) gesondert ausweisen.
  - `listBvlCultures()` & `listBvlSchadorg()` – distinct Werte (nur Ausnahmen = 0), alphabetisch sortiert.
- `sqlite.js` Wrapper fuer neue Aktionen ergaenzen.

### 3. State Management
- `state.js`: neues Slice `zulassung` hinzufuegen:
```
zulassung: {
  filters: { culture: null, pest: null, text: '', includeExpired: false },
  results: [],
  busy: false,
  error: null,
  lastSync: null,
  lookups: { cultures: [], pests: [] }
}
```
- `resetState` und `createInitialDatabase` anpassen.

### 4. UI Modul "Zulassung"
- `assets/js/features/zulassung/index.js`:
  - Filterbar (Dropdowns, Textfeld, Checkbox, Suche, Update-Button) rendern.
  - Lookups beim Init laden; Ladeindikator.
  - Suche: `queryZulassung` ausfuehren, Ergebnisse anzeigen (Tabelle/Karten) inkl. Mehrfach-Aufwaende und -Wartezeiten; Ausnahmen farblich markieren.
  - Update-Button: `syncBvlData`, Busy-Zustand, Feedback (Toast/Alert), letztes Sync-Datum setzen.
  - Hinweis bei leerem Datenbestand.
- Styles in vorhandenen CSS-Dateien ergaenzen.

### 5. Shell & Bootstrap
- `assets/js/features/shell/index.js`: `SECTION_MAP` um `{ id: 'zulassung', label: 'Zulassung' }` erweitern.
- `assets/js/core/bootstrap.js`: `initZulassung` einbinden.
- Buttons bleiben deaktiviert solange `app.hasDatabase` false.

### 6. Startup/Settings Integration
- Nach `database:connected` -> `getBvlMeta('lastSyncIso')` abrufen und `state.zulassung.lastSync` setzen.
- Optional: Anzeige "Letzte BVL Aktualisierung" im Settings-Feature.

### 7. Fehler- & Offline-Verhalten
- Update-Button deaktivieren, wenn `sqliteDriver.isSupported()` false oder Worker nicht bereit.
- Fehler differenziert anzeigen: Netzwerk/Timeout, HTTP-Fehler inkl. Response-Text.
- Sync-Log-Eintraege optional im UI (z. B. Tooltip oder Verlauf) sichtbar machen.

### 8. Tests (manuell)
1. Neue Datenbank -> Hinweis "Keine BVL Daten" im Zulassung-Tab.
2. Update ausfuehren -> Daten werden geladen, keine Constraint-Fehler.
3. Filter "SALAT" + "LAUS" -> sinnvolle Treffer, Ausnahmen gekennzeichnet.
4. Beispiel Wartezeit mit Mehrfacheintraegen (z. B. `awg_id 050498-63/02-001`) erscheint vollstaendig.
5. Erneuter Update ohne Datenaenderung -> Meldung "Keine Aktualisierung".
6. Offline simulieren -> Update zeigt Fehler, Daten bleiben bestehen.
7. Browser Reload -> Daten + Zeitstempel bleiben erhalten.

## Annahmen / Hinweise
- Kultur- und Schadorganismus-Codes bleiben vorerst kodiert; Dekodierung via `kode` Endpunkt ist Folgeaufgabe.
- Aufwand- und Wartezeitdaten koennen mehrere Varianten besitzen – UI muss Mehrfachzeilen darstellen.
- Weitere Endpunkte nur nach Abstimmung ergaenzen.

## Definition of Done
- Zulassung-Feature inkl. Sync funktioniert ohne Primaerschluessel-Konflikte.
- Schema Migration (user_version=2) garantiert eindeutige Schluessel und Indizes.
- Update-Button liefert klare Statusmeldungen; Meta/Log werden gepflegt.
- Tests aus Abschnitt 8 dokumentiert; README oder Settings enthalten Hinweis auf neuen Tab/Update-Prozess.
- Keine Regressionen in Berechnung, Historie oder Einstellungen; Code folgt Projektstil (ASCII, sparsame Kommentare).
