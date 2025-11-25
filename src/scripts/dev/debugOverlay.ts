import type { AppState, SliceWindow } from "@scripts/core/state";

type StateModule = typeof import("@scripts/core/state");
type EventBusModule = typeof import("@scripts/core/eventBus");

type DebugOverlayServices = {
  state: {
    getState: StateModule["getState"];
    subscribe: StateModule["subscribeState"];
  };
  events: {
    emit: EventBusModule["emit"];
    subscribe: EventBusModule["subscribe"];
  };
};

type ProviderBudget = {
  initialLoad?: number;
  maxItems?: number;
};

type ProviderMetrics = {
  items?: number | null;
  totalCount?: number | null;
  cursor?: string | number | null;
  payloadKb?: number | null;
  lastUpdated?: string | null;
  note?: string | null;
};

type ProviderConfig = {
  id: string;
  label: string;
  budget?: ProviderBudget;
  getMetrics?: (state: AppState) => ProviderMetrics | null;
};

type ProviderRecord = ProviderConfig & {
  source: "built-in" | "external" | "placeholder";
  metrics: ProviderMetrics | null;
  error: string | null;
};

type BudgetLevel = "unknown" | "ok" | "warn" | "over";

type ProviderHandle = {
  update: (metrics: ProviderMetrics | null) => void;
  dispose: () => void;
};

type OverlayApi = {
  registerProvider: (config: ProviderConfig) => ProviderHandle;
  refresh: () => void;
};

const STYLE_ID = "psl-debug-overlay-style";
const OVERLAY_ID = "psl-debug-overlay";

const PROVIDER_TEMPLATES: ProviderConfig[] = [
  {
    id: "history",
    label: "History UI",
    budget: { initialLoad: 50, maxItems: 200 },
  },
  {
    id: "documentation",
    label: "Documentation",
    budget: { initialLoad: 50, maxItems: 150 },
  },
  {
    id: "reporting",
    label: "Reporting",
    budget: { initialLoad: 25, maxItems: 100 },
  },
  {
    id: "settings",
    label: "Settings (Mediums)",
    budget: { initialLoad: 50, maxItems: 100 },
  },
  { id: "gps", label: "GPS", budget: { initialLoad: 100, maxItems: 200 } },
  { id: "lookup", label: "Lookup", budget: { initialLoad: 25, maxItems: 75 } },
  {
    id: "import",
    label: "Import-Vorschau",
    budget: { initialLoad: 20, maxItems: 50 },
  },
];

const PROVIDER_EVENT_MAP: Record<string, string> = {
  "history:data-changed": "history",
  "mediums:data-changed": "settings",
  "gps:data-changed": "gps",
};

export function initDebugOverlay(services: DebugOverlayServices): void {
  if (typeof window === "undefined") {
    return;
  }

  destroyExistingOverlay();
  injectStyles();

  const globalWithPsl = window as typeof window & {
    __PSL?: Record<string, any>;
  };
  if (!globalWithPsl.__PSL) {
    globalWithPsl.__PSL = {};
  }

  const providerRegistry = new Map<string, ProviderRecord>();
  for (const template of PROVIDER_TEMPLATES) {
    ensureProviderRecord(providerRegistry, template.id, {
      label: template.label,
      budget: template.budget,
      source: "placeholder",
    });
  }

  const lastActivityMap = new Map<string, number>();
  const rowsState = { needsRender: false };
  const budgetLevels = new Map<string, BudgetLevel>();

  const overlay = createOverlayElement();
  document.body.appendChild(overlay.root);

  const api: OverlayApi = {
    registerProvider: (config) =>
      registerProvider(
        providerRegistry,
        config,
        () => refreshMetrics(),
        () => scheduleRender(),
        "external"
      ),
    refresh: () => refreshMetrics(),
  };
  globalWithPsl.__PSL.debugOverlayApi = api;
  try {
    window.dispatchEvent(new CustomEvent("psl:debug-overlay-ready"));
  } catch {
    // ignore dispatch failures
  }

  registerBuiltInProviders(providerRegistry);

  const stateUnsubscribe = services.state.subscribe(() => {
    scheduleRefresh();
  });

  const eventUnsubscribes = Object.entries(PROVIDER_EVENT_MAP).map(
    ([eventName, providerId]) =>
      services.events.subscribe(eventName, () => {
        lastActivityMap.set(providerId, Date.now());
        scheduleRender();
      })
  );

  const keyHandler = (event: KeyboardEvent) => {
    if (
      (event.ctrlKey || event.metaKey) &&
      event.shiftKey &&
      event.key.toLowerCase() === "d"
    ) {
      overlay.toggleVisibility();
      event.preventDefault();
    }
  };
  window.addEventListener("keydown", keyHandler);

  const cleanup = () => {
    stateUnsubscribe();
    eventUnsubscribes.forEach((fn) => fn());
    window.removeEventListener("keydown", keyHandler);
  };

  overlay.root.addEventListener("psl:debug-overlay:dispose", cleanup, {
    once: true,
  });

  refreshMetrics();

  function scheduleRefresh(): void {
    refreshMetrics();
  }

  function refreshMetrics(): void {
    const state = services.state.getState();
    providerRegistry.forEach((record) => {
      if (record.getMetrics) {
        try {
          const snapshot = normalizeMetrics(record.getMetrics(state));
          record.metrics = snapshot;
          record.error = null;
          if (snapshot?.lastUpdated) {
            const parsed = Date.parse(snapshot.lastUpdated);
            if (!Number.isNaN(parsed)) {
              lastActivityMap.set(record.id, parsed);
            }
          }
        } catch (error) {
          record.error = error instanceof Error ? error.message : String(error);
          record.metrics = null;
        }
      }
      trackBudgetState(record);
    });
    scheduleRender();
  }

  function trackBudgetState(record: ProviderRecord): void {
    const nextLevel = determineBudgetLevel(record);
    const previousLevel = budgetLevels.get(record.id) ?? "unknown";
    if (nextLevel === previousLevel) {
      return;
    }
    budgetLevels.set(record.id, nextLevel);
    if (nextLevel === "warn" || nextLevel === "over") {
      emitBudgetWarning(record, nextLevel);
    }
  }

  function emitBudgetWarning(record: ProviderRecord, level: BudgetLevel): void {
    const items =
      typeof record.metrics?.items === "number" ? record.metrics.items : -1;
    const maxItems =
      typeof record.budget?.maxItems === "number" ? record.budget.maxItems : -1;
    warnIfLargeState(record.label, items, maxItems, {
      providerId: record.id,
      level,
      budget: record.budget ?? null,
      metrics: record.metrics ?? null,
    });
    services.events.emit("performance:budget-warning", {
      providerId: record.id,
      label: record.label,
      level,
      budget: record.budget ?? null,
      metrics: record.metrics ?? null,
    });
  }

  function scheduleRender(): void {
    if (rowsState.needsRender) {
      return;
    }
    rowsState.needsRender = true;
    window.requestAnimationFrame(() => {
      rowsState.needsRender = false;
      renderRows(providerRegistry, overlay.rows, lastActivityMap);
      overlay.updateFooterReason();
    });
  }
}

function registerBuiltInProviders(registry: Map<string, ProviderRecord>): void {
  const builtIns: ProviderConfig[] = [
    {
      id: "history",
      label: "History UI",
      budget: { initialLoad: 50, maxItems: 200 },
      getMetrics: (state) => metricsFromSlice(state.history),
    },
    {
      id: "settings",
      label: "Settings (Mediums)",
      budget: { initialLoad: 50, maxItems: 100 },
      getMetrics: (state) => metricsFromSlice(state.mediums),
    },
    {
      id: "gps",
      label: "GPS",
      budget: { initialLoad: 100, maxItems: 200 },
      getMetrics: (state) => metricsFromSlice(state.gps.points),
    },
    {
      id: "lookup",
      label: "Lookup",
      budget: { initialLoad: 25, maxItems: 75 },
      getMetrics: (state) => metricsFromLookup(state),
    },
  ];

  for (const config of builtIns) {
    const record = ensureProviderRecord(registry, config.id, {
      label: config.label,
      budget: config.budget,
      getMetrics: config.getMetrics,
      source: "built-in",
    });
    registry.set(config.id, record);
  }
}

function metricsFromSlice(
  slice: SliceWindow<any> | undefined | null
): ProviderMetrics | null {
  if (!slice) {
    return null;
  }
  const items = Array.isArray(slice.items) ? slice.items.length : null;
  const payloadKb = estimatePayloadKb(slice.items);
  return {
    items,
    totalCount: typeof slice.totalCount === "number" ? slice.totalCount : null,
    cursor: slice.cursor ?? null,
    lastUpdated: slice.lastUpdatedAt ?? null,
    payloadKb,
  };
}

function metricsFromLookup(state: AppState): ProviderMetrics | null {
  const result = state.zulassung?.results;
  if (!result) {
    return null;
  }
  return {
    items: Array.isArray(result.items) ? result.items.length : null,
    totalCount:
      typeof result.totalCount === "number" ? result.totalCount : null,
    cursor: result.hasMore ? `${result.page + 1}` : null,
    payloadKb: estimatePayloadKb(result.items),
    lastUpdated: null,
    note: result.hasMore ? "Weitere Seiten verfügbar" : null,
  };
}

function estimatePayloadKb(value: any): number | null {
  if (!value) {
    return 0;
  }
  try {
    const json = JSON.stringify(value);
    return json ? Number((json.length / 1024).toFixed(1)) : 0;
  } catch {
    return null;
  }
}

function normalizeMetrics(
  metrics: ProviderMetrics | null | undefined
): ProviderMetrics | null {
  if (!metrics) {
    return null;
  }
  return {
    items: toNumberOrNull(metrics.items),
    totalCount: toNumberOrNull(metrics.totalCount),
    cursor: metrics.cursor ?? null,
    payloadKb:
      typeof metrics.payloadKb === "number"
        ? Number(metrics.payloadKb.toFixed(1))
        : null,
    lastUpdated: metrics.lastUpdated ?? null,
    note: metrics.note ?? null,
  };
}

function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function ensureProviderRecord(
  registry: Map<string, ProviderRecord>,
  id: string,
  defaults: Partial<ProviderRecord>
): ProviderRecord {
  const existing = registry.get(id);
  if (existing) {
    if (defaults.label) existing.label = defaults.label;
    if (defaults.budget) existing.budget = defaults.budget;
    if (defaults.getMetrics) existing.getMetrics = defaults.getMetrics;
    if (defaults.source) existing.source = defaults.source;
    return existing;
  }
  const record: ProviderRecord = {
    id,
    label: defaults.label ?? id,
    budget: defaults.budget,
    getMetrics: defaults.getMetrics,
    metrics: defaults.metrics ?? null,
    source: defaults.source ?? "placeholder",
    error: null,
  };
  registry.set(id, record);
  return record;
}

function registerProvider(
  registry: Map<string, ProviderRecord>,
  config: ProviderConfig,
  triggerRefresh: () => void,
  requestRender: () => void,
  source: ProviderRecord["source"]
): ProviderHandle {
  const record = ensureProviderRecord(registry, config.id, {
    label: config.label,
    budget: config.budget,
    getMetrics: config.getMetrics,
    source,
  });

  const handle: ProviderHandle = {
    update: (metrics) => {
      record.metrics = normalizeMetrics(metrics);
      record.error = null;
      requestRender();
    },
    dispose: () => {
      registry.delete(record.id);
      requestRender();
    },
  };

  triggerRefresh();
  return handle;
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${OVERLAY_ID} {
      position: fixed;
      right: 1rem;
      bottom: 1rem;
      z-index: 2147483600;
      width: 360px;
      max-height: 65vh;
      display: flex;
      flex-direction: column;
      font-family: "Inter", "Segoe UI", system-ui, -apple-system, sans-serif;
      font-size: 12px;
      color: #f8f9fa;
      background: rgba(15, 15, 20, 0.95);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 10px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(10px);
    }
    #${OVERLAY_ID}.psl-hidden {
      display: none;
    }
    #${OVERLAY_ID} .psl-debug-overlay__header {
      padding: 0.5rem 0.75rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      cursor: grab;
      background: rgba(255, 255, 255, 0.04);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }
    #${OVERLAY_ID} .psl-debug-overlay__header:active {
      cursor: grabbing;
    }
    #${OVERLAY_ID} .psl-debug-overlay__title {
      font-weight: 600;
      font-size: 13px;
      letter-spacing: 0.01em;
    }
    #${OVERLAY_ID} .psl-debug-overlay__actions button {
      background: none;
      border: none;
      color: #f8f9fa;
      font-size: 12px;
      padding: 0.15rem 0.35rem;
      border-radius: 4px;
      cursor: pointer;
    }
    #${OVERLAY_ID} .psl-debug-overlay__actions button:hover {
      background: rgba(255, 255, 255, 0.12);
    }
    #${OVERLAY_ID} table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }
    #${OVERLAY_ID} thead th {
      text-align: left;
      padding: 0.35rem 0.5rem;
      font-weight: 600;
      color: rgba(255, 255, 255, 0.75);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }
    #${OVERLAY_ID} tbody td {
      padding: 0.3rem 0.5rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      vertical-align: top;
    }
    #${OVERLAY_ID} tbody tr:last-child td {
      border-bottom: none;
    }
    #${OVERLAY_ID} .psl-budget {
      font-size: 10px;
      color: rgba(255, 255, 255, 0.6);
    }
    #${OVERLAY_ID} .psl-status-tag {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 0.1rem 0.35rem;
      border-radius: 999px;
    }
    #${OVERLAY_ID} .psl-status-ok {
      background: rgba(0, 180, 90, 0.15);
      color: #5ae28a;
    }
    #${OVERLAY_ID} .psl-status-warn {
      background: rgba(255, 200, 0, 0.15);
      color: #ffd875;
    }
    #${OVERLAY_ID} .psl-status-over {
      background: rgba(255, 71, 87, 0.2);
      color: #ff8c98;
    }
    #${OVERLAY_ID} .psl-status-unknown {
      background: rgba(255, 255, 255, 0.1);
      color: rgba(255, 255, 255, 0.8);
    }
    #${OVERLAY_ID} .psl-debug-overlay__footer {
      padding: 0.35rem 0.6rem;
      font-size: 10px;
      color: rgba(255, 255, 255, 0.65);
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(0, 0, 0, 0.25);
    }
    #${OVERLAY_ID} .psl-debug-overlay__body {
      overflow: auto;
      max-height: 50vh;
    }
    #${OVERLAY_ID}.psl-collapsed .psl-debug-overlay__body,
    #${OVERLAY_ID}.psl-collapsed .psl-debug-overlay__footer {
      display: none;
    }
  `;
  document.head.appendChild(style);
}

function destroyExistingOverlay(): void {
  const existing = document.getElementById(OVERLAY_ID);
  if (existing) {
    existing.remove();
  }
}

function createOverlayElement() {
  const root = document.createElement("section");
  root.id = OVERLAY_ID;

  root.innerHTML = `
    <header class="psl-debug-overlay__header" data-role="drag">
      <div class="psl-debug-overlay__title">Performance Monitor</div>
      <div class="psl-debug-overlay__actions">
        <button data-action="collapse" title="Panel ein-/ausklappen">–</button>
        <button data-action="hide" title="Panel ausblenden">×</button>
      </div>
    </header>
    <div class="psl-debug-overlay__body">
      <table>
        <thead>
          <tr>
            <th>Modul</th>
            <th>Items / Budget</th>
            <th>Payload</th>
            <th>Letzte Aktivität</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    </div>
    <div class="psl-debug-overlay__footer" data-role="footer"></div>
  `;

  const rows = root.querySelector<HTMLTableSectionElement>("tbody");
  const footer = root.querySelector<HTMLDivElement>("[data-role='footer']");
  const dragHandle = root.querySelector<HTMLElement>("[data-role='drag']");

  let collapsed = false;
  let hidden = false;

  const toggleVisibility = () => {
    hidden = !hidden;
    root.classList.toggle("psl-hidden", hidden);
  };

  const toggleCollapsed = () => {
    collapsed = !collapsed;
    root.classList.toggle("psl-collapsed", collapsed);
  };

  root.querySelector("[data-action='hide']")?.addEventListener("click", () => {
    toggleVisibility();
  });
  root
    .querySelector("[data-action='collapse']")
    ?.addEventListener("click", () => {
      toggleCollapsed();
    });

  setupDragging(root, dragHandle);

  const updateFooterReason = () => {
    if (!footer) {
      return;
    }
    const reason = (window as typeof window & { __PSL?: Record<string, any> })
      .__PSL?.debugOverlay?.reason;
    const reasonLabel = reason ? `Modus: ${reason}` : "";
    footer.textContent = `${reasonLabel ? `${reasonLabel} • ` : ""}Hotkey: Ctrl/⌘ + Shift + D`;
  };

  return { root, rows: rows!, toggleVisibility, updateFooterReason };
}

function setupDragging(root: HTMLElement, handle: HTMLElement | null): void {
  if (!handle) {
    return;
  }
  let startX = 0;
  let startY = 0;
  let startRight = 0;
  let startBottom = 0;
  let dragging = false;

  const onPointerMove = (event: PointerEvent) => {
    if (!dragging) {
      return;
    }
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    const newRight = Math.max(0, startRight - deltaX);
    const newBottom = Math.max(0, startBottom - deltaY);
    root.style.right = `${newRight}px`;
    root.style.bottom = `${newBottom}px`;
  };

  const onPointerUp = () => {
    dragging = false;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  };

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
    const rect = root.getBoundingClientRect();
    startRight = window.innerWidth - rect.right;
    startBottom = window.innerHeight - rect.bottom;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  });
}

function renderRows(
  registry: Map<string, ProviderRecord>,
  rowsContainer: HTMLTableSectionElement,
  activityMap: Map<string, number>
): void {
  const fragment = document.createDocumentFragment();
  const order = [
    ...PROVIDER_TEMPLATES.map((tpl) => tpl.id),
    ...Array.from(registry.keys()).filter(
      (id) => !PROVIDER_TEMPLATES.some((tpl) => tpl.id === id)
    ),
  ];

  order.forEach((id) => {
    const record = registry.get(id);
    if (!record) {
      return;
    }
    fragment.appendChild(renderRow(record, activityMap.get(id) ?? null));
  });

  rowsContainer.innerHTML = "";
  rowsContainer.appendChild(fragment);
}

function renderRow(
  record: ProviderRecord,
  activityTimestamp: number | null
): HTMLTableRowElement {
  const row = document.createElement("tr");
  const status = determineStatus(record);
  const metrics = record.metrics;
  const budgetLabel = record.budget
    ? `${record.budget.initialLoad ?? "?"} / ${record.budget.maxItems ?? "?"}`
    : "—";
  const itemsLabel = metrics?.items ?? "—";
  const payloadLabel =
    typeof metrics?.payloadKb === "number"
      ? `${metrics.payloadKb.toFixed(1)} KB`
      : "—";
  const activityLabel = formatActivityLabel(
    activityTimestamp,
    metrics?.lastUpdated
  );
  const note = metrics?.note ?? record.error;

  row.innerHTML = `
    <td>
      <div>${escapeHtml(record.label)}</div>
      <div class="psl-budget">Budget: ${escapeHtml(budgetLabel)}</div>
    </td>
    <td>
      <div>${escapeHtml(itemsLabel)}</div>
      <div class="psl-budget">Gesamt: ${escapeHtml(metrics?.totalCount ?? "—")}</div>
    </td>
    <td>${escapeHtml(payloadLabel)}</td>
    <td>
      <div>${escapeHtml(activityLabel)}</div>
      ${note ? `<div class="psl-budget">${escapeHtml(note)}</div>` : ""}
    </td>
  `;

  const statusTag = document.createElement("div");
  statusTag.className = `psl-status-tag ${status.className}`;
  statusTag.textContent = status.label;
  row.cells[0].prepend(statusTag);

  return row;
}

function determineStatus(record: ProviderRecord): {
  label: string;
  className: string;
  level: BudgetLevel;
} {
  const level = determineBudgetLevel(record);
  switch (level) {
    case "over":
      return { label: "Limit", className: "psl-status-over", level };
    case "warn":
      return { label: "Warn", className: "psl-status-warn", level };
    case "ok":
      return { label: "OK", className: "psl-status-ok", level };
    default:
      return { label: "N/A", className: "psl-status-unknown", level };
  }
}

function determineBudgetLevel(record: ProviderRecord): BudgetLevel {
  if (
    !record.metrics ||
    typeof record.metrics.items !== "number" ||
    !record.budget?.maxItems
  ) {
    return "unknown";
  }
  const items = record.metrics.items;
  const max = record.budget.maxItems;
  if (items >= max) {
    return "over";
  }
  if (items >= max * 0.9) {
    return "warn";
  }
  return "ok";
}

function formatActivityLabel(
  activityTs: number | null,
  lastUpdated: string | null | undefined
): string {
  const label =
    formatTimestamp(activityTs) ||
    formatTimestamp(lastUpdated ? Date.parse(lastUpdated) : null);
  return label || "–";
}

function formatTimestamp(timestamp: number | null): string | null {
  if (!timestamp) {
    return null;
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
}

function escapeHtml(value: unknown): string {
  const text = value == null ? "" : String(value);
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function warnIfLargeState(
  sliceName: string,
  size: number,
  budget: number,
  context?: Record<string, unknown>
): void {
  const readableSize = size >= 0 ? size : "unbekannt";
  const readableBudget = budget >= 0 ? budget : "unbekannt";
  const message = `[PSL][warnIfLargeState] ${sliceName} hält ${readableSize} Items (Budget ${readableBudget}).`;
  const error = new Error(message);
  console.warn(message, {
    size,
    budget,
    context,
    stack: error.stack,
  });
}
