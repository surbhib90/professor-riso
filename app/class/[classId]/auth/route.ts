import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Magic-link landing. The instructor's email link points here; we swap the
 * code for a session cookie and send them on to the class page.
 *
 * This has to be a route handler: the exchange writes cookies, and Server
 * Components can't. Both link shapes are handled — `?code=` (PKCE, what
 * @supabase/ssr issues by default) and `?token_hash=&type=` (the newer email
 * template) — so a project whose template was already migrated still works.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ classId: string }> },
) {
  const { classId } = await params;
  const requestUrl = new URL(request.url);
  const destination = new URL(
    `/class/${encodeURIComponent(classId)}`,
    requestUrl.origin,
  );

  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");

  if (!code && !tokenHash) {
    // Supabase reports expiry/reuse as query params on the redirect rather
    // than as a failed exchange, so this branch covers "link already used".
    destination.searchParams.set("signin", "expired");
    return NextResponse.redirect(destination);
  }

  const supabase = await createClient();
  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : await supabase.auth.verifyOtp({ token_hash: tokenHash ?? "", type: "email" });

  if (error) {
    destination.searchParams.set("signin", "expired");
  }

  return NextResponse.redirect(destination);
}
