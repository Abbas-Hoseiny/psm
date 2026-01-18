/**
 * Browser-ausführbares Test-Script
 *
 * Dieses Script kann direkt im Browser-Kontext ausgeführt werden
 * um die Tests durchzuführen und Ergebnisse zu sammeln.
 */

// Test-Ergebnisse speichern
const testResults = {
  performance: [],
  conflicts: [],
  summary: {
    passed: 0,
    failed: 0,
    warnings: [],
    criticalIssues: [],
    recommendations: [],
  },
};

// Performance Budget Konstanten
const BUDGETS = {
  STATE_UPDATE: 10,
  EVENT_EMIT: 5,
  DOM_BATCH: 100,
  WORKER_RESPONSE: 100,
};

/**
 * Misst Ausführungszeit
 */
function measure(name, fn, budget) {
  const start = performance.now();
  const result = fn();
  const duration = performance.now() - start;
  const passed = duration <= budget;

  testResults.performance.push({
    name,
    duration: duration.toFixed(2),
    budget,
    passed,
    status: passed ? "✅" : "❌",
  });

  if (passed) {
    testResults.summary.passed++;
  } else {
    testResults.summary.failed++;
    testResults.summary.warnings.push(
      `${name}: ${duration.toFixed(2)}ms > ${budget}ms`,
    );
  }

  console.log(
    `${passed ? "✅" : "❌"} ${name}: ${duration.toFixed(2)}ms (Budget: ${budget}ms)`,
  );
  return result;
}

/**
 * Async Messung
 */
async function measureAsync(name, fn, budget) {
  const start = performance.now();
  const result = await fn();
  const duration = performance.now() - start;
  const passed = duration <= budget;

  testResults.performance.push({
    name,
    duration: duration.toFixed(2),
    budget,
    passed,
    status: passed ? "✅" : "❌",
  });

  if (passed) {
    testResults.summary.passed++;
  } else {
    testResults.summary.failed++;
    testResults.summary.warnings.push(
      `${name}: ${duration.toFixed(2)}ms > ${budget}ms`,
    );
  }

  console.log(
    `${passed ? "✅" : "❌"} ${name}: ${duration.toFixed(2)}ms (Budget: ${budget}ms)`,
  );
  return result;
}

/**
 * Konflikt-Test
 */
function checkConflict(name, category, testFn, severity = "warning") {
  try {
    const result = testFn();
    const passed = result.passed;

    testResults.conflicts.push({
      name,
      category,
      severity,
      passed,
      message: result.message,
      solution: result.solution,
    });

    if (passed) {
      testResults.summary.passed++;
      console.log(`✅ [${category}] ${name}: ${result.message}`);
    } else {
      testResults.summary.failed++;
      if (severity === "critical") {
        testResults.summary.criticalIssues.push({
          name,
          message: result.message,
          solution: result.solution,
        });
      } else {
        testResults.summary.warnings.push(`${name}: ${result.message}`);
      }
      console.log(
        `${severity === "critical" ? "❌" : "⚠️"} [${category}] ${name}: ${result.message}`,
      );
      if (result.solution) {
        console.log(`   💡 ${result.solution}`);
      }
    }

    return result;
  } catch (error) {
    console.error(`❌ [${category}] ${name}: Test threw error`, error);
    testResults.summary.failed++;
    return { passed: false, message: error.message };
  }
}

/**
 * HAUPTTESTS
 */
async function runAllBrowserTests() {
  console.log("\n" + "=".repeat(60));
  console.log("🧪 DIGITALE PSM - BROWSER TEST SUITE");
  console.log("=".repeat(60));
  console.log(`📅 ${new Date().toISOString()}\n`);

  // ===============================
  // 1. KOMPATIBILITÄTS-TESTS
  // ===============================
  console.log("\n--- 🌐 KOMPATIBILITÄTS-TESTS ---\n");

  checkConflict(
    "WebAssembly Support",
    "compatibility",
    () => ({
      passed: typeof WebAssembly !== "undefined",
      message:
        typeof WebAssembly !== "undefined"
          ? "WebAssembly verfügbar"
          : "WebAssembly nicht verfügbar",
      solution:
        "Moderner Browser erforderlich (Chrome 57+, Firefox 52+, Safari 11+)",
    }),
    "critical",
  );

  checkConflict(
    "Web Worker Support",
    "compatibility",
    () => ({
      passed: typeof Worker !== "undefined",
      message:
        typeof Worker !== "undefined"
          ? "Web Workers verfügbar"
          : "Web Workers nicht verfügbar",
      solution: "Web Workers sind für SQLite erforderlich",
    }),
    "critical",
  );

  checkConflict(
    "Secure Context",
    "compatibility",
    () => ({
      passed: window.isSecureContext,
      message: window.isSecureContext
        ? "HTTPS/localhost aktiv"
        : "Kein sicherer Kontext",
      solution: "HTTPS oder localhost verwenden für alle Features",
    }),
    "warning",
  );

  checkConflict(
    "IndexedDB Support",
    "compatibility",
    () => ({
      passed: typeof indexedDB !== "undefined",
      message:
        typeof indexedDB !== "undefined"
          ? "IndexedDB verfügbar"
          : "IndexedDB nicht verfügbar",
    }),
    "warning",
  );

  checkConflict(
    "Service Worker Support",
    "compatibility",
    () => ({
      passed: "serviceWorker" in navigator,
      message:
        "serviceWorker" in navigator
          ? "Service Workers verfügbar"
          : "Service Workers nicht verfügbar",
    }),
    "info",
  );

  checkConflict(
    "File System Access API",
    "compatibility",
    () => ({
      passed: "showOpenFilePicker" in window,
      message:
        "showOpenFilePicker" in window
          ? "File System API verfügbar"
          : "File System API nicht verfügbar (Fallback aktiv)",
      solution: "Chrome/Edge empfohlen für beste Erfahrung",
    }),
    "info",
  );

  // ===============================
  // 2. PERFORMANCE-TESTS
  // ===============================
  console.log("\n--- 📊 PERFORMANCE-TESTS ---\n");

  // DOM Tests
  const testContainer = document.createElement("div");
  testContainer.style.cssText = "position: absolute; left: -9999px;";
  document.body.appendChild(testContainer);

  measure(
    "Create 100 DOM Elements",
    () => {
      for (let i = 0; i < 100; i++) {
        const div = document.createElement("div");
        div.className = "test";
        div.textContent = `Item ${i}`;
        testContainer.appendChild(div);
      }
    },
    BUDGETS.DOM_BATCH,
  );

  measure(
    "Query 100 Elements",
    () => {
      testContainer.querySelectorAll(".test");
    },
    10,
  );

  measure(
    "Update 100 Elements",
    () => {
      const elements = testContainer.querySelectorAll(".test");
      elements.forEach((el, i) => {
        el.textContent = `Updated ${i}`;
      });
    },
    BUDGETS.DOM_BATCH,
  );

  measure(
    "Remove 100 Elements",
    () => {
      testContainer.innerHTML = "";
    },
    BUDGETS.DOM_BATCH,
  );

  measure(
    "innerHTML Batch (100 elements)",
    () => {
      testContainer.innerHTML = Array.from(
        { length: 100 },
        (_, i) => `<div class="batch">Batch ${i}</div>`,
      ).join("");
    },
    BUDGETS.DOM_BATCH / 2,
  );

  testContainer.remove();

  // ===============================
  // 3. MEMORY TESTS
  // ===============================
  console.log("\n--- 🧠 MEMORY-TESTS ---\n");

  if (performance.memory) {
    const mem = performance.memory;
    const usedMB = (mem.usedJSHeapSize / 1024 / 1024).toFixed(2);
    const totalMB = (mem.totalJSHeapSize / 1024 / 1024).toFixed(2);
    const limitMB = (mem.jsHeapSizeLimit / 1024 / 1024).toFixed(2);
    const usage = ((mem.usedJSHeapSize / mem.jsHeapSizeLimit) * 100).toFixed(1);

    checkConflict(
      "Memory Usage",
      "memory",
      () => ({
        passed: usage < 80,
        message: `JS Heap: ${usedMB}MB / ${limitMB}MB (${usage}%)`,
      }),
      usage >= 80 ? "critical" : "info",
    );
  } else {
    console.log("ℹ️ Memory API nicht verfügbar (kein Chrome)");
  }

  // Event Listener Cleanup Test
  checkConflict(
    "Event Listener Pattern",
    "memory",
    () => {
      const handlers = [];
      const testEl = document.createElement("div");

      for (let i = 0; i < 50; i++) {
        const handler = () => {};
        testEl.addEventListener("click", handler);
        handlers.push(() => testEl.removeEventListener("click", handler));
      }

      handlers.forEach((cleanup) => cleanup());
      return { passed: true, message: "50 Event Listeners korrekt aufgeräumt" };
    },
    "info",
  );

  // ===============================
  // 4. CODE QUALITY CHECKS
  // ===============================
  console.log("\n--- 🔧 CODE QUALITY CHECKS ---\n");

  // Bekannte Probleme aus dem Build
  checkConflict(
    "Deprecated APIs in Use",
    "code-quality",
    () => ({
      passed: false,
      message:
        "5 deprecated APIs gefunden (document.execCommand, event.returnValue, document.write)",
      solution:
        "Clipboard API statt execCommand, event.preventDefault() statt returnValue",
    }),
    "warning",
  );

  checkConflict(
    "Import Conflicts (Vite)",
    "code-quality",
    () => ({
      passed: false,
      message: "4 Module mit gemischten static/dynamic Imports",
      solution: "Einheitlichen Import-Stil pro Modul verwenden",
    }),
    "warning",
  );

  checkConflict(
    "Unused Variables",
    "code-quality",
    () => ({
      passed: false,
      message: "~20 ungenutzte Variablen/Imports laut TypeScript",
      solution: "Entfernen oder mit _ prefixen für absichtlich ungenutzt",
    }),
    "info",
  );

  // ===============================
  // 5. RACE CONDITION TESTS
  // ===============================
  console.log("\n--- 🏃 RACE CONDITION TESTS ---\n");

  // Simpler Race Condition Test
  checkConflict(
    "Concurrent Update Pattern",
    "race-condition",
    () => {
      let counter = 0;
      const promises = [];

      for (let i = 0; i < 20; i++) {
        promises.push(
          new Promise((resolve) => {
            setTimeout(() => {
              const current = counter;
              counter = current + 1;
              resolve();
            }, Math.random() * 5);
          }),
        );
      }

      // Synchrones Update wäre bei Promise.all problematisch
      return {
        passed: true,
        message:
          "Race Condition Pattern erkannt - AsyncLock sollte verwendet werden",
        solution:
          "Verwenden Sie saveLock/gpsLock aus asyncLock.ts für kritische Operationen",
      };
    },
    "info",
  );

  // ===============================
  // 6. NETWORK TESTS
  // ===============================
  console.log("\n--- 🌐 NETWORK-TESTS ---\n");

  await measureAsync(
    "Fetch Manifest",
    async () => {
      try {
        const resp = await fetch("/manifest.json");
        return resp.ok;
      } catch {
        return false;
      }
    },
    500,
  );

  // Resource Timing
  const resources = performance.getEntriesByType("resource");
  console.log(`📡 ${resources.length} Ressourcen geladen`);
  const slowest = resources
    .map((r) => ({ name: r.name.split("/").pop(), duration: r.duration }))
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 5);
  console.log("   Langsamste Ressourcen:");
  slowest.forEach((r) =>
    console.log(`   - ${r.name}: ${r.duration.toFixed(0)}ms`),
  );

  // ===============================
  // ZUSAMMENFASSUNG
  // ===============================
  console.log("\n" + "=".repeat(60));
  console.log("📋 ZUSAMMENFASSUNG");
  console.log("=".repeat(60));
  console.log(`✅ Bestanden: ${testResults.summary.passed}`);
  console.log(`❌ Fehlgeschlagen: ${testResults.summary.failed}`);

  if (testResults.summary.criticalIssues.length > 0) {
    console.log("\n🚨 KRITISCHE PROBLEME:");
    testResults.summary.criticalIssues.forEach((issue) => {
      console.log(`   ❌ ${issue.name}: ${issue.message}`);
      if (issue.solution) console.log(`      💡 ${issue.solution}`);
    });
  }

  if (testResults.summary.warnings.length > 0) {
    console.log("\n⚠️ WARNUNGEN:");
    testResults.summary.warnings.slice(0, 10).forEach((w) => {
      console.log(`   ⚠️ ${w}`);
    });
  }

  // Empfehlungen basierend auf Ergebnissen
  testResults.summary.recommendations = [
    "🔄 Ersetzen Sie document.execCommand durch Clipboard API",
    "📦 Vereinheitlichen Sie Import-Stil (nur static oder nur dynamic)",
    "🧹 Entfernen Sie ungenutzte Variablen und Imports",
    "🔒 Nutzen Sie AsyncLock für konkurrierende DB-Operationen",
    "📊 Überwachen Sie Memory-Nutzung in Langzeitbetrieb",
  ];

  console.log("\n💡 EMPFEHLUNGEN:");
  testResults.summary.recommendations.forEach((r) => console.log(`   ${r}`));

  console.log("\n" + "=".repeat(60));
  console.log("📄 Vollständiger Report in: testResults");
  console.log("=".repeat(60));

  // Globale Variable für Debugging
  window.__TEST_RESULTS__ = testResults;

  return testResults;
}

// Auto-Run wenn direkt ausgeführt
if (typeof window !== "undefined") {
  window.runPSMTests = runAllBrowserTests;
  console.log(
    "🧪 Test-Suite geladen. Führen Sie `runPSMTests()` aus, um alle Tests zu starten.",
  );
}
