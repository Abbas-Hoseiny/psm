# Git LFS Konfiguration für Digitale PSM

## Übersicht

Dieses Projekt verwendet **Git Large File Storage (LFS)** zur Verwaltung großer Binärdateien.
Git LFS ersetzt große Dateien mit Textpointern in Git, während die eigentlichen Dateien
auf einem separaten Server gespeichert werden.

## Warum Git LFS?

| Ohne LFS | Mit LFS |
|----------|---------|
| Repository wird bei jedem Clone vollständig heruntergeladen (~700 MB+) | Nur Pointer werden heruntergeladen (~15 MB) |
| Verlangsamte Git-Operationen | Schnelle Git-Operationen |
| Große Dateien in jeder Version gespeichert | Effiziente Delta-Speicherung |

## Verwaltete Dateitypen

### SQLite-Datenbanken
- `public/data/bvl/pflanzenschutz.sqlite.br` (~6 MB) - Komprimierte BVL-Datenbank
- `public/data/bvl/pflanzenschutz.sqlite.zip` (~11 MB) - ZIP-Archiv
- `database/archive/*.sqlite` - Archivierte Datenbanken
- `database/*.sqlite` - Lokale Entwicklungsdatenbanken

### Bilder
- `*.jpg`, `*.jpeg` - Fotografien
- `*.png` - Bilddateien (Icons, Screenshots)
- `*.gif`, `*.webp` - Animationen und moderne Formate

### Andere Binärdateien
- `*.wasm` - WebAssembly-Module
- `*.ttf`, `*.woff`, `*.woff2` - Schriftarten
- `*.zip`, `*.gz`, `*.br` - Komprimierte Dateien
- `*.pdf` - PDF-Dokumente

## Einrichtung für neue Entwickler

```bash
# 1. Git LFS installieren (einmalig pro System)

# macOS:
brew install git-lfs

# Ubuntu/Debian:
sudo apt-get install git-lfs

# Windows (oft bereits mit Git installiert):
winget install GitHub.GitLFS

# 2. Git LFS aktivieren (einmalig pro System)
git lfs install

# 3. Repository klonen
git clone https://github.com/Abbas-Hoseiny/psm.git
cd psm

# 4. Falls LFS-Dateien fehlen
git lfs pull
```

## Häufige Befehle

```bash
# Zeige alle von LFS verwalteten Dateien
git lfs ls-files

# Zeige welche Muster getrackt werden
git lfs track

# Neue Dateitypen zu LFS hinzufügen
git lfs track "*.psd"

# LFS-Status prüfen
git lfs status

# Alle LFS-Dateien herunterladen
git lfs fetch --all

# LFS-Dateien auschecken
git lfs checkout
```

## Troubleshooting

### LFS-Dateien werden als Pointer angezeigt

```bash
# Dateien neu auschecken
git lfs pull

# Oder spezifische Datei
git lfs fetch --include="public/data/bvl/*"
git lfs checkout public/data/bvl/
```

### "Smudge filter lfs failed"

```bash
# LFS neu installieren
git lfs install --force

# Cache leeren und neu pullen
git lfs fetch --all
git lfs checkout
```

### Große Repository-Größe nach Migration

```bash
# Alte Objekte bereinigen
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

## Aktuelle Dateigrößen

| Datei | Größe |
|-------|-------|
| `public/data/bvl/pflanzenschutz.sqlite.br` | ~6.3 MB |
| `public/data/bvl/pflanzenschutz.sqlite.zip` | ~11 MB |
| `database/archive/eppocodes.sqlite` | ~47 MB |
| `assets/img/fields.jpg` | ~2.2 MB |

## GitHub LFS Limits

- **Free Account**: 1 GB Speicher, 1 GB/Monat Bandbreite
- **Pro Account**: 1 GB Speicher, 1 GB/Monat Bandbreite + Data Packs verfügbar
- **Data Pack**: 50 GB Speicher + 50 GB Bandbreite für $5/Monat

Aktueller Verbrauch: https://github.com/settings/billing

## Weitere Ressourcen

- [Git LFS Dokumentation](https://git-lfs.github.com/)
- [GitHub LFS Guide](https://docs.github.com/en/repositories/working-with-files/managing-large-files)
- [Git LFS Tutorial](https://www.atlassian.com/git/tutorials/git-lfs)
