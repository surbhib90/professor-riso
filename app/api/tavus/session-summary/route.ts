/**
 * Receives the post_call_summary tool's result after a conversation ends.
 *
 * Tavus's post-call tools (docs.tavus.io/sections/conversational-video-interface/
 * pal/post-call-tool) deliver directly to the tool's own `delivery.api.url`
 * (a bare POST of body_template, no envelope, no conversation_id) AND emit an
 * `application.post_call_action_executed` event to the conversation's
 * `callback_url` (the general event stream, which per Tavus's docs does
 * carry conversation_id). Both are pointed at this same route — the tool's
 * own delivery is required to exist but is not otherwise usable here since
 * it cannot be tied to a conversation, so it is silently ignored; only the
 * callback_url event is acted on.
 *
 * Tavus documents no signature/HMAC verification for callbacks (checked
 * 2026-07-28). The `key` query param is the substitute: it comes from the
 * TAVUS_WEBHOOK_SECRET baked into the callback_url at conversation creation
 * (see /api/conversation), not from anything in the request body, so it
 * cannot be forged by crafting a payload alone.
 */

import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Constant-time compare so response timing cannot be used to guess the secret byte-by-byte. */
function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The tool's delivery.api.body_template is `{ "summary": "{summary}" }`
 * (lib/tavus/tools-config.json), JSON-encoded as a string inside
 * properties.request.body — matching the shape Tavus's own docs show for
 * this event (`"body": "{\"channel\":...}"`).
 */
function extractSummary(properties: Record<string, unknown>): string | null {
  const request = properties.request;
  if (!isRecord(request) || typeof request.body !== "string") return null;
  try {
    const parsed = JSON.parse(request.body);
    return isRecord(parsed) && typeof parsed.summary === "string" ? parsed.summary : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.TAVUS_WEBHOOK_SECRET;
  if (!secret) {
    console.error("/api/tavus/session-summary: TAVUS_WEBHOOK_SECRET missing from the server environment.");
    return new Response(null, { status: 500 });
  }

  const key = new URL(request.url).searchParams.get("key");
  if (!secretMatches(key, secret)) {
    return new Response(null, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }

  const supabase = createServiceClient();

  // Persist every event Tavus sends to this callback_url, not just the ones
  // acted on below — this is what makes "did the webhook even arrive" a
  // query instead of a guess (see webhook_events table comment in
  // supabase/schema.sql; motivated by the PUBLIC_APP_URL callback_url bug
  // that broke delivery silently with no way to notice from this app alone).
  // Best-effort: a logging failure must never break the 200 back to Tavus.
  if (isRecord(body) && typeof body.event_type === "string") {
    const { error: eventLogError } = await supabase.from("webhook_events").insert({
      conversation_id: typeof body.conversation_id === "string" ? body.conversation_id : null,
      event_type: body.event_type,
      properties: isRecord(body.properties) ? body.properties : {},
    });
    if (eventLogError) {
      console.error(`/api/tavus/session-summary: webhook_events insert failed: ${eventLogError.message}`);
    }
  }

  // system.shutdown carries why a conversation actually died (crash at
  // startup, replica error, hard duration cap) — the one event type here
  // that is worth a log line on its own, since Tavus gives no other way to
  // see it (not present in GET /conversations either).
  if (isRecord(body) && body.event_type === "system.shutdown") {
    console.error(
      `/api/tavus/session-summary: system.shutdown for ${body.conversation_id ?? "unknown"}: ${JSON.stringify(body.properties ?? {}).slice(0, 500)}`
    );
    return new Response(null, { status: 200 });
  }

  // Every other event type Tavus sends to this callback_url (transcription,
  // perception, speaking state, ...) — and the tool's own envelope-less
  // delivery.api POST — land here too. Acknowledge and drop both silently;
  // this is not an error, just not the event this route acts on.
  if (
    !isRecord(body) ||
    body.event_type !== "application.post_call_action_executed" ||
    !isRecord(body.properties) ||
    body.properties.tool_name !== "post_call_summary"
  ) {
    return new Response(null, { status: 200 });
  }

  const conversationId = typeof body.conversation_id === "string" ? body.conversation_id : null;
  const summary = extractSummary(body.properties);
  if (!conversationId || !summary) {
    console.error(
      `/api/tavus/session-summary: post_call_action_executed missing conversation_id or summary: ${JSON.stringify(body).slice(0, 500)}`
    );
    return new Response(null, { status: 200 });
  }

  // conversation_owners is the authoritative student_id/class_id for this
  // conversation_id — set by /api/conversation at creation time, never taken
  // from this webhook's own body. That is what makes writing under the
  // service role safe despite the shared-secret-only auth above: the row can
  // only ever be attributed to a conversation Riso itself created.
  const { data: owner, error: ownerError } = await supabase
    .from("conversation_owners")
    .select("student_id, class_id")
    .eq("conversation_id", conversationId)
    .maybeSingle();

  if (ownerError || !owner || !owner.class_id) {
    console.error(
      `/api/tavus/session-summary: no conversation_owners row (with class_id) for ${conversationId}: ${ownerError?.message ?? "not found"}`
    );
    return new Response(null, { status: 200 });
  }

  const { error: upsertError } = await supabase.from("session_summaries").upsert({
    conversation_id: conversationId,
    student_id: owner.student_id,
    class_id: owner.class_id,
    summary,
  });

  if (upsertError) {
    console.error(`/api/tavus/session-summary: upsert failed for ${conversationId}: ${upsertError.message}`);
    return new Response(null, { status: 500 });
  }

  return new Response(null, { status: 200 });
}
