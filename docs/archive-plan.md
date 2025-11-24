# Archivierung & Bereinigung – Anforderungen

Stand: 2025-11-23

## Ziele

- Nutzbare Archiv-Funktion für große Datenbestände (>10k Einträge).
- Vollständiger ZIP-Export des ausgewählten Zeitraums bevor Daten gelöscht werden.
- Nach dem Löschen automatische Bereinigung der SQLite-Datei (VACUUM) und Aktualisierung der Dokumentationsansicht.
- Dauerhafte Protokollierung (ArchiveLog) mit Hinweis, wo die Sicherung gespeichert wurde.
- Transparente UX: Nutzer versteht jederzeit, was archiviert und gelöscht wurde.

## UI-Anforderungen

- **Einstiegspunkt**: Neue Karte "Archiv & Bereinigung" unterhalb der Dokumentations-Liste (`src/scripts/features/documentation/index.ts`). Die Karte enthält Statushinweise und einen Button „Archiv erstellen“.
- **Modal / Dialog**: Beim Start öffnet sich ein Dialog mit folgenden Eingaben:
  - Zeitraum (Start/Ende) – vorbefüllt aus aktuellen Dokumentationsfiltern.
  - Optional: Textfeld „Hinweis/Storage-Ort" (z. B. NAS-Pfad), landet als `storageHint` im Log.
  - Optional: Freitext-Notiz.
  - Checkbox „nach dem Export aus Datenbank entfernen“ (standardmäßig aktiv; deaktiviert = nur Backup, kein Löschen).
- **Statusanzeige**: Fortschritts-UI (3 Schritte: Export, Löschen, Bereinigung). Fehlerhinweis + Retry-Option.
- **Nach Abschluss**: Snackbar/Alert mit Download-Link (falls im Browser erstellt) und Button „Dokumentation anzeigen“ → löst Focus-Event aus.
- **Archive Log UI**: Tabelle in gleicher Karte, zeigt letzte N Einträge aus `state.archives.logs` (Datum, Zeitraum, Einträge, Speicherhinweis). Expandierter Bereich für Notizen + Buttons (Dokumentationsfokus setzen, Hinweis kopieren).

## Datenmodell & Persistenz

- `ArchiveLogEntry` (bereits in `src/scripts/core/state.ts`) wird so genutzt:
  - `id`: `archive-${timestamp}-${random}`.
  - `archivedAt`: ISO-String (UTC) des Abschlusses.
  - `startDate`, `endDate`: ISO-Datum ohne Zeit (Formularwerte).
  - `entryCount`: Anzahl exportierter Datensätze.
  - `fileName`: vom Export erzeugter Dateiname (z. B. `pflanzenschutz-archiv-2025-11-23.zip`).
  - `storageHint`: Freitext aus UI (Pfad/Beschreibung).
  - `note`: Freitext.
  - Optional spätere Felder: `driver`, `sizeBytes`.
- Logs werden im Snapshot und `createInitialDatabase` (bereits vorbereitet) gespeichert. SQLite-Worker muss `archives`-Payload ebenfalls sichern (Snapshot/Import/Export Pfad).
- Neues Worker-API (`src/scripts/core/storage/sqlite.ts` + Worker) für Archiv-Vorgang:
  - `listHistoryByRange(filters)` (bestehend) wird wiederverwendet für Export.
  - `deleteHistoryByRange({ startDate, endDate, creator?, crop? })` – Löschung mit Transaction.
  - `vacuum()` – ruft `VACUUM` auf (nur erlaubt, wenn keine Transaktion offen).

## Workflow (Happy Path)

1. Nutzer öffnet Archiv-Dialog (nur wenn `storageDriver === "sqlite"`).
2. UI validiert Zeitraum (max. 5000 Einträge? configurable) per `listHistoryEntries` mit Filtern.
3. Export:
   - Greift `listHistoryEntries` paginiert (Chunks à 250) und sammelt Einträge.
   - Erzeugt ZIP mit `pflanzenschutz.json` und `metadata.json` (`reason: "archive"`, filter-Metadaten, `entryIds`).
   - Browser: `Blob` → Download; optional zusätzlicher Persist via File System Access API, falls verfügbar.
4. Löschphase (wenn Checkbox aktiv):
   - Übergibt identische Filter an Worker-Methode zum Löschen.
   - Danach Worker `vacuum()`.
5. State-Updates:
   - Entfernt gelöschte Einträge aus `state.history` (damit Memory-Treiber konsistent bleibt).
   - Fügt neuen `ArchiveLogEntry` zu `state.archives.logs` (letzte 50 behalten?) hinzu und persistiert (`saveDatabase`).
6. Dokumentation erhält Fokus-Ereignis über bereits bestehendes Event-System:
   ```ts
   services.events?.emit("documentation:focus-range", {
     startDate,
     endDate,
     label: "Archiviert",
     reason: "archive",
     entryIds: exportedRefs.slice(0, 50),
   });
   ```

## Fehler- & Edge-Cases

- **Nicht-SQLite**: Archiv-Button disabled mit Hinweis „nur verfügbar mit lokaler SQLite-Datenbank“.
- **Leere Filter**: UI blockiert Start, falls keine Datensätze existieren (Vorab-Abfrage).
- **Browser-Abbruch**: Wenn Download fehlschlägt, wird kein Löschen durchgeführt; Nutzer bekommt Fehlerhinweis.
- **Löschfehler**: Falls Export erfolgreich war, aber Löschung scheitert, Log wird nicht geschrieben; Nutzer sieht Hinweis, dass DB unverändert blieb.
- **VACUUM nicht möglich**: Fehlermeldung, Log-Eintrag markiert `note = "Vacuum fehlgeschlagen"` und UI empfiehlt Neustart.
- **OPFS/FS-API**: Optionaler Modus, in dem Archiv direkt im App-Verzeichnis gespeichert wird (später). Für jetzt reicht Browser-Download.

## Wechselwirkungen

- **Import & Merge (`src/scripts/features/importMerge/index.ts`)**: Archiv-ZIP entspricht Import-Format, daher keine zusätzlichen Felder notwendig.
- **Dokumentation**: Muss neue Karte + Fokus-Hinweis unterstützen; `doc-focus`-Banner wird wiederverwendet.
- **State/DB**: `getDatabaseSnapshot` enthält Logs → Importieren eines Backups bringt Log-Historie zurück.
- **Docs**: README/DOKUMENTATION ergänzen (neuer Abschnitt „Archiv & Bereinigung“).

## Offen

- Dateigröße im Log (lässt sich aus Blob ableiten) – nice-to-have.
- Automatische Erinnerung bei überschreiten eines DB-Limits (z. B. >200 MB) – später.
- Mehrfachauswahl vs. Filter-basierte Archive – V1 ausschließlich Filter-basierter Zeitraum.
