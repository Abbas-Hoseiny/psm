import { getState, type AppState } from "./state";
import { subscribe as subscribeEvent } from "./eventBus";

export type AutoRefreshStatus = "idle" | "stale" | "refreshing";

export interface AutoRefreshPolicyOptions {
  section: AppState["app"]["activeSection"];
  event: string;
  onRefresh: () => void | Promise<void>;
  onStatusChange?: (status: AutoRefreshStatus) => void;
  shouldHandleEvent?: () => boolean;
  shouldRefresh?: () => boolean;
}

export function registerAutoRefreshPolicy(
  options: AutoRefreshPolicyOptions
): () => void {
  let disposed = false;
  let stale = false;

  const setStatus = (status: AutoRefreshStatus): void => {
    if (!options.onStatusChange) {
      return;
    }
    options.onStatusChange(status);
  };

  const tryRefresh = (): void => {
    if (disposed || !stale) {
      return;
    }
    const activeSection = getState().app.activeSection;
    if (activeSection !== options.section) {
      return;
    }
    if (options.shouldRefresh && !options.shouldRefresh()) {
      return;
    }
    stale = false;
    setStatus("refreshing");
    Promise.resolve(options.onRefresh())
      .catch((error) => {
        console.error("Auto-Refresh konnte nicht ausgeführt werden", error);
        stale = true;
        setStatus("stale");
      })
      .finally(() => {
        if (!disposed && !stale) {
          setStatus("idle");
        }
      });
  };

  const unsubscribeEvent = subscribeEvent(options.event, () => {
    if (options.shouldHandleEvent && !options.shouldHandleEvent()) {
      return;
    }
    stale = true;
    setStatus("stale");
    tryRefresh();
  });

  const unsubscribeActivation = subscribeEvent(
    "app:sectionChanged",
    (section: AppState["app"]["activeSection"]) => {
      if (section === options.section) {
        if (stale) {
          tryRefresh();
        } else {
          setStatus("idle");
        }
      }
    }
  );

  // Initialize indicator when section already active
  if (getState().app.activeSection === options.section) {
    setStatus("idle");
  }

  return () => {
    disposed = true;
    unsubscribeEvent();
    unsubscribeActivation();
  };
}
