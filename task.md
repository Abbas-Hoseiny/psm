# Task: SQLite-Persistenz erweitern

## Ausgangslage

- Meta-Daten (Firma, Defaults, Feldlabels), Messmethoden, Mittel, Historie und GPS-Punkte landen bereits in der SQLite-Datei (`src/scripts/core/storage/sqliteWorker.js`).
- Lookup-/Zulassungsdaten (`lookup_*`, `bvl_*`, `bvl_api_payloads`) werden im gleichen File migriert, sollen perspektivisch aber getrennt oder gefiltert werden.
- `mediumProfiles` existieren nur im App-State und Snapshots, haben jedoch keine Tabellen in `storage/schema.sql` und fehlen im Import/Export.
- UI-Zustände (z. B. `calcContext`, `ui.notifications`, Zulassung-Filter) bleiben bewusst flüchtig.

## Arbeitsschritte

### 1. Snapshot-Vollständigkeit herstellen

- `getDatabaseSnapshot()` und `createInitialDatabase()` prüfen, ob alle benötigten Felder exportiert werden (inkl. `mediumProfiles`).
- `sqliteWorker.exportSnapshot`/`importSnapshot` erweitern, damit Profile + Verknüpfungen mit Mitteln erfasst bzw. wiederhergestellt werden.
- Sicherstellen, dass alternative Treiber (Memory, Filesystem) weiterhin dieselben Strukturen verstehen.
- **Status 2025-11-23:** Offen – Export/Import inkl. `mediumProfiles` noch final prüfen/angleichen.

### 2. Schema & Migration für Medium-Profile

- Tabellen `medium_profiles` (id, name, timestamps) und `medium_profile_mediums` (profile_id, medium_id, sort_order) in `storage/schema.sql` ergänzen.
- Migration in `applySchema()` aufnehmen, inklusive Backfill aus vorhandenen Snapshots (falls möglich).
- CRUD-Hilfen im Worker bereitstellen, um Profile direkt zu persistieren, sobald der Nutzer Änderungen speichert.
- **Status 2025-11-23:** Offen – Migration + CRUDs vorbereitet, aber Abgleich mit Live-Daten (OPFS, Export) steht aus.

### 3. Lookup/Zulassung aus Nutzerdaten herauslösen

- Entscheiden, ob eine zweite SQLite-Datei (`zulassung.sqlite`) die BVL-/Lookup-Daten hält oder ob Export/Import diese Tabellen beim Teilen filtert.
- Bei Single-File-Ansatz: `exportSnapshot` und eventuelle Dateiexporte so anpassen, dass `lookup_*`, `bvl_*`, `bvl_api_payloads` nicht im Nutzer-Backup landen.
- Schnittstellen prüfen, damit Lookup-Caches bei Bedarf neu aufgebaut oder separat synchronisiert werden können.
- **Status 2025-11-23:** Offen – Architekturentscheidung (zweite DB vs. gefilterter Export) noch ausstehend.

### 4. Automatisches Persistieren angleichen

- Settings-/Profile-Änderungen optional direkt via Worker-CRUD speichern, statt auf einen manuellen "Speichern"-Button zu warten.
- Prüfen, welche Features noch ausschließlich im In-Memory-State laufen (z. B. `calcContext`) und ob Persistenz sinnvoll ist.
- **Status 2025-11-23:** Offen – Analyse + Konzept fehlen noch.

### 5. Pflichtfeld "Art der Verwendung"

- Neues Pflichtfeld im Berechnungsformular hinzufügen (Dropdown oder Freitext), idealerweise gespeist aus den vorhandenen BVL-Verwendungszwecken (`awg_verwendungszweck`).
- Feldwerte im Calculation-Header und damit in Historie, Reporting, Export/Druck ablegen, damit die SUR-Pflichtangabe abgedeckt ist.
- Snapshot/Persistenz erweitern, sodass der Wert in SQLite samt History-Einträgen landet.
- UI-Labels/Drucklayouts anpassen, damit der Eintrag klar sichtbar ist.
- **Status 2025-11-23:** Freitextfeld + Persistenz umgesetzt (Anzeige in Formular, Ergebniskarte, Historie & Snapshots). Nächster Schritt: Lookup-gestützte Auswahl vorbereiten.

### 6. Export & Import (JSON/ZIP)

- Format festlegen: ZIP-Container je Export mit z. B. `pflanzenschutz.json` (Kerndaten ohne Lookup), optional `lookup.sqlite` oder `zulassung.sqlite`, `metadata.json` (Version, Zeitraum, Hash) sowie evtl. PDF-Berichte.
- Export-UI: Bereich „Daten & Backup“ mit Aktionen „Komplettbackup“, „Zeitraum-Export“, „Teil-Export für Behörden“. JSON entsteht via SQLite-Worker-Query, ZIP per JSZip/Stream; Nutzer lädt Datei herunter.
- Import/Merge: Upload ZIP → Validierung → Merge-Dialog (Duplikate erkennen über `savedAt`/UUID, Konfliktstrategien). Ergebnis wird in SQLite geschrieben; UI soll direkt den importierten Zeitraum in der Dokumentationsansicht anzeigen.
- Automatische Sicherung (optional): Nach jeder Speicherung eine lokale ZIP-Kopie im OPFS ablegen, sodass Offline-Backups existieren.
- Dokumentation: README/Docs erklären Dateistruktur, Merge-Abläufe und wie Lookup/Zulassung separat behandelt werden.
- **Status 2025-11-23:** Offen – Format, UI und Merge-Flow noch nicht umgesetzt.

### 7. Dokumentationsbereich vereinheitlichen

- Historie & Berichte zu einer gemeinsamen Ansicht „Dokumentation“ zusammenführen: Filterleiste (Zeitraum, Kultur, Anwender, EPPO, Schlag etc.), Ergebnisliste mit Detailkarte + Aktionen (Drucken, Löschen, Export).
- Ladeverhalten umstellen: initial nur jüngste Einträge, dann paginierte/nachladbare Blöcke aus SQLite (`LIMIT/OFFSET` oder Cursor). Keine kompletten Arrays mehr im App-State behalten.
- Suche wie im Lookup: Nutzer muss gezielt filtern; Ergebnisse erscheinen lazy und RAM-schonend. Optional virtuelle Liste nur für den sichtbaren Block.
- Nach Merge-/Import-Aktionen soll dieselbe Ansicht genutzt werden, um neue Einträge zu kontrollieren (z. B. automatische Auswahl des importierten Zeitraums).
- **Status 2025-11-23:** Erste Version der „Dokumentation“ ersetzt Historie/Berichte (Filter, Lazy-Load, Detailkarte, Druck/Export/Löschen). Nächster Schritt: direkte SQLite-Abfragen + Import-Marker integrieren.

### 8. Tests & Validierung

- Migrationen gegen Bestandsdaten testen (lokale `.sqlite` Backups einspielen, `applySchema` ausführen, Unterschied prüfen).
- UI-Flows durchspielen: Mittel anlegen/ändern, Profile verwalten, GPS CRUD, Historie schreiben.
- Export/Import-Roundtrip durchführen, um sicherzustellen, dass alle gewünschten Daten erhalten bleiben und Lookup/Zulassung ausgeschlossen sind.
- **Status 2025-11-23:** Offen – Gesamttestplan steht noch aus.
