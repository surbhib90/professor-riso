import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PANEL_COUNT, isValidPanelNumber, type Mastery, type Panel } from "@/lib/types";
import ZineThumb from "./ZineThumb";
import { formatRelative } from "./format-relative";

/**
 * D15, built last, cuttable: the student's own past zines, grouped by
 * concept — one entry per conversation_id, no class gallery. Own-zines only;
 * social comparison fights the anti-exam ethos (ARCHITECTURE.md, Seam 6).
 */

export const metadata: Metadata = {
  title: "Your shelf",
};

// Auth state lives in cookies; a cached render would serve one student's
// shelf to the next visitor.
export const dynamic = "force-dynamic";

interface PanelRow {
  conversation_id: string;
  concept: string;
  panel_number: number;
  text: string;
  visual_note: string | null;
  source: string;
  mastery: string;
  updated_at: string;
}

interface ZineEntry {
  conversationId: string;
  concept: string;
  lastTouched: string;
  panels: (Panel | null)[];
}

function toPanel(row: PanelRow): Panel {
  return {
    panelNumber: row.panel_number,
    text: row.text,
    visualNote: row.visual_note ?? undefined,
    // Widened on the way out of Postgres; the CHECK constraints in
    // schema.sql are what actually keep these in range.
    source: row.source === "prefill" ? "prefill" : "student",
    mastery:
      row.mastery === "first-try" || row.mastery === "after-retry"
        ? (row.mastery as Mastery)
        : "none",
  };
}

/**
 * A zine is a conversation_id, not a row. Rows arrive newest-`updated_at`
 * first (see the query below), so the first row seen for a given
 * conversation is already that zine's most recent touch — a single pass
 * both groups panels into zines and leaves the zines in most-recent-first
 * order, with no second sort needed.
 */
function groupIntoZines(rows: PanelRow[]): ZineEntry[] {
  const order: string[] = [];
  const byConversation = new Map<string, ZineEntry>();

  for (const row of rows) {
    if (!isValidPanelNumber(row.panel_number)) continue;

    let entry = byConversation.get(row.conversation_id);
    if (!entry) {
      entry = {
        conversationId: row.conversation_id,
        concept: row.concept,
        lastTouched: row.updated_at,
        panels: Array(PANEL_COUNT).fill(null),
      };
      byConversation.set(row.conversation_id, entry);
      order.push(row.conversation_id);
    }
    entry.panels[row.panel_number - 1] = toPanel(row);
  }

  return order.map((id) => byConversation.get(id)!);
}

export default async function ShelfPage() {
  // A missing env var must not 500 the page a student opens between classes.
  // Say what broke and what fixes it (mirrors app/class/[classId]/page.tsx).
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-5 py-16 sm:px-8">
        <p className="font-mono text-stamp uppercase text-yellow">Not connected</p>
        <h1 className="font-display text-marquee text-balance">
          Your shelf can&apos;t reach the database.
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

  // Anonymous is a real signed-in student here (D14) — the gate is only for
  // a browser with no guest pass at all, not for "not a named account".
  if (!user) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-5 py-16 sm:px-8">
        <p className="font-mono text-stamp uppercase text-yellow">Not signed in</p>
        <h1 className="font-display text-marquee text-balance">
          Your shelf lives with your session.
        </h1>
        <p className="max-w-prose text-lg leading-relaxed text-paper/85">
          There&apos;s no guest pass on this browser yet, so there&apos;s
          nothing to show. Start a session — you get one automatically — and
          every panel you earn afterward is saved here.
        </p>
        <Link
          href="/"
          className="self-start bg-pink px-7 py-4 font-mono text-stamp uppercase text-ink-deep shadow-[3px_3px_0_var(--color-ink-deep)] transition-transform hover:-translate-y-0.5 active:translate-y-0"
        >
          Start a session
        </Link>
      </main>
    );
  }

  // `student_id` is the leading column of panels_student_idx
  // (student_id, concept), so this equality filter is an index lookup, not a
  // sequential scan. Sorting by updated_at afterward is an in-memory sort
  // over one student's rows — small by construction (8 panels x a handful of
  // sessions), so it doesn't need its own index.
  const { data, error } = await supabase
    .from("panels")
    .select(
      "conversation_id, concept, panel_number, text, visual_note, source, mastery, updated_at",
    )
    .eq("student_id", user.id)
    .order("updated_at", { ascending: false })
    .returns<PanelRow[]>();

  const zines = error ? [] : groupIntoZines(data ?? []);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b-2 border-ink-edge pb-4">
        <p className="font-mono text-stamp uppercase text-paper/70">
          Professor Riso
        </p>
        <p className="font-mono text-stamp uppercase text-paper/70">
          {zines.length} {zines.length === 1 ? "zine" : "zines"}
        </p>
      </header>

      <div>
        <h1 className="font-display text-marquee sm:text-poster">
          Your shelf
        </h1>
        <p className="mt-3 max-w-prose text-lg leading-relaxed text-paper/85">
          Every sheet you&apos;ve started or finished, in your own words.
          Nobody else&apos;s zines are here — just yours.
        </p>
      </div>

      {error ? (
        <p className="font-mono text-sm leading-snug text-yellow" role="alert">
          Your shelf didn&apos;t load ({error.message}). Reload the page; if
          it keeps failing, check that the database is reachable.
        </p>
      ) : zines.length === 0 ? (
        <div className="paper p-8">
          <p className="font-mono text-stamp uppercase text-graphite-soft">
            Nothing here yet
          </p>
          <p className="mt-3 max-w-prose font-mono text-sm leading-relaxed text-graphite">
            Panels land here as you earn them in a session. Start one and
            your first zine shows up on this shelf.
          </p>
          <Link
            href="/"
            className="mt-5 inline-block bg-ink px-6 py-3 font-mono text-stamp uppercase text-paper shadow-[3px_3px_0_var(--color-graphite)] transition-transform hover:-translate-y-0.5 active:translate-y-0"
          >
            Start a session
          </Link>
        </div>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-6">
          {zines.map((zine) => {
            const filled = zine.panels.filter((panel) => panel !== null).length;
            return (
              <li key={zine.conversationId} className="flex flex-col gap-2">
                <ZineThumb panels={zine.panels} />
                <div className="flex flex-col gap-0.5">
                  <p className="font-display text-lg leading-tight">
                    {zine.concept ? `Your ${zine.concept} zine` : "Your zine"}
                  </p>
                  <p className="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-paper/60">
                    {filled} of {PANEL_COUNT} panels · {formatRelative(zine.lastTouched)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
