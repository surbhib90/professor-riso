/**
 * Shared contract between the conversation surface (bridge, handler, zine)
 * and the data surface (Supabase, auth, prefill). Both build lanes import
 * from here; neither redefines these shapes locally.
 */

export const PANEL_COUNT = 8;

export type PanelSource = "prefill" | "student";
export type UnderstandingLevel = "confused" | "shaky" | "solid";

/** Gold = solid first try, silver = solid after the one retry, none = prefill. */
export type Mastery = "first-try" | "after-retry" | "none";

export interface Panel {
  panelNumber: number;
  text: string;
  visualNote?: string;
  source: PanelSource;
  mastery: Mastery;
}

export interface UnderstandingCheck {
  panelNumber: number;
  level: UnderstandingLevel;
  attempt: number;
}

/**
 * Raw audit record of one conversation.tool_call event, success or rejected.
 * Separate from Panel/UnderstandingCheck, which only ever hold validated,
 * applied writes — this is what answers "did the model even try to call
 * this tool" during debugging.
 */
export interface ToolCallEvent {
  toolName: string;
  toolCallId: string;
  args: Record<string, unknown>;
  status: "ok" | "rejected";
  reason?: string;
}

/** Everything the client needs to act as the state authority for a session. */
export interface SessionContext {
  conversationId: string;
  studentId: string;
  classId: string;
  concept: string;
  /** Panel numbers filled as worked examples before the student joined. */
  prefilledPanels: number[];
}

export function masteryFrom(check: UnderstandingCheck): Mastery {
  if (check.level !== "solid") return "none";
  return check.attempt <= 1 ? "first-try" : "after-retry";
}

export function isValidPanelNumber(v: unknown): v is number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= PANEL_COUNT;
}
