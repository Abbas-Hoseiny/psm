/**
 * Race Condition Tests
 * Erkennt potenzielle Race Conditions im Code
 */

import { ConflictTester, type ConflictTestResult } from "./index";

/**
 * Testet auf Race Conditions bei parallelen State-Updates
 */
export async function runRaceConditionTests(
  tester: ConflictTester,
  options: {
    state: {
      getState: () => any;
      patchState: (patch: any) => void;
      subscribeState: (callback: (state: any) => void) => () => void;
    };
    events: {
      emit: (event: string, payload?: any) => void;
      subscribe: (event: string, handler: (payload: any) => void) => () => void;
    };
  },
): Promise<ConflictTestResult[]> {
  const { state, events } = options;
  const results: ConflictTestResult[] = [];

  console.log("\n🏃 Starte Race Condition Tests...\n");

  // Test: Concurrent State Updates
  await tester.runTest(
    "Concurrent State Updates",
    "race-condition",
    async () => {
      const initialState = state.getState();
      const updates: Promise<void>[] = [];
      let inconsistencies = 0;

      // Führe 20 parallele Updates durch
      for (let i = 0; i < 20; i++) {
        updates.push(
          new Promise<void>((resolve) => {
            setTimeout(() => {
              const current = state.getState();
              state.patchState({
                app: {
                  ...current.app,
                  testCounter: (current.app.testCounter || 0) + 1,
                },
              });
              resolve();
            }, Math.random() * 10);
          }),
        );
      }

      await Promise.all(updates);

      const finalCounter = state.getState().app.testCounter || 0;

      // Bei perfektem Handling sollte der Counter bei 20 sein
      // Bei Race Conditions kann er niedriger sein
      if (finalCounter < 20) {
        inconsistencies = 20 - finalCounter;
      }

      return {
        passed: inconsistencies === 0,
        message:
          inconsistencies === 0
            ? "Keine Race Conditions bei State-Updates gefunden"
            : `${inconsistencies} Updates gingen verloren durch Race Conditions`,
        details: { expectedCounter: 20, actualCounter: finalCounter },
        solution:
          "Verwenden Sie atomare State-Updates oder implementieren Sie ein Lock-System",
      };
    },
    "warning",
  );

  // Test: Event Emission Order
  await tester.runTest(
    "Event Emission Order",
    "race-condition",
    async () => {
      const receivedOrder: number[] = [];
      const expectedOrder = [1, 2, 3, 4, 5];

      const unsub = events.subscribe(
        "test:order",
        (payload: { num: number }) => {
          receivedOrder.push(payload.num);
        },
      );

      // Emitte Events in schneller Folge
      expectedOrder.forEach((num) => {
        events.emit("test:order", { num });
      });

      // Warte kurz
      await new Promise((resolve) => setTimeout(resolve, 50));

      unsub();

      const orderCorrect = expectedOrder.every(
        (num, i) => receivedOrder[i] === num,
      );

      return {
        passed: orderCorrect,
        message: orderCorrect
          ? "Event-Reihenfolge wird korrekt beibehalten"
          : "Event-Reihenfolge wurde nicht beibehalten",
        details: { expected: expectedOrder, received: receivedOrder },
        solution: "Verwenden Sie synchrone Event-Handler oder eine Event-Queue",
      };
    },
    "warning",
  );

  // Test: Database Operations Race
  await tester.runTest(
    "Concurrent Database Save Requests",
    "race-condition",
    async () => {
      // Simuliere mehrere gleichzeitige Save-Requests
      let saveCallCount = 0;
      let concurrentSaves = 0;
      let maxConcurrent = 0;

      const mockSave = async () => {
        concurrentSaves++;
        maxConcurrent = Math.max(maxConcurrent, concurrentSaves);
        saveCallCount++;
        await new Promise((resolve) => setTimeout(resolve, 10));
        concurrentSaves--;
      };

      // 5 parallele Save-Requests
      await Promise.all([
        mockSave(),
        mockSave(),
        mockSave(),
        mockSave(),
        mockSave(),
      ]);

      return {
        passed: maxConcurrent <= 1,
        message:
          maxConcurrent <= 1
            ? "Datenbank-Speicherung wird korrekt serialisiert"
            : `${maxConcurrent} gleichzeitige Speicherungen erkannt - Race Condition möglich`,
        details: { maxConcurrent, totalCalls: saveCallCount },
        solution:
          "Implementieren Sie ein AsyncLock für Datenbank-Operationen (siehe asyncLock.ts)",
      };
    },
    "critical",
  );

  // Test: Worker Message Race
  await tester.runTest(
    "Worker Message Response Matching",
    "race-condition",
    async () => {
      // Simuliere das Worker-Message-Pattern
      const pendingMessages = new Map<number, { resolve: (v: any) => void }>();
      let messageId = 0;

      const callWorker = (action: string): Promise<any> => {
        return new Promise((resolve) => {
          const id = ++messageId;
          pendingMessages.set(id, { resolve });

          // Simuliere Worker-Antwort mit zufälliger Verzögerung
          setTimeout(() => {
            const pending = pendingMessages.get(id);
            if (pending) {
              pendingMessages.delete(id);
              pending.resolve({ id, action, ok: true });
            }
          }, Math.random() * 20);
        });
      };

      // Sende 10 parallele Nachrichten
      const results = await Promise.all([
        callWorker("action1"),
        callWorker("action2"),
        callWorker("action3"),
        callWorker("action4"),
        callWorker("action5"),
        callWorker("action6"),
        callWorker("action7"),
        callWorker("action8"),
        callWorker("action9"),
        callWorker("action10"),
      ]);

      // Prüfe, ob alle Antworten korrekt zugeordnet wurden
      const allMatched = results.every((r, i) => r.id === i + 1);

      return {
        passed: allMatched,
        message: allMatched
          ? "Worker-Nachrichten werden korrekt zugeordnet"
          : "Worker-Nachrichten-Zuordnung fehlerhaft",
        details: { results },
        solution:
          "Verwenden Sie eindeutige Message-IDs und ein Map für pending Messages",
      };
    },
    "critical",
  );

  // Test: Subscription Cleanup Race
  await tester.runTest(
    "Subscription Cleanup während Event",
    "race-condition",
    async () => {
      let callCount = 0;
      let errorOccurred = false;

      const unsubscribe = events.subscribe("test:cleanup", () => {
        callCount++;
        // Unsubscribe während der Verarbeitung
        unsubscribe();

        // Weitere Emission sollte nicht mehr empfangen werden
        events.emit("test:cleanup", {});
      });

      try {
        events.emit("test:cleanup", {});
        await new Promise((resolve) => setTimeout(resolve, 50));
      } catch (e) {
        errorOccurred = true;
      }

      return {
        passed: !errorOccurred && callCount === 1,
        message:
          callCount === 1 && !errorOccurred
            ? "Unsubscribe während Event-Handling funktioniert korrekt"
            : "Problem beim Unsubscribe während Event-Handling",
        details: { callCount, errorOccurred },
        solution:
          "Verwenden Sie eine Kopie der Subscriber-Liste beim Iterieren",
      };
    },
    "warning",
  );

  return results;
}

/**
 * Testet AsyncLock Implementierung
 */
export async function testAsyncLock(
  tester: ConflictTester,
  asyncLock: {
    acquire: () => Promise<() => void>;
  },
): Promise<ConflictTestResult> {
  return await tester.runTest(
    "AsyncLock Serialisierung",
    "race-condition",
    async () => {
      let concurrent = 0;
      let maxConcurrent = 0;
      const results: number[] = [];

      const task = async (num: number) => {
        const release = await asyncLock.acquire();
        try {
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await new Promise((resolve) => setTimeout(resolve, 10));
          results.push(num);
          concurrent--;
        } finally {
          release();
        }
      };

      await Promise.all([task(1), task(2), task(3), task(4), task(5)]);

      const serialized = maxConcurrent === 1;
      const ordered = results.join(",") === "1,2,3,4,5";

      return {
        passed: serialized,
        message: serialized
          ? "AsyncLock serialisiert korrekt"
          : `AsyncLock erlaubt ${maxConcurrent} gleichzeitige Ausführungen`,
        details: { maxConcurrent, executionOrder: results },
        solution:
          "Überprüfen Sie die Lock-Implementierung auf korrekte Promise-Verkettung",
      };
    },
    "critical",
  );
}
