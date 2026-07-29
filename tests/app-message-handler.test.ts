import { beforeEach, describe, expect, it } from "vitest";

import {
  createAppMessageHandler,
  handleAppMessage,
  HANDLED_EVENT_TYPES,
  type HandlerDeps,
} from "@/lib/app-message-handler";
import type { MessageSender } from "@/lib/bridge";
import {
  createZineStore,
  nextUnfinishedPanel,
  type ZineStore,
} from "@/lib/zine";
import type { Panel, UnderstandingCheck } from "@/lib/types";

const CONVERSATION_ID = "c1a2b3c4d5";

/** Wire shape of everything the handler sends back (spike/t1-toolcall-test.py). */
interface WireMessage {
  readonly message_type: string;
  readonly event_type: string;
  readonly conversation_id: string;
  readonly properties: Record<string, unknown>;
}
const wire = (value: unknown): WireMessage => value as WireMessage;

interface Harness {
  readonly deps: HandlerDeps;
  readonly store: ZineStore;
  readonly sent: unknown[];
  readonly applied: Panel[];
  readonly persistedPanels: Panel[];
  readonly appliedChecks: UnderstandingCheck[];
  readonly persistedChecks: UnderstandingCheck[];
  readonly speaking: boolean[];
  readonly utterances: Array<{ role: string; speech: string }>;
}

/**
 * The handler's effects are all injected, so the harness is the real zine store
 * (dispatch must be synchronous for the nudge to name the right panel) plus
 * recording fakes for everything that would touch the network.
 */
function harness(): Harness {
  const store = createZineStore();
  const sent: unknown[] = [];
  const applied: Panel[] = [];
  const persistedPanels: Panel[] = [];
  const appliedChecks: UnderstandingCheck[] = [];
  const persistedChecks: UnderstandingCheck[] = [];
  const speaking: boolean[] = [];
  const utterances: Array<{ role: string; speech: string }> = [];

  const sender: MessageSender = {
    sendAppMessage(data: unknown) {
      sent.push(data);
    },
  };

  const deps: HandlerDeps = {
    conversationId: CONVERSATION_ID,
    sender,
    applyPanel(panel) {
      applied.push(panel);
      store.dispatch({ type: "panel", panel });
    },
    applyCheck(check) {
      appliedChecks.push(check);
      store.dispatch({ type: "check", check });
    },
    persistPanel(panel) {
      persistedPanels.push(panel);
    },
    persistCheck(check) {
      persistedChecks.push(check);
    },
    nextUnfinishedPanel: () => nextUnfinishedPanel(store.getState()),
    setProfessorSpeaking(value) {
      speaking.push(value);
    },
    onUtterance(role, speech) {
      utterances.push({ role, speech });
    },
  };

  return {
    deps,
    store,
    sent,
    applied,
    persistedPanels,
    appliedChecks,
    persistedChecks,
    speaking,
    utterances,
  };
}

/** conversation.tool_call as Tavus delivers it over the data channel. */
const toolCall = (
  name: string,
  args: unknown,
  toolCallId = "toolu_01SPIKEVERIFIED",
): unknown => ({
  message_type: "conversation",
  event_type: "conversation.tool_call",
  conversation_id: CONVERSATION_ID,
  properties: { name, arguments: args, tool_call_id: toolCallId },
});

const utterance = (role: string, speech: string): unknown => ({
  message_type: "conversation",
  event_type: "conversation.utterance",
  conversation_id: CONVERSATION_ID,
  properties: { role, speech },
});

let h: Harness;
beforeEach(() => {
  h = harness();
});

describe("handleAppMessage — event whitelist", () => {
  it("handles exactly the three documented event types", () => {
    expect([...HANDLED_EVENT_TYPES].sort()).toEqual([
      "conversation.stopped_speaking",
      "conversation.tool_call",
      "conversation.utterance",
    ]);
  });

  it("ignores conversation.utterance.streaming, the per-token flood", () => {
    // ~40 of these per sentence; processing them froze a page for 60+ seconds.
    const outcome = handleAppMessage(
      {
        message_type: "conversation",
        event_type: "conversation.utterance.streaming",
        conversation_id: CONVERSATION_ID,
        properties: { role: "replica", speech: "Got" },
      },
      h.deps,
    );

    expect(outcome).toEqual({ kind: "ignored", eventType: "conversation.utterance.streaming" });
    expect(h.speaking).toEqual([]);
    expect(h.utterances).toEqual([]);
    expect(h.sent).toEqual([]);
  });

  it("ignores every other Tavus event without side effects", () => {
    const ignored = [
      "conversation.started_speaking",
      "conversation.replica.started_speaking",
      "conversation.echo",
      "conversation.tool_result",
      "system.replica_joined",
      "system.shutdown",
    ];

    for (const event_type of ignored) {
      const outcome = handleAppMessage(
        { message_type: "conversation", event_type, conversation_id: CONVERSATION_ID, properties: {} },
        h.deps,
      );
      expect(outcome).toEqual({ kind: "ignored", eventType: event_type });
    }

    expect(h.sent).toEqual([]);
    expect(h.applied).toEqual([]);
    expect(h.speaking).toEqual([]);
  });

  it("ignores payloads that are not objects or carry no event_type", () => {
    expect(handleAppMessage(null, h.deps)).toEqual({ kind: "ignored" });
    expect(handleAppMessage("conversation.tool_call", h.deps)).toEqual({ kind: "ignored" });
    expect(handleAppMessage({ properties: {} }, h.deps)).toEqual({ kind: "ignored" });
    expect(handleAppMessage({ event_type: 7 }, h.deps)).toEqual({ kind: "ignored" });
    expect(h.sent).toEqual([]);
  });

  it("stays fast across a full streaming flood", () => {
    // 4000 events is ~100 sentences of replica speech. The rejection must be a
    // Set lookup, not a parse — this is the case that froze the page.
    const flood = Array.from({ length: 4000 }, (_, i) => ({
      message_type: "conversation",
      event_type: "conversation.utterance.streaming",
      conversation_id: CONVERSATION_ID,
      properties: { role: "replica", speech: `chunk ${i}`, inference_id: "inf_1" },
    }));

    const started = performance.now();
    for (const event of flood) handleAppMessage(event, h.deps);
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(250);
    expect(h.sent).toEqual([]);
  });
});

describe("handleAppMessage — speaking state", () => {
  it("marks the professor speaking on a completed replica utterance", () => {
    const outcome = handleAppMessage(utterance("replica", "Got it, panel one is saved."), h.deps);

    expect(outcome).toEqual({ kind: "utterance", role: "replica" });
    expect(h.speaking).toEqual([true]);
    expect(h.utterances).toEqual([{ role: "replica", speech: "Got it, panel one is saved." }]);
  });

  it("does not mark the professor speaking on the student's own injected turn", () => {
    handleAppMessage(utterance("user", "base case stops the recursion"), h.deps);

    expect(h.speaking).toEqual([]);
    expect(h.utterances).toEqual([{ role: "user", speech: "base case stops the recursion" }]);
  });

  it("clears speaking on the replica's stopped_speaking, which is what reopens submit", () => {
    const outcome = handleAppMessage(
      {
        message_type: "conversation",
        event_type: "conversation.stopped_speaking",
        conversation_id: CONVERSATION_ID,
        properties: { role: "replica" },
      },
      h.deps,
    );

    expect(outcome).toEqual({ kind: "stopped-speaking" });
    expect(h.speaking).toEqual([false]);
  });

  it("does not clear speaking on the student's own stopped_speaking mid-professor-turn", () => {
    const outcome = handleAppMessage(
      {
        message_type: "conversation",
        event_type: "conversation.stopped_speaking",
        conversation_id: CONVERSATION_ID,
        properties: { role: "user" },
      },
      h.deps,
    );

    expect(outcome).toEqual({ kind: "stopped-speaking" });
    expect(h.speaking).toEqual([]);
  });
});

describe("handleAppMessage — log_zine_page", () => {
  it("renders, persists, and answers with the matching tool_call_id", () => {
    const outcome = handleAppMessage(
      toolCall(
        "log_zine_page",
        { panel_number: 1, text: "A base case stops the recursion.", visual_note: "two boxes", source: "student" },
        "toolu_01MATCHME",
      ),
      h.deps,
    );

    expect(outcome).toEqual({ kind: "panel-logged", panelNumber: 1, nextPanel: 2 });
    expect(h.applied).toEqual([
      {
        panelNumber: 1,
        text: "A base case stops the recursion.",
        visualNote: "two boxes",
        source: "student",
        mastery: "none",
      },
    ]);
    expect(h.persistedPanels).toEqual(h.applied);

    const result = wire(h.sent[0]);
    expect(result.event_type).toBe("conversation.tool_result");
    expect(result.conversation_id).toBe(CONVERSATION_ID);
    expect(result.properties).toEqual({
      tool_call_id: "toolu_01MATCHME",
      output: "panel 1 saved",
      status: "success",
    });
  });

  it("omits visualNote entirely when the professor sent none", () => {
    handleAppMessage(
      toolCall("log_zine_page", { panel_number: 2, text: "n-1 shrinks the input", source: "student" }),
      h.deps,
    );

    expect(h.applied[0]).not.toHaveProperty("visualNote");
  });

  it("accepts a stringified arguments blob, as some transports deliver it", () => {
    handleAppMessage(
      toolCall(
        "log_zine_page",
        JSON.stringify({ panel_number: 3, text: "recursive step", source: "student" }),
      ),
      h.deps,
    );

    expect(h.applied[0]?.panelNumber).toBe(3);
  });

  it("accepts a numeric string panel_number by coercion", () => {
    // isValidPanelNumber (lib/types.ts) coerces with Number() on purpose:
    // transports that stringify arguments must not lose a valid panel.
    handleAppMessage(
      toolCall("log_zine_page", { panel_number: "3", text: "recursive step", source: "student" }),
      h.deps,
    );

    expect(h.applied[0]?.panelNumber).toBe(3);
    expect(typeof h.applied[0]?.panelNumber).toBe("number");
  });

  const badPanelNumbers: ReadonlyArray<readonly [string, unknown]> = [
    ["0, below the sheet", 0],
    ["9, past the sheet", 9],
    ["a non-numeric string", "three"],
    ["a fraction", 3.5],
    ["null", null],
    ["missing", undefined],
  ];

  for (const [label, panel_number] of badPanelNumbers) {
    it(`rejects panel_number ${label} without rendering or writing`, () => {
      const outcome = handleAppMessage(
        toolCall("log_zine_page", { panel_number, text: "something", source: "student" }, "toolu_BAD"),
        h.deps,
      );

      expect(outcome).toEqual({
        kind: "rejected",
        tool: "log_zine_page",
        reason: "panel_number must be an integer from 1 to 8",
      });
      expect(h.applied).toEqual([]);
      expect(h.persistedPanels).toEqual([]);

      const result = wire(h.sent[0]);
      expect(result.event_type).toBe("conversation.tool_result");
      expect(result.properties.status).toBe("error");
      expect(result.properties.tool_call_id).toBe("toolu_BAD");
      // Nothing else goes out — in particular no state nudge.
      expect(h.sent).toHaveLength(1);
    });
  }

  it("rejects empty or whitespace-only text without rendering or writing", () => {
    for (const text of ["", "   \n ", undefined]) {
      const local = harness();
      const outcome = handleAppMessage(
        toolCall("log_zine_page", { panel_number: 1, text, source: "student" }),
        local.deps,
      );

      expect(outcome).toEqual({
        kind: "rejected",
        tool: "log_zine_page",
        reason: "text must be a non-empty string",
      });
      expect(local.applied).toEqual([]);
      expect(wire(local.sent[0]).properties.status).toBe("error");
    }
  });

  it("rejects a source outside the prefill/student enum", () => {
    for (const source of ["teacher", "", undefined, 1]) {
      const local = harness();
      const outcome = handleAppMessage(
        toolCall("log_zine_page", { panel_number: 1, text: "something", source }),
        local.deps,
      );

      expect(outcome).toEqual({
        kind: "rejected",
        tool: "log_zine_page",
        reason: 'source must be "prefill" or "student"',
      });
      expect(local.applied).toEqual([]);
      expect(wire(local.sent[0]).properties.status).toBe("error");
    }
  });

  it("rejects an unknown tool name", () => {
    const outcome = handleAppMessage(toolCall("log_something_else", { panel_number: 1 }), h.deps);

    expect(outcome).toEqual({
      kind: "rejected",
      tool: "log_something_else",
      reason: "unknown tool log_something_else",
    });
    expect(wire(h.sent[0]).properties.status).toBe("error");
  });

  it("upserts a re-confirmed panel rather than duplicating it in the zine", () => {
    handleAppMessage(
      toolCall("log_zine_page", { panel_number: 1, text: "first wording", source: "student" }),
      h.deps,
    );
    handleAppMessage(
      toolCall("log_zine_page", { panel_number: 1, text: "polished wording", source: "student" }),
      h.deps,
    );

    const panels = h.store.getState().panels;
    expect(Object.keys(panels)).toEqual(["1"]);
    expect(panels[1]?.text).toBe("polished wording");
  });
});

describe("handleAppMessage — state nudge", () => {
  it("names the next panel computed after the reducer applied, not before", () => {
    // Logging panel 1 into an empty zine must nudge to 2. Reading the store
    // before dispatch would say 1 and send the professor back round the loop.
    const outcome = handleAppMessage(
      toolCall("log_zine_page", { panel_number: 1, text: "base case", source: "student" }),
      h.deps,
    );

    expect(outcome).toEqual({ kind: "panel-logged", panelNumber: 1, nextPanel: 2 });

    const nudge = wire(h.sent[1]);
    expect(nudge.event_type).toBe("conversation.respond");
    expect(nudge.properties).toEqual({
      text: "Panel 1 saved. The next unfinished panel is 2.",
    });
  });

  it("skips over prefilled panels when naming the next one", () => {
    // Demo default: panels 1-4 prefilled at join, student confirms 5.
    for (const n of [1, 2, 3, 4]) {
      handleAppMessage(
        toolCall("log_zine_page", { panel_number: n, text: `worked example ${n}`, source: "prefill" }),
        h.deps,
      );
    }
    h.sent.length = 0;

    const outcome = handleAppMessage(
      toolCall("log_zine_page", { panel_number: 5, text: "student panel", source: "student" }),
      h.deps,
    );

    expect(outcome).toEqual({ kind: "panel-logged", panelNumber: 5, nextPanel: 6 });
    expect(wire(h.sent[1]).properties).toEqual({
      text: "Panel 5 saved. The next unfinished panel is 6.",
    });
  });

  it("names the lowest gap when panels were filled out of order", () => {
    for (const n of [1, 3, 4]) {
      handleAppMessage(
        toolCall("log_zine_page", { panel_number: n, text: `panel ${n}`, source: "prefill" }),
        h.deps,
      );
    }
    h.sent.length = 0;

    const outcome = handleAppMessage(
      toolCall("log_zine_page", { panel_number: 5, text: "panel 5", source: "student" }),
      h.deps,
    );

    expect(outcome).toEqual({ kind: "panel-logged", panelNumber: 5, nextPanel: 2 });
  });

  it("tells the professor the sheet is complete on the final panel", () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7]) {
      handleAppMessage(
        toolCall("log_zine_page", { panel_number: n, text: `panel ${n}`, source: "prefill" }),
        h.deps,
      );
    }
    h.sent.length = 0;

    const outcome = handleAppMessage(
      toolCall("log_zine_page", { panel_number: 8, text: "panel 8", source: "student" }),
      h.deps,
    );

    expect(outcome).toEqual({ kind: "panel-logged", panelNumber: 8, nextPanel: null });
    expect(wire(h.sent[1]).properties).toEqual({
      text: "Panel 8 saved. Every panel is filled now.",
    });
  });

  it("sends the tool_result before the nudge", () => {
    handleAppMessage(
      toolCall("log_zine_page", { panel_number: 1, text: "base case", source: "student" }),
      h.deps,
    );

    expect(h.sent).toHaveLength(2);
    expect(wire(h.sent[0]).event_type).toBe("conversation.tool_result");
    expect(wire(h.sent[1]).event_type).toBe("conversation.respond");
  });
});

describe("handleAppMessage — log_understanding_check", () => {
  it("applies, persists, and acknowledges a valid check", () => {
    const outcome = handleAppMessage(
      toolCall("log_understanding_check", { panel_number: 2, level: "solid", attempt: 1 }, "toolu_CHK"),
      h.deps,
    );

    expect(outcome).toEqual({ kind: "check-logged", panelNumber: 2 });
    expect(h.appliedChecks).toEqual([{ panelNumber: 2, level: "solid", attempt: 1 }]);
    expect(h.persistedChecks).toEqual(h.appliedChecks);
    expect(wire(h.sent[0]).properties).toEqual({
      tool_call_id: "toolu_CHK",
      output: "understanding for panel 2 recorded as solid",
      status: "success",
    });
  });

  it("stamps the panel gold when the check lands before the panel is logged", () => {
    handleAppMessage(
      toolCall("log_understanding_check", { panel_number: 5, level: "solid", attempt: 1 }),
      h.deps,
    );
    handleAppMessage(
      toolCall("log_zine_page", { panel_number: 5, text: "student panel", source: "student" }),
      h.deps,
    );

    expect(h.store.getState().panels[5]?.mastery).toBe("first-try");
  });

  it("rejects a level outside the confused/shaky/solid enum", () => {
    for (const level of ["nearly", "SOLID", "", undefined]) {
      const local = harness();
      const outcome = handleAppMessage(
        toolCall("log_understanding_check", { panel_number: 1, level, attempt: 1 }),
        local.deps,
      );

      expect(outcome).toEqual({
        kind: "rejected",
        tool: "log_understanding_check",
        reason: 'level must be "confused", "shaky", or "solid"',
      });
      expect(local.appliedChecks).toEqual([]);
      expect(local.persistedChecks).toEqual([]);
      expect(wire(local.sent[0]).properties.status).toBe("error");
    }
  });

  it("rejects an attempt outside the single-retry range", () => {
    // The objective graph allows exactly one retry, so 3 is a model hallucination.
    for (const attempt of [0, 3, 1.5, "two", undefined]) {
      const local = harness();
      const outcome = handleAppMessage(
        toolCall("log_understanding_check", { panel_number: 1, level: "solid", attempt }),
        local.deps,
      );

      expect(outcome).toEqual({
        kind: "rejected",
        tool: "log_understanding_check",
        reason: "attempt must be 1 or 2",
      });
      expect(local.appliedChecks).toEqual([]);
      expect(wire(local.sent[0]).properties.status).toBe("error");
    }
  });

  it("rejects a bad panel_number before looking at the level", () => {
    const outcome = handleAppMessage(
      toolCall("log_understanding_check", { panel_number: 12, level: "solid", attempt: 1 }),
      h.deps,
    );

    expect(outcome).toEqual({
      kind: "rejected",
      tool: "log_understanding_check",
      reason: "panel_number must be an integer from 1 to 8",
    });
    expect(h.appliedChecks).toEqual([]);
  });
});

describe("createAppMessageHandler", () => {
  it("unwraps the Daily event payload and ignores an event with no data", () => {
    const listener = createAppMessageHandler(h.deps);

    const outcome = listener({
      data: toolCall("log_zine_page", { panel_number: 1, text: "base case", source: "student" }),
    });

    expect(outcome).toEqual({ kind: "panel-logged", panelNumber: 1, nextPanel: 2 });
    expect(listener({ data: undefined })).toEqual({ kind: "ignored" });
    expect(listener({})).toEqual({ kind: "ignored" });
  });

  it("survives a missing sender, so a tool call before join does not throw", () => {
    const offline: HandlerDeps = { ...h.deps, sender: null };

    const outcome = handleAppMessage(
      toolCall("log_zine_page", { panel_number: 1, text: "base case", source: "student" }),
      offline,
    );

    expect(outcome).toEqual({ kind: "panel-logged", panelNumber: 1, nextPanel: 2 });
    expect(h.sent).toEqual([]);
  });
});
