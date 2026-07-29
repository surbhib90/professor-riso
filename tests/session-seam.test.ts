import { describe, expect, it } from "vitest";

import { handleAppMessage, type HandlerDeps } from "@/lib/app-message-handler";
import type { MessageSender } from "@/lib/bridge";
import {
  createZineStore,
  isZineComplete,
  nextUnfinishedPanel,
  panelSlots,
  type ZineStore,
} from "@/lib/zine";
import type { Panel, UnderstandingCheck } from "@/lib/types";

/**
 * The seam, not the modules: handler + zine wired the way
 * app/conversation/ConversationSurface.tsx wires them.
 *
 * The unit suites prove each module in isolation. What this file pins down is
 * the composition — that `nextUnfinishedPanel` is read from state the reducer
 * has already been given, and that a mastery stamp survives the arrival order
 * the objective chain actually produces.
 */

const CONVERSATION_ID = "c1a2b3c4d5";

interface WireMessage {
  readonly event_type: string;
  readonly properties: Record<string, unknown>;
}
const wire = (value: unknown): WireMessage => value as WireMessage;

interface Session {
  readonly deps: HandlerDeps;
  readonly store: ZineStore;
  readonly sent: unknown[];
  /** What the Supabase upsert would receive, in call order. */
  readonly persistedPanels: Panel[];
  readonly persistedChecks: UnderstandingCheck[];
  /** Text of every conversation.respond the client injected. */
  nudges(): string[];
}

function session(prefilled: readonly number[] = []): Session {
  const store = createZineStore();
  const sent: unknown[] = [];
  const persistedPanels: Panel[] = [];
  const persistedChecks: UnderstandingCheck[] = [];

  if (prefilled.length > 0) {
    // Boot rehydrates worked examples before joining the call — the same
    // dispatch ConversationSurface makes once prefill rows come back.
    store.dispatch({
      type: "hydrate",
      panels: prefilled.map((panelNumber) => ({
        panelNumber,
        text: `worked example ${panelNumber}`,
        source: "prefill",
        mastery: "none",
      })),
    });
  }

  const sender: MessageSender = {
    sendAppMessage(data: unknown) {
      sent.push(data);
    },
  };

  const deps: HandlerDeps = {
    conversationId: CONVERSATION_ID,
    sender,
    applyPanel: (panel) => {
      store.dispatch({ type: "panel", panel });
    },
    applyCheck: (check) => {
      store.dispatch({ type: "check", check });
    },
    // Reads through the store the way the app's savePanel closure could, which
    // is the only place the stamped panel exists at write time.
    persistPanel: (panel) => {
      persistedPanels.push(store.getState().panels[panel.panelNumber] ?? panel);
    },
    persistCheck: (check) => {
      persistedChecks.push(check);
    },
    nextUnfinishedPanel: () => nextUnfinishedPanel(store.getState()),
    setProfessorSpeaking: () => {},
  };

  return {
    deps,
    store,
    sent,
    persistedPanels,
    persistedChecks,
    nudges: () =>
      sent
        .map(wire)
        .filter((message) => message.event_type === "conversation.respond")
        .map((message) => String(message.properties.text)),
  };
}

const logPanel = (
  s: Session,
  panelNumber: number,
  text: string,
  source: "prefill" | "student" = "student",
): unknown =>
  handleAppMessage(
    {
      message_type: "conversation",
      event_type: "conversation.tool_call",
      conversation_id: CONVERSATION_ID,
      properties: {
        name: "log_zine_page",
        arguments: { panel_number: panelNumber, text, source },
        tool_call_id: `toolu_panel_${panelNumber}`,
      },
    },
    s.deps,
  );

const logCheck = (
  s: Session,
  panelNumber: number,
  level: UnderstandingCheck["level"],
  attempt: number,
): unknown =>
  handleAppMessage(
    {
      message_type: "conversation",
      event_type: "conversation.tool_call",
      conversation_id: CONVERSATION_ID,
      properties: {
        name: "log_understanding_check",
        arguments: { panel_number: panelNumber, level, attempt },
        tool_call_id: `toolu_check_${panelNumber}_${attempt}`,
      },
    },
    s.deps,
  );

describe("handler + zine seam — the demo session", () => {
  it("nudges the professor to the first unfilled panel after prefill", () => {
    // Demo default: 4 of 8 prefilled, so the chain starts at await_panel_5.
    const s = session([1, 2, 3, 4]);

    // The objective chain runs test_panel_5 before confirm_panel_5.
    logCheck(s, 5, "solid", 1);
    const outcome = logPanel(s, 5, "A base case stops the recursion.");

    expect(outcome).toEqual({ kind: "panel-logged", panelNumber: 5, nextPanel: 6 });
    expect(s.nudges()).toEqual(["Panel 5 saved. The next unfinished panel is 6."]);
  });

  it("walks the remaining panels and closes on a complete sheet", () => {
    const s = session([1, 2, 3, 4]);

    for (const n of [5, 6, 7, 8]) {
      logCheck(s, n, "solid", 1);
      logPanel(s, n, `student panel ${n}`);
    }

    expect(s.nudges()).toEqual([
      "Panel 5 saved. The next unfinished panel is 6.",
      "Panel 6 saved. The next unfinished panel is 7.",
      "Panel 7 saved. The next unfinished panel is 8.",
      "Panel 8 saved. Every panel is filled now.",
    ]);
    expect(isZineComplete(s.store.getState())).toBe(true);
    expect(panelSlots(s.store.getState()).filter(Boolean)).toHaveLength(8);
  });

  it("names the lowest gap, not the panel after the one just saved", () => {
    // A refresh can leave a hole: prefill wrote 1 and 3, the student is on 4.
    const s = session([1, 3]);

    const outcome = logPanel(s, 4, "student panel 4");

    expect(outcome).toEqual({ kind: "panel-logged", panelNumber: 4, nextPanel: 2 });
    expect(s.nudges()).toEqual(["Panel 4 saved. The next unfinished panel is 2."]);
  });

  it("completes the sheet when the professor fills the rest at wrap-up", () => {
    // T-2:00 injection: "wrap up and briefly fill any remaining panels yourself".
    const s = session([1, 2, 3, 4]);
    logCheck(s, 5, "solid", 1);
    logPanel(s, 5, "student panel 5");

    for (const n of [6, 7, 8]) logPanel(s, n, `wrap-up panel ${n}`, "prefill");

    const state = s.store.getState();
    expect(isZineComplete(state)).toBe(true);
    expect(state.panels[5]?.mastery).toBe("first-try");
    // Panels the professor filled at the buzzer are not the student's work.
    expect(state.panels[8]?.mastery).toBe("none");
    expect(s.nudges().at(-1)).toBe("Panel 8 saved. Every panel is filled now.");
  });
});

describe("handler + zine seam — mastery across the real arrival order", () => {
  it("stamps gold when the check lands before the panel, as the chain emits them", () => {
    const s = session([1, 2, 3, 4]);

    logCheck(s, 5, "solid", 1);
    logPanel(s, 5, "student panel 5");

    expect(s.store.getState().panels[5]?.mastery).toBe("first-try");
  });

  it("stamps silver for the shaky-then-solid retry the reexplain node produces", () => {
    const s = session([1, 2, 3, 4]);

    logCheck(s, 5, "shaky", 1);
    logCheck(s, 5, "solid", 2);
    logPanel(s, 5, "student panel 5, second pass");

    expect(s.store.getState().panels[5]?.mastery).toBe("after-retry");
    // Both halves reach the instructor ledger; only the latest drives the stamp.
    expect(s.persistedChecks).toEqual([
      { panelNumber: 5, level: "shaky", attempt: 1 },
      { panelNumber: 5, level: "solid", attempt: 2 },
    ]);
  });

  it("keeps the stamp when the professor re-confirms a polished version", () => {
    const s = session([1, 2, 3, 4]);

    logCheck(s, 5, "solid", 1);
    logPanel(s, 5, "first wording");
    logPanel(s, 5, "polished wording");

    const state = s.store.getState();
    expect(Object.keys(state.panels)).toHaveLength(5);
    expect(state.panels[5]?.text).toBe("polished wording");
    expect(state.panels[5]?.mastery).toBe("first-try");
  });

  it("applies the panel to state before persisting it", () => {
    // Load-bearing for the Supabase write: the stamped panel only exists in the
    // store, so persistPanel must be called after applyPanel, never before.
    const s = session([1, 2, 3, 4]);

    logCheck(s, 5, "solid", 1);
    logPanel(s, 5, "student panel 5");

    expect(s.persistedPanels).toEqual([
      {
        panelNumber: 5,
        text: "student panel 5",
        source: "student",
        mastery: "first-try",
      },
    ]);
  });

  it("never stamps a prefilled panel even if a check names it", () => {
    const s = session([1, 2, 3, 4]);

    logCheck(s, 3, "solid", 1);
    logPanel(s, 3, "worked example 3, restated", "prefill");

    expect(s.store.getState().panels[3]?.mastery).toBe("none");
  });
});

describe("handler + zine seam — rejected tool calls", () => {
  it("leaves the zine and the nudge stream untouched", () => {
    const s = session([1, 2, 3, 4]);

    handleAppMessage(
      {
        message_type: "conversation",
        event_type: "conversation.tool_call",
        conversation_id: CONVERSATION_ID,
        properties: {
          name: "log_zine_page",
          arguments: { panel_number: 9, text: "off the sheet", source: "student" },
          tool_call_id: "toolu_bad",
        },
      },
      s.deps,
    );

    expect(s.persistedPanels).toEqual([]);
    expect(s.nudges()).toEqual([]);
    // The professor is told, so it can correct itself rather than stall.
    expect(wire(s.sent[0]).properties.status).toBe("error");
    expect(nextUnfinishedPanel(s.store.getState())).toBe(5);
  });
});
