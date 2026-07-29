"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * The only magic link in the app (D14). Instructors sign in from their own
 * inbox; students never see this screen.
 *
 * The link lands on /class/[classId]/auth, which exchanges the code for a
 * session cookie and bounces back here — the exchange must happen somewhere
 * that can write cookies, and a server component cannot.
 */
type SendState =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "sent"; email: string }
  | { status: "failed"; reason: string };

export function LoginGate({
  classId,
  notice,
}: {
  classId: string;
  notice?: string;
}) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<SendState>({ status: "idle" });

  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = email.trim();
    if (!address) return;

    setState({ status: "sending" });
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: address,
        options: {
          emailRedirectTo: `${window.location.origin}/class/${encodeURIComponent(classId)}/auth`,
          // No self-serve instructor accounts: ownership is seeded in
          // class_owners, so an unknown address should fail here rather than
          // create a user who then sees "this class isn't yours".
          shouldCreateUser: false,
        },
      });
      if (error) {
        setState({ status: "failed", reason: error.message });
        return;
      }
      setState({ status: "sent", email: address });
    } catch (err) {
      setState({
        status: "failed",
        reason: err instanceof Error ? err.message : "Unknown error.",
      });
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 px-5 py-16 sm:px-8">
      <div>
        <p className="font-mono text-stamp uppercase text-paper/70">
          Instructor view — {classId}
        </p>
        <h1 className="mt-3 font-display text-marquee text-balance">
          Sign in to see how the class is doing.
        </h1>
      </div>

      {notice ? (
        <p className="border-l-2 border-yellow pl-4 text-base leading-relaxed text-paper/85">
          {notice}
        </p>
      ) : null}

      {state.status === "sent" ? (
        <div className="flex flex-col gap-3" role="status">
          <p className="font-mono text-stamp uppercase text-yellow">Link sent</p>
          <p className="max-w-prose text-lg leading-relaxed text-paper/85">
            Open the link in {state.email} on this device. It signs you in and
            drops you back on this page. It stops working after an hour.
          </p>
          <button
            type="button"
            onClick={() => setState({ status: "idle" })}
            className="self-start font-mono text-stamp uppercase text-pink underline underline-offset-4"
          >
            Use a different address
          </button>
        </div>
      ) : (
        <form onSubmit={send} className="flex flex-col gap-4">
          <label
            htmlFor="instructor-email"
            className="font-mono text-stamp uppercase text-paper/70"
          >
            Your email
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id="instructor-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@university.edu"
              className="min-w-0 flex-1 border-2 border-ink-edge bg-ink-deep px-4 py-3 font-mono text-base text-paper placeholder:text-paper/40 focus:border-paper/60"
            />
            <button
              type="submit"
              disabled={state.status === "sending"}
              className="bg-pink px-6 py-3 font-mono text-stamp uppercase text-ink-deep shadow-[3px_3px_0_var(--color-ink-deep)] disabled:cursor-not-allowed disabled:bg-ink-edge disabled:text-paper/50 disabled:shadow-none"
            >
              {state.status === "sending" ? "Sending…" : "Email me a link"}
            </button>
          </div>

          {state.status === "failed" ? (
            <p className="font-mono text-sm leading-snug text-yellow" role="alert">
              That link didn&apos;t send ({state.reason}). Check the address —
              it has to be the one registered as this class&apos;s owner.
            </p>
          ) : null}
        </form>
      )}
    </main>
  );
}

/** Shown to a signed-in user who does not own the class they asked for. */
export function SignOutButton({ label = "Sign out" }: { label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await createClient().auth.signOut();
        // The gate is rendered server-side from the session cookie, so the
        // page has to be re-fetched, not just re-rendered.
        router.refresh();
      }}
      className="self-start border-2 border-ink-edge px-5 py-3 font-mono text-stamp uppercase text-paper hover:border-paper/60 disabled:opacity-50"
    >
      {busy ? "Signing out…" : label}
    </button>
  );
}
