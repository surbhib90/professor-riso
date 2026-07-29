import { describe, expect, it } from "vitest";

import {
  createZineStore,
  emptyZineState,
  filledPanelCount,
  isZineComplete,
  nextUnfinishedPanel,
  panelSlots,
  zineReducer,
  type ZineAction,
  type ZineState,
} from "@/lib/zine";
import { masteryFrom, type Panel, type UnderstandingCheck } from "@/lib/types";

/**
 * Panels arrive from the handler with mastery "none" — the reducer owns the
 * stamp because only it holds the understanding check for that panel number.
 */
const studentPanel = (panelNumber: number, text = `panel ${panelNumber}`): Panel => ({
  panelNumber,
  text,
  source: "student",
  mastery: "none",
});

const prefillPanel = (panelNumber: number): Panel => ({
  panelNumber,
  text: `worked example ${panelNumber}`,
  source: "prefill",
  mastery: "none",
});

const check = (
  panelNumber: number,
  level: UnderstandingCheck["level"],
  attempt: number,
): UnderstandingCheck => ({ panelNumber, level, attempt });

/** Apply actions in order from empty state, the way the handler drives the store. */
const run = (...actions: readonly ZineAction[]): ZineState =>
  actions.reduce(zineReducer, emptyZineState);

describe("zineReducer — panels", () => {
  it("renders a panel logged by a tool call", () => {
    const state = run({ type: "panel", panel: studentPanel(1, "base case stops it") });

    expect(state.panels[1]).toEqual({
      panelNumber: 1,
      text: "base case stops it",
      source: "student",
      mastery: "none",
    });
    expect(panelSlots(state)[0]?.text).toBe("base case stops it");
    expect(panelSlots(state)).toHaveLength(8);
  });

  it("upserts a re-confirmed panel instead of duplicating it", () => {
    const state = run(
      { type: "panel", panel: studentPanel(3, "first wording") },
      { type: "panel", panel: studentPanel(3, "polished wording") },
    );

    expect(filledPanelCount(state)).toBe(1);
    expect(state.panels[3]?.text).toBe("polished wording");
    expect(panelSlots(state).filter(Boolean)).toHaveLength(1);
  });

  it("leaves unlogged slots null rather than blank panels", () => {
    const state = run({ type: "panel", panel: studentPanel(5) });

    expect(panelSlots(state)[3]).toBeNull();
    expect(panelSlots(state)[4]?.panelNumber).toBe(5);
  });
});

describe("zineReducer — mastery stamps", () => {
  it("stamps first-try when the student was solid on attempt 1", () => {
    const state = run(
      { type: "panel", panel: studentPanel(1) },
      { type: "check", check: check(1, "solid", 1) },
    );

    expect(state.panels[1]?.mastery).toBe("first-try");
    expect(state.panels[1]?.mastery).toBe(masteryFrom(check(1, "solid", 1)));
  });

  it("stamps after-retry when the student was solid only on attempt 2", () => {
    const state = run(
      { type: "panel", panel: studentPanel(2) },
      { type: "check", check: check(2, "solid", 2) },
    );

    expect(state.panels[2]?.mastery).toBe("after-retry");
    expect(state.panels[2]?.mastery).toBe(masteryFrom(check(2, "solid", 2)));
  });

  it("leaves a shaky or confused panel unstamped", () => {
    const shaky = run(
      { type: "panel", panel: studentPanel(1) },
      { type: "check", check: check(1, "shaky", 1) },
    );
    const confused = run(
      { type: "panel", panel: studentPanel(1) },
      { type: "check", check: check(1, "confused", 2) },
    );

    expect(shaky.panels[1]?.mastery).toBe("none");
    expect(confused.panels[1]?.mastery).toBe("none");
  });

  it("never stamps a prefilled panel — the student did not earn it", () => {
    const state = run(
      { type: "panel", panel: prefillPanel(4) },
      { type: "check", check: check(4, "solid", 1) },
    );

    expect(state.panels[4]?.mastery).toBe("none");
  });

  it("takes the later check when a panel is re-assessed", () => {
    const state = run(
      { type: "panel", panel: studentPanel(1) },
      { type: "check", check: check(1, "shaky", 1) },
      { type: "check", check: check(1, "solid", 2) },
    );

    expect(state.panels[1]?.mastery).toBe("after-retry");
  });
});

describe("zineReducer — tool-call arrival order", () => {
  // log_understanding_check normally lands BEFORE log_zine_page (test_panel_N
  // runs before confirm_panel_N in the objective chain), but nothing in the
  // transport guarantees it, so both orders must stamp identically.
  it("stamps a panel when the check arrives before the panel (the normal order)", () => {
    const state = run(
      { type: "check", check: check(6, "solid", 1) },
      { type: "panel", panel: studentPanel(6) },
    );

    expect(state.panels[6]?.mastery).toBe("first-try");
  });

  it("stamps a panel when the panel arrives before the check (the reversed order)", () => {
    const state = run(
      { type: "panel", panel: studentPanel(6) },
      { type: "check", check: check(6, "solid", 1) },
    );

    expect(state.panels[6]?.mastery).toBe("first-try");
  });

  it("keeps a check for a panel that has not been logged yet", () => {
    const state = run({ type: "check", check: check(7, "solid", 2) });

    expect(state.panels[7]).toBeUndefined();
    expect(state.checks[7]).toEqual(check(7, "solid", 2));
  });

  it("does not lose an existing stamp when the panel is re-confirmed", () => {
    // The handler always sends mastery "none"; a naive spread would wipe the stamp.
    const state = run(
      { type: "check", check: check(2, "solid", 1) },
      { type: "panel", panel: studentPanel(2, "first wording") },
      { type: "panel", panel: studentPanel(2, "polished wording") },
    );

    expect(state.panels[2]?.text).toBe("polished wording");
    expect(state.panels[2]?.mastery).toBe("first-try");
  });
});

describe("zineReducer — hydrate", () => {
  it("restores persisted panels on a mid-session refresh", () => {
    const state = zineReducer(emptyZineState, {
      type: "hydrate",
      panels: [prefillPanel(1), prefillPanel(2), { ...studentPanel(3), mastery: "first-try" }],
    });

    expect(filledPanelCount(state)).toBe(3);
    expect(state.panels[3]?.mastery).toBe("first-try");
  });

  it("recomputes mastery from hydrated checks rather than trusting the stored column", () => {
    const state = zineReducer(emptyZineState, {
      type: "hydrate",
      // Row says first-try, but the understanding_events row says attempt 2.
      panels: [{ ...studentPanel(1), mastery: "first-try" }],
      checks: [check(1, "solid", 2)],
    });

    expect(state.panels[1]?.mastery).toBe("after-retry");
  });
});

describe("nextUnfinishedPanel", () => {
  it("starts at panel 1 on an empty sheet", () => {
    expect(nextUnfinishedPanel(emptyZineState)).toBe(1);
    expect(isZineComplete(emptyZineState)).toBe(false);
  });

  it("skips a contiguous block of prefilled panels", () => {
    // Demo default: 4 of 8 prefilled, so the student starts at 5.
    const state = run(
      ...[1, 2, 3, 4].map((n): ZineAction => ({ type: "panel", panel: prefillPanel(n) })),
    );

    expect(nextUnfinishedPanel(state)).toBe(5);
  });

  it("returns the lowest gap when prefilled panels are interleaved", () => {
    const state = run(
      ...[1, 3, 5, 7].map((n): ZineAction => ({ type: "panel", panel: prefillPanel(n) })),
    );

    expect(nextUnfinishedPanel(state)).toBe(2);
  });

  it("moves past a panel the student just confirmed", () => {
    const state = run(
      { type: "panel", panel: prefillPanel(1) },
      { type: "panel", panel: studentPanel(2) },
    );

    expect(nextUnfinishedPanel(state)).toBe(3);
  });

  it("returns null once every panel is filled", () => {
    const state = run(
      ...Array.from({ length: 8 }, (_, i): ZineAction => ({
        type: "panel",
        panel: studentPanel(i + 1),
      })),
    );

    expect(nextUnfinishedPanel(state)).toBeNull();
    expect(isZineComplete(state)).toBe(true);
    expect(filledPanelCount(state)).toBe(8);
  });

  it("ignores checks for panels with no content", () => {
    const state = run({ type: "check", check: check(1, "solid", 1) });

    expect(nextUnfinishedPanel(state)).toBe(1);
  });
});

describe("createZineStore", () => {
  it("exposes the new state synchronously so the nudge can read it in the same tick", () => {
    const store = createZineStore();

    const returned = store.dispatch({ type: "panel", panel: studentPanel(1) });

    expect(returned).toBe(store.getState());
    expect(nextUnfinishedPanel(store.getState())).toBe(2);
  });

  it("notifies subscribers on change and stops after unsubscribe", () => {
    const store = createZineStore();
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });

    store.dispatch({ type: "panel", panel: studentPanel(1) });
    expect(notifications).toBe(1);

    unsubscribe();
    store.dispatch({ type: "panel", panel: studentPanel(2) });
    expect(notifications).toBe(1);
  });

  it("starts from injected state so rehydrated panels survive the first render", () => {
    const store = createZineStore(
      zineReducer(emptyZineState, { type: "hydrate", panels: [prefillPanel(1)] }),
    );

    expect(filledPanelCount(store.getState())).toBe(1);
  });
});
