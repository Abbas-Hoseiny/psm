# Pflanzenschutz-Aufzeichnung

> Historischer Hinweis: Das Repository heißt weiterhin `pflanzenschutzliste`, die Anwendung selbst wird jedoch neutral als **Pflanzenschutz-Aufzeichnung** geführt.

Pflanzenschutz-Aufzeichnung ist eine statische Web-Anwendung zur Verwaltung, Berechnung und Dokumentation von Pflanzenschutzmitteln. Die gesamte Logik läuft im Browser – inklusive einer **SQLite-WASM** Datenbank im Web Worker für große Datenmengen. Für Browser ohne OPFS stehen weiterhin JSON-basierte Speicher-Treiber zur Verfügung.

## Highlights

- Moderne Single-Page-App (ES-Module, kein Build-Step nötig)
- Persistent gespeicherte Berechnungen, History und Stammdaten
- SQLite-WASM mit OPFS-Unterstützung, Fallback auf JSON-Dateien oder LocalStorage
- **BVL-Zulassungsdaten**: Automatischer Sync aus vorbereiteter SQLite-Datenbank via [pflanzenschutzliste-data](https://github.com/Abbas-Hoseiny/pflanzenschutzliste-data)
- Sofortdruck (PDF) und Export/Import von Datenbank-Dateien
- Nutzerfreundliche Features wie `beforeunload`-Hinweis bei aktiver Datenbankverbindung

## Datenversorgung

Die Anwendung bezieht BVL-Zulassungsdaten aus dem externen Repository [pflanzenschutzliste-data](https://github.com/Abbas-Hoseiny/pflanzenschutzliste-data), das per GitHub Action täglich eine komplette SQLite-Datenbank erzeugt und über GitHub Pages bereitstellt.

### Manifest-basierte Synchronisation

Statt zur Laufzeit die BVL-API direkt abzufragen, lädt die App ein `manifest.json` von `https://abbas-hoseiny.github.io/pflanzenschutzliste-data/latest/manifest.json`, prüft die Version und lädt bei Bedarf die vorbereitete SQLite-Datei herunter. Dies bietet mehrere Vorteile:

- **Schnellerer Sync**: Eine einzelne Datei statt 40+ API-Aufrufe
- **Offline-fähig**: Daten können lokal vorgehalten werden
- **Erweiterte Daten**: Zusätzliche Informationen wie Wirkstoffe, Gefahrenhinweise, Hersteller etc.
- **Konsistenz**: Alle Clients nutzen denselben Datenstand

### Manifest-URL anpassen

Für Tests oder alternative Datenquellen kann die Manifest-URL in der Browser-Konsole geändert werden:

```javascript
// Eigene Manifest-URL setzen
localStorage.setItem("bvlManifestUrl", "https://example.com/my-manifest.json");

// Zurück zur Standard-URL
localStorage.removeItem("bvlManifestUrl");
```

Nach dem Ändern der URL einmal die Seite neu laden und dann "Daten aktualisieren" klicken.

## Lookup Explorer verwenden

Der Reiter **"EPPO & BBCH Lookup"** steht erst zur Verfügung, wenn eine Datenbank verbunden ist **und** in den Einstellungen der SQLite-Treiber aktiv ist. Ohne SQLite bleiben die Buttons deaktiviert und ein Hinweis erklärt den Grund.

### 1. Lookup-Daten importieren

- Öffne im linken Menü den Lookup-Bereich und prüfe den Status mit `Status aktualisieren` oder `Daten prüfen`.
- Lade EPPO- bzw. BBCH-Daten über die Buttons `Daten laden`. Der Import wird im Statusfeld (Datum, Eintragsanzahl) bestätigt.
- Wiederhole den Import nur bei neuen Daten – die App merkt sich den letzten Stand in der verbundenen Datenbank.

### 2. Sprache und Filter wählen

- Das EPPO-Formular besitzt ein Suchfeld, ein Limit (10/25/50) und ein dynamisches Sprach-Dropdown.
- Die Sprachen werden aus der Datenbank gelesen; unbekannte Codes werden automatisch als deutsche Labels (z. B. "Deutsch") dargestellt.
- Die gewählte Sprache wird im Browser gespeichert und bei der nächsten Sitzung wiederhergestellt. "Alle Sprachen" zeigt gemischte Treffer.

### 3. Suchen und blättern

- Starte die Suche mit `Suchen`. Standardmäßig werden 25 Treffer pro Seite geladen.
- Unter der Tabelle steht „Einträge X–Y von Z“ sowie ein Vor/Zurück-Buttonpaar. Darüber steuerst du explizit die Seiten; es werden nie mehr Datensätze geladen als angefordert.
- BBCH-Suchen funktionieren analog, allerdings ohne Sprachfilter.

### 4. Codes in Berechnung übernehmen

- Jede Zeile bietet `Kopieren` und `Übernehmen`.
- `Übernehmen` trägt EPPO-Code, Name sowie BBCH-Stadium direkt in das Berechnungsformular ein und quittiert den Erfolg mit einer Meldung.
- Ist keine SQLite-Datenbank aktiv, bleiben die Buttons deaktiviert, um Fehlversuche zu vermeiden.

## Projektstruktur

- `index.html` – Host-Dokument, bindet Bootstrap & App Entry-Point
- `assets/css/` – Basistheme, Layout und Komponenten-Styles
- `assets/config/` – Seed-Daten (`defaults.json`) und JSON-Schema (`schema.json`)
- `assets/js/main.js` – Einstiegspunkt, bootstrapped die App
- `assets/js/core/` – State-Management, Events, Storage, SQLite-Worker, Konfiguration
- `assets/js/core/storage/` – Treiber für SQLite-WASM, File System Access API, LocalStorage
- `assets/js/features/` – Feature-Module (Startup, Shell, Calculation, History, Settings, Reporting, Starfield)

## Storage-Treiber & Browser-Support

| Treiber            | Format          | Persistenz                     | Voraussetzungen                             | Empfohlen für                                    |
| ------------------ | --------------- | ------------------------------ | ------------------------------------------- | ------------------------------------------------ |
| SQLite-WASM        | `.sqlite`/`.db` | OPFS (Chromium) oder In-Memory | Chromium ≥108, HTTPS/localhost, WebAssembly | Produktive Nutzung, große Historien              |
| File System Access | `.json`         | Lokale Datei via Picker        | Chromium ≥86, HTTPS/localhost               | Kleine/mittlere Datenmengen, manuelles Speichern |
| LocalStorage       | `.json`         | Browser-Storage (max. ~10 MB)  | Alle modernen Browser                       | Demo/Test ohne Dateizugriff                      |

> Firefox & Safari unterstützen aktuell kein OPFS. In diesen Browsern läuft SQLite im Speicher und Änderungen sollten zusätzlich als JSON oder SQLite-Datei exportiert werden.

## Arbeiten mit SQLite-WASM

1. **Neue Datenbank erstellen** – Dateien werden im OPFS abgelegt (Chromium-basiert) oder optional direkt als `.sqlite` exportiert.
2. **Bestehende Datei verbinden** – sowohl JSON- als auch SQLite-Dateien werden erkannt und importiert.
3. **Änderungen speichern** – History-Änderungen (Speichern/Löschen) schreiben direkt in die aktive Datenbank.
4. **Seite verlassen** – Nutzer erhalten einen Hinweis, dass die Verbindung getrennt wird, solange eine DB aktiv ist.

## Datenmodell

### JSON-Snapshot (Export/Import)

```json
{
  "meta": {
    "version": 1,
    "company": { "name": "", "logoUrl": "", "contactEmail": "" },
    "defaults": { "waterPerKisteL": 5, "kistenProAr": 300 },
    "measurementMethods": [ { "id": "perKiste", "label": "pro Kiste" } ],
    "fieldLabels": { }
  },
  "mediums": [ { "id": "water", "name": "Wasser", "methodId": "perKiste", "value": 0.0166, "zulassungsnummer": "" } ],
  "history": [ { "ersteller": "…", "datum": "…", "items": [ … ] } ]
}
```

`assets/config/schema.json` beschreibt das komplette JSON-Schema.

### SQLite-Schema

| Tabelle               | Inhalt                                                 |
| --------------------- | ------------------------------------------------------ |
| `meta`                | Schlüssel/Werte für Company, Defaults, Labels, Version |
| `measurement_methods` | Messmethoden inkl. Konfiguration (JSON in Spalten)     |
| `mediums`             | Mittel mit Messmethode, Faktor und Zulassungsnummer    |
| `history`             | Header eines Historien-Eintrags (JSON)                 |
| `history_items`       | Detailwerte pro Mittel                                 |

SQL-Definition: `assets/js/core/storage/schema.sql`.

## Entwicklung & Setup

```bash
# Repository klonen (Name bleibt aus Kompatibilitätsgründen "pflanzenschutzliste")
git clone https://github.com/Abbas-Hoseiny/pflanzenschutzliste.git
cd pflanzenschutzliste

# Statischer Dev-Server (Beispiel)
python3 -m http.server

# Browser öffnen
open http://localhost:8000
```

Empfohlener Browser für Entwicklung: Chrome oder Edge (ermöglicht SQLite + OPFS). Beim ersten Start können die bereitgestellten Defaults geladen oder direkt eine neue Datenbank erstellt werden.

Deployment auf GitHub Pages funktioniert out-of-the-box, da die App aus statischen Assets besteht. Die Anwendung läuft dauerhaft öffentlich unter [https://abbas-hoseiny.github.io/pflanzenschutzliste/](https://abbas-hoseiny.github.io/pflanzenschutzliste/) und kann ohne Entwicklerkenntnisse direkt im Browser genutzt werden.

## Tests & Qualität

Automatisierte Tests sind aktuell nicht hinterlegt. Für Releases sollten diese manuellen Szenarien geprüft werden:

1. Neue SQLite-Datenbank erstellen, Berechnung durchführen, History speichern, Seite neu laden und Eintrag prüfen.
2. Historie-Eintrag löschen, Seite neu laden und sicherstellen, dass der Eintrag entfernt bleibt.
3. JSON-Datei importieren und anschließend als SQLite exportieren (und umgekehrt).
4. Browser ohne OPFS (Firefox/Safari) – prüfen, dass Fallback funktioniert und der Nutzer bei Bedarf Dateien exportieren kann.

## Lizenz

[MIT License](LICENSE) © 2025 Pflanzenschutz-Aufzeichnung
