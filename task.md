# Taskplan: Performance-Regeln und Speicherbudgets

## Leitidee

Keine UI darf mehr komplette Datenbestaende auf einmal laden oder im Arbeitsspeicher halten. Alle Features folgen festen Budgets (Eintragsmenge bzw. Payload-Groessen) und teilen Inhalte in wiederladbare Bloecke auf. Nach jedem Schritt werden passende Tests oder QA-Checks durchgefuehrt.

## Arbeitspakete

### 1. Leitplanken dokumentieren

- [x] PERFORMANCE-Richtlinie in [`PERFORMANCE.md`](./PERFORMANCE.md) festhalten (Budgets, UX-Muster, Debug-Hilfen) und dort aktuell halten.
- [x] `task.md` verlinkt die Regeln, damit neue Features automatisch daran gemessen werden.
- Tests: Markdown lint plus Review.

### 2. Datenzugriffe vereinheitlichen

- [x] Jede Worker-Liste (History, Reporting, Documentation, Settings/Mediums, GPS, Import-Vorschau) muss Cursor- oder pageSize-Parameter besitzen.
- [x] Fehlende Endpunkte ergaenzen (`listMediumsPaged`, `listGpsPointsPaged`, `streamHistoryChunk`, ...).
- [x] Persistenz-Verhalten pruefen: Nach Batch-Schreiboperationen muss `persistSqliteDatabaseFile()` bzw. das Debounce greifen.
- Tests: Vitest bzw. Vite Integration sowie `npm run build`.

### 3. UI-Komponenten auf Paging umbauen

- [ ] Gemeinsames "Mehr laden"-Widget inklusive Spinner, Fehlerzustand und Retry.
- [ ] Virtual-List-Helper anpassen, damit er Cursor-Callbacks aus Schritt 2 nutzt.
- [ ] Module migrieren (History, Reporting, Documentation, Import-Vorschau, Settings, GPS-Liste, Lookup). Nach jedem Modul manuelles QA (Scroll + Reload + Filter).
- Tests: Komponententests, etwa mit Vitest + Testing Library, sowie manuelle Browser-Smoketests.

### 4. State- und Event-Synchronitaet absichern

- [ ] State-Slices verschlanken: keine globalen Arrays mehr, nur `{ items, cursor, totalCount }` pro Domaene.
- [ ] EventBus erweitern (z. B. `history:data-changed`, `gps:data-changed`), damit andere Module ihre Ausschnitte invalidieren.
- [ ] Auto-Refresh-Policies definieren: wann Listen automatisch neu laden und wann ein Hinweis angezeigt wird.
- Tests: Unit-Tests fuer Store/Reducer, manuelle UI-Checks (Mutationen in Modul A wirken in Modul B).

### 5. Monitoring und Schutzmechanismen

- [ ] Debug-Overlay anzeigen (aktuelle Items, Cursor-Status, letzte Fetch-Zeit).
- [ ] Dev-Warnung ausgeben, sobald mehr als N Items oder M Megabyte gleichzeitig geladen werden.
- [ ] Optionale Telemetrie-Hooks fuer Ladezeiten und RAM-Verbrauch im Dev-Mode aktivieren.
- Tests: Manuelle Dev-Session plus automatisierte Checks, dass Warnungen beim Ueberschreiten feuern.

### 6. QA und Regression

- [ ] Testmatrix mit Szenarien (Initial Load, Mehr laden, Filter, Delete, Browser-Reload) pro Feature bauen.
- [ ] Manuelle QA mit grossem Datensatz (z. B. 10k History-Eintraege) und RAM-Monitoring.
- [ ] Release-Gate: Kein Merge, bevor alle Szenarien abgehakt und `npm run build` gruen sind.

## Abhaengigkeiten und Hinweise

- Worker-API-Erweiterungen (Schritt 2) sind Voraussetzung fuer UI-Umbauten (Schritt 3).
- Eventing aus Schritt 4 sofort nach jedem Modul-Refactor pruefen, sonst drohen Inkonsistenzen.
- Debug bzw. Monitoring (Schritt 5) nur im Dev-Build aktivieren (Feature-Flag), damit Endnutzer unbehelligt bleiben.
- QA (Schritt 6) nutzt reale Import- bzw. History-Datensaetze, damit Speicherspitzen realistisch bleiben.
- Erfolgsdefinition: Listen initial hoechstens 50 Eintraege, weitere Daten ausschliesslich ueber Cursor/Paging; Browser-RAM bleibt unter 250 MB bei 10k History-Eintraegen.
