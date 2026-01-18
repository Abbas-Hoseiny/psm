import { escapeHtml } from "@scripts/core/utils";
import {
  createPagerWidget,
  type PagerWidget,
  type PagerDirection,
} from "@scripts/features/shared/pagerWidget";
import {
  createDebugOverlayBinding,
  estimatePayloadKb as estimateOverlayPayloadKb,
  pushDebugOverlayMetrics,
} from "@scripts/dev/debugOverlayClient";
import {
  ensureLookupData,
  getLookupStats,
  listLookupLanguages,
  reloadLookup,
  searchBbchLookup,
  searchEppoLookup,
  type BbchLookupResult,
  type EppoLookupResult,
  type LookupLanguageInfo,
  type LookupStats,
  type LookupSearchResult,
  type LookupSearchOptions,
} from "@scripts/core/lookups";
import { getState, subscribeState } from "@scripts/core/state";

interface Services {
  state: {
    getState: typeof getState;
    subscribe: typeof subscribeState;
  };
  events: {
    emit: (eventName: string, payload?: unknown) => void;
  };
}

type LookupTab = "eppo" | "bbch";

type SearchState = {
  query: string;
  limit: number;
  language: string;
  executed: boolean;
  total: number;
  page: number;
  currentCount: number;
  loading: boolean;
  lastPayloadKb: number | null;
  lastUpdated: string | null;
};

const numberFormatter = new Intl.NumberFormat("de-DE");
const EPPO_COLUMN_COUNT = 6;
const BBCH_COLUMN_COUNT = 5;
const EPPO_LANGUAGE_PREF_KEY = "lookup:eppoLanguage";

const LANGUAGE_LABEL_OVERRIDES: Record<string, string> = {
  DE: "Deutsch",
  EN: "Englisch",
  LA: "Latein",
  SCIENTIFIC: "Wissenschaftlich",
  ES: "Spanisch",
  FR: "Französisch",
  IT: "Italienisch",
  NL: "Niederländisch",
  PL: "Polnisch",
  PT: "Portugiesisch",
  RU: "Russisch",
  SV: "Schwedisch",
  TR: "Türkisch",
  NO: "Norwegisch",
  ZH: "Chinesisch",
  JA: "Japanisch",
};

const LANGUAGE_NAME_OVERRIDES: Record<string, string> = {
  german: "Deutsch",
  english: "Englisch",
  latin: "Latein",
  spanish: "Spanisch",
  french: "Französisch",
  italian: "Italienisch",
  dutch: "Niederländisch",
  polish: "Polnisch",
  portuguese: "Portugiesisch",
  russian: "Russisch",
  swedish: "Schwedisch",
  turkish: "Türkisch",
  norwegian: "Norwegisch",
  chinese: "Chinesisch",
  japanese: "Japanisch",
  scientific: "Wissenschaftlich",
};

function resolveLanguageLabel(code: string, fallback?: string | null): string {
  const normalizedCode = code?.trim().toUpperCase() || "";
  if (normalizedCode && LANGUAGE_LABEL_OVERRIDES[normalizedCode]) {
    return LANGUAGE_LABEL_OVERRIDES[normalizedCode];
  }
  if (fallback) {
    const normalizedLabel = fallback.trim().toLowerCase();
    if (LANGUAGE_NAME_OVERRIDES[normalizedLabel]) {
      return LANGUAGE_NAME_OVERRIDES[normalizedLabel];
    }
    return fallback;
  }
  if (normalizedCode) {
    return normalizedCode;
  }
  return "Ohne Sprachcode";
}

function readLanguagePreference(): string {
  if (typeof window === "undefined" || !window.localStorage) {
    return "";
  }
  try {
    const value = window.localStorage.getItem(EPPO_LANGUAGE_PREF_KEY) || "";
    return value.trim().toUpperCase();
  } catch (error) {
    console.warn("Lookup-Sprachpräferenz konnte nicht gelesen werden", error);
    return "";
  }
}

function writeLanguagePreference(value: string): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    const normalized = value.trim().toUpperCase();
    if (normalized) {
      window.localStorage.setItem(EPPO_LANGUAGE_PREF_KEY, normalized);
    } else {
      window.localStorage.removeItem(EPPO_LANGUAGE_PREF_KEY);
    }
  } catch (error) {
    console.warn(
      "Lookup-Sprachpräferenz konnte nicht gespeichert werden",
      error,
    );
  }
}

let initialized = false;
const lookupOverlayBinding = createDebugOverlayBinding({
  id: "lookup",
  label: "Lookup (EPPO/BBCH)",
  budget: { initialLoad: 25, maxItems: 75 },
});

export function initLookup(
  container: Element | null,
  services: Services,
): void {
  if (!container || initialized) {
    return;
  }

  const host = container as HTMLElement;
  host.innerHTML = "";
  const section = createSection();
  host.appendChild(section);

  const refs = {
    message: section.querySelector<HTMLElement>('[data-role="lookup-message"]'),
    eppoCount: section.querySelector<HTMLElement>('[data-role="eppo-count"]'),
    eppoUpdated: section.querySelector<HTMLElement>(
      '[data-role="eppo-updated"]',
    ),
    eppoStatus: section.querySelector<HTMLElement>('[data-role="eppo-status"]'),
    bbchCount: section.querySelector<HTMLElement>('[data-role="bbch-count"]'),
    bbchUpdated: section.querySelector<HTMLElement>(
      '[data-role="bbch-updated"]',
    ),
    bbchStatus: section.querySelector<HTMLElement>('[data-role="bbch-status"]'),
    importEppoBtn: section.querySelector<HTMLButtonElement>(
      '[data-action="import-eppo"]',
    ),
    importBbchBtn: section.querySelector<HTMLButtonElement>(
      '[data-action="import-bbch"]',
    ),
    refreshStatsBtn: section.querySelector<HTMLButtonElement>(
      '[data-action="refresh-stats"]',
    ),
    ensureBtn: section.querySelector<HTMLButtonElement>(
      '[data-action="ensure-datasets"]',
    ),
    eppoForm: section.querySelector<HTMLFormElement>('[data-role="eppo-form"]'),
    bbchForm: section.querySelector<HTMLFormElement>('[data-role="bbch-form"]'),
    eppoLanguageSelect: section.querySelector<HTMLSelectElement>(
      "#lookup-eppo-language",
    ),
    eppoResults: section.querySelector<HTMLTableSectionElement>(
      '[data-role="eppo-results-body"]',
    ),
    bbchResults: section.querySelector<HTMLTableSectionElement>(
      '[data-role="bbch-results-body"]',
    ),
    eppoPager: section.querySelector<HTMLElement>('[data-role="eppo-pager"]'),
    bbchPager: section.querySelector<HTMLElement>('[data-role="bbch-pager"]'),
    tabButtons: Array.from(
      section.querySelectorAll<HTMLButtonElement>('[data-role="lookup-tab"]'),
    ),
    panels: Array.from(
      section.querySelectorAll<HTMLElement>('[data-role="lookup-panel"]'),
    ),
  };

  const disableTargets = Array.from(
    section.querySelectorAll<HTMLElement>("[data-lookup-disable]"),
  );

  let databaseReady = services.state.getState().app.hasDatabase;
  let storageDriver = services.state.getState().app.storageDriver;
  const canApplyToCalculation = typeof services.events?.emit === "function";
  const savedLanguagePreference = readLanguagePreference();
  let activeTab: LookupTab = "eppo";
  let messageTimeout: number | null = null;

  const searchState: Record<LookupTab, SearchState> = {
    eppo: {
      query: "",
      limit: 25,
      language: savedLanguagePreference,
      executed: false,
      total: 0,
      page: 0,
      currentCount: 0,
      loading: false,
      lastPayloadKb: null,
      lastUpdated: null,
    },
    bbch: {
      query: "",
      limit: 25,
      language: "",
      executed: false,
      total: 0,
      page: 0,
      currentCount: 0,
      loading: false,
      lastPayloadKb: null,
      lastUpdated: null,
    },
  };

  const pagerTargets: Record<LookupTab, HTMLElement | null> = {
    eppo: refs.eppoPager,
    bbch: refs.bbchPager,
  };

  const pagerWidgets: Record<LookupTab, PagerWidget | null> = {
    eppo: null,
    bbch: null,
  };

  const pagerLoadingDirections: Record<LookupTab, PagerDirection | null> = {
    eppo: null,
    bbch: null,
  };

  const describeTab = (tab: LookupTab): string =>
    tab === "eppo" ? "EPPO" : "BBCH";

  const buildLookupOverlayNote = (tab: LookupTab): string | undefined => {
    const state = searchState[tab];
    const parts: string[] = [`Tab: ${describeTab(tab)}`];
    if (!databaseReady) {
      parts.push("Keine Datenbank");
    } else if (storageDriver !== "sqlite") {
      parts.push("Nur mit SQLite verfügbar");
    }
    if (state.loading) {
      parts.push("Suche läuft");
    } else if (!state.executed) {
      parts.push("Noch keine Suche");
    } else if (!state.currentCount) {
      parts.push("Keine Treffer");
    }
    return parts.length ? parts.join(" · ") : undefined;
  };

  const publishLookupOverlayMetrics = (tab: LookupTab = activeTab) => {
    const state = searchState[tab];
    const usable = Boolean(databaseReady && storageDriver === "sqlite");
    const metrics = usable
      ? {
          items: state.executed ? state.currentCount : null,
          totalCount: state.executed ? state.total || null : null,
          cursor: state.executed ? `Seite ${state.page + 1}` : null,
          payloadKb: state.executed ? (state.lastPayloadKb ?? null) : null,
          lastUpdated: state.lastUpdated,
          note: buildLookupOverlayNote(tab),
        }
      : {
          items: null,
          totalCount: null,
          cursor: null,
          payloadKb: null,
          lastUpdated: null,
          note: buildLookupOverlayNote(tab),
        };
    pushDebugOverlayMetrics(lookupOverlayBinding, metrics);
  };

  const ensurePager = (tab: LookupTab): PagerWidget | null => {
    const target = pagerTargets[tab];
    if (!target) {
      return null;
    }
    if (!pagerWidgets[tab]) {
      pagerWidgets[tab] = createPagerWidget(target, {
        onPrev: () => changePage(tab, -1),
        onNext: () => changePage(tab, 1),
        labels: {
          prev: "Zurück",
          next: "Weiter",
          loading: "Suche läuft...",
          empty: "Keine Treffer",
        },
      });
    }
    return pagerWidgets[tab];
  };

  const setMessage = (
    text?: string,
    variant: "info" | "success" | "warning" | "danger" = "info",
    autoHideMs = 4500,
  ) => {
    if (!refs.message) {
      return;
    }
    if (messageTimeout) {
      window.clearTimeout(messageTimeout);
      messageTimeout = null;
    }
    if (!text) {
      refs.message.classList.add("d-none");
      refs.message.textContent = "";
      return;
    }
    refs.message.className = `alert alert-${variant} mt-3`;
    refs.message.textContent = text;
    refs.message.classList.remove("d-none");
    if (autoHideMs > 0) {
      messageTimeout = window.setTimeout(() => {
        refs.message?.classList.add("d-none");
      }, autoHideMs);
    }
  };

  const setUiEnabled = (
    enabled: boolean,
    reason: "no-db" | "wrong-driver" | null = null,
  ) => {
    disableTargets.forEach((element) => {
      if (
        element instanceof HTMLButtonElement ||
        element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement
      ) {
        element.disabled = !enabled;
      }
    });
    if (!enabled) {
      if (reason === "no-db") {
        setMessage(
          "Bitte zuerst eine Datenbank verbinden, um Lookup-Daten zu laden.",
          "info",
          0,
        );
      } else if (reason === "wrong-driver") {
        setMessage(
          "Lookup-Funktionen benötigen eine SQLite-Datenbank. Bitte in den Einstellungen den SQLite-Treiber aktivieren.",
          "warning",
          0,
        );
      } else {
        setMessage("Lookup-Funktion vorübergehend deaktiviert.", "warning", 0);
      }
      showPlaceholder("eppo", "Lookup derzeit nicht verfügbar");
      showPlaceholder("bbch", "Lookup derzeit nicht verfügbar");
    } else {
      setMessage();
      if (!searchState.eppo.executed) {
        showPlaceholder("eppo", "Noch keine Suche ausgeführt.");
      }
      if (!searchState.bbch.executed) {
        showPlaceholder("bbch", "Noch keine Suche ausgeführt.");
      }
    }
    updatePaginationUi("eppo");
    updatePaginationUi("bbch");
    publishLookupOverlayMetrics(activeTab);
  };

  const isLookupAvailable = (): boolean =>
    Boolean(databaseReady && storageDriver === "sqlite");

  const updateUiAvailability = () => {
    if (!databaseReady) {
      setUiEnabled(false, "no-db");
      return;
    }
    if (storageDriver !== "sqlite") {
      setUiEnabled(false, "wrong-driver");
      return;
    }
    setUiEnabled(true);
  };

  const prepareNewSearch = (tab: LookupTab) => {
    const state = searchState[tab];
    state.total = 0;
    state.executed = false;
    state.loading = false;
    state.page = 0;
    state.currentCount = 0;
    state.lastPayloadKb = null;
    state.lastUpdated = null;
    pagerLoadingDirections[tab] = null;
    updatePaginationUi(tab);
    publishLookupOverlayMetrics(tab);
  };

  const updatePaginationUi = (tab: LookupTab) => {
    const widget = ensurePager(tab);
    if (!widget) {
      return;
    }
    const state = searchState[tab];

    if (!databaseReady) {
      widget.update({
        status: "disabled",
        info: "Keine aktive Datenbank.",
      });
      return;
    }

    if (!state.executed) {
      widget.update({
        status: "disabled",
        info: state.loading ? "Suche läuft..." : "Noch keine Suche.",
      });
      return;
    }

    if (!state.total) {
      widget.update({
        status: "disabled",
        info: state.loading ? "Suche läuft..." : "Keine Treffer.",
      });
      return;
    }

    const firstIndex = state.page * state.limit + 1;
    const lastIndex = Math.min(
      state.total,
      firstIndex + (state.currentCount || state.limit) - 1,
    );
    const info = `Einträge ${numberFormatter.format(
      firstIndex,
    )}–${numberFormatter.format(lastIndex)} von ${numberFormatter.format(
      state.total,
    )}`;
    const maxPage = Math.max(Math.ceil(state.total / state.limit) - 1, 0);
    const canPrev = !state.loading && state.page > 0;
    const canNext = !state.loading && state.page < maxPage;

    widget.update({
      status: "ready",
      info,
      canPrev,
      canNext,
      loadingDirection: state.loading ? pagerLoadingDirections[tab] : null,
    });
  };

  function changePage(tab: LookupTab, delta: number): void {
    if (!databaseReady) {
      return;
    }
    const state = searchState[tab];
    if (!state.executed || state.loading || !state.total) {
      return;
    }
    const maxPage = Math.max(Math.ceil(state.total / state.limit) - 1, 0);
    const nextPage = Math.min(Math.max(state.page + delta, 0), maxPage);
    if (nextPage === state.page) {
      return;
    }
    state.page = nextPage;
    pagerLoadingDirections[tab] = delta > 0 ? "next" : "prev";
    void runSearch(tab);
  }

  const getResultBody = (tab: LookupTab): HTMLTableSectionElement | null =>
    tab === "eppo" ? refs.eppoResults : refs.bbchResults;

  const getColumnCount = (tab: LookupTab): number =>
    tab === "eppo" ? EPPO_COLUMN_COUNT : BBCH_COLUMN_COUNT;

  function showPlaceholder(tab: LookupTab, text: string): void {
    const body = getResultBody(tab);
    renderPlaceholder(body, text, getColumnCount(tab));
  }

  let languageOptionsPromise: Promise<boolean> | null = null;

  const refreshLanguageOptions = (): Promise<boolean> => {
    if (!refs.eppoLanguageSelect) {
      return Promise.resolve(false);
    }
    if (!isLookupAvailable()) {
      refs.eppoLanguageSelect.innerHTML =
        '<option value="">Alle Sprachen</option>';
      refs.eppoLanguageSelect.value = "";
      return Promise.resolve(false);
    }
    if (languageOptionsPromise) {
      return languageOptionsPromise;
    }
    languageOptionsPromise = (async () => {
      const select = refs.eppoLanguageSelect!;
      select.dataset.loading = "true";
      try {
        const languages = await listLookupLanguages();
        const totalEntries = languages.reduce(
          (sum, entry) => sum + (entry.count || 0),
          0,
        );
        const optionRows: string[] = [
          `<option value="">${escapeHtml(
            totalEntries
              ? `Alle Sprachen (${numberFormatter.format(totalEntries)})`
              : "Alle Sprachen",
          )}</option>`,
        ];
        const availableCodes = new Set<string>();
        for (const entry of languages) {
          const code = (entry.code || "").trim().toUpperCase();
          const label = resolveLanguageLabel(code, entry.label);
          const countSuffix = entry.count
            ? ` · ${numberFormatter.format(entry.count)}`
            : "";
          optionRows.push(
            `<option value="${escapeHtml(code)}">${escapeHtml(
              `${label}${countSuffix}`,
            )}</option>`,
          );
          availableCodes.add(code);
        }
        select.innerHTML = optionRows.join("");
        const previousSelection =
          searchState.eppo.language?.trim().toUpperCase() || "";
        let nextSelection = previousSelection;
        if (nextSelection && !availableCodes.has(nextSelection)) {
          nextSelection = "";
        }
        select.value = nextSelection;
        if (nextSelection) {
          writeLanguagePreference(nextSelection);
        } else {
          writeLanguagePreference("");
        }
        const selectionChanged = previousSelection !== nextSelection;
        if (selectionChanged) {
          searchState.eppo.language = nextSelection;
        }
        return selectionChanged;
      } catch (error) {
        console.error(
          "Lookup-Sprachen konnten nicht aktualisiert werden",
          error,
        );
        setMessage("Sprachenliste konnte nicht geladen werden.", "danger");
        return false;
      } finally {
        const select = refs.eppoLanguageSelect;
        if (select) {
          delete select.dataset.loading;
        }
      }
    })().finally(() => {
      languageOptionsPromise = null;
    });
    return languageOptionsPromise;
  };

  const formatTimestamp = (value?: string | null): string => {
    if (!value) {
      return "–";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return `${date.toLocaleDateString("de-DE")} ${date.toLocaleTimeString(
      "de-DE",
      { hour: "2-digit", minute: "2-digit" },
    )}`;
  };

  const renderStats = (stats: LookupStats | null) => {
    const eppoCount = stats?.eppo?.count ?? 0;
    const bbchCount = stats?.bbch?.count ?? 0;
    if (refs.eppoCount) {
      refs.eppoCount.textContent = eppoCount
        ? numberFormatter.format(eppoCount)
        : "0";
    }
    if (refs.bbchCount) {
      refs.bbchCount.textContent = bbchCount
        ? numberFormatter.format(bbchCount)
        : "0";
    }
    if (refs.eppoUpdated) {
      refs.eppoUpdated.textContent = formatTimestamp(stats?.eppo?.lastImport);
    }
    if (refs.bbchUpdated) {
      refs.bbchUpdated.textContent = formatTimestamp(stats?.bbch?.lastImport);
    }
    if (refs.eppoStatus) {
      refs.eppoStatus.textContent = eppoCount ? "Bereit" : "Nicht geladen";
      refs.eppoStatus.className = eppoCount
        ? "badge bg-success"
        : "badge bg-secondary";
    }
    if (refs.bbchStatus) {
      refs.bbchStatus.textContent = bbchCount ? "Bereit" : "Nicht geladen";
      refs.bbchStatus.className = bbchCount
        ? "badge bg-success"
        : "badge bg-secondary";
    }
  };

  const refreshStats = async (button?: HTMLButtonElement | null) => {
    const task = async () => {
      try {
        const stats = await getLookupStats();
        renderStats(stats);
      } catch (error) {
        console.error("Lookup-Status konnte nicht geladen werden", error);
        setMessage("Status konnte nicht aktualisiert werden.", "danger");
      }
    };
    await withButtonBusy(button ?? null, task);
  };

  const runSearch = async (
    tab: LookupTab,
    override?: Partial<Pick<SearchState, "query" | "limit" | "language">>,
  ) => {
    if (!isLookupAvailable()) {
      return;
    }

    const state = searchState[tab];
    if (state.loading) {
      return;
    }

    if (override?.query !== undefined) {
      state.query = override.query.trim();
      state.page = 0;
    }
    if (override?.limit !== undefined) {
      const normalized = Math.min(Math.max(override.limit, 1), 50);
      state.limit = normalized;
      state.page = 0;
    }
    if (override?.language !== undefined) {
      state.language = override.language.trim().toUpperCase();
      state.page = 0;
    }

    showPlaceholder(tab, "Suche läuft...");
    state.loading = true;
    updatePaginationUi(tab);
    const payload: LookupSearchOptions = {
      query: state.query,
      limit: state.limit,
      offset: state.page * state.limit,
    };
    if (tab === "eppo") {
      const language = state.language?.trim().toUpperCase();
      if (language) {
        payload.language = language;
      }
    }

    try {
      const result =
        tab === "eppo"
          ? await searchEppoLookup(payload)
          : await searchBbchLookup(payload);
      const rows = Array.isArray(result?.rows) ? result.rows : [];
      const totalValue = Number(result?.total);
      state.total =
        Number.isFinite(totalValue) && totalValue >= 0
          ? totalValue
          : rows.length;

      if (!rows.length && state.total && state.page > 0) {
        const maxPage = Math.max(Math.ceil(state.total / state.limit) - 1, 0);
        if (state.page > maxPage) {
          state.page = maxPage;
          state.loading = false;
          pagerLoadingDirections[tab] = null;
          await runSearch(tab);
          return;
        }
      }

      const targetBody = getResultBody(tab);
      if (!rows.length) {
        showPlaceholder(tab, "Keine Treffer gefunden.");
      } else if (tab === "eppo") {
        renderEppoResults(rows as EppoLookupResult[], targetBody, false, {
          enableApply: canApplyToCalculation,
        });
      } else {
        renderBbchResults(rows as BbchLookupResult[], targetBody, false, {
          enableApply: canApplyToCalculation,
        });
      }

      state.executed = true;
      state.currentCount = rows.length;
      state.lastPayloadKb = estimateOverlayPayloadKb(rows);
      state.lastUpdated = new Date().toISOString();
    } catch (error) {
      console.error("Lookup-Suche fehlgeschlagen", error);
      setMessage("Suche fehlgeschlagen.", "danger");
      showPlaceholder(tab, "Fehler bei der Suche");
      state.executed = false;
      state.total = 0;
      state.currentCount = 0;
      state.lastPayloadKb = null;
      state.lastUpdated = new Date().toISOString();
    } finally {
      state.loading = false;
      pagerLoadingDirections[tab] = null;
      updatePaginationUi(tab);
      publishLookupOverlayMetrics(tab);
    }
  };

  const setActiveTab = (tab: LookupTab) => {
    activeTab = tab;
    refs.tabButtons.forEach((button) => {
      const isActive = button.dataset.tab === tab;
      button.classList.toggle("active", isActive);
    });
    refs.panels.forEach((panel) => {
      const isActive = panel.dataset.tab === tab;
      panel.classList.toggle("d-none", !isActive);
    });
    publishLookupOverlayMetrics(tab);
  };

  refs.eppoForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!databaseReady) {
      return;
    }
    const formData = new FormData(refs.eppoForm!);
    const query = (formData.get("query") || "").toString().trim();
    const limit = Number(formData.get("limit")) || 25;
    const language = (formData.get("language") || "")
      .toString()
      .trim()
      .toUpperCase();
    searchState.eppo.query = query;
    searchState.eppo.limit = limit;
    searchState.eppo.language = language;
    prepareNewSearch("eppo");
    void runSearch("eppo", { query, limit, language });
  });

  refs.eppoLanguageSelect?.addEventListener("change", () => {
    if (!isLookupAvailable()) {
      if (refs.eppoLanguageSelect) {
        refs.eppoLanguageSelect.value = "";
      }
      return;
    }
    const selection = refs.eppoLanguageSelect?.value.trim().toUpperCase() || "";
    searchState.eppo.language = selection;
    writeLanguagePreference(selection);
    prepareNewSearch("eppo");
    void runSearch("eppo");
  });

  refs.bbchForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!databaseReady) {
      return;
    }
    const formData = new FormData(refs.bbchForm!);
    const query = (formData.get("query") || "").toString().trim();
    const limit = Number(formData.get("limit")) || 25;
    searchState.bbch.query = query;
    searchState.bbch.limit = limit;
    prepareNewSearch("bbch");
    void runSearch("bbch", { query, limit });
  });

  refs.tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.tab as LookupTab | undefined;
      if (!target || target === activeTab) {
        return;
      }
      setActiveTab(target);
      if (isLookupAvailable() && !searchState[target].executed) {
        void runSearch(target);
      }
    });
  });

  section.addEventListener("click", (event) => {
    const targetElement = event.target as HTMLElement;
    const copyBtn = targetElement.closest<HTMLButtonElement>(
      '[data-action="copy-code"]',
    );
    if (copyBtn && copyBtn.dataset.code) {
      event.preventDefault();
      void copyToClipboard(copyBtn.dataset.code, setMessage);
      return;
    }

    const applyEppoBtn = targetElement.closest<HTMLButtonElement>(
      '[data-action="apply-eppo"]',
    );
    if (applyEppoBtn) {
      event.preventDefault();
      if (!canApplyToCalculation) {
        setMessage(
          "Berechnungsformular nicht verfügbar – bitte SQLite-Treiber aktivieren.",
          "warning",
        );
        return;
      }
      const payload = {
        code: applyEppoBtn.dataset.code || "",
        name: applyEppoBtn.dataset.name || "",
        language: applyEppoBtn.dataset.language || "",
        dtcode: applyEppoBtn.dataset.dtcode || "",
      };
      try {
        services.events.emit("lookup:apply-eppo", payload);
        const label = payload.code ? `EPPO-Code ${payload.code}` : "EPPO-Code";
        setMessage(`${label} wurde ins Formular übernommen.`, "success");
      } catch (error) {
        console.error("EPPO-Code konnte nicht übergeben werden", error);
        setMessage(
          "Auswahl konnte nicht ins Formular übernommen werden.",
          "danger",
        );
      }
      return;
    }

    const applyBbchBtn = targetElement.closest<HTMLButtonElement>(
      '[data-action="apply-bbch"]',
    );
    if (applyBbchBtn) {
      event.preventDefault();
      if (!canApplyToCalculation) {
        setMessage(
          "Berechnungsformular nicht verfügbar – bitte SQLite-Treiber aktivieren.",
          "warning",
        );
        return;
      }
      const payload = {
        code: applyBbchBtn.dataset.code || "",
        label: applyBbchBtn.dataset.name || "",
      };
      try {
        services.events.emit("lookup:apply-bbch", payload);
        const label = payload.code
          ? `BBCH-Stadium ${payload.code}`
          : "BBCH-Stadium";
        setMessage(`${label} wurde ins Formular übernommen.`, "success");
      } catch (error) {
        console.error("BBCH-Eintrag konnte nicht übergeben werden", error);
        setMessage(
          "Stadium konnte nicht ins Formular übernommen werden.",
          "danger",
        );
      }
    }
  });

  refs.importEppoBtn?.addEventListener("click", () => {
    void withButtonBusy(refs.importEppoBtn, async () => {
      try {
        await reloadLookup("eppo");
        setMessage("EPPO-Datenbank aktualisiert.", "success");
        await refreshStats();
        if (activeTab === "eppo") {
          prepareNewSearch("eppo");
          await runSearch("eppo");
        }
      } catch (error) {
        console.error("EPPO-Import fehlgeschlagen", error);
        setMessage("EPPO-Daten konnten nicht geladen werden.", "danger");
      }
    });
  });

  refs.importBbchBtn?.addEventListener("click", () => {
    void withButtonBusy(refs.importBbchBtn, async () => {
      try {
        await reloadLookup("bbch");
        setMessage("BBCH-Datenbank aktualisiert.", "success");
        await refreshStats();
        if (activeTab === "bbch") {
          prepareNewSearch("bbch");
          await runSearch("bbch");
        }
      } catch (error) {
        console.error("BBCH-Import fehlgeschlagen", error);
        setMessage("BBCH-Daten konnten nicht geladen werden.", "danger");
      }
    });
  });

  refs.refreshStatsBtn?.addEventListener("click", () => {
    void refreshStats(refs.refreshStatsBtn);
  });

  refs.ensureBtn?.addEventListener("click", () => {
    void withButtonBusy(refs.ensureBtn, async () => {
      try {
        await ensureLookupData("eppo");
        await ensureLookupData("bbch");
        await refreshStats();
        if (!searchState.eppo.executed && databaseReady) {
          await runSearch("eppo");
        }
        setMessage("Lookup-Daten geprüft.", "success");
      } catch (error) {
        console.error("Lookup-Daten konnten nicht geprüft werden", error);
        setMessage("Lookup-Daten konnten nicht geprüft werden.", "danger");
      }
    });
  });

  const handleStateChange = () => {
    const nextAppState = services.state.getState().app;
    const wasAvailable = isLookupAvailable();
    databaseReady = nextAppState.hasDatabase;
    storageDriver = nextAppState.storageDriver;
    updateUiAvailability();
    const nowAvailable = isLookupAvailable();
    if (!wasAvailable && nowAvailable) {
      void (async () => {
        await refreshStats();
        await refreshLanguageOptions();
        if (!searchState[activeTab].executed) {
          await runSearch(activeTab);
        }
      })();
    } else if (nowAvailable) {
      updatePaginationUi(activeTab);
    }
    publishLookupOverlayMetrics(activeTab);
  };

  services.state.subscribe(handleStateChange);
  setActiveTab("eppo");
  updateUiAvailability();
  publishLookupOverlayMetrics("eppo");
  void refreshLanguageOptions();
  if (isLookupAvailable()) {
    void refreshStats();
    void runSearch("eppo");
  }

  initialized = true;
}

function createSection(): HTMLElement {
  const section = document.createElement("section");
  section.className = "section-inner lookup-section";
  section.innerHTML = `
    <div class="card card-dark mb-4">
      <div class="card-body">
        <div class="d-flex flex-column flex-lg-row justify-content-between gap-3">
          <div>
            <h2 class="h4 mb-1">EPPO & BBCH Lookup</h2>
            <p class="text-muted mb-0">Importiere die Lookup-Datenbanken einmalig und durchsuche die Referenzen komfortabel.</p>
          </div>
          <div class="d-flex flex-wrap gap-2">
            <button type="button" class="btn btn-outline-light" data-action="refresh-stats" data-lookup-disable>
              <i class="bi bi-arrow-repeat"></i> Status aktualisieren
            </button>
          </div>
        </div>
        <div class="alert alert-info mt-3 d-none" data-role="lookup-message"></div>
        <div class="row g-3 mt-1">
          <div class="col-md-6">
            <div class="border border-secondary rounded-3 p-3 h-100">
              <div class="d-flex justify-content-between align-items-start gap-2">
                <div>
                  <p class="text-uppercase text-muted small mb-1">EPPO-Codes</p>
                  <div class="h4 mb-1" data-role="eppo-count">–</div>
                  <small class="text-muted">Zuletzt importiert: <span data-role="eppo-updated">–</span></small>
                </div>
                <span class="badge bg-secondary" data-role="eppo-status">Unbekannt</span>
              </div>
              <button type="button" class="btn btn-sm btn-outline-light mt-3" data-action="import-eppo" data-lookup-disable>
                <i class="bi bi-cloud-download"></i> Daten laden
              </button>
            </div>
          </div>
          <div class="col-md-6">
            <div class="border border-secondary rounded-3 p-3 h-100">
              <div class="d-flex justify-content-between align-items-start gap-2">
                <div>
                  <p class="text-uppercase text-muted small mb-1">BBCH-Stadien</p>
                  <div class="h4 mb-1" data-role="bbch-count">–</div>
                  <small class="text-muted">Zuletzt importiert: <span data-role="bbch-updated">–</span></small>
                </div>
                <span class="badge bg-secondary" data-role="bbch-status">Unbekannt</span>
              </div>
              <button type="button" class="btn btn-sm btn-outline-light mt-3" data-action="import-bbch" data-lookup-disable>
                <i class="bi bi-cloud-download"></i> Daten laden
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="card card-dark">
      <div class="card-body">
        <div class="d-flex flex-column flex-lg-row justify-content-between align-items-start gap-3 mb-3">
          <div>
            <h3 class="h5 mb-1">Lookup Explorer</h3>
            <p class="text-muted mb-0">Durchsuche EPPO- und BBCH-Daten mit Filtern, ohne das Berechnungsformular zu verlassen.</p>
          </div>
          <div class="d-flex flex-wrap gap-2">
            <button type="button" class="btn btn-outline-light" data-action="ensure-datasets" data-lookup-disable>
              <i class="bi bi-database-check"></i> Daten prüfen
            </button>
          </div>
        </div>

        <div class="btn-group mb-3" role="group">
          <button type="button" class="btn btn-outline-light active" data-role="lookup-tab" data-tab="eppo">EPPO</button>
          <button type="button" class="btn btn-outline-light" data-role="lookup-tab" data-tab="bbch">BBCH</button>
        </div>

        <div data-role="lookup-panel" data-tab="eppo">
          <form class="row g-3 align-items-end" data-role="eppo-form">
            <div class="col-md-5">
              <label class="form-label" for="lookup-eppo-query">Suchbegriff</label>
              <input class="form-control" id="lookup-eppo-query" name="query" placeholder="Code oder Name" data-lookup-disable />
            </div>
            <div class="col-md-3">
              <label class="form-label" for="lookup-eppo-language">Sprache</label>
              <select class="form-select" id="lookup-eppo-language" name="language" data-lookup-disable>
                <option value="" selected>Alle Sprachen</option>
                <option value="DE">Deutsch</option>
                <option value="EN">Englisch</option>
                <option value="LA">Latein</option>
              </select>
            </div>
            <div class="col-md-2">
              <label class="form-label" for="lookup-eppo-limit">Limit</label>
              <select class="form-select" id="lookup-eppo-limit" name="limit" data-lookup-disable>
                <option value="10">10</option>
                <option value="25" selected>25</option>
                <option value="50">50</option>
              </select>
            </div>
            <div class="col-md-2 d-grid">
              <button class="btn btn-success" type="submit" data-lookup-disable>
                <i class="bi bi-search"></i> Suchen
              </button>
            </div>
          </form>
          <div class="table-responsive mt-3">
            <table class="table table-dark table-striped align-middle mb-0">
              <thead>
                <tr>
                  <th style="width: 12%">Code</th>
                  <th>Name &amp; Synonyme</th>
                  <th style="width: 18%">Typ</th>
                  <th style="width: 18%">Sprache</th>
                  <th>Hinweise</th>
                  <th style="width: 12%" class="text-end">Aktion</th>
                </tr>
              </thead>
              <tbody data-role="eppo-results-body">
                <tr>
                  <td colspan="6" class="text-muted">Noch keine Suche ausgeführt.</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="d-flex justify-content-end mt-2" data-role="eppo-pager"></div>
        </div>

        <div data-role="lookup-panel" data-tab="bbch" class="d-none">
          <form class="row g-3 align-items-end" data-role="bbch-form">
            <div class="col-md-6">
              <label class="form-label" for="lookup-bbch-query">Suchbegriff</label>
              <input class="form-control" id="lookup-bbch-query" name="query" placeholder="Code, Stadium oder Beschreibung" data-lookup-disable />
            </div>
            <div class="col-md-3">
              <label class="form-label" for="lookup-bbch-limit">Limit</label>
              <select class="form-select" id="lookup-bbch-limit" name="limit" data-lookup-disable>
                <option value="10">10</option>
                <option value="25" selected>25</option>
                <option value="50">50</option>
              </select>
            </div>
            <div class="col-md-3 d-grid">
              <button class="btn btn-success" type="submit" data-lookup-disable>
                <i class="bi bi-search"></i> Suchen
              </button>
            </div>
          </form>
          <div class="table-responsive mt-3">
            <table class="table table-dark table-striped align-middle mb-0">
              <thead>
                <tr>
                  <th style="width: 15%">Code</th>
                  <th>Bezeichnung</th>
                  <th style="width: 18%">Stadium</th>
                  <th>Beschreibung</th>
                  <th style="width: 12%" class="text-end">Aktion</th>
                </tr>
              </thead>
              <tbody data-role="bbch-results-body">
                <tr>
                  <td colspan="5" class="text-muted">Noch keine Suche ausgeführt.</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="d-flex justify-content-end mt-2" data-role="bbch-pager"></div>
        </div>
      </div>
    </div>
  `;
  return section;
}

type LookupRenderOptions = {
  enableApply?: boolean;
};

async function withButtonBusy(
  button: HTMLButtonElement | null,
  task: () => Promise<void>,
): Promise<void> {
  if (!button) {
    await task();
    return;
  }
  const original = button.innerHTML;
  button.disabled = true;
  const label = button.textContent?.trim() || "Bitte warten";
  button.innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>${escapeHtml(
    label,
  )}`;
  try {
    await task();
  } finally {
    button.innerHTML = original;
    button.disabled = false;
  }
}

function renderEppoResults(
  rows: EppoLookupResult[],
  target?: HTMLTableSectionElement | null,
  append = false,
  options: LookupRenderOptions = {},
): void {
  if (!target) {
    return;
  }
  if (!rows.length) {
    if (!append && !target.children.length) {
      renderPlaceholder(target, "Keine Treffer gefunden", EPPO_COLUMN_COUNT);
    }
    return;
  }
  const enableApply = Boolean(options.enableApply);
  const html = rows
    .map((row) => {
      const dtLabel = row.dtLabel?.trim() || null;
      const dtCode = row.dtcode?.trim() || null;
      const languageText = formatLanguageLabel(row);
      const synonyms = collectSynonymEntries(row);
      const synonymsHtml = synonyms.length
        ? `<div class="text-muted small mt-1">${synonyms
            .map(
              (entry) =>
                `<span class="me-3">${escapeHtml(entry.label)}: ${escapeHtml(
                  entry.value,
                )}</span>`,
            )
            .join("")}</div>`
        : "";
      const hintLines: string[] = [];
      if (row.authority?.trim()) {
        hintLines.push(`Quelle: ${row.authority.trim()}`);
      }
      if (synonyms.length) {
        hintLines.push(
          `Synonyme: ${synonyms.map((entry) => entry.label).join(", ")}`,
        );
      }
      const hintsHtml = hintLines.length
        ? hintLines
            .map(
              (line) =>
                `<div class="text-muted small">${escapeHtml(line)}</div>`,
            )
            .join("")
        : '<div class="text-muted small">Keine weiteren Angaben.</div>';
      return `
        <tr>
          <td class="fw-semibold align-middle">${escapeHtml(row.code)}</td>
          <td>
            <div class="fw-semibold">${escapeHtml(row.name)}</div>
            ${synonymsHtml}
          </td>
          <td>
            <div class="fw-semibold">${escapeHtml(dtLabel || "–")}</div>
            ${dtCode ? `<div class="text-muted small">Code: ${escapeHtml(dtCode)}</div>` : ""}
          </td>
          <td>
            <div>${escapeHtml(languageText)}</div>
          </td>
          <td>${hintsHtml}</td>
          <td class="text-end">
            <div class="btn-group btn-group-sm" role="group">
              <button type="button" class="btn btn-outline-light" data-action="copy-code" data-code="${escapeHtml(
                row.code,
              )}">
                Kopieren
              </button>
              <button type="button" class="btn btn-success" data-action="apply-eppo" data-code="${escapeHtml(
                row.code,
              )}" data-name="${escapeHtml(row.name)}" data-language="${escapeHtml(
                row.language || "",
              )}" data-dtcode="${escapeHtml(row.dtcode || "")}"${
                enableApply ? "" : " disabled"
              }>
                Übernehmen
              </button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
  if (append) {
    target.insertAdjacentHTML("beforeend", html);
  } else {
    target.innerHTML = html;
  }
}

function formatLanguageLabel(
  row: Pick<EppoLookupResult, "language" | "languageLabel">,
): string {
  const label = row.languageLabel?.trim() || "";
  const code = row.language?.trim() || "";
  if (label && code) {
    return `${label} (${code})`;
  }
  if (label) {
    return label;
  }
  if (code) {
    return code;
  }
  return "–";
}

type SynonymEntry = { label: string; value: string };

function collectSynonymEntries(row: EppoLookupResult): SynonymEntry[] {
  if (!row) {
    return [];
  }
  const canonical = row.name?.trim().toLowerCase() || "";
  const entries: SynonymEntry[] = [];
  const pushEntry = (label: string, value?: string | null) => {
    const normalized = value?.trim();
    if (!normalized || normalized.toLowerCase() === canonical) {
      return;
    }
    entries.push({ label, value: normalized });
  };
  pushEntry("DE", row.nameDe);
  pushEntry("EN", row.nameEn);
  pushEntry("LA", row.nameLa);
  return entries;
}

function renderBbchResults(
  rows: BbchLookupResult[],
  target?: HTMLTableSectionElement | null,
  append = false,
  options: LookupRenderOptions = {},
): void {
  if (!target) {
    return;
  }
  if (!rows.length) {
    if (!append && !target.children.length) {
      renderPlaceholder(target, "Keine Treffer gefunden", BBCH_COLUMN_COUNT);
    }
    return;
  }
  const enableApply = Boolean(options.enableApply);
  const html = rows
    .map((row) => {
      const stageParts: string[] = [];
      if (row.principalStage != null) {
        stageParts.push(String(row.principalStage).padStart(2, "0"));
      }
      if (row.secondaryStage != null) {
        stageParts.push(String(row.secondaryStage).padStart(2, "0"));
      }
      const stage = stageParts.length ? stageParts.join(".") : "–";
      const definitionHtml = renderBbchDefinition(row.definition);
      const kindBadge = row.kind
        ? `<span class="badge bg-secondary ms-1">${escapeHtml(row.kind)}</span>`
        : "";
      return `
        <tr>
          <td class="fw-semibold">${escapeHtml(row.code)}</td>
          <td>${escapeHtml(row.label)}</td>
          <td>
            <div class="fw-semibold">${escapeHtml(stage)}</div>
            <div class="text-muted small">
              ${row.principalStage != null ? `Makrostadium ${escapeHtml(String(row.principalStage).padStart(2, "0"))}` : "Makrostadium –"}
              ${row.secondaryStage != null ? ` · Feinstadium ${escapeHtml(String(row.secondaryStage).padStart(2, "0"))}` : ""}
            </div>
          </td>
          <td>${definitionHtml}${kindBadge}</td>
          <td class="text-end">
            <div class="btn-group btn-group-sm" role="group">
              <button type="button" class="btn btn-outline-light" data-action="copy-code" data-code="${escapeHtml(
                row.code,
              )}">
                Kopieren
              </button>
              <button type="button" class="btn btn-success" data-action="apply-bbch" data-code="${escapeHtml(
                row.code,
              )}" data-name="${escapeHtml(row.label)}"${
                enableApply ? "" : " disabled"
              }>
                Übernehmen
              </button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
  if (append) {
    target.insertAdjacentHTML("beforeend", html);
  } else {
    target.innerHTML = html;
  }
}

function renderBbchDefinition(text?: string | null): string {
  if (!text) {
    return '<span class="text-muted">Keine Beschreibung hinterlegt.</span>';
  }
  const lines = text
    .split(/\r?\n/)
    .map((part) => part.trim())
    .filter((part) => part.length);
  if (!lines.length) {
    return '<span class="text-muted">Keine Beschreibung hinterlegt.</span>';
  }
  if (lines.length === 1) {
    return escapeHtml(lines[0]);
  }
  const [summary, ...rest] = lines;
  const details = rest
    .map((line) => `<li class="small">${escapeHtml(line)}</li>`)
    .join("");
  return `
    <details class="lookup-definition">
      <summary>${escapeHtml(summary)}</summary>
      <ul class="mt-2 mb-0 ps-3">${details}</ul>
    </details>
  `;
}

function renderPlaceholder(
  target: HTMLTableSectionElement | null | undefined,
  text: string,
  columns: number,
): void {
  if (!target) {
    return;
  }
  target.innerHTML = `
    <tr>
      <td colspan="${columns}" class="text-muted">${escapeHtml(text)}</td>
    </tr>
  `;
}

async function copyToClipboard(
  code: string,
  notify: (
    text?: string,
    variant?: "info" | "success" | "warning" | "danger",
  ) => void,
): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(code);
    } else {
      throw new Error("Clipboard API nicht verfügbar");
    }
    notify(`„${code}“ kopiert.`, "success");
  } catch (error) {
    console.warn("Clipboard API fehlgeschlagen", error);
    try {
      // Fallback für ältere Browser ohne Clipboard API
      const input = document.createElement("textarea");
      input.value = code;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.focus();
      input.select();
      // eslint-disable-next-line deprecation/deprecation
      document.execCommand("copy");
      document.body.removeChild(input);
      notify(`„${code}“ kopiert.`, "success");
    } catch (fallbackError) {
      console.error("Fallback-Kopie fehlgeschlagen", fallbackError);
      window.prompt("Code kopieren:", code);
    }
  }
}
