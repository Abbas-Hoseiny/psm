# Frontend-Task: BVL-Daten aus `pflanzenschutz-db` einbinden

## Kontext

- Neues externes Repository [`pflanzenschutz-db`](https://github.com/Abbas-Hoseiny/pflanzenschutz-db) erzeugt per ETL-Pipeline eine komplette SQLite-Datenbank samt `manifest.json` und veröffentlicht sie über GitHub Pages (`https://abbas-hoseiny.github.io/pflanzenschutz-db/`).
- Der aktuelle Frontend-Code (`assets/js/core/bvlSync.js`) lädt die 40 BVL-API-Endpunkte zur Laufzeit und befüllt die Tabellen in `sqliteWorker.js` über `importBvlDataset`.
- Ziel ist, dass die App künftig **nur noch** die fertig gebaute SQLite-Datei aus dem Daten-Repo lädt, mit `manifest.json` abgleicht und sämtliche Zusatzinformationen (Gefahrhinweise, Wirkstoffe, Hersteller etc.) korrekt und vollständig im UI darstellt.

## Ziele

1. Manifestgestützte Datensynchronisierung implementieren (kein direkter BVL-API-Download mehr im Browser).
2. SQLite-Daten aus dem ETL-Repo in die bestehende Worker-Datenbank übernehmen, ohne Nutzer-Tabellen (`mediums`, `history`, ...) zu überschreiben.
3. Zusätzliche Tabellen/Felder aus dem ETL-Schema im Zulassungs-UI anzeigen (so viel wie möglich, aber fachlich korrekt).
4. Nachverfolgbare Metadaten (`version`, `hash`, `build`, `apiStand`) aus `manifest.json` speichern und im UI ausweisen.

## Muss-Anforderungen

### 1. Konfiguration & Manifest

- Neues Modul (`assets/js/core/bvlDataset.js` o. ä.) schreiben:
  - Standard-URL des Manifests: `https://abbas-hoseiny.github.io/pflanzenschutz-db/manifest.json` (per Konstante, optional über `localStorage` overridebar für Tests).
  - Manifest laden, Minimalvalidierung durchführen (`files`, `version`, `tables`). Optional `manifest-schema.json` aus dem Daten-Repo einbinden und mit `ajv` o. ä. prüfen.
  - Einen geeigneten Datei-Eintrag auswählen:
    - Bevorzugt `.sqlite.br`, falls `DecompressionStream('brotli')` unterstützt.
    - Fallback `.sqlite` (direkt einsetzbar).
    - Fallback `.sqlite.zip` (per `JSZip` oder nativem `decompressionStream('gzip')`).
  - Download mit Progress-Callback (für UI-Progressbar).
  - Ergebnis als `Uint8Array` zurückgeben sowie Metainformationen (Dateigröße, Hash, Manifest).

### 2. Worker: Import aus SQLite-Datei

- In `assets/js/core/storage/sqliteWorker.js` neues Kommando hinzufügen (`importBvlSqlite` o. ä.).
- Umsetzungsidee:

  1. Remote-DB in Memory laden (`sqlite3.oo1.DB()` + `sqlite3_deserialize`).
  2. Liste der relevanten BVL-Tabellen anhand `sqlite_master` bzw. Manifest bestimmen. Pflicht: `bvl_meta`, `bvl_mittel`, `bvl_awg`, `bvl_awg_kultur`, `bvl_awg_schadorg`, `bvl_awg_aufwand`, `bvl_awg_wartezeit`, `bvl_lookup_kultur`, `bvl_lookup_schadorg`. Optional (falls vorhanden) auch: `bvl_mittel_wirkstoffe`, `bvl_mittel_gefahrhinweise`, `bvl_mittel_sicherheitshinweise`, `bvl_mittel_gefahrenpiktogramm`, `bvl_mittel_vertrieb`, `bvl_mittel_abpackung`, `bvl_mittel_zusatzstoff`, `bvl_awg_partner`, `bvl_awg_verwendungszweck`, `bvl_lookup_*` weitere Listen etc.
  3. Für jede Tabelle: `DELETE` auf Haupt-DB, anschließend `INSERT INTO main.table (cols...) SELECT cols... FROM remote.table`. Spaltenliste per `PRAGMA table_info` ermitteln, damit zusätzliche Spalten automatisch übernommen werden.
  4. Indizes behalten (werden von Migration hergestellt). Falls neue Indizes benötigt werden, Schema entsprechend anpassen (Quelle: `pflanzenschutz-db/utils/sqlite_schema.sql`).
  5. `bvl_meta` nach Import mit Manifest-Werten überschreiben: `lastSyncIso`, `lastSyncHash`, `lastSyncCounts`, `dataSource` (`pflanzenschutz-db@<manifest.version>`), `apiStand` (`manifest.api_version` oder `manifest.stand_endpoint.timestamp`).
  6. Sauberes Error-Handling + `PRAGMA integrity_check` nach Import (Fehler werfen).

- `applySchema()` im Worker auf neue Tabellen/Spalten erweitern (Schema via ETL-Repo abgleichen). Wichtig: keine Nutzer-Tabellen löschen.

### 3. Orchestrator (`bvlSync.js`)

- `syncBvlData` so umbauen, dass es:
  - Manifest lädt (`fetchManifest`), Version & Hash mit `bvl_meta` vergleicht.
  - Beim Gleichstand (`hash` identisch) nur Metadaten aktualisiert und "keine Aktualisierung" meldet.
  - Bei neuen Daten die SQLite-Datei herunterlädt, Worker-Kommando `importBvlSqlite` aufruft und Progress/Logs aktualisiert.
  - Die bisherigen `fetchCollection`-Aufrufe komplett entfernt oder als reiner Fallback hinter Feature-Flag belässt.
  - `lastSyncCounts` aus `manifest.tables` übernimmt.
  - Debug-Log erweitern: Downloadgröße, Dekompressionsmethode, Importdauer.

### 4. UI-Anpassungen (`features/zulassung/index.js`)

- Statuskarte ergänzen: Manifest-Version (`version`), Build-Zeit (`build.finished_at`), Datenquelle (`dataSource`), API-Stand.
- Ergebnisse erweitern (dynamische Anzeige nur falls Daten vorhanden):
  - **Wirkstoffe** mit Mengen/Einheiten (Tabelle `bvl_mittel_wirkstoffe`).
  - **Gefahr- & Sicherheitshinweise** (H-/P-Sätze), Hazard-Kategorien, Piktogramme (ggf. als Badges/Icons).
  - **Bio-/Öko-Flag** (`bvl_mittel_extras.is_bio` oder ähnlich) als Badge.
  - **Hersteller / Vertrieb** (bvl_mittel_vertrieb) inkl. Website-Link (`manufacturer_url`).
  - **Abpackungen** (Inhalt, Einheit, Artikelnummer), Zusatzstoffe, Auflagen (`bvl_awg_auflage`, falls vorhanden).
  - **Partner/Verwendungszwecke** (Auflistung, falls Tabellen vorhanden).
- Darstellung so gestalten, dass sie bei fehlenden Tabellen elegant ausblendet.
- Filterbereich ggf. um zusätzliche Filter erweitern, sofern Lookup-Daten verfügbar (z. B. Bio-Filter, Gefahrklassen). Mindestens aber Klartext-Lookups weiter nutzen.

### 5. State & Meta

- `state.zulassung.debug` um Manifest und Import-Metriken ergänzen (z. B. `debug.manifest`).
- `services.events.emit('database:connected', …)` sollte direkt manifestbasierten Sync anstoßen, wenn noch keine BVL-Daten importiert wurden (Auto-Load-Prüfung: `lastSyncIso` fehlt).

### 6. Dokumentation

- `README.md` im Frontend um neuen Datenfluss ergänzen (Abschnitt "Datenversorgung" verlinkt auf `pflanzenschutz-db`).
- Kurzbeschreibung für Admins, wie Manifest-URL geändert werden kann (z. B. Browser-Konsole `localStorage.setItem('bvlManifestUrl', '...')`).

## Tests & Verifikation

- Manuelle Tests (Chromium, Firefox, Safari):
  1. Start ohne bestehende Daten -> Manifest-Sync startet, Daten sichtbar.
  2. Erneuter Sync ohne Änderungen -> meldet "keine Aktualisierung", UI bleibt stabil.
  3. Manifest-URL auf Test-Branch umlenken -> Sync nutzt neue Quelle.
  4. Offline-Modus -> Sync verweigert sich mit eindeutiger Fehlermeldung.
  5. Prüfung der UI-Anzeige: Gefahrenhinweise, Wirkstoffe, Bio-Flag, Hersteller, Abpackungen.
- Unit-Tests optional: Hilfsfunktionen (Manifest-Pick, Dekompression, SQL-Import) mit Jest/vitest oder reinen JS-Tests.
- Nach Import einmal `diagnoseBvlSchema` nutzen und prüfen, dass neue Tabellen/Spalten vorhanden sind.

## Abnahme-Kriterien

- `syncBvlData` nutzt ausschließlich Manifest-Download (kein Live-API-Zugriff mehr bei Standardlauf).
- `bvl_meta` enthält `dataSource`, `lastSyncIso`, `lastSyncHash`, `lastSyncCounts` aus dem Manifest.
- Zulassungs-UI zeigt zusätzliche Detailinformationen (Wirkstoffe, Gefahren, Herstellerinfos) sofern in DB vorhanden.
- Fehlerfälle (Manifest nicht erreichbar, Download bricht ab, DB invalid) werden im UI klar dargestellt.
- Dokumentation aktualisiert.

## Offene Punkte für Entwickler

- Browser-Unterstützung für `DecompressionStream('brotli')` prüfen. Falls nicht verfügbar, Bundler-freie Brotli-Implementierung evaluieren oder `.sqlite` direkt laden.
- Welche optionalen Tabellen produziert das ETL-Repo final? Schema-Datei ggf. automatisiert synchronisieren (Build-Skript?).
- Performance bei großen Datenmengen beobachten (evtl. Anzeige paginieren, falls `results.length` > 200).

> Bitte alle Änderungen inkrementell committen und offene Fragen in der PR dokumentieren.
