/**
 * Seam 5 — client app-message handler. Replaces the server webhook entirely.
 *
 * WHITELIST IS LOAD-BEARING, NOT DEFENSIVE STYLE. Tavus streams
 * `conversation.utterance.streaming` once per token — roughly 40 events per
 * sentence. A handler that processed everything froze a page for 60+ seconds
 * in spike testing. Anything not in HANDLED_EVENT_TYPES returns before a single
 * property is read.
 *
 * Pure module: every effect arrives as a dependency, so this is unit-testable
 * against captured spike payloads with a fake sender.
 */

import {
  type MessageSender,
  injectPanelSavedNudge,
  sendToolResult,
} from "./bridge";
import {
  isValidPanelNumber,
  type Panel,
  type PanelSource,
  type ToolCallEvent,
  type UnderstandingCheck,
  type UnderstandingLevel,
} from "./types";

/**
 * The only three events we act on.
 * Deliberately ignored: `conversation.utterance.streaming` (per-token flood),
 * `conversation.started_speaking`, `conversation.replica.*`, `system.*`,
 * `conversation.echo`, and every other Tavus event.
 */
export const HANDLED_EVENT_TYPES: ReadonlySet<string> = new Set([
  "conversation.utterance",
  "conversation.tool_call",
  "conversation.stopped_speaking",
]);

export interface HandlerDeps {
  conversationId: string;
  sender: MessageSender | null;
  /** Apply a validated panel to zine state. Must be synchronous. */
  applyPanel(panel: Panel): void;
  /** Apply a validated understanding check to zine state. Must be synchronous. */
  applyCheck(check: UnderstandingCheck): void;
  /** Persist to Supabase. Fire-and-forget; rendering never waits on the network. */
  persistPanel(panel: Panel): void;
  persistCheck(check: UnderstandingCheck): void;
  /** Read AFTER applyPanel so the state nudge names the right panel. */
  nextUnfinishedPanel(): number | null;
  setProfessorSpeaking(speaking: boolean): void;
  onUtterance?(role: string, speech: string): void;
  /**
   * Raw audit trail of every tool_call, success or rejected — per
   * docs.tavus.io/sections/onboarding-guide/tool-calling-examples's
   * observability guidance. Optional so existing test doubles don't need it.
   */
  logToolCall?(event: ToolCallEvent): void;
}

export type HandlerOutcome =
  | { kind: "ignored"; eventType?: string }
  | { kind: "utterance"; role: string }
  | { kind: "stopped-speaking" }
  | { kind: "panel-logged"; panelNumber: number; nextPanel: number | null }
  | { kind: "check-logged"; panelNumber: number }
  | { kind: "rejected"; tool: string; reason: string };

// --- narrowing helpers -----------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Tavus sends `arguments` as an object; some transports stringify it. */
function toolArguments(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (isRecord(parsed)) return parsed;
    } catch {
      return {};
    }
  }
  return {};
}

function asSource(value: unknown): PanelSource | null {
  return value === "prefill" || value === "student" ? value : null;
}

function asLevel(value: unknown): UnderstandingLevel | null {
  return value === "confused" || value === "shaky" || value === "solid" ? value : null;
}

/** attempt is 1 or 2 — the objective graph allows exactly one retry. */
function asAttempt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 2 ? n : null;
}

// --- handler ---------------------------------------------------------------

/**
 * @param raw the `data` payload of a Daily `app-message` event.
 */
export function handleAppMessage(raw: unknown, deps: HandlerDeps): HandlerOutcome {
  if (!isRecord(raw)) return { kind: "ignored" };

  const eventType = raw.event_type;
  // Cheapest possible rejection. Nothing below runs for the streaming flood.
  if (typeof eventType !== "string" || !HANDLED_EVENT_TYPES.has(eventType)) {
    return { kind: "ignored", eventType: typeof eventType === "string" ? eventType : undefined };
  }

  const properties = isRecord(raw.properties) ? raw.properties : {};

  if (eventType === "conversation.stopped_speaking") {
    const role = asString(properties.role);
    if (role === "replica" || role === "pal") deps.setProfessorSpeaking(false);
    return { kind: "stopped-speaking" };
  }

  if (eventType === "conversation.utterance") {
    const role = asString(properties.role);
    const speech = asString(properties.speech) || asString(properties.text);
    // The professor holding the floor is what gates the submit button. We never
    // handle started_speaking, so a completed replica turn is the signal.
    if (role === "replica" || role === "pal") deps.setProfessorSpeaking(true);
    deps.onUtterance?.(role, speech);
    return { kind: "utterance", role };
  }

  // --- conversation.tool_call ---------------------------------------------
  const toolName = asString(properties.name);
  const toolCallId = asString(properties.tool_call_id);
  const args = toolArguments(properties.arguments);

  const reject = (reason: string): HandlerOutcome => {
    sendToolResult(deps.sender, deps.conversationId, toolCallId, reason, "error");
    deps.logToolCall?.({ toolName, toolCallId, args, status: "rejected", reason });
    return { kind: "rejected", tool: toolName, reason };
  };

  if (toolName === "log_zine_page") {
    const panelNumber = Number(args.panel_number);
    const text = asString(args.text).trim();
    const source = asSource(args.source);
    const visualNote = asString(args.visual_note).trim();

    if (!isValidPanelNumber(panelNumber)) return reject("panel_number must be an integer from 1 to 8");
    if (!text) return reject("text must be a non-empty string");
    if (!source) return reject('source must be "prefill" or "student"');

    const panel: Panel = {
      panelNumber,
      text,
      ...(visualNote ? { visualNote } : {}),
      source,
      // The reducer owns mastery: it holds the understanding check for this panel.
      mastery: "none",
    };

    deps.applyPanel(panel);
    deps.persistPanel(panel);
    deps.logToolCall?.({ toolName, toolCallId, args, status: "ok" });
    sendToolResult(deps.sender, deps.conversationId, toolCallId, `panel ${panelNumber} saved`);

    // Fallback path (unverified tool_result round trip): state the new truth as
    // a user turn, which IS verified to reach the model.
    const nextPanel = deps.nextUnfinishedPanel();
    injectPanelSavedNudge(deps.sender, deps.conversationId, panelNumber, nextPanel);

    return { kind: "panel-logged", panelNumber, nextPanel };
  }

  if (toolName === "log_understanding_check") {
    const panelNumber = Number(args.panel_number);
    const level = asLevel(args.level);
    const attempt = asAttempt(args.attempt);

    if (!isValidPanelNumber(panelNumber)) return reject("panel_number must be an integer from 1 to 8");
    if (!level) return reject('level must be "confused", "shaky", or "solid"');
    if (attempt === null) return reject("attempt must be 1 or 2");

    const check: UnderstandingCheck = { panelNumber, level, attempt };
    deps.applyCheck(check);
    deps.persistCheck(check);
    deps.logToolCall?.({ toolName, toolCallId, args, status: "ok" });
    sendToolResult(
      deps.sender,
      deps.conversationId,
      toolCallId,
      `understanding for panel ${panelNumber} recorded as ${level}`,
    );
    return { kind: "check-logged", panelNumber };
  }

  return reject(`unknown tool ${toolName || "(unnamed)"}`);
}

/**
 * Bind the handler to its dependencies once, so the Daily listener is a stable
 * function reference and the hot path is a Set lookup.
 */
export function createAppMessageHandler(deps: HandlerDeps) {
  return (event: { data?: unknown }): HandlerOutcome =>
    handleAppMessage(event?.data, deps);
}
