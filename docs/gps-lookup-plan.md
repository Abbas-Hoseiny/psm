# GPS & Lookup Integrationsplan

> Umsetzungskontext: Anwendung **Pflanzenschutz-Aufzeichnung**.

## Ausgangslage

- Repository ist auf Commit `8e5f8ea` zurückgesetzt: Lookup-Feature vorhanden, GPS-Bereich war zuvor auseinandergebaut.
- Anforderungen:
  - **Lookup**: Fertigstellen und dokumentieren (Sprachfilter, Interaktion mit Formularen, robuste Imports).
  - **GPS**: Eigener Bereich zum Erfassen/Verwalten von Koordinaten ("Felder"); Berechnung nutzt nur Koordinaten, nicht den Feldnamen.
  - Saubere Modularisierung + Debug-Hooks, damit Fehler eingrenzbar bleiben.

## Funktionale Ziele

### Lookup

1. Nutzer können EPPO- und BBCH-Datenbanken laden, Status einsehen und suchen.
2. Sprachfilter für EPPO soll dynamisch sein und echte Mehrsprachigkeit unterstützen.
3. Ergebnisse sollen per Aktion direkt ins Berechnungsformular geschrieben werden (anstatt Copy & Paste).
4. Feature muss auch mit nicht-SQLite-Treibern klar kommunizieren (Feedback, Deaktivierung).

### GPS

1. Separater Navigationspunkt "GPS" (oder "Standorte"), erreichbar über Shell.
2. Funktionen:
   - Standort mit Name (intern), Beschreibung, Source-Hinweis aufnehmen.
   - Koordinaten via Browser-API oder manuell eingeben, Speicherung in zentralem State + DB.
   - Liste mit letzter Messung, Möglichkeit zum Setzen eines "aktiven" Punktes.
   - Debug-Anzeigen (z. B. aktueller State-Slice) um Fehler zu finden.
3. **Verwendung in Berechnung**:
   - Formular zeigt Dropdown oder Suggest-Eingabe mit gespeicherten Punkten.
   - Nur Koordinaten (lat/lng) fließen in History/Print; Name bleibt intern.
   - Fallback-Feld für freie Texteingabe bleibt bestehen.
   - Behördenrelevante Dokumente dürfen ausschließlich GPS-Koordinaten anzeigen; Feld-/Profilnamen bleiben interne Metadaten.

## Architekturplan

### State & Storage

- `state.ts`: Wiedereinführen einer Slice `gps: { points: GpsPoint[]; activePointId: string | null; lastError?: string }`.
- `database.ts` + `schema.sql`: persistente Speicherung (History bleibt unverändert; GPS-Punkte werden im Meta-Bereich oder neuer Tabelle `gps_points` abgelegt).
- `sqliteWorker.js`: Migration prüfen, damit Tabelle bei alten DBs angelegt wird.

### Module

1. **`@scripts/features/gps`**
   - UI mit Tabs (Liste / Aufnahme) + Debug-Panel (zeigt Raw-State, letzte Operation).
   - Services: Zugriff auf `state`, `events`.
   - Aktionen: `recordGpsPoint`, `setActiveGpsPoint`, `deleteGpsPoint`, `exportPoints` (Debug).
   - Fehler- und Pending-Zustände klar anzeigen.

2. **`@scripts/features/calculation`**
   - Feld `calc-gps` wird zu Combo: freier Text + Dropdown mit gespeicherten Punkten.
   - Beim Speichern: `header.gps` = freier Text; `header.gpsCoordinates` = vom ausgewählten Punkt (lat/lng).
   - Ausgabe/Print nutzt `gpsCoordinates` → formatierte Koordinaten.

3. **Lookup**
   - Neues Utility `lookupLanguages` (Worker-Query `SELECT DISTINCT language, language_label ...`).
   - UI aktualisiert `<select>` dynamisch inkl. persistenter Auswahl.
   - Ergebnis-Buttons: `Übernehmen (EPPO)` setzt `calc-eppo`, analog `BBCH`.
   - Wenn aktueller Treiber ≠ `sqlite`, Buttons disabled + Hinweis.
   - Debug-Log im Lookup-Panel (z. B. `console.table` + Ein-/Ausblendung).

### Debugging & Fehlertoleranz

- Jeder Feature-Init liefert `initialized = true`-Flag, loggt bei Mehrfachaufruf Warnung.
- Service-Events für wichtige Aktionen (z. B. `gps:pointRecorded`, `lookup:searchFailed`).
- Utility `reportFeatureStatus(featureName, details)` – schreibt in `state.ui.notifications` oder `console`.

## Umsetzungsschritte (High-Level)

1. **Lookup-Refactor**
   - Worker: Import so anpassen, dass mehrere Sprachzeilen pro Code gespeichert werden (`code + language` als Primärschlüssel).
   - API: `searchEppoLookup` optional `language=''` → alle; neue Funktion `listLookupLanguages()`.
   - UI: Dropdown dynamisch befüllen, Buttons für "Übernehmen in Formular".
   - Dokumentation + Styles ergänzen.

2. **GPS-Reintegration**
   - Schema/State/Treiber erweitern (`gps_points`-Tabelle, Snapshot-Felder).
   - Feature-UI (eigener Ordner wiederherstellen oder neu aufsetzen) + Shell-Navigation.
   - Calculation-Integration (Dropdown + History/Print-Anpassung).

3. **Tests/Checks**
   - `npm run build` + manuelle Durchläufe: GPS erfassen → Berechnung → History → Print.
   - Lookup: Import beider DBs, Sprachfilter testen, Formular-Übergabe prüfen.

## Offene Fragen

- Koordinaten-Eingabe über Geolocation-API erlaubt? (Berechtigungen, Fallback?).
- Speicherort für GPS-Punkte: separate Tabelle vs. Meta-JSON? (Tendenz: Tabelle).
- Debug-UI global oder Feature-spezifisch?

> Sobald wir dieses Konzept abnicken, folgt ein detailliertes Task-Breakdown (Tickets) und anschließend die Implementierung.

## GPS Task Breakdown

1. **Schema & Migrationen**
   - `assets/js/core/storage/schema.sql`: neue Tabelle `gps_points` (id, name, description, latitude, longitude, source, created_at, updated_at).
   - SQLite-Worker-Migration (`sqliteWorker.js`) inkl. `user_version`-Bump und Backfill für Bestandsdaten (legt leere Tabelle an, falls sie fehlt).
   - JSON-Snapshot (`assets/config/schema.json` + Export/Import-Routinen) um `gpsPoints`-Array erweitern.

2. **State & Services**
   - `state.ts`: Slice `gps` mit `points`, `activePointId`, `pending`, `lastError` + Selectors.
   - `database.ts`: CRUD-Funktionen `listGpsPoints`, `insertGpsPoint`, `updateGpsPoint`, `deleteGpsPoint`, `setActiveGpsPoint` (inkl. Event-Emittern `gps:pointRecorded`, `gps:pointDeleted`).
   - `eventBus`: neue Events `gps:request-current-position`, `gps:active-point-changed` für UI-Kopplung.

3. **Feature-Modul `@scripts/features/gps`**
   - Oberfläche mit Tabs "Liste" (sortiert nach Aktualisierung, Filter, Aktionen) und "Aufnahme" (Formular + Browser-Geolocation).
   - Debug-Panel mit Roh-State, letztem Event und Export-Button (JSON Download).
   - Aktionen: `recordGpsPoint`, `setActiveGpsPoint`, `deleteGpsPoint` mit Busy-States und Toasts.

4. **Shell & Navigation**
   - Shell-Menü erweitert um Punkt "GPS" inkl. Badge (Anzahl gespeicherter Punkte).
   - Feature lazy initialisieren und doppelte Initialisierung per `initialized`-Flag abfangen.

5. **Calculation-Integration**
   - Formularfeld `calc-gps` zu Combobox umbauen (freier Text + Dropdown der gespeicherten Punkte).
   - Beim Speichern: `header.gps` = Freitext, `header.gpsCoordinates` = Koordinaten des aktiven Punktes; History/Print erhalten Formatierer für `gpsCoordinates`.
   - Lookup/Calculation-Events ergänzen: `gps:set-active-from-history` o. ä. für Wiederverwendung.

6. **Tests & Verifikation**
   - Manuell: Punkt anlegen → aktiv setzen → Berechnung speichern → History/Print prüfen.
   - Regression: Lookup weiterhin funktionsfähig (Import, Sprache, Pagination, Apply).

## Fortschrittsnotiz · 23.11.2025

- Lookup-Worker speichert nun EPPO-Einträge mit zusammengesetztem Schlüssel (`code + language`) und stellt `listLookupLanguages()` für die UI bereit.
- Lookup-UI nutzt einen dynamischen Sprachfilter (persistiert in `localStorage`), seitenbasierte Pagination (25/50 Einträge) und deaktiviert Aktionen automatisch, wenn kein SQLite-Treiber aktiv ist.
- Ergebnislisten besitzen Copy- und "Übernehmen"-Buttons; Letztere feuern `lookup:apply-*`-Events, die das Berechnungsformular füllen.
- Calculation-Feature abonniert die Lookup-Events, übernimmt Codes direkt in `calc-eppo`/`calc-bbch` und füllt Kulturname, sofern leer.
- SQLite-Schema ergänzt `gps_points` inklusive Migration (`user_version` 6); der Worker liefert CRUD- sowie Active-Point-Actions.
- `state.ts` enthält wieder eine `gps`-Slice, und `core/database.ts` stellt asynchrone Helper zum Laden/Speichern/Löschen/Selektieren bereit.
- GPS-Feature (Tabs, Formular, Debug) ist als eigener Menüpunkt verdrahtet; `indexClient` initialisiert `initGps`, und die Shell enthält einen "GPS"-Eintrag.
- Das Berechnungsformular bietet jetzt eine Verknüpfung zu gespeicherten GPS-Punkten (Dropdown + "Aktiver Punkt"-Button) und persistiert `gpsCoordinates`, `gpsPointId` sowie den Freitext separat.
- History-Karten, Detailansicht und Druckausgaben zeigen automatisch die formatierten Koordinaten (`formatGpsCoordinates`) und fallen nur auf Freitext zurück, falls keine Daten vorliegen.
- Historienkarten (inkl. Detailansicht) besitzen jetzt eine Aktion "GPS aktivieren", die `gps:set-active-from-history` feuert; das GPS-Modul setzt daraufhin den gespeicherten Punkt aktiv und quittiert den Status im UI.
- GPS- und History-Ansichten zeigen anklickbare "Google Maps"-Links neben Koordinaten sowie direkte Buttons in Karten/Details; jeder Link öffnet die externe Karte in einem neuen Tab für ein freundlicheres UX.
- Reporting-, History- und Print-Templates trennen GPS-Freitext jetzt sichtbar von den präzisen Koordinaten; jede Koordinatenzeile enthält zusätzlich den direkten Google-Maps-Link (auch im Druck/PDF sichtbar).
- Nach einer Aktivierungsanfrage meldet das GPS-Modul den Status (pending/success/error) asynchron zurück; die Historie blendet daraufhin automatisch farbcodierte Hinweise im UI ein, damit Operatoren Feedback ohne Tab-Wechsel erhalten.
- GPS-Bereich besitzt nun einen permanent sichtbaren "Google Maps"-Button sowie einen leeren Zustand mit Hinweis; ohne gespeicherte Punkte öffnet sich Maps automatisch an der Betriebsadresse bzw. einem sinnvollen Standard, sodass niemand "bei Null" auf der Weltkarte starten muss.
- Das Erfassungsformular enthält ein Feld "Koordinaten aus Google Maps" samt Split-Button: Einfügen einer Rohzeile (z. B. aus Maps kopiert) teilt sie automatisch in Latitude/Longitude auf, rundet auf 6 Nachkommastellen und hält damit die offiziellen Ausgaben streng bei Koordinaten ohne Flächen- oder Feldnamen.
- Zusätzlich gibt es eine Schaltfläche "Koordinaten in Google Maps prüfen", die den aktuell eingegebenen Wert sofort in einem neuen Tab öffnet; sie bleibt deaktiviert, bis gültige Werte vorliegen, sodass Bediener die Lage visuell bestätigen können, bevor sie speichern oder exportieren.
- Nächste Schritte: (1) Regressionstests für den End-to-End-Flow "GPS anlegen → Berechnung → Historie/Print" dokumentieren und automatisierbar machen. (2) Optional: Lightweight Testplan für Lookup+GPS-Kombinationen (Lookup → Berechnung → GPS-Aktivierung) erstellen.
