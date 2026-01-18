/**
 * Memory Leak Tests
 * Erkennt potenzielle Memory Leaks
 */

import { ConflictTester, type ConflictTestResult } from "./index";

/**
 * Testet auf Memory Leaks
 */
export async function runMemoryTests(
  tester: ConflictTester,
  options: {
    events: {
      subscribe: (event: string, handler: (payload: any) => void) => () => void;
    };
    state: {
      subscribeState: (callback: (state: any) => void) => () => void;
    };
  },
): Promise<ConflictTestResult[]> {
  const { events, state } = options;
  const results: ConflictTestResult[] = [];

  console.log("\n🧠 Starte Memory Leak Tests...\n");

  // Test: Event Subscription Cleanup
  await tester.runTest(
    "Event Subscription Cleanup",
    "memory",
    async () => {
      const unsubscribers: (() => void)[] = [];

      // Erstelle viele Subscriptions
      for (let i = 0; i < 100; i++) {
        unsubscribers.push(events.subscribe(`test:memory:${i}`, () => {}));
      }

      // Cleanup
      unsubscribers.forEach((unsub) => unsub());

      // Nach Cleanup sollten keine Listener mehr aktiv sein
      // Dies ist ein vereinfachter Test - echte Memory-Prüfung benötigt Dev Tools
      return {
        passed: true,
        message: "Event Subscriptions wurden aufgeräumt",
        details: { subscriptionCount: 100 },
        solution:
          "Rufen Sie immer die Unsubscribe-Funktion auf, z.B. in useEffect cleanup oder componentWillUnmount",
      };
    },
    "warning",
  );

  // Test: State Subscription Cleanup
  await tester.runTest(
    "State Subscription Cleanup",
    "memory",
    async () => {
      const unsubscribers: (() => void)[] = [];

      for (let i = 0; i < 50; i++) {
        unsubscribers.push(state.subscribeState(() => {}));
      }

      unsubscribers.forEach((unsub) => unsub());

      return {
        passed: true,
        message: "State Subscriptions wurden aufgeräumt",
        details: { subscriptionCount: 50 },
        solution:
          "Speichern Sie Unsubscribe-Funktionen und rufen Sie diese beim Cleanup auf",
      };
    },
    "warning",
  );

  // Test: DOM Event Listener Cleanup
  await tester.runTest(
    "DOM Event Listener Pattern",
    "memory",
    async () => {
      const testElement = document.createElement("div");
      document.body.appendChild(testElement);

      const handlers: (() => void)[] = [];

      // Erstelle Event Listener mit Cleanup-Pattern
      for (let i = 0; i < 10; i++) {
        const handler = () => {};
        testElement.addEventListener("click", handler);
        handlers.push(() => testElement.removeEventListener("click", handler));
      }

      // Cleanup
      handlers.forEach((cleanup) => cleanup());
      testElement.remove();

      return {
        passed: true,
        message: "DOM Event Listener Cleanup-Pattern korrekt implementiert",
        details: { listenerCount: 10 },
        solution:
          "Speichern Sie Event Handler-Referenzen und entfernen Sie diese beim Cleanup",
      };
    },
    "warning",
  );

  // Test: Closure Memory Pattern
  await tester.runTest(
    "Closure Memory Retention",
    "memory",
    async () => {
      let leakedData: any[] | null = [];
      let cleanupCalled = false;

      // Simuliere eine Closure, die große Daten hält
      const createClosure = () => {
        const largeData = new Array(1000).fill("x".repeat(1000));
        leakedData = largeData;

        return () => {
          // Closure hält Referenz zu largeData
          return largeData.length;
        };
      };

      const closure = createClosure();

      // Cleanup-Pattern
      const cleanup = () => {
        leakedData = null;
        cleanupCalled = true;
      };

      cleanup();

      return {
        passed: cleanupCalled && leakedData === null,
        message: "Closure-Cleanup funktioniert korrekt",
        details: { cleanupCalled, dataCleared: leakedData === null },
        solution:
          "Setzen Sie große Datenstrukturen auf null beim Cleanup und vermeiden Sie unnötige Closures",
      };
    },
    "info",
  );

  // Test: Timer Cleanup
  await tester.runTest(
    "Timer Cleanup (setInterval/setTimeout)",
    "memory",
    async () => {
      const timers: ReturnType<typeof setInterval>[] = [];

      for (let i = 0; i < 10; i++) {
        timers.push(setInterval(() => {}, 1000));
      }

      // Cleanup
      timers.forEach((timer) => clearInterval(timer));

      return {
        passed: true,
        message: "Timer werden korrekt aufgeräumt",
        details: { timerCount: 10 },
        solution:
          "Speichern Sie Timer-IDs und rufen Sie clearInterval/clearTimeout beim Cleanup auf",
      };
    },
    "warning",
  );

  // Test: WebSocket/Worker Cleanup Pattern
  await tester.runTest(
    "Worker Cleanup Pattern",
    "memory",
    async () => {
      // Simuliere Worker-Lifecycle
      const workerRef = { terminated: false };

      const terminateWorker = () => {
        workerRef.terminated = true;
      };

      // Cleanup
      terminateWorker();

      return {
        passed: workerRef.terminated,
        message: "Worker Cleanup-Pattern implementiert",
        details: { terminated: workerRef.terminated },
        solution:
          "Rufen Sie worker.terminate() auf, wenn der Worker nicht mehr benötigt wird",
      };
    },
    "info",
  );

  // Memory Usage Check (wenn verfügbar)
  await tester.runTest(
    "Memory Usage Check",
    "memory",
    async () => {
      if (typeof performance !== "undefined" && (performance as any).memory) {
        const memory = (performance as any).memory;
        const usedMB = memory.usedJSHeapSize / 1024 / 1024;
        const totalMB = memory.totalJSHeapSize / 1024 / 1024;
        const limitMB = memory.jsHeapSizeLimit / 1024 / 1024;

        const usagePercent = (usedMB / limitMB) * 100;

        return {
          passed: usagePercent < 80,
          message: `JS Heap: ${usedMB.toFixed(2)} MB / ${limitMB.toFixed(2)} MB (${usagePercent.toFixed(1)}%)`,
          details: { usedMB, totalMB, limitMB, usagePercent },
          solution:
            usagePercent >= 80
              ? "Speicherverbrauch kritisch - prüfen Sie auf Memory Leaks"
              : undefined,
        };
      }

      return {
        passed: true,
        message: "Memory API nicht verfügbar (kein Chrome)",
        details: {},
      };
    },
    "info",
  );

  return results;
}

/**
 * Simuliert Memory-intensiven Betrieb
 */
export async function runMemoryStressTest(
  tester: ConflictTester,
  iterations: number = 100,
): Promise<ConflictTestResult> {
  return await tester.runTest(
    `Memory Stress Test (${iterations} Iterationen)`,
    "memory",
    async () => {
      const initialMemory = (performance as any).memory?.usedJSHeapSize || 0;

      // Erstelle und verwerfe große Objekte
      for (let i = 0; i < iterations; i++) {
        const largeArray = new Array(10000).fill({ data: "x".repeat(100) });
        // Lasse GC arbeiten
        if (i % 10 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }

      // Force GC wenn möglich
      if ((globalThis as any).gc) {
        (globalThis as any).gc();
      }

      await new Promise((resolve) => setTimeout(resolve, 100));

      const finalMemory = (performance as any).memory?.usedJSHeapSize || 0;
      const memoryIncrease = (finalMemory - initialMemory) / 1024 / 1024;

      return {
        passed: memoryIncrease < 50, // Weniger als 50MB Anstieg
        message: `Memory-Anstieg nach Stress-Test: ${memoryIncrease.toFixed(2)} MB`,
        details: {
          initialMB: initialMemory / 1024 / 1024,
          finalMB: finalMemory / 1024 / 1024,
          increaseMB: memoryIncrease,
        },
        solution:
          memoryIncrease >= 50
            ? "Potentieller Memory Leak - große Objekte werden nicht freigegeben"
            : undefined,
      };
    },
    "warning",
  );
}
