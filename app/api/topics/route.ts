/**
 * Lists the topics a student can pick for a session.
 *
 * Reads public.topic_documents instead of walking Tavus's document API —
 * that table is now the source of truth for which documents count as a
 * "topic" (see supabase/schema.sql), replacing the hardcoded
 * TOPIC_DOCUMENT_IDS array this route used to carry. A topic label can have
 * several rows behind it (the original curated document plus any number of
 * student uploads that passed the relevance check in
 * app/api/knowledge/upload/route.ts) — grouped into one dropdown entry here,
 * per (class_id, topic_label).
 *
 * classId is now actually applied (the old Tavus-backed version silently
 * ignored it — every class shared one global list).
 */

import { createClient } from "@/lib/supabase/server";

interface TopicRow {
  topic_label: string;
}

/**
 * Deduplicates a list of raw topic labels (strings), sorts them
 * locale-aware ascending, and maps each to the picker shape
 * `{ id: string, label: string }`. Pure function — testable without Supabase.
 *
 * `id` is deliberately set to `label` (not a UUID): the session-start picker
 * passes `id` on as the `concept` query param, and downstream code (the
 * conversation route, the zine pane header) expects concept to be
 * human-readable, not an opaque key.
 */
export function buildTopicList(rawLabels: string[]): { id: string; label: string }[] {
  const unique = Array.from(new Set(rawLabels));
  return unique
    .sort((a, b) => a.localeCompare(b))
    .map((label) => ({ id: label, label }));
}

export async function GET(request: Request): Promise<Response> {
  const classId = new URL(request.url).searchParams.get("classId");
  if (!classId) {
    return Response.json({ topics: [] });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("topic_documents")
    .select("topic_label")
    .eq("class_id", classId)
    .eq("status", "ready");

  if (error) {
    console.error(`/api/topics: query failed for class ${classId}: ${error.message}`);
    return Response.json({ topics: [] });
  }

  // One dropdown entry per distinct label, regardless of how many documents
  // (curated + student uploads) back it. `id` only needs to be a stable key
  // for the picker — the label itself is what gets sent on as `concept`.
  const topics = buildTopicList((data as TopicRow[]).map((row) => row.topic_label));

  return Response.json({ topics });
}
