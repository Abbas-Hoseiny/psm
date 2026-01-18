/**
 * Konflikt- und Problem-Test Suite für Digitale PSM
 *
 * Erkennt und dokumentiert potenzielle Probleme:
 * - Race Conditions
 * - Memory Leaks
 * - State Inconsistencies
 * - Worker Communication Failures
 * - Import Conflicts
 * - Browser Compatibility Issues
 */

export interface ConflictTestResult {
  name: string;
  category:
    | "race-condition"
    | "memory"
    | "state"
    | "worker"
    | "import"
    | "compatibility"
    | "code-quality";
  severity: "critical" | "warning" | "info";
  passed: boolean;
  message: string;
  details?: Record<string, any>;
  solution?: string;
}

export interface ConflictReport {
  timestamp: string;
  totalTests: number;
  passed: number;
  failed: number;
  results: ConflictTestResult[];
  criticalIssues: ConflictTestResult[];
  warnings: ConflictTestResult[];
  recommendations: string[];
}

/**
 * Hauptklasse für Konflikt-Tests
 */
export class ConflictTester {
  private results: ConflictTestResult[] = [];

  constructor(
    private readonly options: {
      verbose?: boolean;
    } = {},
  ) {}

  /**
   * Fügt ein Testergebnis hinzu
   */
  addResult(result: ConflictTestResult): void {
    this.results.push(result);

    if (this.options.verbose) {
      const icon = result.passed
        ? "✅"
        : result.severity === "critical"
          ? "❌"
          : "⚠️";
      console.log(
        `${icon} [${result.category}] ${result.name}: ${result.message}`,
      );
    }
  }

  /**
   * Führt einen Test durch
   */
  async runTest(
    name: string,
    category: ConflictTestResult["category"],
    testFn: () => Promise<{
      passed: boolean;
      message: string;
      details?: Record<string, any>;
      solution?: string;
    }>,
    severity: ConflictTestResult["severity"] = "warning",
  ): Promise<ConflictTestResult> {
    try {
      const result = await testFn();
      const testResult: ConflictTestResult = {
        name,
        category,
        severity,
        ...result,
      };
      this.addResult(testResult);
      return testResult;
    } catch (error) {
      const testResult: ConflictTestResult = {
        name,
        category,
        severity: "critical",
        passed: false,
        message: `Test threw an error: ${error instanceof Error ? error.message : String(error)}`,
        details: { error },
      };
      this.addResult(testResult);
      return testResult;
    }
  }

  /**
   * Generiert den Abschlussbericht
   */
  generateReport(): ConflictReport {
    const passed = this.results.filter((r) => r.passed).length;
    const criticalIssues = this.results.filter(
      (r) => !r.passed && r.severity === "critical",
    );
    const warnings = this.results.filter(
      (r) => !r.passed && r.severity === "warning",
    );

    const recommendations: string[] = [];

    // Analysiere Ergebnisse und erstelle Empfehlungen
    const raceConditions = this.results.filter(
      (r) => r.category === "race-condition" && !r.passed,
    );
    if (raceConditions.length > 0) {
      recommendations.push(
        "🏃 Race Conditions gefunden: Implementieren Sie Async Locks oder verwenden Sie Promise-Queues",
      );
    }

    const memoryIssues = this.results.filter(
      (r) => r.category === "memory" && !r.passed,
    );
    if (memoryIssues.length > 0) {
      recommendations.push(
        "🧠 Memory-Probleme gefunden: Prüfen Sie auf fehlende Cleanup-Funktionen und Event-Listener",
      );
    }

    const stateIssues = this.results.filter(
      (r) => r.category === "state" && !r.passed,
    );
    if (stateIssues.length > 0) {
      recommendations.push(
        "📊 State-Inkonsistenzen gefunden: Verwenden Sie immutable Updates und vermeiden Sie direkte Mutations",
      );
    }

    const workerIssues = this.results.filter(
      (r) => r.category === "worker" && !r.passed,
    );
    if (workerIssues.length > 0) {
      recommendations.push(
        "👷 Worker-Probleme gefunden: Implementieren Sie Retry-Logik und Timeout-Handling",
      );
    }

    return {
      timestamp: new Date().toISOString(),
      totalTests: this.results.length,
      passed,
      failed: this.results.length - passed,
      results: this.results,
      criticalIssues,
      warnings,
      recommendations,
    };
  }

  /**
   * Gibt den Bericht als formatierte Konsole aus
   */
  printReport(): void {
    const report = this.generateReport();

    console.log("\n" + "=".repeat(60));
    console.log("🔍 KONFLIKT- UND PROBLEM-REPORT");
    console.log("=".repeat(60));
    console.log(`📅 Zeitstempel: ${report.timestamp}`);
    console.log(`✅ Bestanden: ${report.passed}/${report.totalTests}`);
    console.log(`❌ Fehlgeschlagen: ${report.failed}`);

    if (report.criticalIssues.length > 0) {
      console.log("\n🚨 KRITISCHE PROBLEME:");
      report.criticalIssues.forEach((issue) => {
        console.log(`   ❌ ${issue.name}`);
        console.log(`      ${issue.message}`);
        if (issue.solution) {
          console.log(`      💡 Lösung: ${issue.solution}`);
        }
      });
    }

    if (report.warnings.length > 0) {
      console.log("\n⚠️ WARNUNGEN:");
      report.warnings.forEach((warning) => {
        console.log(`   ⚠️ ${warning.name}`);
        console.log(`      ${warning.message}`);
        if (warning.solution) {
          console.log(`      💡 Lösung: ${warning.solution}`);
        }
      });
    }

    if (report.recommendations.length > 0) {
      console.log("\n💡 EMPFEHLUNGEN:");
      report.recommendations.forEach((r) => console.log(`   ${r}`));
    }

    console.log("\n" + "=".repeat(60));
  }

  /**
   * Setzt die Ergebnisse zurück
   */
  reset(): void {
    this.results = [];
  }
}

// Export Singleton-Instanz
export const conflictTester = new ConflictTester({ verbose: true });
