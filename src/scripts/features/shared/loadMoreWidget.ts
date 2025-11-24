export type LoadMoreWidgetState =
  | { status: "hidden" }
  | { status: "idle"; label?: string; remaining?: number }
  | { status: "loading"; label?: string; remaining?: number }
  | { status: "error"; message?: string }
  | { status: "done"; label?: string };

export interface LoadMoreWidget {
  update: (state: LoadMoreWidgetState) => void;
  destroy: () => void;
  getState: () => LoadMoreWidgetState;
}

interface LoadMoreWidgetOptions {
  onRequest: () => void;
  idleLabel?: string;
  loadingLabel?: string;
  doneLabel?: string;
  errorLabel?: string;
  retryLabel?: string;
  formatter?: (params: { remaining?: number }) => string | null;
}

const DEFAULT_LABELS = {
  idle: "Mehr laden",
  loading: "Lade …",
  done: "Keine weiteren Einträge",
  error: "Fehler beim Laden",
  retry: "Erneut versuchen",
};

export function createLoadMoreWidget(
  target: Element | null,
  options: LoadMoreWidgetOptions
): LoadMoreWidget | null {
  if (!target) {
    return null;
  }

  const {
    onRequest,
    idleLabel,
    loadingLabel,
    doneLabel,
    errorLabel,
    retryLabel,
    formatter,
  } = options;

  const container = document.createElement("div");
  container.className = "load-more-widget d-grid gap-2";
  target.innerHTML = "";
  target.appendChild(container);

  let currentState: LoadMoreWidgetState = { status: "hidden" };
  let isDestroyed = false;

  function formatLabel(base: string, remaining?: number): string {
    if (typeof formatter === "function") {
      const custom = formatter({ remaining });
      if (typeof custom === "string" && custom.trim()) {
        return custom;
      }
    }
    if (typeof remaining === "number" && remaining > 0) {
      return `${base} (${remaining} weitere)`;
    }
    return base;
  }

  function renderIdle(state: Extract<LoadMoreWidgetState, { status: "idle" }>) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-outline-light w-100";
    button.innerHTML = formatLabel(
      idleLabel || DEFAULT_LABELS.idle,
      state.remaining
    );
    button.addEventListener("click", () => onRequest());
    container.replaceChildren(button);
  }

  function renderLoading(
    state: Extract<LoadMoreWidgetState, { status: "loading" }>
  ) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-outline-light w-100 d-flex align-items-center justify-content-center gap-2";
    button.disabled = true;
    button.innerHTML = `
      <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
      <span>${formatLabel(
        loadingLabel || DEFAULT_LABELS.loading,
        state.remaining
      )}</span>
    `;
    container.replaceChildren(button);
  }

  function renderError(state: Extract<LoadMoreWidgetState, { status: "error" }>) {
    const wrapper = document.createElement("div");
    wrapper.className = "alert alert-danger d-flex flex-column gap-2 mb-0";
    const message = document.createElement("div");
    message.textContent = state.message || errorLabel || DEFAULT_LABELS.error;
    const retryButton = document.createElement("button");
    retryButton.type = "button";
    retryButton.className = "btn btn-outline-light btn-sm align-self-start";
    retryButton.textContent = retryLabel || DEFAULT_LABELS.retry;
    retryButton.addEventListener("click", () => onRequest());
    wrapper.append(message, retryButton);
    container.replaceChildren(wrapper);
  }

  function renderDone(state: Extract<LoadMoreWidgetState, { status: "done" }>) {
    const info = document.createElement("div");
    info.className = "text-muted small text-center";
    info.textContent = state.label || doneLabel || DEFAULT_LABELS.done;
    container.replaceChildren(info);
  }

  function renderHidden() {
    container.replaceChildren();
  }

  function renderState(next: LoadMoreWidgetState) {
    switch (next.status) {
      case "idle":
        renderIdle(next);
        break;
      case "loading":
        renderLoading(next);
        break;
      case "error":
        renderError(next);
        break;
      case "done":
        renderDone(next);
        break;
      default:
        renderHidden();
        break;
    }
  }

  renderHidden();

  return {
    update(state: LoadMoreWidgetState) {
      if (isDestroyed) {
        return;
      }
      currentState = state;
      renderState(state);
    },
    destroy() {
      if (isDestroyed) {
        return;
      }
      isDestroyed = true;
      container.replaceChildren();
      target.innerHTML = "";
    },
    getState() {
      return currentState;
    },
  };
}
