import type { Metadata } from "next";
import { PANEL_COUNT, type UnderstandingLevel } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";
import { LoginGate, SignOutButton } from "./login-gate";

export const metadata: Metadata = {
  title: "Class ledger",
};

// Auth state lives in cookies; a cached render would serve one instructor's
// ledger to the next visitor.
export const dynamic = "force-dynamic";

interface EventRow {
  student_id: string;
  panel_number: number;
  level: UnderstandingLevel;
  attempt: number;
}

interface SummaryRow {
  conversation_id: string;
  summary: string;
  created_at: string;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface PanelStats {
  panelNumber: number;
  students: number;
  neededSecondPass: number;
  avgAttempts: number;
}

/**
 * Rolls verdicts up per student first, then per panel. The raw event table has
 * up to two rows per student per panel (shaky → solid), so counting rows
 * directly would double-count exactly the students who struggled — inflating
 * the number the instructor is here to read.
 */
function aggregate(rows: EventRow[]): PanelStats[] {
  const byPanel = new Map<number, Map<string, { attempts: number; struggled: boolean }>>();

  for (const row of rows) {
    if (!byPanel.has(row.panel_number)) byPanel.set(row.panel_number, new Map());
    const students = byPanel.get(row.panel_number)!;
    const prior = students.get(row.student_id) ?? { attempts: 0, struggled: false };
    students.set(row.student_id, {
      attempts: Math.max(prior.attempts, row.attempt),
      struggled: prior.struggled || row.level !== "solid",
    });
  }

  return [...byPanel.entries()]
    .map(([panelNumber, students]) => {
      const values = [...students.values()];
      const totalAttempts = values.reduce((sum, s) => sum + s.attempts, 0);
      return {
        panelNumber,
        students: values.length,
        neededSecondPass: values.filter((s) => s.struggled).length,
        avgAttempts: values.length ? totalAttempts / values.length : 0,
      };
    })
    .sort((a, b) => a.panelNumber - b.panelNumber);
}

export default async function ClassPage({
  params,
  searchParams,
}: {
  params: Promise<{ classId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { classId } = await params;
  const query = await searchParams;

  // A missing env var must not 500 the page an instructor opens in front of a
  // room. Say what broke and what fixes it.
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-5 py-16 sm:px-8">
        <p className="font-mono text-stamp uppercase text-yellow">Not connected</p>
        <h1 className="font-display text-marquee text-balance">
          The ledger can&apos;t reach the database.
        </h1>
        <p className="max-w-prose font-mono text-sm leading-relaxed text-paper/85">
          {err instanceof Error ? err.message : "Unknown configuration error."}
        </p>
      </main>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <LoginGate
        classId={classId}
        notice={
          query.signin === "expired"
            ? "That link had already been used or expired. Send yourself a fresh one."
            : undefined
        }
      />
    );
  }

  // A student who wandered over from /session is signed in, just anonymously.
  // Say so plainly instead of accusing them of not owning the class.
  if (user.is_anonymous) {
    return (
      <LoginGate
        classId={classId}
        notice="You're signed in as a guest from a session. Instructors sign in with the email registered to this class."
      />
    );
  }

  // Claim-on-first-visit: a class with no owner yet is claimed by whoever
  // signs in and looks. The RLS policy "first signed-in visitor claims it"
  // is the actual enforcement — it only allows this insert when no owner row
  // exists for classId — so a race between two instructors is decided by the
  // database (backed by the unique constraint on class_id), not by this code.
  // The error is swallowed: on an already-owned class this insert is EXPECTED
  // to fail RLS, and that failure is not this instructor's problem to see.
  await supabase.from("class_owners").insert({ class_id: classId, owner_user_id: user.id });

  // Ownership check before any data is read. RLS enforces the same rule at the
  // database, so a non-owner's query below would return nothing anyway — this
  // exists to render an honest message, not to be the security boundary.
  const { data: ownership, error: ownershipError } = await supabase
    .from("class_owners")
    .select("class_id")
    .eq("class_id", classId)
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (ownershipError || !ownership) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-5 py-16 sm:px-8">
        <p className="font-mono text-stamp uppercase text-yellow">No access</p>
        <h1 className="font-display text-marquee text-balance">
          {classId} isn&apos;t registered to this account.
        </h1>
        <p className="max-w-prose text-lg leading-relaxed text-paper/85">
          You&apos;re signed in as{" "}
          <span className="font-mono text-pink">{user.email}</span>. Ask whoever
          set up {classId} to register that address as its owner, or sign out
          and use the address they already registered.
        </p>
        <SignOutButton />
      </main>
    );
  }

  const { data: events, error: eventsError } = await supabase
    .from("understanding_events")
    .select("student_id, panel_number, level, attempt")
    .eq("class_id", classId)
    .returns<EventRow[]>();

  const stats = aggregate(events ?? []);
  const totalStudents = new Set((events ?? []).map((row) => row.student_id)).size;

  // Populated by the PAL's post_call_summary tool via /api/tavus/session-summary
  // once a session ends. Rows simply don't exist for sessions run before that
  // was wired up, or without PUBLIC_APP_URL/TAVUS_WEBHOOK_SECRET configured.
  const { data: summaries, error: summariesError } = await supabase
    .from("session_summaries")
    .select("conversation_id, summary, created_at")
    .eq("class_id", classId)
    .order("created_at", { ascending: false })
    .returns<SummaryRow[]>();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b-2 border-ink-edge pb-4">
        <p className="font-mono text-stamp uppercase text-paper/70">
          Instructor view
        </p>
        <p className="font-mono text-stamp uppercase text-paper/70">
          {user.email}
        </p>
      </header>

      <div>
        <h1 className="font-display text-marquee sm:text-poster">{classId}</h1>
        <p className="mt-3 max-w-prose text-lg leading-relaxed text-paper/85">
          One row per panel, drawn from every transfer test the professor ran.
          The panels with a high second-pass count are the ones to re-teach.
        </p>
      </div>

      {eventsError ? (
        <p className="font-mono text-sm leading-snug text-yellow" role="alert">
          The ledger didn&apos;t load ({eventsError.message}). Reload the page;
          if it keeps failing, check that the database is reachable.
        </p>
      ) : stats.length === 0 ? (
        <div className="paper p-8">
          <p className="font-mono text-stamp uppercase text-graphite-soft">
            Nothing logged yet
          </p>
          <p className="mt-3 max-w-prose font-mono text-sm leading-relaxed text-graphite">
            Rows land here as students finish panels in {classId}. Nobody has
            been tested on one yet.
          </p>
        </div>
      ) : (
        <>
          {/* The ledger is the print shop's job sheet: paper, mono, ruled. */}
          <div className="paper overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse font-mono text-sm tabular-nums text-graphite">
              <caption className="px-5 pt-5 pb-3 text-left text-stamp uppercase tracking-[0.14em] text-graphite-soft">
                Panel ledger — {totalStudents}{" "}
                {totalStudents === 1 ? "student" : "students"} across{" "}
                {PANEL_COUNT} panels
              </caption>
              <thead>
                <tr className="border-b-2 border-graphite text-left text-stamp uppercase tracking-[0.14em] text-graphite-soft">
                  <th scope="col" className="px-5 py-2 font-normal">
                    Panel
                  </th>
                  <th scope="col" className="px-5 py-2 text-right font-normal">
                    Students
                  </th>
                  <th scope="col" className="px-5 py-2 text-right font-normal">
                    Needed a second pass
                  </th>
                  <th scope="col" className="px-5 py-2 text-right font-normal">
                    Avg attempts
                  </th>
                </tr>
              </thead>
              <tbody>
                {stats.map((row) => (
                  <tr
                    key={row.panelNumber}
                    className="border-b border-graphite/20 last:border-b-0"
                  >
                    <th scope="row" className="px-5 py-3 text-left font-bold">
                      {row.panelNumber}
                    </th>
                    <td className="px-5 py-3 text-right">{row.students}</td>
                    <td className="px-5 py-3 text-right">
                      {row.neededSecondPass > 0 ? (
                        <span className="text-pink">{row.neededSecondPass}</span>
                      ) : (
                        row.neededSecondPass
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {row.avgAttempts.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="max-w-prose font-mono text-xs leading-relaxed text-paper/60">
            A second pass means the professor re-explained the panel from a
            different angle before the student got it. Attempts cap at two —
            after the retry the panel is confirmed either way.
          </p>
        </>
      )}

      <div className="flex flex-col gap-4 border-t-2 border-ink-edge pt-6">
        <h2 className="font-display text-2xl tracking-tight">Session recaps</h2>
        {summariesError ? (
          <p className="font-mono text-sm leading-snug text-yellow" role="alert">
            Recaps didn&apos;t load ({summariesError.message}).
          </p>
        ) : !summaries || summaries.length === 0 ? (
          <p className="font-mono text-sm leading-relaxed text-paper/60">
            Nothing here yet — recaps land after a session ends.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {summaries.map((row) => (
              <li key={row.conversation_id} className="paper flex flex-col gap-1.5 p-4">
                <p className="font-mono text-[0.68rem] uppercase tracking-[0.1em] text-graphite-soft">
                  {formatTimestamp(row.created_at)}
                </p>
                <p className="text-sm leading-relaxed text-graphite">{row.summary}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t-2 border-ink-edge pt-6">
        <SignOutButton />
      </div>
    </main>
  );
}
