# Digitale PSM

**Digitale Pflanzenschutz-Dokumentation** – Eine moderne Web-Anwendung zur Erfassung, Berechnung und Dokumentation von Pflanzenschutzmaßnahmen im biologischen und konventionellen Landbau.

🌐 **Live-Demo:** [www.digitale-psm.de](https://www.digitale-psm.de)

## Features

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

- **Frontend:** Astro, TypeScript, Bootstrap 5
- **Datenbank:** SQLite WASM (läuft komplett im Browser)
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

## Lizenz

MIT-Lizenz – siehe [LICENSE](LICENSE)

## Kontakt

- Website: [www.digitale-psm.de](https://www.digitale-psm.de)
- Entwickler: Abbas Hoseiny
