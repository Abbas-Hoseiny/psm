# BVL Zulassungsdaten Integration – Umsetzungsplan

## Zielbild
- Nutzer koennen im Bereich "Zulassungs-Datenbank" zugelassene Mittel nach Kultur und Schadorganismus suchen und Details wie Aufwandmenge oder Wartezeit abrufen.
- Daten werden lokal aus BVL OpenAPI Endpunkten geladen, in der bestehenden SQLite-WASM Persistenz gespeichert und ersetzen veraltete Eintraege.
- Ein manueller Update-Button meldet Erfolg, Fehler oder "keine Aktualisierung" und haelt die lokale Datenbank synchron.

## Ziel-Endpoints (maximal 6)
1. `mittel` – Stammdaten der Mittel (Kenr, Name, Formulierung, Zulassungsdaten, Risiko).
2. `awg` – Anwendungen je Mittel (verbindet Mittel mit Kulturen, Schadorganismen, Zulassungsstatus).
3. `awg_kultur` – Kulturen zu Anwendungen, inkl. Ausnahmen.
4. `awg_schadorg` – Schadorganismen zu Anwendungen, inkl. Ausnahmen.
5. `awg_aufwand` – Aufwand- und Wassermengen je Anwendung.
6. `awg_wartezeit` – Wartezeiten mit Bemerkungskodes je Anwendung/Kultur.

## Architektur-Erweiterungen
- Neues Core-Modul `assets/js/core/bvlClient.js` fuer API-Aufrufe (Pagination, Fehlerbehandlung, Hashing).
- Sync-Orchestrator `assets/js/core/bvlSync.js` fuer koordinierte Datenerfassung, Transform und Rueckmeldung.
- SQLite-WASM Schema-Erweiterung (`user_version = 2`) fuer BVL Tabellen, inklusive Migrationspfad.
- Neuer Worker-Support in `sqliteWorker.js` fuer BVL-spezifische Aktionen (Import, Query, Meta, Lookup).
- State-Slice `zulassung` fuer Filter, Ergebnisse, Busy/Fehler-Status und letzten Sync-Zeitpunkt.
- Neues Feature-Modul `assets/js/features/zulassung/index.js` mit Filter-UI, Ergebnisdarstellung und Update-Button.
- Shell Navigation um Tab "Zulassung" erweitern; Anzeige nur bei verbundener Datenbank.

## SQLite Datenmodell (Vorschlag)
```
Table bvl_meta
- key TEXT PRIMARY KEY (z. B. lastSyncIso, lastSyncHash)
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
- PRIMARY KEY (awg_id, kultur)

Table bvl_awg_schadorg
- awg_id TEXT REFERENCES bvl_awg(awg_id) ON DELETE CASCADE
- schadorg TEXT
- ausgenommen INTEGER
- PRIMARY KEY (awg_id, schadorg)

Table bvl_awg_aufwand
- awg_id TEXT REFERENCES bvl_awg(awg_id) ON DELETE CASCADE
- sortier_nr INTEGER
- aufwand_bedingung TEXT
- mittel_menge REAL
- mittel_einheit TEXT
- wasser_menge REAL
- wasser_einheit TEXT
- payload_json TEXT
- PRIMARY KEY (awg_id, sortier_nr, aufwand_bedingung)

Table bvl_awg_wartezeit
- awg_id TEXT REFERENCES bvl_awg(awg_id) ON DELETE CASCADE
- kultur TEXT
- tage INTEGER
- bemerkung_kode TEXT
- payload_json TEXT
- PRIMARY KEY (awg_id, kultur)

Table bvl_sync_log
- id INTEGER PRIMARY KEY AUTOINCREMENT
- synced_at TEXT
- ok INTEGER
- message TEXT
- payload_hash TEXT
```
- Indizes: `CREATE INDEX idx_awg_kennr ON bvl_awg(kennr);`, `idx_awg_kultur_kultur`, `idx_awg_schadorg_schadorg`.

## Aufgabenpakete fuer den Coding-Agent

### 1. Core Utilities
- Implementiere `assets/js/core/bvlClient.js`:
  - `fetchCollection(endpoint, { query, signal })` mit `Accept: application/json`, Redirect-Toleranz, Pagination via `links.next`.
  - Zeitlimit (z. B. 30 s) per `AbortController` und Fehlerklassifizierung.
  - `hashData(payload)` Wrapper (SHA-256 -> hex) zur Diff-Erkennung.
- Implementiere `assets/js/core/bvlSync.js`:
  - `syncBvlData({ endpoints?, onProgress? })` Ablauf: Meta lesen -> Endpunkte laden -> Gesamt-Hash bilden -> no-change Fruehverlassen -> Transform -> Worker `importBvlDataset` -> Meta aktualisieren -> Sync-Log schreiben.
  - Liefere strukturiertes Ergebnis `{ status, counts, message }` (status: updated | no-change | failed).
  - Aufrufbar auch fuer Teilmengen (optional Parameter `endpoints`).

### 2. SQLite Worker & Treiber
- `assets/js/core/storage/sqliteWorker.js`:
  - Migration: Wenn `user_version < 2`, neue Tabellen erzeugen und `PRAGMA user_version = 2` setzen.
  - Neue Aktionen:
    - `importBvlDataset` (Payload mit Arrays je Tabelle -> Transaction -> DELETE + INSERT).
    - `getBvlMeta` / `setBvlMeta` / `appendBvlSyncLog`.
    - `queryZulassung` (Filter `culture`, `pest`, `text`, `includeExpired`, `limit`, `offset`).
    - `listBvlCultures`, `listBvlSchadorg` (distinct Werte, optional mit Trefferanzahl).
  - Query Beispiel (Feintuning durch Agent):
```
SELECT m.kennr,
       m.name AS mittelname,
       m.formulierung,
       m.zul_ende,
       a.awg_id,
       GROUP_CONCAT(DISTINCT CASE WHEN ak.ausgenommen = 0 THEN ak.kultur END) AS kulturen,
       GROUP_CONCAT(DISTINCT CASE WHEN ak.ausgenommen = 1 THEN ak.kultur END) AS kulturen_ausgenommen,
       GROUP_CONCAT(DISTINCT CASE WHEN asg.ausgenommen = 0 THEN asg.schadorg END) AS schadorg,
       GROUP_CONCAT(DISTINCT CASE WHEN asg.ausgenommen = 1 THEN asg.schadorg END) AS schadorg_ausgenommen,
       ao.mittel_menge,
       ao.mittel_einheit,
       ao.wasser_menge,
       ao.wasser_einheit,
       aw.tage,
       aw.bemerkung_kode
FROM bvl_awg a
JOIN bvl_mittel m ON m.kennr = a.kennr
LEFT JOIN bvl_awg_kultur ak ON ak.awg_id = a.awg_id
LEFT JOIN bvl_awg_schadorg asg ON asg.awg_id = a.awg_id
LEFT JOIN bvl_awg_aufwand ao ON ao.awg_id = a.awg_id
LEFT JOIN bvl_awg_wartezeit aw ON aw.awg_id = a.awg_id AND (aw.kultur = ak.kultur OR aw.kultur IS NULL)
WHERE (:culture IS NULL OR EXISTS (
  SELECT 1 FROM bvl_awg_kultur ak2
  WHERE ak2.awg_id = a.awg_id AND ak2.ausgenommen = 0 AND ak2.kultur = :culture
))
  AND (:pest IS NULL OR EXISTS (
  SELECT 1 FROM bvl_awg_schadorg asg2
  WHERE asg2.awg_id = a.awg_id AND asg2.ausgenommen = 0 AND asg2.schadorg = :pest
))
  AND (:text IS NULL OR (m.name LIKE :text OR m.kennr LIKE :text))
  AND (:includeExpired = 1 OR m.zul_ende IS NULL OR m.zul_ende >= :currentDate)
GROUP BY m.kennr, a.awg_id, ao.sortier_nr, aw.kultur
ORDER BY m.name ASC, a.awg_id ASC, ao.sortier_nr ASC
LIMIT :limit OFFSET :offset;
```
- `assets/js/core/storage/sqlite.js`: Worker-Aufrufe durchreichen (`importBvlDataset`, `getBvlMeta`, `setBvlMeta`, `appendBvlSyncLog`, `queryZulassung`, `listBvlCultures`, `listBvlSchadorg`).

### 3. State Management
- `assets/js/core/state.js` initial um Slice erweitern:
```
zulassung: {
  filters: { culture: null, pest: null, text: '', includeExpired: false },
  results: [],
  lastSync: null,
  busy: false,
  error: null,
  lookups: { cultures: [], pests: [] }
}
```
- `resetState` und `createInitialDatabase` entsprechend anpassen.
- Optional Hilfsfunktionen fuer Notifications (Toast) ueber `state.ui.notifications`.

### 4. UI Modul "Zulassung"
- Neues Modul `assets/js/features/zulassung/index.js`:
  - Baut Feature-Section mit Filterleiste (Dropdowns Kultur/Schadorganismus, Textfeld, Checkbox, Buttons).
  - Nutzt Services (`state`, `events`) fuer Abhoeren und Aktualisieren.
  - Initial lädt `lookups` via Worker Listen, zeigt Ladezustand.
  - Suche triggert `queryZulassung`, Ergebnisse im State speichern, UI rendern (Tabelle oder Karten).
  - Update-Button triggert `syncBvlData`, zeigt Busy/Status, aktualisiert `lastSync`.
  - Hinweis bei leeren Daten: "Bitte zuerst Daten aktualisieren".
  - Markiert Ausnahmen (wenn Kultur/Schadorg in `*_ausgenommen`).
- Styling in vorhandenen CSS-Dateien erweitern (keine Inline Styles).

### 5. Shell & Bootstrap Anpassungen
- `assets/js/features/shell/index.js`: `SECTION_MAP` um `{ id: 'zulassung', label: 'Zulassung' }` ergaenzen.
- `assets/js/core/bootstrap.js`: `initZulassung` importieren und aufrufen (analog zu anderen Features).
- Sichtbarkeit: Tab bleibt deaktiviert solange `app.hasDatabase` false.

### 6. Startup/Settings Integration
- Beim Event `database:connected` (siehe `features/startup`) `getBvlMeta('lastSyncIso')` aufrufen und State aktualisieren.
- Optional in `features/settings` Anzeige "Letzte BVL Aktualisierung".

### 7. Fehler- und Offline-Verhalten
- Sync-Button deaktivieren, wenn `sqliteDriver.isSupported()` false oder Worker nicht initialisiert.
- Fehler beim Sync via Toast und State `error` anzeigen.
- Timeout/Netrwerkfehler klar benennen.
- Hinweis bei Browser ohne FileSystem/OPFS: z. B. "Automatische Speicherung nicht moeglich".

### 8. Manuelle Testliste
1. Defaults laden -> Zulassung-Tab zeigt Hinweis "Keine BVL Daten".
2. Update ausfuehren -> Spinner, Erfolgsmeldung, results > 0.
3. Filter Kultur "SALAT" + Schadorganismus "LAUS" -> Ergebnisse plausibel, Ausnahmen sichtbar.
4. Erneuter Update direkt danach -> Meldung "Keine Aktualisierung".
5. Offline-Modus (DevTools) -> Update -> Fehlerhinweis, Daten unveraendert.
6. Browser neu laden -> `lastSync` sichtbar, Daten persistent.

## Annahmen (Dokumentation im PR)
- Kultur- und Schadorganismus-Codes werden initial unveraendert angezeigt; Klartext-Dekodierung via `kode` Endpunkt kann spaeter folgen.
- Aufwanddaten koennen mehrere Zeilen je Anwendung haben; UI zeigt Liste/Tabelle pro Anwendung.
- Wartezeiten koennen fehlen; UI zeigt "keine Angabe".

## Definition of Done
- Zulassung-Tab vorhanden, Filter und Ergebnisanzeige funktionieren.
- Sync-Button aktualisiert Daten, ersetzt Tabelleninhalte und meldet Status korrekt.
- SQLite Migration laeuft einmalig, bestehende Funktionalitaet (Berechnung, Historie, Einstellungen) bleibt intakt.
- README oder Hilfeabschnitt ergaenzt Hinweise zu neuem Tab und Update-Vorgehen.
- Code entspricht Projektstil (Module, Kommentare nur bei Bedarf, ASCII-only) und fuehrt zu keiner Regression laut manueller Testliste.
