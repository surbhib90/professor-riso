import type { Metadata } from "next";
import SessionStart from "./session-start";

export const metadata: Metadata = {
  title: "Start a session",
};

/**
 * Seam 3, student side. This page is a server shell only so that `class` and
 * `concept` arrive already resolved — the interactive half (anonymous sign-in,
 * class/topic/difficulty pickers) lives in the client component.
 *
 * `class_id` is an unguarded URL param by design: anyone with the link can
 * join. Only the instructor aggregation is gated.
 *
 * `cs101` is the only class right now (D-none, product decision 2026-07-28),
 * so a missing/unknown `class` param just falls back to it instead of
 * dead-ending the visitor — the class picker in SessionStart is what's
 * future-proofed for more than one, not this default.
 */
const DEFAULT_CLASS_ID = "cs101";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value?.trim() ? value.trim() : null;
}

export default async function SessionPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  // `class` reads better in a shared link; `classId` is what /conversation
  // uses. Accept both so a copy-pasted link never dead-ends.
  const classId = first(params.class) ?? first(params.classId) ?? DEFAULT_CLASS_ID;
  // No fallback text: an empty concept means "let the topic picker choose",
  // not a placeholder to display.
  const concept = first(params.concept);

  return <SessionStart classId={classId} concept={concept} />;
}
