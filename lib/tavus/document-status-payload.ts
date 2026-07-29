/**
 * Parses whatever app/api/tavus/document-status/route.ts receives on Tavus's
 * per-document callback_url. Split out (pure, no Supabase/request
 * dependency) so this — the genuinely uncertain part of that route, per its
 * own header comment about the payload shape being undocumented — can be
 * pinned down with tests instead of only trusted by inspection.
 */

export type DocumentStatus = "started" | "processing" | "ready" | "error" | "recrawling";

export interface DocumentStatusPayload {
  documentId: string;
  status: "ready" | "error";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFrom(record: Record<string, unknown>): DocumentStatusPayload | null {
  const documentId = record.document_id;
  const status = record.status;
  if (typeof documentId !== "string") return null;
  if (status !== "ready" && status !== "error") return null;
  return { documentId, status };
}

/** Tries the flat shape GET /v2/documents/{id} returns first, then the same
 *  fields nested under `properties` in case Tavus wraps this the way the
 *  conversation event stream wraps `application.post_call_action_executed`. */
export function extractDocumentStatusPayload(
  body: Record<string, unknown>
): DocumentStatusPayload | null {
  const flat = readFrom(body);
  if (flat) return flat;
  if (isRecord(body.properties)) return readFrom(body.properties);
  return null;
}
