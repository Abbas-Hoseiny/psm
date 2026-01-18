/**
 * State & Event Bus Performance Tests
 * Testet State Management und Event-System
 */

import {
  PerformanceTester,
  PERFORMANCE_BUDGETS,
  type PerformanceMetric,
} from "./index";

/**
 * Testet State Management Performance
 */
export async function runStateTests(
  tester: PerformanceTester,
  options: {
    state: {
      getState: () => any;
      patchState: (patch: any) => void;
      updateSlice: (slice: string, updater: (current: any) => any) => void;
      subscribeState: (callback: (state: any) => void) => () => void;
    };
  },
): Promise<PerformanceMetric[]> {
  const { state } = options;
  const metrics: PerformanceMetric[] = [];

  console.log("\n📊 Starte State Management Tests...\n");

  // Test: Get State
  tester.runSync(
    "Get State",
    () => state.getState(),
    "state",
    PERFORMANCE_BUDGETS.STATE_UPDATE,
  );

  // Test: Patch State (Simple)
  tester.runSync(
    "Patch State (Simple Property)",
    () => {
      state.patchState({
        app: {
          ...state.getState().app,
          testValue: Date.now(),
        },
      });
    },
    "state",
    PERFORMANCE_BUDGETS.STATE_UPDATE,
  );

  // Test: Update Slice
  tester.runSync(
    "Update Slice",
    () => {
      state.updateSlice("defaults", (current: any) => ({
        ...current,
        waterPerHaL: 600,
      }));
    },
    "state",
    PERFORMANCE_BUDGETS.STATE_UPDATE,
  );

  // Test: Multiple Subscriptions
  const unsubscribers: (() => void)[] = [];

  tester.runSync(
    "Create 10 Subscriptions",
    () => {
      for (let i = 0; i < 10; i++) {
        unsubscribers.push(state.subscribeState(() => {}));
      }
    },
    "state",
    PERFORMANCE_BUDGETS.STATE_SUBSCRIBE * 10,
  );

  // Test: State Update with Subscribers
  await tester.runIterations(
    "State Update with 10 Subscribers",
    () => {
      state.patchState({
        app: {
          ...state.getState().app,
          testCounter: Date.now(),
        },
      });
    },
    "state",
    PERFORMANCE_BUDGETS.STATE_UPDATE * 2,
    20,
  );

  // Cleanup subscriptions
  unsubscribers.forEach((unsub) => unsub());

  // Test: Rapid State Updates
  await tester.runIterations(
    "Rapid State Updates (burst)",
    () => {
      for (let i = 0; i < 10; i++) {
        state.patchState({
          app: {
            ...state.getState().app,
            burstCounter: i,
          },
        });
      }
    },
    "state",
    PERFORMANCE_BUDGETS.STATE_UPDATE * 15,
    5,
  );

  // Test: Large State Update
  const largePayload = {
    items: Array.from({ length: 100 }, (_, i) => ({
      id: `item-${i}`,
      name: `Item ${i}`,
      value: Math.random() * 1000,
      metadata: {
        created: new Date().toISOString(),
        tags: ["test", "performance", `tag-${i}`],
      },
    })),
  };

  tester.runSync(
    "Large State Update (100 items)",
    () => {
      state.updateSlice("history", () => ({
        items: largePayload.items,
        cursor: null,
        totalCount: 100,
        isComplete: true,
        lastUpdatedAt: new Date().toISOString(),
      }));
    },
    "state",
    PERFORMANCE_BUDGETS.STATE_UPDATE * 5,
  );

  return metrics;
}

/**
 * Testet Event Bus Performance
 */
export async function runEventBusTests(
  tester: PerformanceTester,
  options: {
    events: {
      emit: (event: string, payload?: any) => void;
      subscribe: (event: string, handler: (payload: any) => void) => () => void;
    };
  },
): Promise<PerformanceMetric[]> {
  const { events } = options;
  const metrics: PerformanceMetric[] = [];

  console.log("\n📡 Starte Event Bus Tests...\n");

  // Test: Subscribe
  let unsubscribe: (() => void) | undefined;

  tester.runSync(
    "Event Subscribe",
    () => {
      unsubscribe = events.subscribe("test:event", () => {});
    },
    "state",
    PERFORMANCE_BUDGETS.STATE_SUBSCRIBE,
  );

  // Test: Emit (no subscribers)
  tester.runSync(
    "Event Emit (no subscribers)",
    () => {
      events.emit("nonexistent:event", { test: true });
    },
    "state",
    PERFORMANCE_BUDGETS.EVENT_EMIT,
  );

  // Test: Emit (with subscriber)
  let received = false;
  const unsub = events.subscribe("test:perf", () => {
    received = true;
  });

  tester.runSync(
    "Event Emit (with subscriber)",
    () => {
      events.emit("test:perf", { timestamp: Date.now() });
    },
    "state",
    PERFORMANCE_BUDGETS.EVENT_EMIT,
  );

  unsub();

  // Test: Multiple Subscribers
  const subscribers: (() => void)[] = [];
  let callCount = 0;

  for (let i = 0; i < 20; i++) {
    subscribers.push(
      events.subscribe("test:multi", () => {
        callCount++;
      }),
    );
  }

  await tester.runIterations(
    "Event Emit to 20 Subscribers",
    () => {
      events.emit("test:multi", { iteration: Date.now() });
    },
    "state",
    PERFORMANCE_BUDGETS.EVENT_EMIT * 5,
    10,
  );

  subscribers.forEach((unsub) => unsub());

  // Test: Event with Large Payload
  const largePayload = {
    items: Array.from({ length: 50 }, (_, i) => ({
      id: i,
      data: `payload-${i}`,
    })),
    metadata: {
      timestamp: Date.now(),
      source: "performance-test",
    },
  };

  const largeSub = events.subscribe("test:large", () => {});

  tester.runSync(
    "Event Emit (large payload)",
    () => {
      events.emit("test:large", largePayload);
    },
    "state",
    PERFORMANCE_BUDGETS.EVENT_EMIT * 2,
  );

  largeSub();

  // Cleanup
  if (unsubscribe) unsubscribe();

  return metrics;
}

/**
 * Testet Memory-Leaks bei Subscriptions
 */
export async function runMemoryLeakTest(
  tester: PerformanceTester,
  options: {
    events: {
      subscribe: (event: string, handler: (payload: any) => void) => () => void;
    };
    state: {
      subscribeState: (callback: (state: any) => void) => () => void;
    };
  },
): Promise<{ potentialLeaks: string[] }> {
  console.log("\n🔍 Prüfe auf Memory Leaks...\n");

  const potentialLeaks: string[] = [];

  // Test: Subscription Cleanup
  const subscriptions: (() => void)[] = [];

  // Erstelle viele Subscriptions
  for (let i = 0; i < 100; i++) {
    subscriptions.push(options.events.subscribe(`leak:test:${i}`, () => {}));
    subscriptions.push(options.state.subscribeState(() => {}));
  }

  // Cleanup
  const cleanupStart = performance.now();
  subscriptions.forEach((unsub) => unsub());
  const cleanupDuration = performance.now() - cleanupStart;

  if (cleanupDuration > 100) {
    potentialLeaks.push(
      `Subscription Cleanup dauert zu lange: ${cleanupDuration.toFixed(2)}ms für 200 Subscriptions`,
    );
  }

  // Memory check (wenn verfügbar)
  if (typeof performance !== "undefined" && (performance as any).memory) {
    const memory = (performance as any).memory;
    console.log(
      `📈 JS Heap Used: ${(memory.usedJSHeapSize / 1024 / 1024).toFixed(2)} MB`,
    );
    console.log(
      `📈 JS Heap Total: ${(memory.totalJSHeapSize / 1024 / 1024).toFixed(2)} MB`,
    );
  }

  return { potentialLeaks };
}
