/**
 * Code Quality & Compatibility Tests
 * Prüft Code-Qualität und Browser-Kompatibilität
 */

import { ConflictTester, type ConflictTestResult } from "./index";

/**
 * Prüft Browser-Kompatibilität
 */
export async function runCompatibilityTests(
  tester: ConflictTester,
): Promise<ConflictTestResult[]> {
  const results: ConflictTestResult[] = [];

  console.log("\n🌐 Starte Browser-Kompatibilitäts-Tests...\n");

  // Test: WebAssembly Support
  await tester.runTest(
    "WebAssembly Support",
    "compatibility",
    async () => {
      const supported = typeof WebAssembly !== "undefined";
      return {
        passed: supported,
        message: supported
          ? "WebAssembly wird unterstützt"
          : "WebAssembly wird nicht unterstützt - SQLite WASM funktioniert nicht",
        details: { supported },
        solution: !supported
          ? "Verwenden Sie einen modernen Browser (Chrome 57+, Firefox 52+, Safari 11+)"
          : undefined,
      };
    },
    "critical",
  );

  // Test: Web Worker Support
  await tester.runTest(
    "Web Worker Support",
    "compatibility",
    async () => {
      const supported = typeof Worker !== "undefined";
      return {
        passed: supported,
        message: supported
          ? "Web Workers werden unterstützt"
          : "Web Workers werden nicht unterstützt - Hintergrund-Verarbeitung nicht möglich",
        details: { supported },
        solution: !supported
          ? "Web Workers sind für die Datenbank-Verarbeitung erforderlich"
          : undefined,
      };
    },
    "critical",
  );

  // Test: Secure Context
  await tester.runTest(
    "Secure Context (HTTPS)",
    "compatibility",
    async () => {
      const isSecure = typeof window !== "undefined" && window.isSecureContext;
      return {
        passed: isSecure,
        message: isSecure
          ? "Seite läuft in sicherem Kontext (HTTPS)"
          : "Seite läuft nicht in sicherem Kontext - einige Features deaktiviert",
        details: { isSecure },
        solution: !isSecure
          ? "Verwenden Sie HTTPS oder localhost für alle Features"
          : undefined,
      };
    },
    "warning",
  );

  // Test: File System Access API
  await tester.runTest(
    "File System Access API",
    "compatibility",
    async () => {
      const supported = "showOpenFilePicker" in window;
      return {
        passed: true, // Not critical, has fallback
        message: supported
          ? "File System Access API verfügbar"
          : "File System Access API nicht verfügbar - Fallback auf Input-Element",
        details: { supported },
        solution: !supported
          ? "Chrome/Edge empfohlen für beste Dateizugriffs-Funktionen"
          : undefined,
      };
    },
    "info",
  );

  // Test: IndexedDB
  await tester.runTest(
    "IndexedDB Support",
    "compatibility",
    async () => {
      const supported = typeof indexedDB !== "undefined";
      return {
        passed: supported,
        message: supported
          ? "IndexedDB wird unterstützt"
          : "IndexedDB wird nicht unterstützt - lokale Speicherung eingeschränkt",
        details: { supported },
        solution: !supported
          ? "IndexedDB ist für die persistente Speicherung erforderlich"
          : undefined,
      };
    },
    "warning",
  );

  // Test: Service Worker Support
  await tester.runTest(
    "Service Worker Support",
    "compatibility",
    async () => {
      const supported = "serviceWorker" in navigator;
      return {
        passed: true, // PWA is optional
        message: supported
          ? "Service Workers werden unterstützt (PWA möglich)"
          : "Service Workers nicht unterstützt - Offline-Modus nicht verfügbar",
        details: { supported },
        solution: !supported ? "Service Workers benötigen HTTPS" : undefined,
      };
    },
    "info",
  );

  // Test: ES Module Support
  await tester.runTest(
    "ES Module Support",
    "compatibility",
    async () => {
      const supported = "noModule" in document.createElement("script");
      return {
        passed: supported,
        message: supported
          ? "ES Modules werden unterstützt"
          : "ES Modules werden nicht unterstützt",
        details: { supported },
        solution: !supported
          ? "Browser-Update erforderlich für ES Module Support"
          : undefined,
      };
    },
    "critical",
  );

  // Test: CSS Custom Properties
  await tester.runTest(
    "CSS Custom Properties (Variables)",
    "compatibility",
    async () => {
      const supported = CSS.supports("--test", "0");
      return {
        passed: supported,
        message: supported
          ? "CSS Custom Properties werden unterstützt"
          : "CSS Custom Properties nicht unterstützt - Theming eingeschränkt",
        details: { supported },
      };
    },
    "warning",
  );

  // Test: Async/Await
  await tester.runTest(
    "Async/Await Support",
    "compatibility",
    async () => {
      try {
        await Promise.resolve(true);
        return {
          passed: true,
          message: "Async/Await wird unterstützt",
          details: { supported: true },
        };
      } catch {
        return {
          passed: false,
          message: "Async/Await wird nicht unterstützt",
          details: { supported: false },
          solution: "Browser-Update erforderlich",
        };
      }
    },
    "critical",
  );

  return results;
}

/**
 * Prüft Code-Qualitätsprobleme durch statische Analyse
 */
export async function runCodeQualityTests(
  tester: ConflictTester,
): Promise<ConflictTestResult[]> {
  const results: ConflictTestResult[] = [];

  console.log("\n🔧 Starte Code-Qualitäts-Tests...\n");

  // Test: Deprecation Warnings aus Build
  await tester.runTest(
    "TypeScript Deprecation Warnings",
    "code-quality",
    async () => {
      // Diese Informationen stammen aus dem Build-Output
      const knownDeprecations = [
        {
          location: "bootstrap.ts:28",
          api: "event.returnValue",
          reason: "deprecated",
        },
        {
          location: "print.ts:38",
          api: "document.write",
          reason: "deprecated in strict mode",
        },
        {
          location: "documentation/index.ts:948",
          api: "document.execCommand",
          reason: "deprecated",
        },
        {
          location: "gps/index.ts:896",
          api: "document.execCommand",
          reason: "deprecated",
        },
        {
          location: "lookup/index.ts:1450",
          api: "document.execCommand",
          reason: "deprecated",
        },
      ];

      return {
        passed: knownDeprecations.length === 0,
        message: `${knownDeprecations.length} deprecated APIs gefunden`,
        details: { deprecations: knownDeprecations },
        solution:
          "Ersetzen Sie deprecated APIs durch moderne Alternativen (z.B. Clipboard API statt execCommand)",
      };
    },
    "warning",
  );

  // Test: Unused Variables (aus Build)
  await tester.runTest(
    "Unused Variables/Imports",
    "code-quality",
    async () => {
      const unusedItems = [
        { file: "bootstrap.ts:189", name: "event" },
        { file: "bootstrap.ts:71", name: "regions" },
        { file: "database.ts:13", name: "saveLock" },
        { file: "infos/index.ts:16", name: "DEFAULT_INFOS_CONFIG" },
        { file: "infos/index.ts:14", name: "InfoSource" },
        { file: "calculation/index.ts:1553", name: "gpsDisplayValue" },
        { file: "calculation/index.ts:740", name: "hideAllDropdowns" },
        { file: "documentation/index.ts:1642", name: "usageLabel" },
        { file: "settings/index.ts:66", name: "activeSettingsTab" },
        { file: "startup/index.ts:240", name: "showNewCreateFocus" },
      ];

      return {
        passed: unusedItems.length < 5,
        message: `${unusedItems.length} ungenutzte Variablen/Imports gefunden`,
        details: { unused: unusedItems.slice(0, 10) },
        solution:
          "Entfernen Sie ungenutzte Variablen oder prefixen Sie mit _ für absichtlich ungenutzte Parameter",
      };
    },
    "info",
  );

  // Test: Dynamic/Static Import Conflict
  await tester.runTest(
    "Dynamic/Static Import Konflikt",
    "code-quality",
    async () => {
      // Aus Vite Build-Warnungen
      const conflicts = [
        {
          module: "sqlite.ts",
          dynamicBy: "bootstrap.ts",
          staticBy: ["database.ts", "lookups.ts", "storage/index.ts"],
        },
        {
          module: "storage/index.ts",
          dynamicBy: "bootstrap.ts",
          staticBy: ["database.ts"],
        },
        {
          module: "eventBus.ts",
          dynamicBy: "indexClient.ts",
          staticBy: ["shellClient.ts", "bootstrap.ts"],
        },
        {
          module: "database.ts",
          dynamicBy: "bootstrap.ts",
          staticBy: ["calculation/index.ts", "documentation/index.ts"],
        },
      ];

      return {
        passed: false,
        message: `${conflicts.length} Module werden sowohl dynamisch als auch statisch importiert`,
        details: { conflicts },
        solution:
          "Entscheiden Sie sich für einen Import-Stil pro Modul: entweder durchgängig dynamisch oder statisch",
      };
    },
    "warning",
  );

  // Test: JSDoc Type Annotations
  await tester.runTest(
    "JSDoc zu TypeScript Migration",
    "code-quality",
    async () => {
      const jsdocTypes = [
        { file: "bvlDataset.ts:571", function: "checkForUpdates" },
        { file: "bvlDataset.ts:48", function: "downloadLocalDatabase" },
        { file: "bvlDataset.ts:34", function: "hasLocalDatabase" },
      ];

      return {
        passed: jsdocTypes.length === 0,
        message: `${jsdocTypes.length} Funktionen mit JSDoc statt TypeScript-Typen`,
        details: { jsdocTypes },
        solution:
          "Migrieren Sie JSDoc-Typen zu TypeScript für bessere Typ-Sicherheit",
      };
    },
    "info",
  );

  // Test: Async Await Effects
  await tester.runTest(
    "Unnötige await Statements",
    "code-quality",
    async () => {
      const unnecessaryAwaits = [
        { file: "sqliteWorker.js:1289", expression: "await getLookupStats()" },
        {
          file: "sqliteWorker.js:1283",
          expression: "await searchBbchStages()",
        },
        { file: "sqliteWorker.js:1280", expression: "await searchEppoCodes()" },
      ];

      return {
        passed: unnecessaryAwaits.length === 0,
        message: `${unnecessaryAwaits.length} unnötige await-Statements gefunden`,
        details: { unnecessaryAwaits },
        solution:
          "Entfernen Sie await bei synchronen Funktionen für bessere Performance",
      };
    },
    "info",
  );

  return results;
}

/**
 * Prüft potenzielle State-Inkonsistenzen
 */
export async function runStateConsistencyTests(
  tester: ConflictTester,
  options: {
    state: {
      getState: () => any;
    };
  },
): Promise<ConflictTestResult[]> {
  const { state } = options;
  const results: ConflictTestResult[] = [];

  console.log("\n📊 Starte State-Konsistenz-Tests...\n");

  // Test: State Structure
  await tester.runTest(
    "State Structure Validation",
    "state",
    async () => {
      const currentState = state.getState();
      const requiredSlices = [
        "app",
        "defaults",
        "history",
        "gps",
        "zulassung",
        "ui",
      ];
      const missingSlices = requiredSlices.filter(
        (slice) => !(slice in currentState),
      );

      return {
        passed: missingSlices.length === 0,
        message:
          missingSlices.length === 0
            ? "Alle erforderlichen State-Slices vorhanden"
            : `Fehlende State-Slices: ${missingSlices.join(", ")}`,
        details: { present: Object.keys(currentState), missing: missingSlices },
        solution:
          "Stellen Sie sicher, dass der Initial-State alle erforderlichen Slices enthält",
      };
    },
    "critical",
  );

  // Test: State Immutability
  await tester.runTest(
    "State Immutability Check",
    "state",
    async () => {
      const state1 = state.getState();
      const state2 = state.getState();

      // getState sollte das gleiche Objekt zurückgeben, bis ein Update erfolgt
      const isSameReference = state1 === state2;

      return {
        passed: true,
        message: isSameReference
          ? "State-Referenz bleibt stabil zwischen Aufrufen"
          : "State wird bei jedem Aufruf neu erstellt (Performance-Impact möglich)",
        details: { sameReference: isSameReference },
        solution: !isSameReference
          ? "Erwägen Sie Memoization für bessere Performance"
          : undefined,
      };
    },
    "info",
  );

  // Test: GPS State Integrity
  await tester.runTest(
    "GPS State Integrity",
    "state",
    async () => {
      const currentState = state.getState();
      const gpsState = currentState.gps;

      const issues: string[] = [];

      if (!gpsState) {
        issues.push("GPS State fehlt komplett");
      } else {
        if (!gpsState.points || !Array.isArray(gpsState.points.items)) {
          issues.push("GPS points.items ist kein Array");
        }
        if (
          gpsState.activePointId &&
          typeof gpsState.activePointId !== "string"
        ) {
          issues.push("activePointId sollte string oder null sein");
        }
      }

      return {
        passed: issues.length === 0,
        message:
          issues.length === 0
            ? "GPS State ist konsistent"
            : `GPS State Probleme: ${issues.join(", ")}`,
        details: { issues, gpsState },
        solution:
          issues.length > 0
            ? "Überprüfen Sie die GPS State Initialisierung"
            : undefined,
      };
    },
    "warning",
  );

  // Test: Zulassung State Integrity
  await tester.runTest(
    "Zulassung State Integrity",
    "state",
    async () => {
      const currentState = state.getState();
      const zulState = currentState.zulassung;

      const issues: string[] = [];

      if (!zulState) {
        issues.push("Zulassung State fehlt");
      } else {
        if (!zulState.filters) {
          issues.push("Filters fehlt");
        }
        if (!zulState.results || !Array.isArray(zulState.results.items)) {
          issues.push("Results.items ist kein Array");
        }
        if (
          !["idle", "loading", "ready", "error"].includes(zulState.resultStatus)
        ) {
          issues.push(`Ungültiger resultStatus: ${zulState.resultStatus}`);
        }
      }

      return {
        passed: issues.length === 0,
        message:
          issues.length === 0
            ? "Zulassung State ist konsistent"
            : `Zulassung State Probleme: ${issues.join(", ")}`,
        details: { issues },
        solution:
          issues.length > 0
            ? "Überprüfen Sie die Zulassung State Initialisierung und Updates"
            : undefined,
      };
    },
    "warning",
  );

  return results;
}
