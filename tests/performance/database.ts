/**
 * Database Performance Tests
 * Testet SQLite Worker und Datenbank-Operationen
 */

import {
  PerformanceTester,
  PERFORMANCE_BUDGETS,
  type PerformanceMetric,
} from "./index";

/**
 * Testet die Database-Performance
 * Muss im Browser-Kontext ausgeführt werden
 */
export async function runDatabaseTests(
  tester: PerformanceTester,
  options: {
    sqlite: {
      isSupported: () => boolean;
      initWorker: () => Promise<void>;
      executeSQL: (sql: string, params?: any[]) => Promise<any>;
      appendHistoryEntry: (entry: any) => Promise<number>;
      listHistoryEntriesPaged: (opts: any) => Promise<any>;
      getHistoryEntryById: (id: number) => Promise<any>;
      deleteHistoryEntryById: (id: number) => Promise<boolean>;
      searchBvlMittel: (query: string, opts?: any) => Promise<any[]>;
    };
  },
): Promise<PerformanceMetric[]> {
  const { sqlite } = options;
  const metrics: PerformanceMetric[] = [];

  console.log("\n🗄️ Starte Datenbank-Performance-Tests...\n");

  // Test: SQLite Support Check
  tester.runSync(
    "SQLite Support Check",
    () => sqlite.isSupported(),
    "database",
    10,
  );

  // Test: Worker Initialization
  await tester.runAsync(
    "Worker Initialization",
    async () => {
      await sqlite.initWorker();
    },
    "worker",
    PERFORMANCE_BUDGETS.DB_INIT,
  );

  // Test: Simple Query
  await tester.runAsync(
    "Simple SELECT Query",
    async () => {
      await sqlite.executeSQL("SELECT 1 as test");
    },
    "database",
    PERFORMANCE_BUDGETS.DB_QUERY_SIMPLE,
  );

  // Test: Create Test Table
  await tester.runAsync(
    "Create Test Table",
    async () => {
      await sqlite.executeSQL(`
        CREATE TABLE IF NOT EXISTS performance_test (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT,
          value REAL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
    },
    "database",
    PERFORMANCE_BUDGETS.DB_QUERY_SIMPLE,
  );

  // Test: Single Insert
  await tester.runAsync(
    "Single Row Insert",
    async () => {
      await sqlite.executeSQL(
        "INSERT INTO performance_test (name, value) VALUES (?, ?)",
        ["test", 123.45],
      );
    },
    "database",
    PERFORMANCE_BUDGETS.DB_INSERT_SINGLE,
  );

  // Test: Batch Insert (100 Rows)
  await tester.runAsync(
    "Batch Insert (100 Rows)",
    async () => {
      const values = Array.from(
        { length: 100 },
        (_, i) => `('batch_${i}', ${i * 1.5})`,
      ).join(",");
      await sqlite.executeSQL(
        `INSERT INTO performance_test (name, value) VALUES ${values}`,
      );
    },
    "database",
    PERFORMANCE_BUDGETS.DB_INSERT_BATCH,
  );

  // Test: Indexed Query
  await tester.runAsync(
    "Indexed Query (by ID)",
    async () => {
      await sqlite.executeSQL("SELECT * FROM performance_test WHERE id = ?", [
        1,
      ]);
    },
    "database",
    PERFORMANCE_BUDGETS.DB_QUERY_SIMPLE,
  );

  // Test: Range Query
  await tester.runAsync(
    "Range Query (BETWEEN)",
    async () => {
      await sqlite.executeSQL(
        "SELECT * FROM performance_test WHERE value BETWEEN ? AND ?",
        [10, 50],
      );
    },
    "database",
    PERFORMANCE_BUDGETS.DB_QUERY_COMPLEX,
  );

  // Test: Text Search (LIKE)
  await tester.runAsync(
    "Text Search (LIKE)",
    async () => {
      await sqlite.executeSQL(
        "SELECT * FROM performance_test WHERE name LIKE ?",
        ["%batch%"],
      );
    },
    "database",
    PERFORMANCE_BUDGETS.DB_QUERY_COMPLEX,
  );

  // Test: Aggregation
  await tester.runAsync(
    "Aggregation Query (COUNT, SUM, AVG)",
    async () => {
      await sqlite.executeSQL(`
        SELECT 
          COUNT(*) as count,
          SUM(value) as total,
          AVG(value) as average
        FROM performance_test
      `);
    },
    "database",
    PERFORMANCE_BUDGETS.DB_QUERY_SIMPLE,
  );

  // Test: History Entry Operations
  const testHistoryEntry = {
    datum: new Date().toISOString().split("T")[0],
    dateIso: new Date().toISOString(),
    ersteller: "Performance Test",
    standort: "Test Location",
    kultur: "Weizen",
    areaHa: 10.5,
    eppoCode: "TRZAW",
    bbch: "25",
    mittel: [
      {
        id: "test-1",
        name: "Test Mittel",
        unit: "l/ha",
        value: 2.5,
        total: 26.25,
        methodLabel: "pro Hektar",
        methodId: "perHa",
      },
    ],
  };

  let insertedId: number;

  await tester.runAsync(
    "Insert History Entry",
    async () => {
      insertedId = await sqlite.appendHistoryEntry(testHistoryEntry);
    },
    "database",
    PERFORMANCE_BUDGETS.DB_INSERT_SINGLE,
  );

  await tester.runAsync(
    "Get History Entry by ID",
    async () => {
      await sqlite.getHistoryEntryById(insertedId);
    },
    "database",
    PERFORMANCE_BUDGETS.DB_QUERY_SIMPLE,
  );

  await tester.runAsync(
    "List History Entries (Paged)",
    async () => {
      await sqlite.listHistoryEntriesPaged({ pageSize: 50 });
    },
    "database",
    PERFORMANCE_BUDGETS.DB_QUERY_COMPLEX,
  );

  // Test: BVL Search (wenn verfügbar)
  try {
    await tester.runAsync(
      "BVL Mittel Search",
      async () => {
        await sqlite.searchBvlMittel("Glyphosat", { limit: 20 });
      },
      "database",
      PERFORMANCE_BUDGETS.DB_QUERY_COMPLEX,
    );
  } catch (e) {
    console.log("ℹ️ BVL-Suche übersprungen (keine BVL-Daten verfügbar)");
  }

  // Cleanup
  await tester.runAsync(
    "Delete Test Entry",
    async () => {
      await sqlite.deleteHistoryEntryById(insertedId);
    },
    "database",
    PERFORMANCE_BUDGETS.DB_QUERY_SIMPLE,
  );

  await tester.runAsync(
    "Drop Test Table",
    async () => {
      await sqlite.executeSQL("DROP TABLE IF EXISTS performance_test");
    },
    "database",
    PERFORMANCE_BUDGETS.DB_QUERY_SIMPLE,
  );

  return metrics;
}

/**
 * Testet Worker-Kommunikation unter Last
 */
export async function runWorkerStressTest(
  tester: PerformanceTester,
  options: {
    callWorker: (action: string, payload?: any) => Promise<any>;
  },
  iterations: number = 50,
): Promise<void> {
  console.log(
    `\n👷 Starte Worker Stress Test (${iterations} Iterationen)...\n`,
  );

  await tester.runIterations(
    "Worker Round-Trip (Simple)",
    async () => {
      await options.callWorker("ping");
    },
    "worker",
    PERFORMANCE_BUDGETS.WORKER_MESSAGE,
    iterations,
  );

  await tester.runIterations(
    "Worker Round-Trip (With Payload)",
    async () => {
      await options.callWorker("executeSQL", {
        sql: "SELECT 1 as test",
        params: [],
      });
    },
    "worker",
    PERFORMANCE_BUDGETS.WORKER_RESPONSE,
    iterations,
  );

  // Concurrent Worker Calls
  await tester.runAsync(
    "Concurrent Worker Calls (10 parallel)",
    async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        options.callWorker("executeSQL", {
          sql: `SELECT ${i} as num`,
          params: [],
        }),
      );
      await Promise.all(promises);
    },
    "worker",
    PERFORMANCE_BUDGETS.WORKER_RESPONSE * 3,
  );
}
