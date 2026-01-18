/**
 * Digitale PSM - Test Runner
 *
 * Haupteinstiegspunkt für alle Tests
 * Kann im Browser oder über Node.js ausgeführt werden
 */

import { PerformanceTester, type PerformanceReport } from "./performance/index";
import { runDatabaseTests, runWorkerStressTest } from "./performance/database";
import {
  runStateTests,
  runEventBusTests,
  runMemoryLeakTest,
} from "./performance/state";
import {
  runVirtualListTests,
  runDomTests,
  runTableRenderTests,
  measureFrameRate,
} from "./performance/rendering";
import {
  runNetworkTests,
  runBvlDatasetTests,
  runServiceWorkerTests,
  analyzeNetworkTimings,
} from "./performance/network";

import { ConflictTester, type ConflictReport } from "./conflicts/index";
import {
  runRaceConditionTests,
  testAsyncLock,
} from "./conflicts/raceConditions";
import { runMemoryTests, runMemoryStressTest } from "./conflicts/memory";
import {
  runCompatibilityTests,
  runCodeQualityTests,
  runStateConsistencyTests,
} from "./conflicts/codeQuality";

export interface FullTestReport {
  timestamp: string;
  performance: PerformanceReport;
  conflicts: ConflictReport;
  summary: {
    totalTests: number;
    totalPassed: number;
    totalFailed: number;
    executionTimeMs: number;
  };
  recommendations: string[];
}

/**
 * Führt alle Tests aus
 */
export async function runAllTests(options: {
  services: {
    state: {
      getState: () => any;
      patchState: (patch: any) => void;
      updateSlice: (slice: string, updater: (current: any) => any) => void;
      subscribeState: (callback: (state: any) => void) => () => void;
    };
    events: {
      emit: (event: string, payload?: any) => void;
      subscribe: (event: string, handler: (payload: any) => void) => () => void;
    };
  };
  sqlite?: {
    isSupported: () => boolean;
    initWorker: () => Promise<void>;
    executeSQL: (sql: string, params?: any[]) => Promise<any>;
    appendHistoryEntry: (entry: any) => Promise<number>;
    listHistoryEntriesPaged: (opts: any) => Promise<any>;
    getHistoryEntryById: (id: number) => Promise<any>;
    deleteHistoryEntryById: (id: number) => Promise<boolean>;
    searchBvlMittel: (query: string, opts?: any) => Promise<any[]>;
  };
  bvlDataset?: {
    hasLocalDatabase: () => Promise<boolean>;
    downloadLocalDatabase: (opts?: any) => Promise<any>;
    fetchManifest: () => Promise<any>;
    checkForUpdates: (currentHash?: string) => Promise<any>;
  };
  asyncLock?: {
    acquire: () => Promise<() => void>;
  };
  skipPerformance?: boolean;
  skipConflicts?: boolean;
  verbose?: boolean;
}): Promise<FullTestReport> {
  const startTime = performance.now();

  console.log("\n" + "=".repeat(70));
  console.log("🧪 DIGITALE PSM - VOLLSTÄNDIGE TEST-SUITE");
  console.log("=".repeat(70));
  console.log(`📅 Gestartet: ${new Date().toISOString()}`);
  console.log("");

  const perfTester = new PerformanceTester({
    verbose: options.verbose ?? true,
  });
  const conflictTester = new ConflictTester({
    verbose: options.verbose ?? true,
  });

  // =====================
  // PERFORMANCE TESTS
  // =====================
  if (!options.skipPerformance) {
    console.log("\n" + "-".repeat(70));
    console.log("📊 PERFORMANCE TESTS");
    console.log("-".repeat(70));

    // State Tests
    await runStateTests(perfTester, { state: options.services.state });

    // Event Bus Tests
    await runEventBusTests(perfTester, { events: options.services.events });

    // Memory Leak Test
    await runMemoryLeakTest(perfTester, {
      events: options.services.events,
      state: options.services.state,
    });

    // Database Tests (wenn SQLite verfügbar)
    if (options.sqlite) {
      await runDatabaseTests(perfTester, { sqlite: options.sqlite });
    }

    // DOM Tests
    await runDomTests(perfTester);

    // Table Render Tests
    await runTableRenderTests(perfTester, 200);

    // Network Tests
    await runNetworkTests(perfTester);

    // Service Worker Tests
    await runServiceWorkerTests(perfTester);

    // Frame Rate
    console.log("\n🎬 Messe Frame Rate...");
    const fps = await measureFrameRate(500);
    console.log(`   Durchschnitt: ${fps.avgFps.toFixed(1)} FPS`);
    console.log(
      `   Min: ${fps.minFps.toFixed(1)} FPS, Max: ${fps.maxFps.toFixed(1)} FPS`,
    );

    // Network Timing Analysis
    const networkAnalysis = analyzeNetworkTimings();
    console.log(
      `\n📡 Network Analysis: ${networkAnalysis.summary.totalResources} Ressourcen geladen`,
    );
  }

  // =====================
  // CONFLICT TESTS
  // =====================
  if (!options.skipConflicts) {
    console.log("\n" + "-".repeat(70));
    console.log("🔍 KONFLIKT- UND PROBLEM-TESTS");
    console.log("-".repeat(70));

    // Race Condition Tests
    await runRaceConditionTests(conflictTester, options.services);

    // AsyncLock Test (wenn verfügbar)
    if (options.asyncLock) {
      await testAsyncLock(conflictTester, options.asyncLock);
    }

    // Memory Tests
    await runMemoryTests(conflictTester, {
      events: options.services.events,
      state: options.services.state,
    });

    // Compatibility Tests
    await runCompatibilityTests(conflictTester);

    // Code Quality Tests
    await runCodeQualityTests(conflictTester);

    // State Consistency Tests
    await runStateConsistencyTests(conflictTester, {
      state: options.services.state,
    });
  }

  // =====================
  // REPORTS GENERIEREN
  // =====================
  const perfReport = perfTester.generateReport();
  const conflictReport = conflictTester.generateReport();
  const executionTime = performance.now() - startTime;

  const totalTests = perfReport.totalTests + conflictReport.totalTests;
  const totalPassed = perfReport.passed + conflictReport.passed;
  const totalFailed = perfReport.failed + conflictReport.failed;

  // Kombinierte Empfehlungen
  const allRecommendations = [
    ...perfReport.recommendations,
    ...conflictReport.recommendations,
  ];

  // Final Report
  const fullReport: FullTestReport = {
    timestamp: new Date().toISOString(),
    performance: perfReport,
    conflicts: conflictReport,
    summary: {
      totalTests,
      totalPassed,
      totalFailed,
      executionTimeMs: executionTime,
    },
    recommendations: allRecommendations,
  };

  // Print Summary
  console.log("\n" + "=".repeat(70));
  console.log("📋 ZUSAMMENFASSUNG");
  console.log("=".repeat(70));
  console.log(`\n✅ Bestanden: ${totalPassed}/${totalTests}`);
  console.log(`❌ Fehlgeschlagen: ${totalFailed}`);
  console.log(`⏱️ Ausführungszeit: ${(executionTime / 1000).toFixed(2)}s`);

  if (allRecommendations.length > 0) {
    console.log("\n💡 TOP EMPFEHLUNGEN:");
    allRecommendations.slice(0, 5).forEach((r) => console.log(`   ${r}`));
  }

  console.log("\n" + "=".repeat(70));

  return fullReport;
}

/**
 * Führt nur Performance-Tests aus
 */
export async function runPerformanceTestsOnly(
  options: Parameters<typeof runAllTests>[0],
): Promise<PerformanceReport> {
  const result = await runAllTests({ ...options, skipConflicts: true });
  return result.performance;
}

/**
 * Führt nur Konflikt-Tests aus
 */
export async function runConflictTestsOnly(
  options: Parameters<typeof runAllTests>[0],
): Promise<ConflictReport> {
  const result = await runAllTests({ ...options, skipPerformance: true });
  return result.conflicts;
}

// Export für Browser-Konsole
if (typeof window !== "undefined") {
  (window as any).PSMTests = {
    runAllTests,
    runPerformanceTestsOnly,
    runConflictTestsOnly,
    PerformanceTester,
    ConflictTester,
  };
}
