/**
 * Receives Tavus's document processing status updates — the callback_url set
 * per-document in app/api/knowledge/upload/route.ts's POST /v2/documents
 * call — and flips the matching topic_documents row from 'processing' to
 * 'ready' or 'error'.
 *
 * UNVERIFIED PAYLOAD SHAPE: unlike /api/tavus/session-summary's
 * `application.post_call_action_executed` envelope (confirmed against real
 * traffic), Tavus's docs do not show a worked example of what a per-document
 * callback_url actually POSTs — checked docs.tavus.io/sections/
 * webhooks-and-callbacks and the documents API reference on 2026-07-28,
 * neither documents it. This handler accepts the same flat shape
 * GET /v2/documents/{id} returns (document_id, status, error_message) at the
 * top level, since a "notify when this resource's state changes" callback
 * typically just posts the resource — falling back to the same fields
 * nested under `properties`, in case Tavus wraps it the way the conversation
 * event stream wraps `application.post_call_action_executed`. If neither
 * matches, the raw body is logged so the real shape can be read off a live
 * webhook and this route adjusted — see the companion verification note in
 * the plan doc for this feature.
 *
 * Same shared-secret model as session-summary: no signature/HMAC from
 * Tavus, so the `key` query param (baked into the callback_url at document
 * creation, not taken from the request body) is what stands in for auth.
 */

import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { extractDocumentStatusPayload, isRecord } from "@/lib/tavus/document-status-payload";

/** Constant-time compare so response timing cannot be used to guess the secret byte-by-byte. */
function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.TAVUS_WEBHOOK_SECRET;
  if (!secret) {
    console.error("/api/tavus/document-status: TAVUS_WEBHOOK_SECRET missing from the server environment.");
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

  if (!isRecord(body)) {
    return new Response(null, { status: 200 });
  }

  const payload = extractDocumentStatusPayload(body);
  if (!payload) {
    // Not necessarily an error — 'started'/'processing' updates land here too
    // and are deliberately ignored (topic_documents already defaults to
    // 'processing'). Logged at info level so the real shape is visible if
    // 'ready'/'error' updates are ever silently missed.
    console.log(`/api/tavus/document-status: no ready/error verdict in payload: ${JSON.stringify(body).slice(0, 500)}`);
    return new Response(null, { status: 200 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("topic_documents")
    .update({ status: payload.status })
    .eq("tavus_document_id", payload.documentId);

  if (error) {
    console.error(
      `/api/tavus/document-status: update failed for ${payload.documentId}: ${error.message}`
    );
    return new Response(null, { status: 500 });
  }

  return new Response(null, { status: 200 });
}
