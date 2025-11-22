import { escapeHtml } from "@scripts/core/utils";
import {
  ensureLookupData,
  getLookupStats,
  reloadLookup,
  searchBbchLookup,
  searchEppoLookup,
  type BbchLookupResult,
  type EppoLookupResult,
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
}

type LookupTab = "eppo" | "bbch";

type SearchState = {
  query: string;
  limit: number;
  language: string;
  executed: boolean;
  page: number;
  total: number;
};

const numberFormatter = new Intl.NumberFormat("de-DE");
const EPPO_COLUMN_COUNT = 6;
const BBCH_COLUMN_COUNT = 5;

let initialized = false;

export function initLookup(
  container: Element | null,
  services: Services
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
      '[data-role="eppo-updated"]'
    ),
    eppoStatus: section.querySelector<HTMLElement>('[data-role="eppo-status"]'),
    bbchCount: section.querySelector<HTMLElement>('[data-role="bbch-count"]'),
    bbchUpdated: section.querySelector<HTMLElement>(
      '[data-role="bbch-updated"]'
    ),
    bbchStatus: section.querySelector<HTMLElement>('[data-role="bbch-status"]'),
    importEppoBtn: section.querySelector<HTMLButtonElement>(
      '[data-action="import-eppo"]'
    ),
    importBbchBtn: section.querySelector<HTMLButtonElement>(
      '[data-action="import-bbch"]'
    ),
    refreshStatsBtn: section.querySelector<HTMLButtonElement>(
      '[data-action="refresh-stats"]'
    ),
    ensureBtn: section.querySelector<HTMLButtonElement>(
      '[data-action="ensure-datasets"]'
    ),
    eppoForm: section.querySelector<HTMLFormElement>('[data-role="eppo-form"]'),
    bbchForm: section.querySelector<HTMLFormElement>('[data-role="bbch-form"]'),
    eppoResults: section.querySelector<HTMLTableSectionElement>(
      '[data-role="eppo-results-body"]'
    ),
    bbchResults: section.querySelector<HTMLTableSectionElement>(
      '[data-role="bbch-results-body"]'
    ),
    eppoPageInfo: section.querySelector<HTMLElement>(
      '[data-role="eppo-page-info"]'
    ),
    bbchPageInfo: section.querySelector<HTMLElement>(
      '[data-role="bbch-page-info"]'
    ),
    eppoPrevPage: section.querySelector<HTMLButtonElement>(
      '[data-action="eppo-page-prev"]'
    ),
    eppoNextPage: section.querySelector<HTMLButtonElement>(
      '[data-action="eppo-page-next"]'
    ),
    bbchPrevPage: section.querySelector<HTMLButtonElement>(
      '[data-action="bbch-page-prev"]'
    ),
    bbchNextPage: section.querySelector<HTMLButtonElement>(
      '[data-action="bbch-page-next"]'
    ),
    tabButtons: Array.from(
      section.querySelectorAll<HTMLButtonElement>('[data-role="lookup-tab"]')
    ),
    panels: Array.from(
      section.querySelectorAll<HTMLElement>('[data-role="lookup-panel"]')
    ),
  };

  const disableTargets = Array.from(
    section.querySelectorAll<HTMLElement>("[data-lookup-disable]")
  );

  let databaseReady = services.state.getState().app.hasDatabase;
  let activeTab: LookupTab = "eppo";
  let messageTimeout: number | null = null;

  const searchState: Record<LookupTab, SearchState> = {
    eppo: {
      query: "",
      limit: 25,
      language: "",
      executed: false,
      page: 0,
      total: 0,
    },
    bbch: {
      query: "",
      limit: 25,
      language: "",
      executed: false,
      page: 0,
      total: 0,
    },
  };

  const paginationRefs: Record<
    LookupTab,
    {
      info?: HTMLElement | null;
      prev?: HTMLButtonElement | null;
      next?: HTMLButtonElement | null;
    }
  > = {
    eppo: {
      info: refs.eppoPageInfo,
      prev: refs.eppoPrevPage,
      next: refs.eppoNextPage,
    },
    bbch: {
      info: refs.bbchPageInfo,
      prev: refs.bbchPrevPage,
      next: refs.bbchNextPage,
    },
  };

  const setMessage = (
    text?: string,
    variant: "info" | "success" | "warning" | "danger" = "info",
    autoHideMs = 4500
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

  const setUiEnabled = (enabled: boolean) => {
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
      setMessage(
        "Bitte zuerst eine Datenbank verbinden, um Lookup-Daten zu laden.",
        "info",
        0
      );
      renderPlaceholder(
        refs.eppoResults,
        "Keine aktive Datenbank",
        EPPO_COLUMN_COUNT
      );
      renderPlaceholder(
        refs.bbchResults,
        "Keine aktive Datenbank",
        BBCH_COLUMN_COUNT
      );
    } else {
      setMessage();
      if (!searchState.eppo.executed) {
        renderPlaceholder(
          refs.eppoResults,
          "Noch keine Suche ausgeführt.",
          EPPO_COLUMN_COUNT
        );
      }
      if (!searchState.bbch.executed) {
        renderPlaceholder(
          refs.bbchResults,
          "Noch keine Suche ausgeführt.",
          BBCH_COLUMN_COUNT
        );
      }
    }
    updatePaginationUi("eppo");
    updatePaginationUi("bbch");
  };

  const prepareNewSearch = (tab: LookupTab) => {
    searchState[tab].page = 0;
    searchState[tab].total = 0;
    searchState[tab].executed = false;
    updatePaginationUi(tab);
  };

  const updatePaginationUi = (tab: LookupTab) => {
    const state = searchState[tab];
    const { info, prev, next } = paginationRefs[tab];
    const hasResults = state.executed && state.total > 0;
    if (info) {
      if (!state.executed) {
        info.textContent = "Noch keine Suche.";
      } else if (!hasResults) {
        info.textContent = "Keine Treffer.";
      } else {
        const firstItem = state.page * state.limit + 1;
        const lastItem = Math.min((state.page + 1) * state.limit, state.total);
        info.textContent = `Einträge ${numberFormatter.format(
          firstItem
        )}–${numberFormatter.format(lastItem)} von ${numberFormatter.format(
          state.total
        )}`;
      }
    }
    const prevDisabled =
      !databaseReady || !state.executed || state.page === 0 || !hasResults;
    const nextDisabled =
      !databaseReady ||
      !state.executed ||
      !hasResults ||
      (state.page + 1) * state.limit >= state.total;
    if (prev) {
      prev.disabled = prevDisabled;
    }
    if (next) {
      next.disabled = nextDisabled;
    }
  };

  const changePage = (tab: LookupTab, delta: number) => {
    const state = searchState[tab];
    if (!state.executed) {
      return;
    }
    const nextPage = state.page + delta;
    if (nextPage < 0) {
      return;
    }
    if (delta > 0 && nextPage * state.limit >= state.total) {
      return;
    }
    searchState[tab].page = nextPage;
    void runSearch(tab);
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
      { hour: "2-digit", minute: "2-digit" }
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
    override?: Partial<Pick<SearchState, "query" | "limit" | "language">>
  ) => {
    if (!databaseReady) {
      return;
    }
    if (override?.query !== undefined) {
      searchState[tab].query = override.query.trim();
    }
    if (override?.limit !== undefined) {
      const normalized = Math.min(Math.max(override.limit, 1), 100);
      searchState[tab].limit = normalized;
    }
    if (override?.language !== undefined) {
      searchState[tab].language = override.language;
    }

    const state = searchState[tab];
    const query = state.query;
    const limit = state.limit;
    const offset = state.page * limit;
    const payload: LookupSearchOptions = { query, limit, offset };
    if (tab === "eppo") {
      const language = state.language?.trim().toUpperCase();
      if (language) {
        payload.language = language;
      }
    }
    const targetBody = tab === "eppo" ? refs.eppoResults : refs.bbchResults;
    const columnCount = tab === "eppo" ? EPPO_COLUMN_COUNT : BBCH_COLUMN_COUNT;
    renderPlaceholder(targetBody, "Suche läuft...", columnCount);

    try {
      let result:
        | LookupSearchResult<EppoLookupResult>
        | LookupSearchResult<BbchLookupResult>;
      if (tab === "eppo") {
        result = await searchEppoLookup(payload);
      } else {
        result = await searchBbchLookup(payload);
      }

      const total = Number(result.total) || 0;
      const rows = Array.isArray(result.rows) ? result.rows : [];

      if (total > 0) {
        const maxPage = Math.max(0, Math.ceil(total / limit) - 1);
        if (state.page > maxPage) {
          state.page = maxPage;
          updatePaginationUi(tab);
          await runSearch(tab);
          return;
        }
      } else if (state.page !== 0) {
        state.page = 0;
      }

      state.total = total;
      state.executed = true;

      if (tab === "eppo") {
        renderEppoResults(rows as EppoLookupResult[], targetBody);
      } else {
        renderBbchResults(rows as BbchLookupResult[], targetBody);
      }

      updatePaginationUi(tab);
    } catch (error) {
      console.error("Lookup-Suche fehlgeschlagen", error);
      setMessage("Suche fehlgeschlagen.", "danger");
      renderPlaceholder(targetBody, "Fehler bei der Suche", columnCount);
      state.executed = false;
      state.total = 0;
      updatePaginationUi(tab);
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
      if (databaseReady && !searchState[target].executed) {
        void runSearch(target);
      }
    });
  });

  section.addEventListener("click", (event) => {
    const copyBtn = (event.target as HTMLElement).closest<HTMLButtonElement>(
      '[data-action="copy-code"]'
    );
    if (copyBtn && copyBtn.dataset.code) {
      event.preventDefault();
      void copyToClipboard(copyBtn.dataset.code, setMessage);
    }
  });

  refs.eppoPrevPage?.addEventListener("click", () => changePage("eppo", -1));
  refs.eppoNextPage?.addEventListener("click", () => changePage("eppo", 1));
  refs.bbchPrevPage?.addEventListener("click", () => changePage("bbch", -1));
  refs.bbchNextPage?.addEventListener("click", () => changePage("bbch", 1));

  refs.importEppoBtn?.addEventListener("click", () => {
    void withButtonBusy(refs.importEppoBtn, async () => {
      try {
        await reloadLookup("eppo");
        setMessage("EPPO-Datenbank aktualisiert.", "success");
        await refreshStats();
        if (activeTab === "eppo") {
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
    const nextReady = services.state.getState().app.hasDatabase;
    if (nextReady === databaseReady) {
      return;
    }
    databaseReady = nextReady;
    setUiEnabled(databaseReady);
    if (databaseReady) {
      void refreshStats();
      if (!searchState[activeTab].executed) {
        void runSearch(activeTab);
      }
    }
  };

  services.state.subscribe(handleStateChange);
  setActiveTab("eppo");
  setUiEnabled(databaseReady);
  if (databaseReady) {
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
          <div class="d-flex justify-content-between align-items-center mt-2">
            <small class="text-muted" data-role="eppo-page-info">Noch keine Suche.</small>
            <div class="btn-group">
              <button type="button" class="btn btn-outline-light btn-sm" data-action="eppo-page-prev" data-lookup-disable>
                <i class="bi bi-chevron-left"></i>
              </button>
              <button type="button" class="btn btn-outline-light btn-sm" data-action="eppo-page-next" data-lookup-disable>
                <i class="bi bi-chevron-right"></i>
              </button>
            </div>
          </div>
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
          <div class="d-flex justify-content-between align-items-center mt-2">
            <small class="text-muted" data-role="bbch-page-info">Noch keine Suche.</small>
            <div class="btn-group">
              <button type="button" class="btn btn-outline-light btn-sm" data-action="bbch-page-prev" data-lookup-disable>
                <i class="bi bi-chevron-left"></i>
              </button>
              <button type="button" class="btn btn-outline-light btn-sm" data-action="bbch-page-next" data-lookup-disable>
                <i class="bi bi-chevron-right"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  return section;
}

async function withButtonBusy(
  button: HTMLButtonElement | null,
  task: () => Promise<void>
): Promise<void> {
  if (!button) {
    await task();
    return;
  }
  const original = button.innerHTML;
  button.disabled = true;
  const label = button.textContent?.trim() || "Bitte warten";
  button.innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>${escapeHtml(
    label
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
  target?: HTMLTableSectionElement | null
): void {
  if (!target) {
    return;
  }
  if (!rows.length) {
    renderPlaceholder(target, "Keine Treffer gefunden", EPPO_COLUMN_COUNT);
    return;
  }
  target.innerHTML = rows
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
                  entry.value
                )}</span>`
            )
            .join("")}</div>`
        : "";
      const hintLines: string[] = [];
      if (row.authority?.trim()) {
        hintLines.push(`Quelle: ${row.authority.trim()}`);
      }
      if (synonyms.length) {
        hintLines.push(
          `Synonyme: ${synonyms.map((entry) => entry.label).join(", ")}`
        );
      }
      const hintsHtml = hintLines.length
        ? hintLines
            .map(
              (line) =>
                `<div class="text-muted small">${escapeHtml(line)}</div>`
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
            <button class="btn btn-sm btn-outline-light" data-action="copy-code" data-code="${escapeHtml(
              row.code
            )}">
              Kopieren
            </button>
          </td>
        </tr>
      `;
    })
    .join("");
}

function formatLanguageLabel(
  row: Pick<EppoLookupResult, "language" | "languageLabel">
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
  target?: HTMLTableSectionElement | null
): void {
  if (!target) {
    return;
  }
  if (!rows.length) {
    renderPlaceholder(target, "Keine Treffer gefunden", BBCH_COLUMN_COUNT);
    return;
  }
  target.innerHTML = rows
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
            <button class="btn btn-sm btn-outline-light" data-action="copy-code" data-code="${escapeHtml(
              row.code
            )}">
              Kopieren
            </button>
          </td>
        </tr>
      `;
    })
    .join("");
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
  columns: number
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
    variant?: "info" | "success" | "warning" | "danger"
  ) => void
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
      const input = document.createElement("textarea");
      input.value = code;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.focus();
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      notify(`„${code}“ kopiert.`, "success");
    } catch (fallbackError) {
      console.error("Fallback-Kopie fehlgeschlagen", fallbackError);
      window.prompt("Code kopieren:", code);
    }
  }
}
