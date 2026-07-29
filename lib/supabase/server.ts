import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client, bound to the current request's cookies.
 *
 * Anon key only — never the service role. Every server read in this app is
 * meant to run *as the signed-in user* so RLS is the thing enforcing access,
 * not an `if` statement above the query. The instructor gate depends on that:
 * a non-owner's query returns zero rows from Postgres, not filtered rows.
 *
 * Must be created per request. Caching one across requests would hand one
 * user's session to the next.
 */
export async function createClient(): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local, then restart the dev server.",
    );
  }

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot write cookies. A refreshed token is
          // dropped here and re-refreshed on the next request that can write
          // one (the /class/[classId]/auth route handler, or middleware if it
          // is added later). Swallowing is correct; rethrowing would 500 a
          // page whose only sin was rendering slightly after a token expiry.
        }
      },
    },
  });
}
