const DEFAULT_PAGER_LABELS = {
  prev: "Zurück",
  next: "Weiter",
  loading: "Lädt …",
  empty: "Keine Einträge verfügbar",
};

function createSpinner() {
  const spinner = document.createElement("span");
  spinner.className = "spinner-border spinner-border-sm";
  spinner.setAttribute("role", "status");
  spinner.setAttribute("aria-hidden", "true");
  return spinner;
}

function renderInfo(text) {
  const info = document.createElement("div");
  info.className =
    "pager-widget__info text-muted small text-center flex-grow-1";
  info.textContent = text && text.trim ? text.trim() : text || "";
  return info;
}

export function createPagerWidget(target, options) {
  if (!target) {
    return null;
  }

  const container = document.createElement("div");
  container.className = "pager-widget d-flex flex-column gap-2";
  target.innerHTML = "";
  target.appendChild(container);

  let currentState = { status: "hidden" };
  let isDestroyed = false;
  const labels = { ...DEFAULT_PAGER_LABELS, ...(options?.labels || {}) };

  function renderHidden() {
    container.replaceChildren();
  }

  function renderDisabled(state) {
    const info = renderInfo(state.info || labels.empty);
    container.replaceChildren(info);
  }

  function renderError(state) {
    const alert = document.createElement("div");
    alert.className = "alert alert-danger mb-0";
    alert.textContent = state.message || "Unbekannter Fehler";
    container.replaceChildren(alert);
  }

  function renderReady(state) {
    const wrapper = document.createElement("div");
    wrapper.className =
      "pager-widget__controls d-flex flex-column flex-md-row gap-2 align-items-stretch";

    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className =
      "btn btn-outline-light d-flex align-items-center justify-content-center gap-2";
    prevBtn.disabled = !state.canPrev || state.loadingDirection === "prev";
    prevBtn.textContent = labels.prev;
    if (state.loadingDirection === "prev") {
      prevBtn.prepend(createSpinner());
    }
    prevBtn.addEventListener("click", () => {
      if (!prevBtn.disabled) {
        options.onPrev?.();
      }
    });

    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className =
      "btn btn-outline-light d-flex align-items-center justify-content-center gap-2";
    nextBtn.disabled = !state.canNext || state.loadingDirection === "next";
    nextBtn.textContent = labels.next;
    if (state.loadingDirection === "next") {
      nextBtn.append(createSpinner());
    }
    nextBtn.addEventListener("click", () => {
      if (!nextBtn.disabled) {
        options.onNext?.();
      }
    });

    const info = renderInfo(
      state.info ||
        (state.canPrev || state.canNext ? labels.loading : labels.empty)
    );

    wrapper.append(prevBtn, info, nextBtn);
    container.replaceChildren(wrapper);
  }

  function renderState(state) {
    switch (state.status) {
      case "hidden":
        renderHidden();
        break;
      case "disabled":
        renderDisabled(state);
        break;
      case "error":
        renderError(state);
        break;
      case "ready":
        renderReady(state);
        break;
      default:
        renderHidden();
        break;
    }
  }

  return {
    update(state) {
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
