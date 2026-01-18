# Digitale PSM

**Digitale Pflanzenschutz-Dokumentation** – Eine moderne Web-Anwendung zur Erfassung, Berechnung und Dokumentation von Pflanzenschutzmaßnahmen im biologischen und konventionellen Landbau.

🌐 **Live-Demo:** [www.digitale-psm.de](https://www.digitale-psm.de)

## Features

### 📱 Progressive Web App (PWA)

- **Als App installierbar** auf Desktop und Mobilgeräten
- **Offline-fähig** dank Service Worker Caching
- **Auto-Start** mit zuletzt verwendeter Datenbank
- Direktes Öffnen von .sqlite Dateien aus dem Explorer

### 🧮 Berechnung

- Intelligente Pflanzenschutzmittel-Berechnung basierend auf Fläche/Menge
- EPPO-Code und BBCH-Stadium Unterstützung mit Schnellauswahl
- Automatische Umrechnung verschiedener Aufwandmengen
- Mittel-Profile für häufig verwendete Kombinationen

### 📋 Dokumentation

- Vollständige Aufzeichnung aller Anwendungen
- Kalenderansicht mit Filter-Funktionen
- Export als PDF oder CSV
- QS-konforme Dokumentation

### 🗄️ BVL-Datenbank

- Direkter Zugriff auf die offizielle BVL-Zulassungsdatenbank
- Automatische Updates der Zulassungsdaten
- Suche nach Kulturen, Schaderreger und Wirkstoffen

### 📍 GPS-Standorte

- Speichern häufig genutzter Standorte
- Koordinaten-Erfassung via Geolocation

### ⚙️ Einstellungen

- Eigene Mittel und Profile verwalten
- EPPO/BBCH-Codes speichern
- Individuelle Anpassungen

## Technologie

- **Frontend:** Astro 4.16, TypeScript, Bootstrap 5
- **Datenbank:** SQLite WASM (läuft komplett im Browser)
- **PWA:** Service Worker, Web App Manifest, File Handling API
- **Offline-First:** Funktioniert ohne Internetverbindung
- **Datenschutz:** Alle Daten bleiben lokal auf Ihrem Gerät

## Installation (Entwicklung)

```bash
# Repository klonen
git clone https://github.com/Abbas-Hoseiny/psm.git
cd psm

# Abhängigkeiten installieren
npm install

# Entwicklungsserver starten
npm run dev

# Produktion bauen
npm run build
```

## PWA Installation

Die App kann als Progressive Web App installiert werden:

1. **Chrome/Edge:** Auf das Installations-Symbol in der Adressleiste klicken
2. **Mobile:** "Zum Startbildschirm hinzufügen" im Browser-Menü

Nach der Installation:
- Startet die App ohne Browser-UI
- Merkt sich die zuletzt verwendete Datenbank
- Öffnet .sqlite Dateien direkt per Doppelklick

## Lizenz

MIT-Lizenz – siehe [LICENSE](LICENSE)

## Kontakt

- Website: [www.digitale-psm.de](https://www.digitale-psm.de)
- Entwickler: Abbas Hoseiny
