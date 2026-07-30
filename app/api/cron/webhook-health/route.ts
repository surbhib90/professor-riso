/**
 * Scheduled health check for Tavus webhook delivery (vercel.json cron,
 * every 15 minutes). Two things this catches that nothing else did before
 * 2026-07-30: a session dying for a reason nobody saw (system.shutdown),
 * and webhook delivery silently breaking end to end (the PUBLIC_APP_URL
 * trailing-newline bug — conversations happened, zero webhook_events rows
 * landed, and the only way to notice was a manual session_summaries diff).
 *
 * Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically
 * once CRON_SECRET is set as a project env var. Same constant-time compare
 * as /api/tavus/session-summary's secret check, duplicated rather than
 * shared — two call sites doesn't justify an abstraction yet.
 */

import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";

const WINDOW_MINUTES = 15;

function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface ShutdownRow {
  conversation_id: string | null;
  properties: { shutdown_reason?: string } | null;
}

/** Any system.shutdown in the window with a shutdown_reason set. */
async function findAbnormalShutdowns(
  supabase: ReturnType<typeof createServiceClient>,
  sinceIso: string
): Promise<ShutdownRow[]> {
  const { data, error } = await supabase
    .from("webhook_events")
    .select("conversation_id, properties")
    .eq("event_type", "system.shutdown")
    .gte("received_at", sinceIso)
    .not("properties->>shutdown_reason", "is", null);

  if (error) {
    console.error(`/api/cron/webhook-health: shutdown query failed: ${error.message}`);
    return [];
  }
  return (data ?? []) as ShutdownRow[];
}

/**
 * Sessions started but zero webhook_events landed in the same window —
 * the exact shape of the PUBLIC_APP_URL delivery failure.
 */
async function findWebhookSilence(
  supabase: ReturnType<typeof createServiceClient>,
  sinceIso: string
): Promise<boolean> {
  const [{ count: conversationCount, error: convError }, { count: eventCount, error: eventError }] =
    await Promise.all([
      supabase
        .from("conversation_owners")
        .select("conversation_id", { count: "exact", head: true })
        .gte("created_at", sinceIso),
      supabase.from("webhook_events").select("id", { count: "exact", head: true }).gte("received_at", sinceIso),
    ]);

  if (convError || eventError) {
    console.error(
      `/api/cron/webhook-health: silence query failed: ${convError?.message ?? eventError?.message}`
    );
    return false;
  }

  return (conversationCount ?? 0) > 0 && (eventCount ?? 0) === 0;
}

async function alert(message: string): Promise<void> {
  const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!slackWebhookUrl) {
    console.error(`/api/cron/webhook-health: ${message}`);
    return;
  }
  try {
    const response = await fetch(slackWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message }),
    });
    if (!response.ok) {
      console.error(`/api/cron/webhook-health: Slack POST failed with status ${response.status}`);
    }
  } catch (err) {
    console.error(`/api/cron/webhook-health: Slack POST threw: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("/api/cron/webhook-health: CRON_SECRET missing from the server environment.");
    return new Response(null, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  const provided = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
  if (!secretMatches(provided, secret)) {
    return new Response(null, { status: 401 });
  }

  const supabase = createServiceClient();
  const sinceIso = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();

  const [shutdowns, silent] = await Promise.all([
    findAbnormalShutdowns(supabase, sinceIso),
    findWebhookSilence(supabase, sinceIso),
  ]);

  if (shutdowns.length > 0) {
    const ids = shutdowns.map((row) => row.conversation_id ?? "unknown").join(", ");
    await alert(
      `webhook-health: ${shutdowns.length} abnormal system.shutdown event(s) in the last ${WINDOW_MINUTES}min: ${ids}`
    );
  }

  if (silent) {
    await alert(
      `webhook-health: conversations started in the last ${WINDOW_MINUTES}min but zero webhook_events landed — delivery may be broken.`
    );
  }

  return new Response(null, { status: 200 });
}
