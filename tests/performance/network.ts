/**
 * Network Performance Tests
 * Testet BVL Dataset Loading und Manifest Fetching
 */

import {
  PerformanceTester,
  PERFORMANCE_BUDGETS,
  type PerformanceMetric,
} from "./index";

/**
 * Testet Network/Download Performance
 */
export async function runNetworkTests(
  tester: PerformanceTester,
): Promise<PerformanceMetric[]> {
  const metrics: PerformanceMetric[] = [];

  console.log("\n🌐 Starte Network Performance Tests...\n");

  // Test: Manifest Fetch
  await tester.runAsync(
    "Fetch BVL Manifest",
    async () => {
      const manifestUrl =
        "https://abbas-hoseiny.github.io/pflanzenschutz-db/manifest.json";
      const response = await fetch(manifestUrl);
      if (!response.ok) {
        throw new Error(`Manifest fetch failed: ${response.status}`);
      }
      return await response.json();
    },
    "network",
    PERFORMANCE_BUDGETS.MANIFEST_FETCH,
  );

  // Test: Check Local Database
  await tester.runAsync(
    "Check Local Database Availability",
    async () => {
      try {
        const response = await fetch("/data/bvl/pflanzenschutz.sqlite", {
          method: "HEAD",
        });
        return response.ok;
      } catch {
        return false;
      }
    },
    "network",
    1000,
  );

  // Test: Small Resource Fetch
  await tester.runAsync(
    "Fetch Small Resource",
    async () => {
      // Lade eine kleine Ressource zum Testen der Latenz
      const response = await fetch("/manifest.json");
      return await response.json();
    },
    "network",
    500,
  );

  return metrics;
}

/**
 * Testet BVL Dataset Operations
 */
export async function runBvlDatasetTests(
  tester: PerformanceTester,
  options: {
    bvlDataset: {
      hasLocalDatabase: () => Promise<boolean>;
      downloadLocalDatabase: (opts?: any) => Promise<any>;
      fetchManifest: () => Promise<any>;
      checkForUpdates: (currentHash?: string) => Promise<any>;
    };
  },
): Promise<PerformanceMetric[]> {
  const metrics: PerformanceMetric[] = [];
  const { bvlDataset } = options;

  console.log("\n📦 Starte BVL Dataset Tests...\n");

  // Test: Check for Local Database
  const hasLocal = await tester.runAsync(
    "Check Local Database",
    async () => {
      return await bvlDataset.hasLocalDatabase();
    },
    "network",
    500,
  );

  // Test: Fetch Manifest
  let manifest: any;
  await tester.runAsync(
    "Fetch BVL Manifest",
    async () => {
      manifest = await bvlDataset.fetchManifest();
      return manifest;
    },
    "network",
    PERFORMANCE_BUDGETS.MANIFEST_FETCH,
  );

  // Test: Check for Updates
  await tester.runAsync(
    "Check for Updates",
    async () => {
      return await bvlDataset.checkForUpdates("dummy-hash");
    },
    "network",
    PERFORMANCE_BUDGETS.MANIFEST_FETCH,
  );

  // Lokale Datenbank Download-Test (nur wenn verfügbar)
  if (hasLocal) {
    console.log(
      "ℹ️ Lokale Datenbank verfügbar - Download-Test wird durchgeführt",
    );

    await tester.runAsync(
      "Download Local Database",
      async () => {
        return await bvlDataset.downloadLocalDatabase({
          onProgress: (progress: any) => {
            // Stille Progress-Callbacks für Test
          },
        });
      },
      "network",
      10000, // 10 Sekunden für lokalen Download
    );
  }

  return metrics;
}

/**
 * Testet Service Worker Caching
 */
export async function runServiceWorkerTests(
  tester: PerformanceTester,
): Promise<PerformanceMetric[]> {
  const metrics: PerformanceMetric[] = [];

  console.log("\n⚡ Starte Service Worker Tests...\n");

  if (!("serviceWorker" in navigator)) {
    console.log("⚠️ Service Worker nicht unterstützt");
    return metrics;
  }

  // Test: Service Worker Registration Check
  await tester.runAsync(
    "Service Worker Registration Check",
    async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return !!registration;
    },
    "network",
    100,
  );

  // Test: Cached Resource Fetch (wenn SW aktiv)
  const registration = await navigator.serviceWorker.getRegistration();
  if (registration?.active) {
    // First fetch (may be network)
    await tester.runAsync(
      "First Fetch (possibly cached)",
      async () => {
        const start = performance.now();
        await fetch("/manifest.json");
        return performance.now() - start;
      },
      "network",
      500,
    );

    // Second fetch (should be cached)
    await tester.runAsync(
      "Second Fetch (should be cached)",
      async () => {
        const start = performance.now();
        await fetch("/manifest.json");
        return performance.now() - start;
      },
      "network",
      100,
    );
  }

  return metrics;
}

/**
 * Prüft Network Timing API
 */
export function analyzeNetworkTimings(): {
  resources: PerformanceResourceTiming[];
  summary: {
    totalResources: number;
    totalTransferSize: number;
    avgDuration: number;
    slowestResources: Array<{ name: string; duration: number }>;
  };
} {
  const resources = performance.getEntriesByType(
    "resource",
  ) as PerformanceResourceTiming[];

  const durations = resources.map((r) => r.duration);
  const sorted = resources
    .map((r) => ({ name: r.name, duration: r.duration }))
    .sort((a, b) => b.duration - a.duration);

  return {
    resources,
    summary: {
      totalResources: resources.length,
      totalTransferSize: resources.reduce(
        (sum, r) => sum + (r.transferSize || 0),
        0,
      ),
      avgDuration:
        durations.length > 0
          ? durations.reduce((a, b) => a + b, 0) / durations.length
          : 0,
      slowestResources: sorted.slice(0, 5),
    },
  };
}
