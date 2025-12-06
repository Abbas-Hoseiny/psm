import { getDefaultFieldLabels } from "./labels";

export interface SliceWindow<T> {
  items: T[];
  cursor: string | number | null;
  totalCount: number;
  isComplete: boolean;
  lastUpdatedAt: string | null;
}

export function createSliceWindow<T>(
  overrides: Partial<SliceWindow<T>> = {}
): SliceWindow<T> {
  return {
    items: [],
    cursor: null,
    totalCount: 0,
    isComplete: true,
    lastUpdatedAt: null,
    ...overrides,
  };
}

export function createSliceWindowFromArray<T>(items: T[] = []): SliceWindow<T> {
  return createSliceWindow<T>({
    items: [...items],
    totalCount: items.length,
    isComplete: true,
    lastUpdatedAt: new Date().toISOString(),
  });
}

export function extractSliceItems<T>(
  slice: SliceWindow<T> | T[] | null | undefined
): T[] {
  if (!slice) {
    return [];
  }
  if (Array.isArray(slice)) {
    return slice;
  }
  return Array.isArray(slice.items) ? slice.items : [];
}

export function ensureSliceWindow<T>(
  slice: SliceWindow<T> | T[] | null | undefined
): SliceWindow<T> {
  if (!slice) {
    return createSliceWindow<T>();
  }
  if (Array.isArray(slice)) {
    return createSliceWindowFromArray(slice);
  }
  return slice;
}

export interface ArchiveLogEntry {
  id: string;
  archivedAt: string;
  startDate: string;
  endDate: string;
  entryCount: number;
  fileName: string;
  storageHint?: string;
  note?: string;
}

export interface ArchiveState {
  logs: ArchiveLogEntry[];
}

export interface GpsPoint {
  id: string;
  name: string;
  description?: string | null;
  latitude: number;
  longitude: number;
  source?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GpsState {
  points: SliceWindow<GpsPoint>;
  activePointId: string | null;
  pending: boolean;
  lastError: string | null;
  initialized: boolean;
}

export interface MediumProfile {
  id: string;
  name: string;
  mediumIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AppState {
  app: {
    ready: boolean;
    version: string | null;
    hasFileAccess: boolean;
    hasDatabase: boolean;
    activeSection:
      | "calc"
      | "documentation"
      | "history"
      | "zulassung"
      | "settings"
      | "report"
      | "lookup"
      | "gps"
      | "import";
    storageDriver: "memory" | "sqlite" | "filesystem" | "localstorage";
  };
  company: {
    name: string;
    headline: string;
    logoUrl: string;
    contactEmail: string;
    address: string;
    accentColor: string;
  };
  defaults: {
    waterPerHaL: number;
    form: {
      creator: string;
      location: string;
      crop: string;
      usageType: string;
      areaHa: string;
      eppoCode: string;
      bbch: string;
      gps: string;
      invekos: string;
      time: string;
      date: string;
      // QS-Modus Felder
      qsWartezeit: string;
      qsMaschine: string;
      qsSchaderreger: string;
      qsVerantwortlicher: string;
      qsWetter: string;
      qsBehandlungsart: string;
    };
  };
  measurementMethods: any[];
  mediums: SliceWindow<any>;
  mediumProfiles: MediumProfile[];
  history: SliceWindow<any>;
  archives: ArchiveState;
  fieldLabels: any;
  calcContext: any | null;
  gps: GpsState;
  zulassung: {
    filters: {
      culture: string | null;
      pest: string | null;
      text: string;
      includeExpired: boolean;
    };
    results: {
      items: any[];
      page: number;
      pageSize: number;
      totalCount: number | null;
      hasMore: boolean;
    };
    resultStatus: "idle" | "loading" | "ready" | "error";
    resultError: string | null;
    lastSync: string | null;
    lastResultCounts: any | null;
    dataSource: string | null;
    apiStand: string | null;
    manifestVersion: string | null;
    lastSyncHash: string | null;
    busy: boolean;
    progress: {
      step: string | null;
      percent: number;
      message: string;
    };
    error: string | null;
    logs: any[];
    debug: {
      schema: any | null;
      lastSyncLog: any[];
      manifest: any | null;
      lastAutoUpdateCheck: any | null;
    };
    lookups: {
      cultures: any[];
      pests: any[];
    };
    autoUpdateAvailable: boolean;
    autoUpdateVersion: string | null;
  };
  ui: {
    notifications: any[];
  };
}

type StateListener = (state: AppState, prevState: AppState) => void;

const listeners = new Set<StateListener>();

let state: AppState = {
  app: {
    ready: false,
    version: null,
    hasFileAccess: false,
    hasDatabase: false,
    activeSection: "calc",
    storageDriver: "memory",
  },
  company: {
    name: "",
    headline: "",
    logoUrl: "",
    contactEmail: "",
    address: "",
    accentColor: "",
  },
  defaults: {
    waterPerHaL: 500,
    form: {
      creator: "",
      location: "",
      crop: "",
      usageType: "",
      areaHa: "",
      eppoCode: "",
      bbch: "",
      gps: "",
      invekos: "",
      time: "",
      date: "",
      // QS-Modus Felder
      qsWartezeit: "",
      qsMaschine: "",
      qsSchaderreger: "",
      qsVerantwortlicher: "",
      qsWetter: "",
      qsBehandlungsart: "",
    },
  },
  measurementMethods: [],
  mediums: createSliceWindow(),
  mediumProfiles: [],
  history: createSliceWindow(),
  archives: { logs: [] },
  fieldLabels: getDefaultFieldLabels(),
  calcContext: null,
  gps: {
    points: createSliceWindow(),
    activePointId: null,
    pending: false,
    lastError: null,
    initialized: false,
  },
  zulassung: {
    filters: {
      culture: null,
      pest: null,
      text: "",
      includeExpired: false,
    },
    results: {
      items: [],
      page: 0,
      pageSize: 25,
      totalCount: null,
      hasMore: false,
    },
    resultStatus: "idle",
    resultError: null,
    lastSync: null,
    lastResultCounts: null,
    dataSource: null,
    apiStand: null,
    manifestVersion: null,
    lastSyncHash: null,
    busy: false,
    progress: { step: null, percent: 0, message: "" },
    error: null,
    logs: [],
    debug: {
      schema: null,
      lastSyncLog: [],
      manifest: null,
      lastAutoUpdateCheck: null,
    },
    lookups: { cultures: [], pests: [] },
    autoUpdateAvailable: false,
    autoUpdateVersion: null,
  },
  ui: {
    notifications: [],
  },
};

export function getState(): AppState {
  return state;
}

export function getSlice<K extends keyof AppState>(key: K): AppState[K] {
  return state[key];
}

export function subscribeState(listener: StateListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(prevState: AppState): void {
  for (const listener of listeners) {
    try {
      listener(state, prevState);
    } catch (err) {
      console.error("state listener error", err);
    }
  }
}

export function patchState(patch: Partial<AppState>): AppState {
  const prevState = state;
  state = { ...state, ...patch };
  notify(prevState);
  return state;
}

export function updateSlice<K extends keyof AppState>(
  sliceKey: K,
  updater:
    | ((current: AppState[K], state: AppState) => AppState[K])
    | AppState[K]
): AppState {
  const currentSlice = state[sliceKey];
  const nextSlice =
    typeof updater === "function"
      ? (updater as (current: AppState[K], state: AppState) => AppState[K])(
          currentSlice,
          state
        )
      : updater;
  if (nextSlice === currentSlice) {
    return state;
  }
  return patchState({ [sliceKey]: nextSlice } as Partial<AppState>);
}

export function resetState(newState?: AppState): AppState {
  const base = newState || {
    app: {
      ready: false,
      version: null,
      hasFileAccess: false,
      hasDatabase: false,
      activeSection: "calc" as const,
      storageDriver: "memory" as const,
    },
    company: {
      name: "",
      headline: "",
      logoUrl: "",
      contactEmail: "",
      address: "",
      accentColor: "",
    },
    defaults: {
      waterPerHaL: 500,
      form: {
        creator: "",
        location: "",
        crop: "",
        usageType: "",
        areaHa: "",
        eppoCode: "",
        bbch: "",
        gps: "",
        invekos: "",
        time: "",
        date: "",
        // QS-Modus Felder
        qsWartezeit: "",
        qsMaschine: "",
        qsSchaderreger: "",
        qsVerantwortlicher: "",
        qsWetter: "",
        qsBehandlungsart: "",
      },
    },
    measurementMethods: [],
    mediums: createSliceWindow(),
    mediumProfiles: [],
    history: createSliceWindow(),
    archives: { logs: [] },
    fieldLabels: getDefaultFieldLabels(),
    calcContext: null,
    gps: {
      points: createSliceWindow(),
      activePointId: null,
      pending: false,
      lastError: null,
      initialized: false,
    },
    zulassung: {
      filters: {
        culture: null,
        pest: null,
        text: "",
        includeExpired: false,
      },
      results: {
        items: [],
        page: 0,
        pageSize: 25,
        totalCount: null,
        hasMore: false,
      },
      resultStatus: "idle",
      resultError: null,
      lastSync: null,
      lastResultCounts: null,
      dataSource: null,
      apiStand: null,
      manifestVersion: null,
      lastSyncHash: null,
      busy: false,
      progress: { step: null, percent: 0, message: "" },
      error: null,
      logs: [],
      debug: {
        schema: null,
        lastSyncLog: [],
        manifest: null,
        lastAutoUpdateCheck: null,
      },
      lookups: { cultures: [], pests: [] },
      autoUpdateAvailable: false,
      autoUpdateVersion: null,
    },
    ui: {
      notifications: [],
    },
  };
  const prevState = state;
  state = base;
  notify(prevState);
  return state;
}
