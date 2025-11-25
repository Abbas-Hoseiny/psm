type DebugOverlayBudget = {
  initialLoad?: number;
  maxItems?: number;
};

export type DebugOverlayMetrics = {
  items?: number | null;
  totalCount?: number | null;
  cursor?: string | number | null;
  payloadKb?: number | null;
  lastUpdated?: string | null;
  note?: string | null;
};

export type DebugOverlayProviderConfig = {
  id: string;
  label: string;
  budget?: DebugOverlayBudget;
};

type DebugOverlayProviderHandle = {
  update: (metrics: DebugOverlayMetrics | null) => void;
  dispose: () => void;
};

type DebugOverlayApi = {
  registerProvider: (
    config: DebugOverlayProviderConfig
  ) => DebugOverlayProviderHandle;
};

export type DebugOverlayBinding = {
  config: DebugOverlayProviderConfig;
  handle: DebugOverlayProviderHandle | null;
  lastMetrics: DebugOverlayMetrics | null;
};

const bindings = new Set<DebugOverlayBinding>();
let readyListenerAttached = false;

function resolveApi(): DebugOverlayApi | null {
  if (typeof window === "undefined") {
    return null;
  }
  const globalWithPsl = window as typeof window & {
    __PSL?: { debugOverlayApi?: DebugOverlayApi };
  };
  return globalWithPsl.__PSL?.debugOverlayApi ?? null;
}

function ensureReadyListener(): void {
  if (readyListenerAttached || typeof window === "undefined") {
    return;
  }
  readyListenerAttached = true;
  window.addEventListener("psl:debug-overlay-ready", () => {
    bindings.forEach((binding) => {
      trySyncBinding(binding);
    });
  });
}

function trySyncBinding(binding: DebugOverlayBinding): void {
  const api = resolveApi();
  if (!api?.registerProvider) {
    return;
  }
  if (!binding.handle) {
    binding.handle = api.registerProvider(binding.config);
  }
  binding.handle.update(binding.lastMetrics ?? null);
}

export function createDebugOverlayBinding(
  config: DebugOverlayProviderConfig
): DebugOverlayBinding {
  const binding: DebugOverlayBinding = {
    config,
    handle: null,
    lastMetrics: null,
  };
  bindings.add(binding);
  ensureReadyListener();
  trySyncBinding(binding);
  return binding;
}

export function pushDebugOverlayMetrics(
  binding: DebugOverlayBinding,
  metrics: DebugOverlayMetrics | null
): void {
  binding.lastMetrics = metrics;
  bindings.add(binding);
  ensureReadyListener();
  trySyncBinding(binding);
}

export function estimatePayloadKb(value: unknown): number | null {
  if (value == null) {
    return 0;
  }
  try {
    const json = JSON.stringify(value);
    return json ? Number((json.length / 1024).toFixed(1)) : 0;
  } catch {
    return null;
  }
}
