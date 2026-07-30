import { afterEach, describe, expect, it, vi } from "vitest";

import {
  capNotes,
  injectPanelSavedNudge,
  injectWrapUp,
  NOTES_CHAR_CAP,
  panelSavedNudge,
  sendConversationRespond,
  sendToolResult,
  submitBlock,
  submitBlockMessage,
  submitNotes,
  WRAP_UP_TEXT,
  type MessageSender,
  type SubmitGate,
} from "@/lib/bridge";

const CONVERSATION_ID = "c1a2b3c4d5";

/** Wire shape verified live in spike/headless-test.py and t1-toolcall-test.py. */
interface WireMessage {
  readonly message_type: string;
  readonly event_type: string;
  readonly conversation_id: string;
  readonly properties: Record<string, unknown>;
}
const wire = (value: unknown): WireMessage => value as WireMessage;

interface FakeSender extends MessageSender {
  readonly sent: unknown[];
  readonly targets: Array<string | undefined>;
}

function fakeSender(): FakeSender {
  const sent: unknown[] = [];
  const targets: Array<string | undefined> = [];
  return {
    sent,
    targets,
    sendAppMessage(data: unknown, to?: string) {
      sent.push(data);
      targets.push(to);
    },
  };
}

/** A gate in the only state where a submit is allowed through. */
const openGate = (overrides: Partial<SubmitGate> = {}): SubmitGate => ({
  connected: true,
  professorSpeaking: false,
  inFlight: false,
  ...overrides,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("submit discipline", () => {
  it("blocks an empty summary — a sketch with nothing in it is not a turn", () => {
    const sender = fakeSender();

    const result = submitNotes(sender, CONVERSATION_ID, "   \n  ", openGate());

    expect(result).toEqual({ ok: false, block: "empty" });
    expect(sender.sent).toEqual([]);
    expect(submitBlockMessage("empty")).toBe("Write or sketch something first, then send it.");
  });

  it("blocks while the professor is speaking — injecting mid-utterance interleaves turns", () => {
    const sender = fakeSender();

    const result = submitNotes(
      sender,
      CONVERSATION_ID,
      "base case stops the recursion",
      openGate({ professorSpeaking: true }),
    );

    expect(result).toEqual({ ok: false, block: "professor-speaking" });
    expect(sender.sent).toEqual([]);
  });

  it("blocks while a submission is already in flight — a double click is two user turns", () => {
    const sender = fakeSender();

    const result = submitNotes(
      sender,
      CONVERSATION_ID,
      "base case stops the recursion",
      openGate({ inFlight: true }),
    );

    expect(result).toEqual({ ok: false, block: "in-flight" });
    expect(sender.sent).toEqual([]);
  });

  it("blocks before the call has joined", () => {
    const sender = fakeSender();

    const result = submitNotes(
      sender,
      CONVERSATION_ID,
      "base case stops the recursion",
      openGate({ connected: false }),
    );

    expect(result).toEqual({ ok: false, block: "no-call" });
    expect(sender.sent).toEqual([]);
  });

  it("reports the emptiness the student can act on before the connection state", () => {
    expect(submitBlock("", openGate({ connected: false }))).toBe("empty");
  });

  it("has student-facing copy for every block reason", () => {
    for (const block of ["empty", "no-call", "professor-speaking", "in-flight"] as const) {
      expect(submitBlockMessage(block).length).toBeGreaterThan(0);
    }
  });

  it("lets a real submission through when nothing blocks it", () => {
    const sender = fakeSender();

    const result = submitNotes(
      sender,
      CONVERSATION_ID,
      "  base case stops the recursion  ",
      openGate(),
    );

    expect(result).toEqual({ ok: true, sent: "base case stops the recursion" });
    expect(sender.sent).toHaveLength(1);
  });

  it("reports no-call when the send itself throws rather than claiming success", () => {
    // A Daily call object that has left throws from sendAppMessage.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken: MessageSender = {
      sendAppMessage() {
        throw new Error("call object destroyed");
      },
    };

    const result = submitNotes(broken, CONVERSATION_ID, "base case", openGate());

    expect(result).toEqual({ ok: false, block: "no-call" });
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe("capNotes", () => {
  it("leaves notes under the cap untouched apart from trimming", () => {
    expect(capNotes("  base case  ")).toBe("base case");
    expect(NOTES_CHAR_CAP).toBe(1500);
  });

  it("caps a serialized scene at the documented limit", () => {
    const long = "recursion ".repeat(400); // 4000 chars

    const capped = capNotes(long);

    expect(capped.length).toBeLessThanOrEqual(NOTES_CHAR_CAP);
    expect(long.startsWith(capped)).toBe(true);
  });

  it("cuts on a word boundary so the professor never hears half a word", () => {
    const long = `${"recursion ".repeat(400)}end`;

    const capped = capNotes(long);

    expect(capped.endsWith("recursion")).toBe(true);
  });

  it("hard-cuts a single unbroken blob rather than sending nothing", () => {
    const blob = "x".repeat(3000);

    expect(capNotes(blob)).toHaveLength(NOTES_CHAR_CAP);
  });

  it("caps what actually goes on the wire, not just the return value", () => {
    const sender = fakeSender();

    const result = submitNotes(sender, CONVERSATION_ID, "recursion ".repeat(400), openGate());

    expect(result.ok).toBe(true);
    const text = wire(sender.sent[0]).properties.text;
    expect(typeof text).toBe("string");
    expect(String(text).length).toBeLessThanOrEqual(NOTES_CHAR_CAP);
  });

  it("honours an explicit cap", () => {
    expect(capNotes("one two three four", 7)).toBe("one two");
  });
});

describe("conversation.respond wire format", () => {
  it("emits exactly the envelope verified against live Tavus", () => {
    const sender = fakeSender();

    submitNotes(sender, CONVERSATION_ID, "base case stops the recursion", openGate());

    expect(sender.sent[0]).toEqual({
      message_type: "conversation",
      event_type: "conversation.respond",
      conversation_id: CONVERSATION_ID,
      properties: { text: "base case stops the recursion" },
    });
    // Daily broadcasts to every participant; the Tavus ingest listens on "*".
    expect(sender.targets[0]).toBe("*");
  });

  it("refuses to send an empty respond even when called directly", () => {
    const sender = fakeSender();

    expect(sendConversationRespond(sender, CONVERSATION_ID, "  ")).toBe(false);
    expect(sender.sent).toEqual([]);
  });

  it("reports failure instead of throwing when there is no call object", () => {
    expect(sendConversationRespond(null, CONVERSATION_ID, "base case")).toBe(false);
    expect(sendConversationRespond(undefined, CONVERSATION_ID, "base case")).toBe(false);
  });
});

describe("conversation.tool_result wire format", () => {
  it("answers with the matching tool_call_id and a success status", () => {
    const sender = fakeSender();

    expect(sendToolResult(sender, CONVERSATION_ID, "toolu_01MATCHME", "panel 1 saved")).toBe(true);
    expect(sender.sent[0]).toEqual({
      message_type: "conversation",
      event_type: "conversation.tool_result",
      conversation_id: CONVERSATION_ID,
      properties: {
        tool_call_id: "toolu_01MATCHME",
        output: "panel 1 saved",
        status: "success",
      },
    });
  });

  it("carries an error status when the arguments were rejected", () => {
    const sender = fakeSender();

    sendToolResult(sender, CONVERSATION_ID, "toolu_BAD", "invalid arguments", "error");

    expect(wire(sender.sent[0]).properties.status).toBe("error");
  });

  it("sends nothing when there is no tool_call_id to match", () => {
    const sender = fakeSender();

    expect(sendToolResult(sender, CONVERSATION_ID, "", "panel 1 saved")).toBe(false);
    expect(sender.sent).toEqual([]);
  });
});

describe("state nudges", () => {
  it("states the saved panel and the next one to work on, for a student-authored panel", () => {
    expect(panelSavedNudge(1, 2, "student")).toBe("Panel 1 saved. The next unfinished panel is 2.");
  });

  it("states completion when no panel is left", () => {
    expect(panelSavedNudge(8, null, "student")).toBe("Panel 8 saved. Every panel is filled now.");
  });

  it("reinforces staying silent for a prefill panel, instead of prompting engagement", () => {
    const nudge = panelSavedNudge(1, 2, "prefill");
    expect(nudge).toContain("logged silently");
    expect(nudge).toContain("continue silently");
    expect(nudge).not.toContain("The next unfinished panel is");
  });

  it("still states plain completion for the last prefill panel, source does not matter once nextPanel is null", () => {
    expect(panelSavedNudge(4, null, "prefill")).toBe("Panel 4 saved. Every panel is filled now.");
  });

  it("injects the nudge as a user turn, the only path verified to reach the model", () => {
    const sender = fakeSender();

    expect(injectPanelSavedNudge(sender, CONVERSATION_ID, 5, 6, "student")).toBe(true);
    expect(sender.sent[0]).toEqual({
      message_type: "conversation",
      event_type: "conversation.respond",
      conversation_id: CONVERSATION_ID,
      properties: { text: "Panel 5 saved. The next unfinished panel is 6." },
    });
  });

  it("injects the wrap-up as a respond, since max_call_duration warns nobody", () => {
    const sender = fakeSender();

    expect(injectWrapUp(sender, CONVERSATION_ID)).toBe(true);
    expect(wire(sender.sent[0]).properties).toEqual({ text: WRAP_UP_TEXT });
  });
});
