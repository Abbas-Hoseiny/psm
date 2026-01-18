/**
 * Rendering Performance Tests
 * Testet Virtual List und DOM-Operationen
 */

import {
  PerformanceTester,
  PERFORMANCE_BUDGETS,
  type PerformanceMetric,
} from "./index";

/**
 * Testet Virtual List Performance
 */
export async function runVirtualListTests(
  tester: PerformanceTester,
  options?: {
    container?: HTMLElement;
    itemCount?: number;
  },
): Promise<PerformanceMetric[]> {
  const metrics: PerformanceMetric[] = [];
  const itemCount = options?.itemCount ?? 1000;

  console.log(`\n📜 Starte Virtual List Tests (${itemCount} Items)...\n`);

  // Erstelle Test-Container
  const container = options?.container ?? document.createElement("div");
  container.style.cssText = "height: 500px; width: 300px; overflow: auto;";

  if (!options?.container) {
    document.body.appendChild(container);
  }

  // Test: Virtual List Initialization
  let virtualList: any;

  await tester.runAsync(
    "Virtual List Initialization",
    async () => {
      const { initVirtualList } = await import(
        "../../src/scripts/core/virtualList"
      );

      virtualList = initVirtualList(container, {
        itemCount,
        estimatedItemHeight: 50,
        renderItem: (node: HTMLElement, index: number) => {
          node.innerHTML = `<div class="test-item">Item ${index}</div>`;
          node.style.cssText = "height: 50px; border-bottom: 1px solid #eee;";
        },
        overscan: 6,
      });
    },
    "render",
    PERFORMANCE_BUDGETS.VIRTUAL_LIST_INIT,
  );

  // Test: Scroll to Index
  if (virtualList) {
    await tester.runAsync(
      "Scroll to Index (middle)",
      async () => {
        virtualList.scrollToIndex(Math.floor(itemCount / 2));
        // Warte auf nächsten Frame
        await new Promise((resolve) => requestAnimationFrame(resolve));
      },
      "render",
      PERFORMANCE_BUDGETS.VIRTUAL_LIST_SCROLL * 3,
    );

    await tester.runAsync(
      "Scroll to Index (end)",
      async () => {
        virtualList.scrollToIndex(itemCount - 1);
        await new Promise((resolve) => requestAnimationFrame(resolve));
      },
      "render",
      PERFORMANCE_BUDGETS.VIRTUAL_LIST_SCROLL * 3,
    );

    await tester.runAsync(
      "Scroll to Index (start)",
      async () => {
        virtualList.scrollToIndex(0);
        await new Promise((resolve) => requestAnimationFrame(resolve));
      },
      "render",
      PERFORMANCE_BUDGETS.VIRTUAL_LIST_SCROLL * 3,
    );

    // Test: Update Item Count
    await tester.runAsync(
      "Update Item Count (double)",
      async () => {
        virtualList.updateItemCount(itemCount * 2);
        await new Promise((resolve) => requestAnimationFrame(resolve));
      },
      "render",
      PERFORMANCE_BUDGETS.VIRTUAL_LIST_INIT,
    );

    // Test: Rapid Scroll
    await tester.runIterations(
      "Rapid Scroll Simulation",
      async () => {
        const targetIndex = Math.floor(Math.random() * itemCount);
        virtualList.scrollToIndex(targetIndex);
        await new Promise((resolve) => requestAnimationFrame(resolve));
      },
      "render",
      PERFORMANCE_BUDGETS.VIRTUAL_LIST_SCROLL * 5,
      20,
    );

    // Cleanup
    virtualList.destroy();
  }

  if (!options?.container) {
    container.remove();
  }

  return metrics;
}

/**
 * Testet DOM-Manipulation Performance
 */
export async function runDomTests(
  tester: PerformanceTester,
): Promise<PerformanceMetric[]> {
  const metrics: PerformanceMetric[] = [];

  console.log("\n🎨 Starte DOM Performance Tests...\n");

  const testContainer = document.createElement("div");
  testContainer.id = "dom-perf-test";
  testContainer.style.cssText = "position: absolute; left: -9999px; top: 0;";
  document.body.appendChild(testContainer);

  // Test: Create Elements (100)
  tester.runSync(
    "Create 100 Elements",
    () => {
      for (let i = 0; i < 100; i++) {
        const div = document.createElement("div");
        div.className = "test-element";
        div.textContent = `Element ${i}`;
        testContainer.appendChild(div);
      }
    },
    "render",
    PERFORMANCE_BUDGETS.DOM_UPDATE_BATCH,
  );

  // Test: Query Elements
  tester.runSync(
    "Query 100 Elements",
    () => {
      testContainer.querySelectorAll(".test-element");
    },
    "render",
    10,
  );

  // Test: Update Elements
  tester.runSync(
    "Update 100 Elements",
    () => {
      const elements = testContainer.querySelectorAll(".test-element");
      elements.forEach((el, i) => {
        (el as HTMLElement).textContent = `Updated ${i}`;
        (el as HTMLElement).style.color = "blue";
      });
    },
    "render",
    PERFORMANCE_BUDGETS.DOM_UPDATE_BATCH,
  );

  // Test: Remove Elements
  tester.runSync(
    "Remove 100 Elements",
    () => {
      while (testContainer.firstChild) {
        testContainer.removeChild(testContainer.firstChild);
      }
    },
    "render",
    PERFORMANCE_BUDGETS.DOM_UPDATE_BATCH,
  );

  // Test: innerHTML vs createElement
  tester.runSync(
    "Batch Create via innerHTML (100 elements)",
    () => {
      testContainer.innerHTML = Array.from(
        { length: 100 },
        (_, i) => `<div class="batch-element">Batch ${i}</div>`,
      ).join("");
    },
    "render",
    PERFORMANCE_BUDGETS.DOM_UPDATE_BATCH / 2,
  );

  // Test: DocumentFragment
  tester.runSync(
    "Batch Create via DocumentFragment (100 elements)",
    () => {
      testContainer.innerHTML = "";
      const fragment = document.createDocumentFragment();
      for (let i = 0; i < 100; i++) {
        const div = document.createElement("div");
        div.className = "fragment-element";
        div.textContent = `Fragment ${i}`;
        fragment.appendChild(div);
      }
      testContainer.appendChild(fragment);
    },
    "render",
    PERFORMANCE_BUDGETS.DOM_UPDATE_BATCH,
  );

  // Cleanup
  testContainer.remove();

  return metrics;
}

/**
 * Testet Table Rendering Performance
 */
export async function runTableRenderTests(
  tester: PerformanceTester,
  rowCount: number = 500,
): Promise<PerformanceMetric[]> {
  const metrics: PerformanceMetric[] = [];

  console.log(`\n📋 Starte Table Rendering Tests (${rowCount} Zeilen)...\n`);

  const testContainer = document.createElement("div");
  testContainer.style.cssText = "position: absolute; left: -9999px; top: 0;";
  document.body.appendChild(testContainer);

  // Generate test data
  const testData = Array.from({ length: rowCount }, (_, i) => ({
    id: i + 1,
    date: new Date(Date.now() - i * 86400000).toISOString().split("T")[0],
    name: `Mittel ${i}`,
    value: (Math.random() * 100).toFixed(2),
    unit: ["l/ha", "kg/ha", "g/ha"][i % 3],
  }));

  // Test: Table Render via innerHTML
  tester.runSync(
    `Table Render (${rowCount} rows via innerHTML)`,
    () => {
      testContainer.innerHTML = `
        <table>
          <thead>
            <tr><th>ID</th><th>Datum</th><th>Name</th><th>Menge</th><th>Einheit</th></tr>
          </thead>
          <tbody>
            ${testData
              .map(
                (row) => `
              <tr>
                <td>${row.id}</td>
                <td>${row.date}</td>
                <td>${row.name}</td>
                <td>${row.value}</td>
                <td>${row.unit}</td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
      `;
    },
    "render",
    PERFORMANCE_BUDGETS.DOM_UPDATE_BATCH * 3,
  );

  // Test: Table Update (partial)
  tester.runSync(
    "Table Partial Update (first 50 rows)",
    () => {
      const rows = testContainer.querySelectorAll("tbody tr");
      for (let i = 0; i < Math.min(50, rows.length); i++) {
        const cells = rows[i].querySelectorAll("td");
        if (cells[2]) cells[2].textContent = `Updated ${i}`;
        if (cells[3]) cells[3].textContent = (Math.random() * 100).toFixed(2);
      }
    },
    "render",
    PERFORMANCE_BUDGETS.DOM_UPDATE_BATCH,
  );

  // Cleanup
  testContainer.remove();

  return metrics;
}

/**
 * Misst Frame Rate während Animation
 */
export async function measureFrameRate(
  durationMs: number = 1000,
): Promise<{ avgFps: number; minFps: number; maxFps: number; frames: number }> {
  return new Promise((resolve) => {
    const frameTimes: number[] = [];
    let lastTime = performance.now();
    let animationId: number;
    const startTime = performance.now();

    const measure = (currentTime: number) => {
      const delta = currentTime - lastTime;
      frameTimes.push(delta);
      lastTime = currentTime;

      if (currentTime - startTime < durationMs) {
        animationId = requestAnimationFrame(measure);
      } else {
        cancelAnimationFrame(animationId);

        const fps = frameTimes.map((delta) => 1000 / delta);
        resolve({
          avgFps: fps.reduce((a, b) => a + b, 0) / fps.length,
          minFps: Math.min(...fps),
          maxFps: Math.max(...fps),
          frames: frameTimes.length,
        });
      }
    };

    animationId = requestAnimationFrame(measure);
  });
}
