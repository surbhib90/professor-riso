import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client — the one deliberate exception to the
 * anon-key-only rule in server.ts. Every other server read/write in this app
 * runs as the signed-in user so RLS is the real access control; this client
 * bypasses RLS entirely and must only be used where that is correct.
 *
 * Callers: /api/tavus/session-summary (Tavus posts server-to-server, no
 * Supabase session to bind — a shared-secret check stands in for RLS) and
 * /api/cron/webhook-health (Vercel Cron invokes it, same reasoning — no
 * user session, auth is the CRON_SECRET bearer check instead).
 */
export function createServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Supabase service role is not configured. Set SUPABASE_SERVICE_ROLE_KEY " +
        "(server-only — never NEXT_PUBLIC_) in .env.local, from the Supabase " +
        "project's API settings."
    );
  }

  return createSupabaseClient(url, serviceKey, {
    auth: { persistSession: false },
  });
}
