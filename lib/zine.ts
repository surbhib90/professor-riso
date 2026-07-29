/**
 * Zine panel state: the client is the state authority for the session.
 *
 * Pure reducer plus a tiny store. The store is read synchronously (not through
 * React state) because the app-message handler has to answer "what is the next
 * unfinished panel?" in the same tick it applies a tool call, in order to send
 * the state nudge back to the professor.
 */

import {
  PANEL_COUNT,
  type Mastery,
  type Panel,
  type UnderstandingCheck,
  masteryFrom,
} from "./types";

export interface ZineState {
  /** Keyed by panel number, 1..PANEL_COUNT. Upsert only — never duplicated. */
  panels: Readonly<Record<number, Panel>>;
  /** Latest understanding check per panel; drives the mastery stamp. */
  checks: Readonly<Record<number, UnderstandingCheck>>;
}

export const emptyZineState: ZineState = { panels: {}, checks: {} };

export type ZineAction =
  | { type: "hydrate"; panels: readonly Panel[]; checks?: readonly UnderstandingCheck[] }
  | { type: "panel"; panel: Panel }
  | { type: "check"; check: UnderstandingCheck };

/** Prefilled worked examples are never stamped — the student did not earn them. */
function masteryForPanel(
  source: Panel["source"],
  check: UnderstandingCheck | undefined,
): Mastery {
  if (source === "prefill") return "none";
  return check ? masteryFrom(check) : "none";
}

export function zineReducer(state: ZineState, action: ZineAction): ZineState {
  switch (action.type) {
    case "hydrate": {
      const checks: Record<number, UnderstandingCheck> = { ...state.checks };
      for (const check of action.checks ?? []) checks[check.panelNumber] = check;

      const panels: Record<number, Panel> = { ...state.panels };
      for (const panel of action.panels) {
        // A live check wins over whatever mastery the row was persisted with.
        const check = checks[panel.panelNumber];
        panels[panel.panelNumber] = check
          ? { ...panel, mastery: masteryForPanel(panel.source, check) }
          : panel;
      }
      return { panels, checks };
    }

    case "panel": {
      const { panel } = action;
      return {
        ...state,
        panels: {
          ...state.panels,
          // Upsert: a re-confirmed panel_number overwrites, never duplicates.
          [panel.panelNumber]: {
            ...panel,
            mastery: masteryForPanel(panel.source, state.checks[panel.panelNumber]),
          },
        },
      };
    }

    case "check": {
      const { check } = action;
      const checks = { ...state.checks, [check.panelNumber]: check };
      const existing = state.panels[check.panelNumber];
      if (!existing) return { ...state, checks };
      return {
        checks,
        panels: {
          ...state.panels,
          [check.panelNumber]: {
            ...existing,
            mastery: masteryForPanel(existing.source, check),
          },
        },
      };
    }
  }
}

/** Panels 1..8 in fold order; null where nothing has been logged yet. */
export function panelSlots(state: ZineState): readonly (Panel | null)[] {
  const slots: (Panel | null)[] = [];
  for (let n = 1; n <= PANEL_COUNT; n += 1) slots.push(state.panels[n] ?? null);
  return slots;
}

/** Lowest panel number with no logged content, or null when the sheet is full. */
export function nextUnfinishedPanel(state: ZineState): number | null {
  for (let n = 1; n <= PANEL_COUNT; n += 1) {
    if (!state.panels[n]) return n;
  }
  return null;
}

export function filledPanelCount(state: ZineState): number {
  return Object.keys(state.panels).length;
}

export function isZineComplete(state: ZineState): boolean {
  return nextUnfinishedPanel(state) === null;
}

// --- store -----------------------------------------------------------------

export interface ZineStore {
  getState(): ZineState;
  dispatch(action: ZineAction): ZineState;
  subscribe(listener: () => void): () => void;
}

/**
 * Synchronous store so `dispatch` then `nextUnfinishedPanel(getState())` is
 * correct in one tick. Pairs with `useSyncExternalStore` for rendering.
 */
export function createZineStore(initial: ZineState = emptyZineState): ZineStore {
  let state = initial;
  const listeners = new Set<() => void>();

  return {
    getState: () => state,
    dispatch(action) {
      const next = zineReducer(state, action);
      if (next !== state) {
        state = next;
        for (const listener of listeners) listener();
      }
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
