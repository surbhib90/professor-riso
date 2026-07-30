/**
 * Fetches grounding text for server-side prefill generation (lib/anthropic/
 * prefill.ts) from Tavus's own document store — the same `page_summaries`
 * field scripts/seed-prefill.mjs prints for human review, reused here as
 * machine input instead. Best-effort: a document that fails to fetch is
 * skipped rather than failing the whole call, since prefill generation
 * itself falls back to general knowledge when grounding text is empty.
 */

const TAVUS_BASE_URL = "https://tavusapi.com/v2";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function fetchDocumentGroundingText(
  documentIds: readonly string[],
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const parts: string[] = [];

  for (const id of documentIds) {
    try {
      const res = await fetchImpl(`${TAVUS_BASE_URL}/documents/${id}`, {
        headers: { "x-api-key": apiKey },
      });
      if (!res.ok) continue;

      const doc: unknown = await res.json();
      if (!isRecord(doc)) continue;

      const summaries = isRecord(doc.page_summaries) ? doc.page_summaries : {};
      const joined = Object.entries(summaries)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim() !== "")
        .map(([page, text]) => `p${page}: ${text}`)
        .join("\n");
      if (!joined) continue;

      const name = typeof doc.document_name === "string" ? doc.document_name : id;
      parts.push(`--- ${name} ---\n${joined}`);
    } catch {
      // Best-effort: one unreachable document should not block generation.
      continue;
    }
  }

  return parts.join("\n\n");
}
