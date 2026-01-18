/**
 * Performance Test Suite für Digitale PSM
 *
 * Testet alle kritischen Bereiche der Anwendung:
 * - SQLite Worker Performance
 * - Virtual List Rendering
 * - State Management
 * - Event Bus
 * - BVL Dataset Loading
 * - DOM Manipulation
 */

export interface PerformanceMetric {
  name: string;
  duration: number;
  timestamp: number;
  category: "database" | "render" | "state" | "network" | "memory" | "worker";
  passed: boolean;
  threshold: number;
  details?: Record<string, any>;
}

export interface PerformanceReport {
  timestamp: string;
  totalTests: number;
  passed: number;
  failed: number;
  metrics: PerformanceMetric[];
  summary: {
    avgDuration: number;
    maxDuration: number;
    minDuration: number;
    totalDuration: number;
  };
  warnings: string[];
  recommendations: string[];
}

// Performance Budgets (in Millisekunden)
export const PERFORMANCE_BUDGETS = {
  // Database Operations
  DB_INIT: 2000,
  DB_QUERY_SIMPLE: 50,
  DB_QUERY_COMPLEX: 200,
  DB_INSERT_SINGLE: 30,
  DB_INSERT_BATCH: 500,
  DB_EXPORT: 5000,

  // Rendering
  VIRTUAL_LIST_INIT: 100,
  VIRTUAL_LIST_SCROLL: 16, // 60fps target
  DOM_UPDATE_BATCH: 100,

  // State Management
  STATE_UPDATE: 10,
  STATE_SUBSCRIBE: 5,
  EVENT_EMIT: 5,

  // Network
  MANIFEST_FETCH: 3000,
  BVL_DOWNLOAD: 30000,

  // Worker Communication
  WORKER_MESSAGE: 50,
  WORKER_RESPONSE: 100,
};

/**
 * Misst die Ausführungszeit einer asynchronen Funktion
 */
export async function measureAsync<T>(
  name: string,
  fn: () => Promise<T>,
  category: PerformanceMetric["category"],
  threshold: number,
): Promise<{ result: T; metric: PerformanceMetric }> {
  const start = performance.now();
  const result = await fn();
  const duration = performance.now() - start;

  return {
    result,
    metric: {
      name,
      duration,
      timestamp: Date.now(),
      category,
      passed: duration <= threshold,
      threshold,
    },
  };
}

/**
 * Misst die Ausführungszeit einer synchronen Funktion
 */
export function measureSync<T>(
  name: string,
  fn: () => T,
  category: PerformanceMetric["category"],
  threshold: number,
): { result: T; metric: PerformanceMetric } {
  const start = performance.now();
  const result = fn();
  const duration = performance.now() - start;

  return {
    result,
    metric: {
      name,
      duration,
      timestamp: Date.now(),
      category,
      passed: duration <= threshold,
      threshold,
    },
  };
}

/**
 * Hauptklasse für Performance-Tests
 */
export class PerformanceTester {
  private metrics: PerformanceMetric[] = [];
  private warnings: string[] = [];

  constructor(
    private readonly options: {
      verbose?: boolean;
      stopOnFailure?: boolean;
    } = {},
  ) {}

  /**
   * Fügt eine Metrik hinzu
   */
  addMetric(metric: PerformanceMetric): void {
    this.metrics.push(metric);

    if (this.options.verbose) {
      const status = metric.passed ? "✅" : "❌";
      console.log(
        `${status} ${metric.name}: ${metric.duration.toFixed(2)}ms (Budget: ${metric.threshold}ms)`,
      );
    }

    if (!metric.passed) {
      this.warnings.push(
        `${metric.name} überschreitet Budget: ${metric.duration.toFixed(2)}ms > ${metric.threshold}ms`,
      );

      if (this.options.stopOnFailure) {
        throw new Error(`Performance budget exceeded: ${metric.name}`);
      }
    }
  }

  /**
   * Führt einen asynchronen Test durch
   */
  async runAsync<T>(
    name: string,
    fn: () => Promise<T>,
    category: PerformanceMetric["category"],
    threshold: number,
  ): Promise<T> {
    const { result, metric } = await measureAsync(
      name,
      fn,
      category,
      threshold,
    );
    this.addMetric(metric);
    return result;
  }

  /**
   * Führt einen synchronen Test durch
   */
  runSync<T>(
    name: string,
    fn: () => T,
    category: PerformanceMetric["category"],
    threshold: number,
  ): T {
    const { result, metric } = measureSync(name, fn, category, threshold);
    this.addMetric(metric);
    return result;
  }

  /**
   * Führt mehrere Iterationen durch und berechnet Durchschnitt
   */
  async runIterations(
    name: string,
    fn: () => Promise<void> | void,
    category: PerformanceMetric["category"],
    threshold: number,
    iterations: number = 10,
  ): Promise<PerformanceMetric> {
    const durations: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await fn();
      durations.push(performance.now() - start);
    }

    const avgDuration = durations.reduce((a, b) => a + b, 0) / iterations;
    const metric: PerformanceMetric = {
      name: `${name} (avg of ${iterations})`,
      duration: avgDuration,
      timestamp: Date.now(),
      category,
      passed: avgDuration <= threshold,
      threshold,
      details: {
        iterations,
        min: Math.min(...durations),
        max: Math.max(...durations),
        median: durations.sort((a, b) => a - b)[Math.floor(iterations / 2)],
      },
    };

    this.addMetric(metric);
    return metric;
  }

  /**
   * Generiert den Abschlussbericht
   */
  generateReport(): PerformanceReport {
    const passed = this.metrics.filter((m) => m.passed).length;
    const durations = this.metrics.map((m) => m.duration);

    const recommendations: string[] = [];

    // Analysiere Probleme und erstelle Empfehlungen
    const dbMetrics = this.metrics.filter((m) => m.category === "database");
    if (dbMetrics.some((m) => !m.passed)) {
      recommendations.push(
        "🗄️ Datenbank-Performance: Erwägen Sie Indexe zu überprüfen oder Batch-Operationen zu verwenden",
      );
    }

    const renderMetrics = this.metrics.filter((m) => m.category === "render");
    if (renderMetrics.some((m) => !m.passed)) {
      recommendations.push(
        "🎨 Rendering-Performance: Prüfen Sie Virtual List Overscan und DOM-Batch-Updates",
      );
    }

    const stateMetrics = this.metrics.filter((m) => m.category === "state");
    if (stateMetrics.some((m) => !m.passed)) {
      recommendations.push(
        "📊 State-Management: Reduzieren Sie State-Updates oder verwenden Sie Selektoren",
      );
    }

    const workerMetrics = this.metrics.filter((m) => m.category === "worker");
    if (workerMetrics.some((m) => !m.passed)) {
      recommendations.push(
        "👷 Worker-Performance: Überprüfen Sie Message-Serialisierung und Chunking",
      );
    }

    return {
      timestamp: new Date().toISOString(),
      totalTests: this.metrics.length,
      passed,
      failed: this.metrics.length - passed,
      metrics: this.metrics,
      summary: {
        avgDuration:
          durations.length > 0
            ? durations.reduce((a, b) => a + b, 0) / durations.length
            : 0,
        maxDuration: durations.length > 0 ? Math.max(...durations) : 0,
        minDuration: durations.length > 0 ? Math.min(...durations) : 0,
        totalDuration: durations.reduce((a, b) => a + b, 0),
      },
      warnings: this.warnings,
      recommendations,
    };
  }

  /**
   * Gibt den Bericht als formatierte Konsole aus
   */
  printReport(): void {
    const report = this.generateReport();

    console.log("\n" + "=".repeat(60));
    console.log("📊 PERFORMANCE TEST REPORT");
    console.log("=".repeat(60));
    console.log(`📅 Zeitstempel: ${report.timestamp}`);
    console.log(`✅ Bestanden: ${report.passed}/${report.totalTests}`);
    console.log(`❌ Fehlgeschlagen: ${report.failed}`);
    console.log("\n📈 Zusammenfassung:");
    console.log(`   Durchschnitt: ${report.summary.avgDuration.toFixed(2)}ms`);
    console.log(`   Maximum: ${report.summary.maxDuration.toFixed(2)}ms`);
    console.log(`   Minimum: ${report.summary.minDuration.toFixed(2)}ms`);
    console.log(`   Gesamt: ${report.summary.totalDuration.toFixed(2)}ms`);

    if (report.warnings.length > 0) {
      console.log("\n⚠️ Warnungen:");
      report.warnings.forEach((w) => console.log(`   - ${w}`));
    }

    if (report.recommendations.length > 0) {
      console.log("\n💡 Empfehlungen:");
      report.recommendations.forEach((r) => console.log(`   ${r}`));
    }

    console.log("\n" + "=".repeat(60));
  }

  /**
   * Setzt die Metriken zurück
   */
  reset(): void {
    this.metrics = [];
    this.warnings = [];
  }
}

// Export Singleton-Instanz
export const performanceTester = new PerformanceTester({ verbose: true });
