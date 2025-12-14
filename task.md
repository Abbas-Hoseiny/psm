# Monorepo Migration: pflanzenschutz-db → psm

## Übersicht

**Ziel:** Das separate `pflanzenschutz-db` Repository in das `psm` Repository integrieren, sodass:

1. BVL-Daten lokal gebaut werden (kein externer Download nötig)
2. Zwei separate GitHub Actions Workflows existieren
3. Alte Geräte keine Dekompression mehr benötigen
4. Die App schneller und zuverlässiger funktioniert

---

## 🔍 Analyse: Schema-Konflikte

### Spaltenname-Unterschiede (KRITISCH!)

| Tabelle      | pflanzenschutz-db  | psm App           | Konflikt              |
| ------------ | ------------------ | ----------------- | --------------------- |
| `bvl_mittel` | `mittelname`       | `name`            | ⚠️ SPALTENNAME        |
| `bvl_mittel` | `formulierung_art` | `formulierung`    | ⚠️ SPALTENNAME        |
| `bvl_mittel` | `zul_erstmalig_am` | `zul_erstmalig`   | ⚠️ SPALTENNAME        |
| `bvl_mittel` | -                  | `geringes_risiko` | ❌ FEHLT in DB        |
| `bvl_awg`    | viele Spalten      | nur 4 Spalten     | ⚠️ SCHEMA UNTERSCHIED |

### Tabellen-Unterschiede

**In pflanzenschutz-db (49 Tabellen):**

- Vollständiges BVL-API Schema mit allen 41 Endpoints
- Lookup-Tabellen: `bvl_lookup_kultur`, `bvl_lookup_schadorg`
- Enrichment-Tabellen: `bvl_mittel_enrichments`, `bvl_mittel_wirkstoff`
- Meta-Tabellen: `bvl_meta`, `bvl_sync_log`, `bvl_stand`

**In psm App (Worker Schema - 12 Tabellen):**

- Reduziertes Schema für App-Funktionalität
- `bvl_api_payloads` - Extra-Tabelle für API-Payloads
- Unterschiedliche Spaltenstruktur in Core-Tabellen

### Query-Kompatibilität (KRITISCH!)

Die App verwendet in `queryZulassung()`:

```sql
SELECT m.kennr, m.name, m.formulierung, m.zul_ende, m.geringes_risiko, ...
FROM bvl_mittel m
```

Aber pflanzenschutz-db hat:

```sql
mittelname, formulierung_art, zul_erstmalig_am (nicht: name, formulierung, zul_erstmalig)
```

**→ Queries würden fehlschlagen ohne Anpassung!**

---

## 🔄 Lösungsstrategie

### Option A: App an DB-Schema anpassen

- App-Queries ändern um DB-Spaltennamen zu verwenden
- Aufwändig, viele Dateien betroffen

### Option B: DB-Schema an App anpassen ✅ EMPFOHLEN

- Spalten-Aliase in DB hinzufügen
- Kompatibilitäts-Views erstellen
- Minimale App-Änderungen

### Option C: Mapping-Layer im Worker

- Worker mappt Spaltennamen dynamisch
- Komplexer, aber flexibel

**→ Empfehlung: Option B (DB anpassen) + kleine App-Änderungen**

---

## 📋 Umsetzungsplan

### Phase 1: Vorbereitung (Keine Code-Änderungen)

#### Schritt 1.1: Backup erstellen

```bash
cd /Users/admin-m3/psm
git checkout -b backup/pre-monorepo-merge
git push origin backup/pre-monorepo-merge
```

**Test:** Branch existiert auf GitHub

#### Schritt 1.2: Feature-Branch erstellen

```bash
git checkout main
git pull origin main
git checkout -b feature/monorepo-bvl-integration
```

**Test:** Auf neuem Branch

---

### Phase 2: Dateien integrieren

#### Schritt 2.1: Tool-Ordner erstellen

```bash
mkdir -p tools/bvl-sync
```

#### Schritt 2.2: pflanzenschutz-db Dateien kopieren

```bash
# Von /tmp/pflanzenschutz-db kopieren:
cp -r /tmp/pflanzenschutz-db/scripts tools/bvl-sync/
cp -r /tmp/pflanzenschutz-db/configs tools/bvl-sync/
cp -r /tmp/pflanzenschutz-db/utils tools/bvl-sync/
cp /tmp/pflanzenschutz-db/requirements.txt tools/bvl-sync/
cp /tmp/pflanzenschutz-db/README.md tools/bvl-sync/README.md
```

#### Schritt 2.3: Data-Ordner für Output erstellen

```bash
mkdir -p public/data/bvl
```

**Test:**

```bash
ls -la tools/bvl-sync/
ls -la tools/bvl-sync/scripts/
ls -la public/data/bvl/
```

---

### Phase 3: Schema-Kompatibilität herstellen

#### Schritt 3.1: Schema-Datei anpassen (`tools/bvl-sync/utils/sqlite_schema.sql`)

Änderungen:

1. `bvl_mittel` Tabelle: Alias-Spalte `name` hinzufügen
2. Kompatibilitäts-View erstellen

```sql
-- Nach der bvl_mittel Tabelle hinzufügen:

-- Kompatibilitäts-View für PSM App
CREATE VIEW IF NOT EXISTS bvl_mittel_compat AS
SELECT
    kennr,
    mittelname AS name,
    formulierung_art AS formulierung,
    zul_erstmalig_am AS zul_erstmalig,
    zul_ende,
    0 AS geringes_risiko,  -- Default-Wert
    payload_json
FROM bvl_mittel;
```

**Test:** SQL-Syntax validieren

```bash
cd tools/bvl-sync
sqlite3 :memory: < utils/sqlite_schema.sql
echo "SELECT * FROM bvl_mittel_compat LIMIT 1;" | sqlite3 :memory:
```

#### Schritt 3.2: Alternative - Spalten direkt in Tabelle hinzufügen

```sql
-- In bvl_mittel Definition:
CREATE TABLE IF NOT EXISTS bvl_mittel (
    kennr TEXT PRIMARY KEY,
    mittelname TEXT,
    formulierung_art TEXT,
    zul_ende TEXT,
    zul_erstmalig_am TEXT,
    payload_json TEXT,
    updated_at TEXT DEFAULT (datetime('now')),
    -- Kompatibilitäts-Spalten (Aliase)
    name TEXT GENERATED ALWAYS AS (mittelname) STORED,
    formulierung TEXT GENERATED ALWAYS AS (formulierung_art) STORED,
    zul_erstmalig TEXT GENERATED ALWAYS AS (zul_erstmalig_am) STORED,
    geringes_risiko INTEGER DEFAULT 0
);
```

**Test:** Schema laden und Spalten prüfen

```bash
sqlite3 test.db < utils/sqlite_schema.sql
sqlite3 test.db ".schema bvl_mittel"
rm test.db
```

---

### Phase 4: GitHub Actions Workflows

#### Schritt 4.1: BVL-Sync Workflow erstellen (`.github/workflows/sync-bvl.yml`)

```yaml
name: Sync BVL Data

on:
  schedule:
    - cron: "0 3 1-31/2 * *" # Alle 2 Tage um 3:00 UTC
  workflow_dispatch: # Manueller Trigger

permissions:
  contents: write

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.11"

      - name: Install dependencies
        run: |
          pip install -r tools/bvl-sync/requirements.txt

      - name: Fetch BVL data
        run: |
          cd tools/bvl-sync
          python scripts/fetch_bvl_data.py \
            --output-dir ../../public/data/bvl \
            --verbose

      - name: Validate export
        run: |
          python tools/bvl-sync/scripts/validate_export.py \
            public/data/bvl/pflanzenschutz.sqlite

      - name: Commit changes
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add public/data/bvl/
          git diff --staged --quiet || git commit -m "chore: update BVL database [skip ci]"
          git push
```

**Test:** Workflow-Syntax validieren

```bash
# Online: https://rhysd.github.io/actionlint/
```

#### Schritt 4.2: Deploy Workflow anpassen (`.github/workflows/deploy.yml`)

Keine Änderung nötig - Astro Build kopiert `public/` automatisch.

**Test:** Lokaler Build

```bash
npm run build
ls -la dist/data/bvl/
```

---

### Phase 5: App-Code anpassen

#### Schritt 5.1: `bvlDataset.ts` - Lokalen Pfad hinzufügen

```typescript
// NEU: Lokaler Pfad als primäre Quelle
const LOCAL_DB_PATH = "/data/bvl/pflanzenschutz.sqlite";

// Prüfen ob lokale DB existiert
export async function hasLocalDatabase(): Promise<boolean> {
  try {
    const response = await fetch(LOCAL_DB_PATH, { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
}
```

**Test:**

```bash
npm run dev
# Browser: Prüfen ob /data/bvl/pflanzenschutz.sqlite erreichbar
```

#### Schritt 5.2: `bvlSync.ts` - Lokale DB priorisieren

```typescript
// In syncFromManifest() oder neue Funktion:
export async function syncFromLocalDb(storage, options) {
  const { onProgress, log } = options;

  log("info", "Loading local BVL database");
  onProgress({
    step: "download",
    percent: 10,
    message: "Lade lokale Datenbank...",
  });

  const response = await fetch(LOCAL_DB_PATH);
  if (!response.ok) {
    throw new Error("Lokale BVL-Datenbank nicht gefunden");
  }

  const data = new Uint8Array(await response.arrayBuffer());
  // ... Import wie bisher
}
```

**Test:**

```bash
# Manuell: BVL-Daten herunterladen und Button testen
```

#### Schritt 5.3: `sqliteWorker.js` - Schema-Kompatibilität

Option A: Queries anpassen um beide Spaltennamen zu unterstützen:

```javascript
// In queryZulassung():
// COALESCE(m.name, m.mittelname) AS name
```

Option B: Beim Import Spalten mappen (bereits teilweise vorhanden)

**Test:**

```javascript
// Im Worker: Testquery ausführen
db.exec("SELECT name, mittelname FROM bvl_mittel LIMIT 1");
```

---

### Phase 6: Skript-Pfade anpassen

#### Schritt 6.1: `fetch_bvl_data.py` - Output-Pfad Parameter

Bereits vorhanden via `--output-dir`. Keine Änderung nötig.

#### Schritt 6.2: `manifest.py` - base_url anpassen

```python
# Von:
base_url: str = "https://abbas-hoseiny.github.io/pflanzenschutz-db"

# Zu:
base_url: str = "/data/bvl"  # Relativer Pfad
```

Oder: Manifest ganz weglassen da nicht mehr nötig.

**Test:**

```bash
cd tools/bvl-sync
python scripts/fetch_bvl_data.py --output-dir /tmp/test-output --verbose
ls -la /tmp/test-output/
```

---

### Phase 7: Kompression entscheiden

#### Option A: Keine Kompression (EMPFOHLEN für alte Geräte)

- SQLite-Datei direkt in `public/data/bvl/`
- Ca. 20MB, aber keine Dekompression nötig
- GitHub Pages unterstützt bis 100MB

#### Option B: Gzip-Kompression

- Universell unterstützt
- Halb so groß (~10MB)
- Etwas mehr CPU auf alten Geräten

**Entscheidung:** Option A für maximale Kompatibilität

#### Schritt 7.1: Kompression in `fetch_bvl_data.py` deaktivieren

```python
# In compress_database() Aufruf:
# Nur SQLite-Datei behalten, keine .br oder .zip
```

**Test:**

```bash
ls -la public/data/bvl/
# Sollte nur pflanzenschutz.sqlite zeigen
```

---

### Phase 8: Testing

#### Schritt 8.1: Lokaler End-to-End Test

```bash
# 1. BVL-Daten generieren
cd tools/bvl-sync
pip install -r requirements.txt
python scripts/fetch_bvl_data.py --output-dir ../../public/data/bvl --verbose

# 2. App bauen
cd ../..
npm run build

# 3. Preview starten
npm run preview

# 4. Im Browser testen:
#    - Zulassung öffnen
#    - "Jetzt herunterladen" klicken (sollte lokale DB nutzen)
#    - Suche testen
```

#### Schritt 8.2: Schema-Kompatibilität testen

```bash
# SQLite direkt prüfen
sqlite3 public/data/bvl/pflanzenschutz.sqlite

# Queries testen:
.schema bvl_mittel
SELECT kennr, name, formulierung FROM bvl_mittel LIMIT 5;
SELECT kennr, mittelname, formulierung_art FROM bvl_mittel LIMIT 5;
```

#### Schritt 8.3: Worker-Import testen

```javascript
// Browser Console:
// 1. Datenbank öffnen/erstellen
// 2. BVL-Daten laden
// 3. Suche ausführen
```

---

### Phase 9: Deployment

#### Schritt 9.1: Feature-Branch pushen

```bash
git add .
git commit -m "feat: integrate pflanzenschutz-db as monorepo"
git push origin feature/monorepo-bvl-integration
```

#### Schritt 9.2: Pull Request erstellen

- Titel: "Monorepo: BVL-Datenbank Integration"
- Beschreibung: Änderungen zusammenfassen
- Review anfordern

#### Schritt 9.3: Nach Merge - Altes Repo archivieren

```bash
# pflanzenschutz-db Repository:
# Settings → Archive this repository
```

---

## ⚠️ Bekannte Risiken

### 1. GitHub Repository Größe

- SQLite-Datei: ~20MB
- Bei jedem Sync: +20MB in Git-History
- **Mitigation:** Git LFS verwenden oder History periodisch bereinigen

### 2. Build-Zeit

- Astro Build enthält 20MB DB
- Erste Ladezeit länger
- **Mitigation:** Service Worker für Caching

### 3. Schema-Drift

- pflanzenschutz-db Schema kann sich ändern
- App-Queries könnten brechen
- **Mitigation:** Versionierung + Kompatibilitäts-Layer

---

## 📁 Finale Struktur

```
psm/
├── .github/
│   └── workflows/
│       ├── deploy.yml           # Astro Build (bei Push)
│       └── sync-bvl.yml         # BVL-Sync (alle 2 Tage)
├── public/
│   └── data/
│       └── bvl/
│           └── pflanzenschutz.sqlite  # BVL-Datenbank
├── src/
│   └── scripts/
│       └── core/
│           ├── bvlDataset.ts    # Angepasst für lokale DB
│           ├── bvlSync.ts       # Angepasst für lokale DB
│           └── storage/
│               └── sqliteWorker.js  # Schema-kompatibel
├── tools/
│   └── bvl-sync/                # Python ETL
│       ├── scripts/
│       │   ├── fetch_bvl_data.py
│       │   ├── validate_export.py
│       │   └── helpers/
│       ├── configs/
│       │   ├── endpoints.yaml
│       │   └── enrichments.yaml
│       ├── utils/
│       │   └── sqlite_schema.sql  # Angepasst
│       └── requirements.txt
├── package.json
└── astro.config.mjs
```

---

## ✅ Checkliste

- [ ] Phase 1: Backup und Feature-Branch
- [ ] Phase 2: Dateien kopieren
- [ ] Phase 3: Schema-Kompatibilität
- [ ] Phase 4: GitHub Actions
- [ ] Phase 5: App-Code anpassen
- [ ] Phase 6: Skript-Pfade
- [ ] Phase 7: Kompression entscheiden
- [ ] Phase 8: Testing
- [ ] Phase 9: Deployment
