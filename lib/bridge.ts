/**
 * The notes-to-conversation bridge — the one genuinely custom piece.
 *
 * Mechanism verified live 2026-07-27 (spike/headless-test.py): a
 * `conversation.respond` app-message sent over the Daily data channel is
 * ingested by Tavus as a real user turn and drives Objectives running with
 * `confirmation_mode: auto`. `conversation.tool_result` uses the same envelope
 * (spike/t1-toolcall-test.py).
 *
 * This module owns the wire format and the submit discipline. No React, no DOM.
 */

/**
 * The only capability we need from Daily's call object. Narrow on purpose:
 * `DailyCall` satisfies it structurally, and a fake satisfies it in tests.
 */
export interface MessageSender {
  sendAppMessage(data: unknown, to?: string): unknown;
}

/** Blob limits are unstated in Tavus docs; cap before we find the edge live. */
export const NOTES_CHAR_CAP = 1500;

const MESSAGE_TYPE = "conversation";

function send(sender: MessageSender | null | undefined, payload: unknown): boolean {
  if (!sender) return false;
  try {
    sender.sendAppMessage(payload, "*");
    return true;
  } catch (err) {
    console.error("[bridge] sendAppMessage failed", err);
    return false;
  }
}

/** Inject text into the live conversation as if the student had spoken it. */
export function sendConversationRespond(
  sender: MessageSender | null | undefined,
  conversationId: string,
  text: string,
): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return send(sender, {
    message_type: MESSAGE_TYPE,
    event_type: "conversation.respond",
    conversation_id: conversationId,
    properties: { text: trimmed },
  });
}

/** Answer a `conversation.tool_call` with the matching tool_call_id. */
export function sendToolResult(
  sender: MessageSender | null | undefined,
  conversationId: string,
  toolCallId: string,
  output: string,
  status: "success" | "error" = "success",
): boolean {
  if (!toolCallId) return false;
  return send(sender, {
    message_type: MESSAGE_TYPE,
    event_type: "conversation.tool_result",
    conversation_id: conversationId,
    properties: { tool_call_id: toolCallId, output, status },
  });
}

// --- submit discipline -----------------------------------------------------

export type SubmitBlock = "no-call" | "empty" | "professor-speaking" | "in-flight";

export interface SubmitGate {
  /** True once the call object exists and has joined. */
  connected: boolean;
  /** Tracked from conversation.utterance / conversation.stopped_speaking. */
  professorSpeaking: boolean;
  /** True between send and the professor's next turn. */
  inFlight: boolean;
}

/**
 * Why a submit cannot go out right now, or null if it can.
 * Order matters: report the thing the student can act on first.
 */
export function submitBlock(summary: string, gate: SubmitGate): SubmitBlock | null {
  if (!summary.trim()) return "empty";
  if (!gate.connected) return "no-call";
  if (gate.professorSpeaking) return "professor-speaking";
  if (gate.inFlight) return "in-flight";
  return null;
}

/** Student-facing copy: what went wrong and what to do about it. */
export function submitBlockMessage(block: SubmitBlock): string {
  switch (block) {
    case "empty":
      return "Write or sketch something first, then send it.";
    case "no-call":
      return "You are not connected yet. Wait for the call to start.";
    case "professor-speaking":
      return "Professor Riso is talking. Send as soon as they stop.";
    case "in-flight":
      return "Your last notes are still going through.";
  }
}

/** Trim to the cap on a word boundary so the professor never gets a half word. */
export function capNotes(text: string, cap: number = NOTES_CHAR_CAP): string {
  const trimmed = text.trim();
  if (trimmed.length <= cap) return trimmed;
  const slice = trimmed.slice(0, cap);
  const lastBreak = Math.max(slice.lastIndexOf(" "), slice.lastIndexOf("\n"));
  return (lastBreak > cap * 0.6 ? slice.slice(0, lastBreak) : slice).trim();
}

export type SubmitResult =
  | { ok: true; sent: string }
  | { ok: false; block: SubmitBlock };

/**
 * The submit button's whole contract: gate, cap, send. Callers set `inFlight`
 * around this call — a double click must not become two user turns.
 */
export function submitNotes(
  sender: MessageSender | null | undefined,
  conversationId: string,
  summary: string,
  gate: SubmitGate,
): SubmitResult {
  const block = submitBlock(summary, gate);
  if (block) return { ok: false, block };

  const text = capNotes(summary);
  if (!sendConversationRespond(sender, conversationId, text)) {
    return { ok: false, block: "no-call" };
  }
  return { ok: true, sent: text };
}

// --- state nudges ----------------------------------------------------------

/**
 * Documented fallback for the unverified tool_result round trip.
 *
 * The spike could not confirm that `conversation.tool_result` reaches the model
 * (the Daily join failed on transport, so we have evidence neither way).
 * `conversation.respond` IS verified. So after every accepted tool call the
 * client also states the new truth out loud as a user turn: the client stays
 * the state authority whether or not tool_result lands.
 */
/**
 * Wording depends on the panel's source: a "prefill" save happens mid-silent-
 * sequence, and the plain "next unfinished panel is N" phrasing reads as "go
 * engage the student on N" — observed live pulling the model out of the
 * prefillChain and into interactive mode after just one prefilled panel,
 * regardless of what the objective_prompt said. A "student" save is already
 * mid-interactive-conversation, where that phrasing is exactly right.
 */
export function panelSavedNudge(
  panelNumber: number,
  nextPanel: number | null,
  source: "prefill" | "student",
): string {
  if (nextPanel === null) {
    return `Panel ${panelNumber} saved. Every panel is filled now.`;
  }
  if (source === "prefill") {
    return `Panel ${panelNumber} logged silently. If panel ${nextPanel} is also meant to be pre-filled per the difficulty pick, continue silently — do not speak or engage the student yet. Otherwise begin the interactive panel ${nextPanel} with the student now.`;
  }
  return `Panel ${panelNumber} saved. The next unfinished panel is ${nextPanel}.`;
}

export function injectPanelSavedNudge(
  sender: MessageSender | null | undefined,
  conversationId: string,
  panelNumber: number,
  nextPanel: number | null,
  source: "prefill" | "student",
): boolean {
  return sendConversationRespond(
    sender,
    conversationId,
    panelSavedNudge(panelNumber, nextPanel, source),
  );
}

/**
 * `max_call_duration` kills the call with no warning to the agent, so the
 * client owns the wrap-up (ARCHITECTURE Seam 5, D10).
 */
export const WRAP_UP_TEXT =
  "Two minutes remain. Wrap up and briefly fill any remaining panels yourself.";

export function injectWrapUp(
  sender: MessageSender | null | undefined,
  conversationId: string,
): boolean {
  return sendConversationRespond(sender, conversationId, WRAP_UP_TEXT);
}
