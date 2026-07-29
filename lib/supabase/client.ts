import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Panel, SessionContext, ToolCallEvent, UnderstandingCheck } from "@/lib/types";
import { isValidPanelNumber } from "@/lib/types";

/**
 * Browser-side Supabase: the client factory, plus the four writes/reads the
 * conversation surface makes. Everything here runs as the signed-in student,
 * so RLS — not this file — is what stops a student writing as someone else.
 *
 * Every function throws on failure. Callers decide whether a failed write is
 * worth interrupting a live session over (it isn't; see the data adapter).
 */

/**
 * Sessions live in cookies (not localStorage) so the server components in
 * /class read the same session without a second round trip.
 *
 * The two env reads must stay written out literally — Next inlines
 * `process.env.NEXT_PUBLIC_*` at build time only when it can see the whole
 * expression, so indexing a variable key silently yields undefined in prod.
 */
function readEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local, then restart the dev server.",
    );
  }
  return { url, anonKey };
}

/**
 * `createBrowserClient` is a singleton by default, so calling this per render
 * is cheap and every caller shares one auth state — the anonymous sign-in
 * fired on /session is already live when /conversation mounts.
 */
export function createClient(): SupabaseClient {
  const { url, anonKey } = readEnv();
  return createBrowserClient(url, anonKey);
}

/**
 * The current student's `auth.uid()`, which every RLS policy compares against.
 *
 * Falls back to signing in anonymously (D14) when there is no session at all —
 * someone opening /conversation in a fresh browser should get a working
 * session rather than a page whose every write is silently rejected.
 */
export async function getStudentId(): Promise<string | null> {
  const supabase = createClient();

  const { data: existing } = await supabase.auth.getSession();
  if (existing.session) return existing.session.user.id;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    throw new Error(`Could not start a guest session: ${error.message}`);
  }
  return data.user?.id ?? null;
}

interface PanelRow {
  panel_number: number;
  text: string;
  visual_note: string | null;
  source: string;
  mastery: string;
}

function toPanel(row: PanelRow): Panel {
  return {
    panelNumber: row.panel_number,
    text: row.text,
    visualNote: row.visual_note ?? undefined,
    // Widened on the way out of Postgres; the CHECK constraints in
    // schema.sql are what actually keep these in range.
    source: row.source === "prefill" ? "prefill" : "student",
    mastery:
      row.mastery === "first-try" || row.mastery === "after-retry"
        ? row.mastery
        : "none",
  };
}

/**
 * Rehydrate on mount. Daily never replays app-messages, so without this a
 * mid-session refresh blanks a zine the student already earned.
 */
export async function loadPanelsForSession(
  conversationId: string,
): Promise<Panel[]> {
  if (!conversationId) return [];

  const { data, error } = await createClient()
    .from("panels")
    .select("panel_number, text, visual_note, source, mastery")
    .eq("conversation_id", conversationId)
    .order("panel_number", { ascending: true })
    .returns<PanelRow[]>();

  if (error) {
    throw new Error(`Could not load this session's panels: ${error.message}`);
  }
  return (data ?? []).filter((row) => isValidPanelNumber(row.panel_number)).map(toPanel);
}

/**
 * Upsert, not insert: a re-confirmed panel overwrites its earlier version.
 * The conflict target is the unique index on (conversation_id, panel_number),
 * which is also what the prefill pass writes against.
 */
export async function upsertPanelRow(
  ctx: SessionContext,
  panel: Panel,
): Promise<void> {
  const { error } = await createClient()
    .from("panels")
    .upsert(
      {
        conversation_id: ctx.conversationId,
        // Must equal auth.uid(); RLS rejects the row otherwise.
        student_id: ctx.studentId,
        class_id: ctx.classId,
        concept: ctx.concept,
        panel_number: panel.panelNumber,
        text: panel.text,
        visual_note: panel.visualNote ?? null,
        source: panel.source,
        mastery: panel.mastery,
      },
      { onConflict: "conversation_id,panel_number" },
    );

  if (error) {
    throw new Error(`Could not save panel ${panel.panelNumber}: ${error.message}`);
  }
}

/**
 * Append-only. Both halves of a shaky→solid pair are kept: the instructor
 * ledger reads the pair, so overwriting would erase the only signal it has.
 */
export async function insertUnderstandingEvent(
  ctx: SessionContext,
  check: UnderstandingCheck,
): Promise<void> {
  const { error } = await createClient().from("understanding_events").insert({
    class_id: ctx.classId,
    student_id: ctx.studentId,
    panel_number: check.panelNumber,
    level: check.level,
    attempt: check.attempt,
  });

  if (error) {
    throw new Error(
      `Could not record the check for panel ${check.panelNumber}: ${error.message}`,
    );
  }
}

/**
 * Raw audit log of every conversation.tool_call, success or rejected — the
 * observability trail docs.tavus.io/sections/onboarding-guide/tool-calling-examples
 * recommends (conversation id, tool call id, tool name, parameters, status,
 * timestamp), separate from Panel/UnderstandingCheck which only ever hold
 * validated, applied writes.
 */
export async function insertToolCallEvent(
  ctx: SessionContext,
  event: ToolCallEvent,
): Promise<void> {
  const { error } = await createClient().from("tool_call_events").insert({
    conversation_id: ctx.conversationId,
    class_id: ctx.classId,
    student_id: ctx.studentId,
    tool_name: event.toolName,
    tool_call_id: event.toolCallId,
    arguments: event.args,
    status: event.status,
    reason: event.reason ?? null,
  });

  if (error) {
    throw new Error(`Could not log tool call ${event.toolName}: ${error.message}`);
  }
}
