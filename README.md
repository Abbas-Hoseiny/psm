# Bio-Pflanzenschutz – All in One

Statische Web-Anwendung zur Verwaltung und Berechnung von Pflanzenschutzmitteln. Die App läuft komplett im Browser und nutzt **SQLite-WASM** für performante Datenverwaltung bei großen Datenmengen. Alternativ stehen die File System Access API oder ein LocalStorage-Fallback zur Verfügung. Die Oberfläche wurde in modulare Features aufgeteilt und lässt sich über GitHub Pages direkt ausliefern.

## Architekturüberblick

- **index.html** – minimaler Host, bindet Bootstrap sowie die gebündelten Styles und lädt `assets/js/main.js` als ES-Modul.
- **assets/css/** – thematische Stylesheets (`base.css`, `layout.css`, `components.css`) mit CSS-Variablen für das Branding.
- **assets/config/** – Seed- und Schema-Dateien (`defaults.json`, `schema.json`) liefern Startdaten und Validierungsgrundlage.
- **assets/js/core/** – Infrastrukturmodule (State-Management, EventBus, Storage-Abstraktion, Bootstrap, Config-Handling, Database-Snapshots).
- **assets/js/core/storage/** – Storage-Treiber (SQLite-WASM, File System Access API, LocalStorage-Fallback) mit Web Worker für SQLite.
- **assets/js/features/** – unabhängige Feature-Pakete (Startup, Shell, Calculation, History, Settings, Reporting, Starfield).

## Storage-Systeme

Die Anwendung unterstützt drei Storage-Backends, die automatisch nach Verfügbarkeit priorisiert werden:

### 1. SQLite-WASM (Bevorzugt) 🚀

- **Performance:** Optimiert für große Datenmengen (>10.000 Historie-Einträge)
- **Technologie:** SQLite 3.46+ via WebAssembly
- **Persistenz:** Origin Private File System (OPFS) in Chromium-Browsern
- **Worker:** Alle Datenbankoperationen im Web Worker (kein UI-Blocking)
- **Features:**
  - Relationale Datenbank mit Foreign Keys und Indizes
  - Transaktionale Integrität
  - WAL-Modus für bessere Concurrency
  - Optimierte Prepared Statements
  - Lazy Loading für Historie
- **Kompatibilität:**
  - ✅ Chrome/Edge 108+ (mit OPFS)
  - ⚠️ Firefox (in-memory Fallback, keine Persistenz über Reloads)
  - ⚠️ Safari (in-memory Fallback)
- **Import/Export:** Unterstützt sowohl `.sqlite`/`.db` als auch `.json` Dateien

### 2. File System Access API

- **Technologie:** Native Browser-API für Dateizugriff
- **Format:** JSON
- **Kompatibilität:** Chrome/Edge 86+, HTTPS oder localhost erforderlich
- **Limitation:** Nur für kleinere Datenmengen empfohlen (<1000 Einträge)

### 3. LocalStorage Fallback

- **Technologie:** Browser LocalStorage
- **Format:** JSON (komprimiert im Storage)
- **Kompatibilität:** Alle modernen Browser
- **Limitation:** Speicherlimit ~5-10 MB, nur für Tests geeignet

## Lokale Entwicklung

1. Repository klonen oder Codespace öffnen.
2. Projekt über einen lokalen Webserver ausliefern, z. B.:
   ```bash
   python3 -m http.server
   ```
3. Anschließend `http://localhost:8000` im Browser öffnen.
4. Beim ersten Start eine neue Datenbank erstellen oder die Defaults laden.

> **Empfehlung:** Verwende Chrome oder Edge für die Entwicklung, um SQLite-WASM mit OPFS-Persistenz zu nutzen.

> **Hinweis:** SQLite-WASM lädt die benötigten Assets (~1 MB) einmalig von CDN. Eine Internetverbindung ist beim ersten Aufruf erforderlich.

## Deployment auf GitHub Pages

1. Stelle sicher, dass die statischen Assets committet sind.
2. Aktiviere GitHub Pages für den `master`- (oder `main`-) Branch über die Repository-Einstellungen.
3. Die Anwendung ist anschließend unter `https://<user>.github.io/pflanzenschutzliste/` erreichbar.

## Datenstruktur

### JSON-Format (Import/Export)

```json
{
  "meta": {
    "version": 1,
    "company": { "name": "", "logoUrl": "", "contactEmail": "", "address": "", "accentColor": "" },
    "defaults": { "waterPerKisteL": 5, "kistenProAr": 300 },
    "measurementMethods": [ { "id": "perKiste", ... }, ... ],
    "fieldLabels": { ... }
  },
  "mediums": [ { "id": "water", "name": "Wasser", ... } ],
  "history": [ { "header": {...}, "items": [...] } ]
}
```

`assets/config/schema.json` enthält das vollständige JSON-Schema.

### SQLite-Schema

Bei Verwendung von SQLite-WASM werden die Daten in folgenden Tabellen gespeichert:

- **meta** – Konfiguration (company, defaults, fieldLabels)
- **measurement_methods** – Messmethoden mit Config
- **mediums** – Mittel mit Referenz zur Messmethode
- **history** – Historie-Einträge (Header-Daten)
- **history_items** – Historie-Details (Berechnungsergebnisse)

Das vollständige SQL-Schema findet sich in `assets/js/core/storage/schema.sql`.

## Migration von JSON zu SQLite

Bestehende JSON-Datenbanken können problemlos weiterverwendet werden:

1. **Automatischer Import:** Beim Öffnen einer `.json`-Datei wird diese automatisch in SQLite importiert
2. **Export als JSON:** Jederzeit möglich über das Download-Feature
3. **Export als SQLite:** Speichern der `.sqlite`/`.db` Datei für direktes Öffnen

Die Anwendung erkennt automatisch das Dateiformat beim Öffnen.

## Performance-Optimierungen

### SQLite-WASM Konfiguration

- **WAL-Modus:** Write-Ahead Logging für bessere Concurrency
- **Foreign Keys:** Aktiviert für Datenintegrität
- **Indizes:** Auf häufig abgefragte Felder (created_at, history_id)
- **Cache:** 20 MB Seiten-Cache für schnellere Queries
- **Prepared Statements:** Wiederverwendung für CRUD-Operationen

### Best Practices

- Historie wird bei >1000 Einträgen per Lazy Loading geladen (automatisch)
- Große Importe erfolgen in Transaktionen
- Worker verhindert UI-Blocking bei komplexen Operationen

## Tests

Aktuell keine automatisierten Tests. Sichtprüfungen erfolgen manuell im Browser.

**Manuelle Test-Szenarien:**
1. Neue Datenbank mit SQLite erstellen
2. JSON-Datei importieren
3. Große Historie (>1000 Einträge) testen
4. Export als JSON und SQLite
5. Fallback-Verhalten in Firefox/Safari prüfen

## Lizenz

Noch nicht festgelegt – bitte ergänzen.
