# 📋 Test-Dokumentation für Digitale PSM

## Übersicht

Dieses Dokument beschreibt die implementierte Test-Suite für das Digitale PSM Projekt.

## Test-Kategorien

### 1. Performance-Tests (`tests/performance/`)

#### 1.1 Datenbank-Tests (`database.ts`)

- **SQLite Support Check** - Prüft WebAssembly/Worker-Unterstützung
- **Worker Initialization** - Misst Initialisierungszeit des SQLite Workers
- **Query Performance** - Testet SELECT, INSERT, UPDATE Operationen
- **Batch Operations** - Prüft Massen-Insert Performance
- **History Entry Operations** - Testet CRUD für Anwendungshistorie
- **BVL Search** - Misst Suchperformance in BVL-Daten

#### 1.2 State-Tests (`state.ts`)

- **Get State** - Misst State-Abruf Zeit
- **Patch State** - Testet State-Update Performance
- **Update Slice** - Prüft Slice-spezifische Updates
- **Subscription Performance** - Testet Subscriber-Benachrichtigung
- **Large State Updates** - Prüft Performance bei großen Datenmengen

#### 1.3 Event Bus Tests (`state.ts`)

- **Subscribe/Emit** - Misst Event-System Latenz
- **Multiple Subscribers** - Testet Skalierung bei vielen Listenern
- **Large Payloads** - Prüft Event-Serialisierung

#### 1.4 Rendering-Tests (`rendering.ts`)

- **Virtual List** - Testet Virtualisierung für große Listen
- **DOM Manipulation** - Prüft createElement, innerHTML, DocumentFragment
- **Table Rendering** - Misst Tabellen-Rendering Performance
- **Frame Rate** - Überwacht 60fps Ziel

#### 1.5 Network-Tests (`network.ts`)

- **Manifest Fetch** - Testet BVL Manifest Download
- **Service Worker Caching** - Prüft Cache-Hits
- **Resource Timing** - Analysiert Netzwerk-Latenz

### 2. Konflikt-Tests (`tests/conflicts/`)

#### 2.1 Race Condition Tests (`raceConditions.ts`)

- **Concurrent State Updates** - Erkennt Lost Updates
- **Event Emission Order** - Prüft Event-Reihenfolge
- **Database Save Race** - Testet parallele Speicherungen
- **Worker Message Matching** - Prüft Request/Response Zuordnung
- **Subscription Cleanup** - Testet Unsubscribe während Events

#### 2.2 Memory Tests (`memory.ts`)

- **Event Subscription Cleanup** - Prüft auf Listener-Leaks
- **State Subscription Cleanup** - Testet State-Observer Cleanup
- **DOM Event Listeners** - Prüft addEventListener/removeEventListener
- **Closure Retention** - Testet Closure Memory-Muster
- **Timer Cleanup** - Prüft setInterval/setTimeout Cleanup
- **Memory Usage** - Überwacht JS Heap

#### 2.3 Code Quality Tests (`codeQuality.ts`)

- **TypeScript Deprecations** - Listet deprecated API Nutzung
- **Unused Variables** - Findet ungenutzte Deklarationen
- **Import Conflicts** - Erkennt static/dynamic Import Probleme
- **JSDoc Migration** - Identifiziert JSDoc statt TypeScript
- **Unnecessary Awaits** - Findet überflüssige async/await

#### 2.4 Compatibility Tests (`codeQuality.ts`)

- **WebAssembly Support** - Kritisch für SQLite WASM
- **Web Worker Support** - Kritisch für Hintergrund-Verarbeitung
- **Secure Context** - HTTPS Prüfung
- **File System Access API** - Optionale Datei-API
- **IndexedDB** - Lokale Speicherung
- **Service Worker** - PWA Unterstützung
- **ES Modules** - Modul-System

## Performance-Budgets

| Metrik            | Budget       |
| ----------------- | ------------ |
| DB Init           | 2000ms       |
| Simple Query      | 50ms         |
| Complex Query     | 200ms        |
| Single Insert     | 30ms         |
| Batch Insert      | 500ms        |
| Virtual List Init | 100ms        |
| Scroll Frame      | 16ms (60fps) |
| State Update      | 10ms         |
| Event Emit        | 5ms          |
| Manifest Fetch    | 3000ms       |

## Ausführung

### Im Browser

```javascript
// In der Browser-Konsole (nach App-Load):
const { state, events } = window.__PSM_SERVICES__;

// Alle Tests ausführen
const report = await window.PSMTests.runAllTests({
  services: { state, events },
  verbose: true,
});

// Nur Performance-Tests
const perfReport = await window.PSMTests.runPerformanceTestsOnly({
  services: { state, events },
});

// Nur Konflikt-Tests
const conflictReport = await window.PSMTests.runConflictTestsOnly({
  services: { state, events },
});
```

### Via GitHub Actions

Tests werden automatisch ausgeführt bei:

- Push auf `main` oder `develop`
- Pull Requests
- Täglich um 3:00 UTC
- Manuell via `workflow_dispatch`

## CI/CD Pipeline

```
┌─────────────┐
│    Lint     │
└──────┬──────┘
       │
┌──────▼──────┐
│    Build    │
└──────┬──────┘
       │
┌──────┴──────────────────────────┐
│                                 │
▼                                 ▼
┌─────────────┐           ┌─────────────┐
│ Performance │           │  Conflicts  │
│    Tests    │           │    Tests    │
└──────┬──────┘           └──────┬──────┘
       │                         │
       └────────────┬────────────┘
                    │
            ┌───────▼───────┐
            │  Lighthouse   │
            │    Audit      │
            └───────┬───────┘
                    │
            ┌───────▼───────┐
            │   Deploy      │
            │ (main only)   │
            └───────────────┘
```

## Bekannte Probleme aus dem Build

### Deprecation Warnings

| Datei                      | API               | Lösung                        |
| -------------------------- | ----------------- | ----------------------------- |
| bootstrap.ts:28            | event.returnValue | Modernere beforeunload Syntax |
| print.ts:38                | document.write    | Iframe oder DOM-Manipulation  |
| documentation/index.ts:948 | execCommand       | Clipboard API                 |
| gps/index.ts:896           | execCommand       | Clipboard API                 |
| lookup/index.ts:1450       | execCommand       | Clipboard API                 |

### Import-Konflikte (Vite Warnings)

- `sqlite.ts` - dynamisch (bootstrap) & statisch (database, lookups)
- `storage/index.ts` - dynamisch (bootstrap) & statisch (database)
- `eventBus.ts` - dynamisch (indexClient) & statisch (shellClient)
- `database.ts` - dynamisch (bootstrap) & statisch (mehrere Features)

**Empfehlung:** Einheitlicher Import-Stil pro Modul verwenden.

## Empfohlene Lösungen

### 1. Clipboard API statt execCommand

```typescript
// Alt (deprecated)
document.execCommand("copy");

// Neu
await navigator.clipboard.writeText(text);
```

### 2. Import-Konflikte lösen

```typescript
// Option A: Alles statisch (wenn immer benötigt)
import { sqlite } from "./storage/sqlite";

// Option B: Alles dynamisch (für Code-Splitting)
const sqlite = await import("./storage/sqlite");
```

### 3. beforeunload modernisieren

```typescript
// Alt
event.returnValue = "message";
return event.returnValue;

// Neu
event.preventDefault();
return ""; // Standardmeldung des Browsers
```

## Metriken-Interpretation

### Performance Report

- **passed** - Test unter Budget
- **failed** - Test über Budget
- **avgDuration** - Durchschnittliche Ausführungszeit
- **details.iterations** - Anzahl Wiederholungen

### Conflict Report

- **critical** - Muss behoben werden
- **warning** - Sollte behoben werden
- **info** - Zur Kenntnisnahme

## Wartung

Die Test-Suite sollte erweitert werden, wenn:

1. Neue Features hinzugefügt werden
2. Performance-Probleme gemeldet werden
3. Browser-Kompatibilität sich ändert
4. Neue Abhängigkeiten hinzugefügt werden
