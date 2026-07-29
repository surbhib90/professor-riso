/**
 * Every data-layer call the conversation surface makes goes through this file
 * — the surface itself never imports Supabase directly.
 *
 * All calls are wrapped: the network never blocks rendering, and a failed write
 * never takes the live session down.
 */

import {
  getStudentId,
  insertUnderstandingEvent,
  loadPanelsForSession,
  upsertPanelRow,
} from "@/lib/supabase/client";
import type { Panel, SessionContext, UnderstandingCheck } from "@/lib/types";

export async function resolveStudentId(): Promise<string> {
  try {
    return (await getStudentId()) ?? "";
  } catch (err) {
    console.error("[data] could not resolve student id", err);
    return "";
  }
}

/** Rehydration: a mid-session refresh must redraw the zine, not blank it. */
export async function fetchSessionPanels(conversationId: string): Promise<Panel[]> {
  try {
    return (await loadPanelsForSession(conversationId)) ?? [];
  } catch (err) {
    console.error("[data] could not load panels for this session", err);
    return [];
  }
}

export function savePanel(ctx: SessionContext, panel: Panel): void {
  void Promise.resolve(upsertPanelRow(ctx, panel)).catch((err: unknown) => {
    console.error("[data] panel write failed", err);
  });
}

export function saveCheck(ctx: SessionContext, check: UnderstandingCheck): void {
  void Promise.resolve(insertUnderstandingEvent(ctx, check)).catch((err: unknown) => {
    console.error("[data] understanding event write failed", err);
  });
}

// --- knowledge upload --------------------------------------------------

export type UploadKnowledgeResult =
  | { ok: true; added: true }
  | { ok: true; added: false; reason: string }
  | { ok: false; message: string };

/**
 * POSTs a mid-session attachment to /api/knowledge/upload. Unlike the rest of
 * this file's writes (savePanel, saveCheck), this one has a result the UI
 * needs to show immediately (relevant vs. not), so it returns a typed
 * outcome instead of firing-and-forgetting — but it still never throws into
 * the caller, same "never blocks rendering, never takes the live session
 * down" contract as everything else here.
 */
export async function uploadKnowledgeFile(
  file: File,
  classId: string,
  concept: string,
): Promise<UploadKnowledgeResult> {
  try {
    const form = new FormData();
    form.append("file", file);
    form.append("classId", classId);
    form.append("concept", concept);

    const response = await fetch("/api/knowledge/upload", { method: "POST", body: form });
    const body: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const message =
        typeof body === "object" && body !== null && "error" in body
          ? String((body as { error: unknown }).error)
          : `The server could not check this file (HTTP ${response.status}).`;
      return { ok: false, message };
    }

    const record = (body ?? {}) as { added?: boolean; reason?: string };
    if (record.added) return { ok: true, added: true };
    return { ok: true, added: false, reason: record.reason ?? "not about this topic." };
  } catch (err) {
    console.error("[data] knowledge upload failed", err);
    return { ok: false, message: "Could not reach the server. Try again." };
  }
}

// --- conversation lifecycle ------------------------------------------------

export interface StartedConversation {
  conversationId: string;
  conversationUrl: string;
}

export interface StartConversationInput {
  classId: string;
  studentId: string;
  concept: string;
  /** D19: the PAL generates the prefilled panels itself from this number. */
  difficulty: number;
}

export async function startConversation(
  input: StartConversationInput,
): Promise<StartedConversation> {
  const response = await fetch("/api/conversation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // studentId is intentionally absent: the route reads identity from the
    // Supabase session, and sending it here would imply the client gets a say.
    body: JSON.stringify({
      classId: input.classId,
      concept: input.concept,
      difficulty: input.difficulty,
    }),
  });

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: unknown }).error)
        : `The server could not start the call (HTTP ${response.status}).`;
    throw new Error(message);
  }

  const record = (body ?? {}) as Partial<StartedConversation>;
  if (!record.conversationId || !record.conversationUrl) {
    throw new Error("The server started a call but returned no join link.");
  }
  return { conversationId: record.conversationId, conversationUrl: record.conversationUrl };
}

export interface EndConversationOptions {
  /**
   * Set on paths where the document is going away (tab close, full-page
   * navigation). A normal fetch is cancelled the moment the page unloads; a
   * keepalive fetch is handed to the browser to finish on its own.
   */
  keepalive?: boolean;
}

/**
 * End a conversation and hand its Tavus concurrency slot back.
 *
 * Why not `navigator.sendBeacon`: a beacon can only issue POST, and POST
 * /api/conversation is the *create* route. A beacon aimed there is at best a
 * 400 (malformed create body) and at worst opens another conversation — the
 * exact opposite of the intent — while the DELETE handler never sees it.
 * `fetch(..., { keepalive: true })` buys the same survive-the-unload guarantee
 * without giving up the method. The request carries no body, so the 64KB
 * keepalive payload ceiling is not a concern.
 *
 * Best effort by contract. The route treats an already-ended conversation as
 * success, so a double fire is harmless, and every failure is logged rather
 * than thrown: a slot held for the 60s participant_left_timeout is a far
 * smaller harm than an error surfaced over a session the student is still in.
 */
export async function endConversation(
  conversationId: string,
  options: EndConversationOptions = {},
): Promise<void> {
  if (!conversationId) return;
  try {
    const response = await fetch(
      `/api/conversation?conversationId=${encodeURIComponent(conversationId)}`,
      { method: "DELETE", keepalive: options.keepalive === true },
    );
    // 404 is "no session of yours matches that id" — already reaped, or ended
    // by the create route's per-student sweep. That is the desired end state.
    if (!response.ok && response.status !== 404) {
      console.error(
        `[data] could not end conversation ${conversationId} (HTTP ${response.status})`,
      );
    }
  } catch (err) {
    console.error("[data] could not end conversation", err);
  }
}

// --- refresh survival ------------------------------------------------------

/**
 * A refresh must rejoin the SAME conversation, otherwise rehydration has
 * nothing to rehydrate and the student watches their zine vanish. sessionStorage
 * is the right scope: per tab, cleared when the tab closes.
 */
const RESUME_KEY = "professor-riso:conversation";
/** Matches max_call_duration; a staler entry points at a dead room. */
const RESUME_TTL_MS = 15 * 60 * 1000;

interface ResumeRecord extends StartedConversation {
  signature: string;
  startedAt: number;
}

function signatureOf(classId: string, concept: string, difficulty: number): string {
  return `${classId}|${concept}|${difficulty}`;
}

export interface ResumableConversation extends StartedConversation {
  /** When the conversation was created — matches Tavus's max_call_duration clock. */
  startedAt: number;
}

export function readResumableConversation(
  classId: string,
  concept: string,
  difficulty: number,
): ResumableConversation | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(RESUME_KEY);
    if (!raw) return null;
    const record = JSON.parse(raw) as Partial<ResumeRecord>;
    if (
      !record.conversationId ||
      !record.conversationUrl ||
      record.signature !== signatureOf(classId, concept, difficulty) ||
      typeof record.startedAt !== "number" ||
      Date.now() - record.startedAt > RESUME_TTL_MS
    ) {
      return null;
    }
    return {
      conversationId: record.conversationId,
      conversationUrl: record.conversationUrl,
      startedAt: record.startedAt,
    };
  } catch {
    return null;
  }
}

/**
 * @param startedAt Conversation-creation timestamp (ms). Defaults to now — pass
 * the timestamp captured right before the create request when the caller has
 * one, so the stored clock matches Tavus's max_call_duration as closely as possible.
 */
export function rememberConversation(
  classId: string,
  concept: string,
  difficulty: number,
  started: StartedConversation,
  startedAt: number = Date.now(),
): void {
  if (typeof window === "undefined") return;
  try {
    const record: ResumeRecord = {
      ...started,
      signature: signatureOf(classId, concept, difficulty),
      startedAt,
    };
    window.sessionStorage.setItem(RESUME_KEY, JSON.stringify(record));
  } catch {
    // Private-mode storage failure only costs refresh survival.
  }
}

/**
 * Drop the resume record. Pairs with `endConversation`: once a conversation is
 * ended, a record pointing at it is worse than no record at all — the next
 * visit would skip creating a call and try to rejoin a dead room, which reads
 * to the student as a hang rather than an error.
 */
export function forgetConversation(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(RESUME_KEY);
  } catch {
    // Same private-mode failure as rememberConversation; the TTL is the backstop.
  }
}
