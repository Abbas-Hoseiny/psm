# Digitale PSM

**Digitale Pflanzenschutz-Dokumentation** – Eine moderne Web-Anwendung zur Erfassung, Berechnung und Dokumentation von Pflanzenschutzmaßnahmen im biologischen und konventionellen Landbau.

🌐 **Live-Demo:** [digitale-psm.de](https://digitale-psm.de)

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

- **Frontend:** Astro 5, TypeScript, Bootstrap 5 (lokal gebündelt, kein CDN)
- **Datenbank:** SQLite WASM (läuft komplett im Browser, lokal gebündelt)
- **PWA:** Service Worker, Web App Manifest, File Handling API
- **Offline-First:** Funktioniert ohne Internetverbindung
- **Datenschutz:** Alle Daten bleiben lokal auf Ihrem Gerät

## Installation (Entwicklung)

### Voraussetzungen

- **Node.js** (v18 oder höher)
- **npm** (v9 oder höher)
- **Git LFS** (für große Binärdateien)

### Git LFS einrichten

Dieses Projekt verwendet [Git Large File Storage (LFS)](https://git-lfs.github.com/) für große Binärdateien wie SQLite-Datenbanken und Bilder. Git LFS muss **vor dem Klonen** installiert werden.

```bash
# Git LFS installieren (macOS)
brew install git-lfs

# Git LFS installieren (Ubuntu/Debian)
sudo apt-get install git-lfs

# Git LFS installieren (Windows - mit Git für Windows bereits enthalten)
# Oder: winget install GitHub.GitLFS

# Git LFS global aktivieren (einmalig pro System)
git lfs install
```

### Repository klonen

```bash
# Repository klonen (Git LFS lädt große Dateien automatisch)
git clone https://github.com/Abbas-Hoseiny/psm.git
cd psm

# Falls Git LFS Dateien nicht geladen wurden:
git lfs pull

# Abhängigkeiten installieren
npm install

# Entwicklungsserver starten
npm run dev

# Produktion bauen
npm run build
```

### Von Git LFS verwaltete Dateien

Folgende Dateitypen werden von Git LFS verwaltet:

| Dateityp | Beschreibung |
|----------|--------------|
| `*.sqlite`, `*.sqlite.br`, `*.sqlite.zip` | SQLite-Datenbanken (BVL, EPPO, BBCH) |
| `*.jpg`, `*.jpeg`, `*.png`, `*.gif`, `*.webp` | Bilddateien |
| `*.wasm` | WebAssembly-Module |
| `*.ttf`, `*.woff`, `*.woff2` | Schriftarten |
| `*.zip`, `*.gz`, `*.br` | Komprimierte Dateien |
| `*.pdf` | PDF-Dokumente |

**Wichtig:** Wenn Sie große Dateien hinzufügen, werden diese automatisch von Git LFS verwaltet.

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

- Website: [digitale-psm.de](https://digitale-psm.de)
- Entwickler: Abbas Hoseiny
