"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_DIFFICULTY, type Difficulty } from "@/lib/prefill";
import { PANEL_COUNT } from "@/lib/types";

/**
 * D14: students never see a login. Anonymous sign-in fires on mount, gives us
 * a real stable `auth.uid()` for RLS and memory, and costs zero clicks. The
 * only visible trace is the guest tag in the corner.
 */
type SignInState =
  | { status: "signing-in" }
  | { status: "ready"; studentId: string }
  | { status: "failed"; reason: string };

interface Choice {
  difficulty: Difficulty;
  /** Named by what the student controls: the panels they write. */
  label: string;
  detail: string;
}

const CHOICES: readonly Choice[] = [
  {
    difficulty: 0,
    label: "You write all 8",
    detail: "Nothing is printed yet. You and the professor build the whole sheet.",
  },
  {
    difficulty: 2,
    label: "You write 6",
    detail: "Two panels arrive as worked examples to borrow from.",
  },
  {
    difficulty: 4,
    label: "You write 4",
    detail: "Half the sheet arrives filled in. This is the one that fits fifteen minutes.",
  },
];

interface ClassOption {
  id: string;
  label: string;
}

/** Only one class exists right now; the select is real, the list just has one row. */
const CLASSES: readonly ClassOption[] = [{ id: "cs101", label: "CS 101" }];

interface Topic {
  id: string;
  label: string;
}

type TopicsState =
  | { status: "loading" }
  | { status: "ready"; topics: readonly Topic[] }
  | { status: "error" };

export default function SessionStart({
  classId: initialClassId,
  concept: initialConcept,
}: {
  classId: string;
  concept: string | null;
}) {
  const router = useRouter();
  const [auth, setAuth] = useState<SignInState>({ status: "signing-in" });
  const [difficulty, setDifficulty] = useState<Difficulty>(DEFAULT_DIFFICULTY);
  const [starting, setStarting] = useState(false);

  const [classId, setClassId] = useState(
    CLASSES.some((c) => c.id === initialClassId) ? initialClassId : CLASSES[0].id
  );
  const [concept, setConcept] = useState(initialConcept ?? "");
  const [topicsState, setTopicsState] = useState<TopicsState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function loadTopics() {
      try {
        const res = await fetch(`/api/topics?classId=${encodeURIComponent(classId)}`);
        if (cancelled) return;
        if (!res.ok) {
          setTopicsState({ status: "error" });
          return;
        }
        const body = (await res.json()) as { topics: readonly Topic[] };
        setTopicsState({ status: "ready", topics: body.topics });
        // A shared link's ?concept= might not match any real topic label —
        // only trust it once we know what the real options are.
        setConcept((current) => {
          if (current && body.topics.some((t) => t.label === current)) return current;
          return body.topics[0]?.label ?? "";
        });
      } catch (err) {
        if (cancelled) return;
        console.error("[session-start] failed to load topics", err);
        setTopicsState({ status: "error" });
      }
    }

    void loadTopics();
    return () => {
      cancelled = true;
    };
  }, [classId]);

  useEffect(() => {
    let cancelled = false;

    async function signIn() {
      try {
        const supabase = createClient();
        // Re-entering /session in the same browser must not mint a second
        // guest — that would orphan the first one's zines.
        const { data: existing } = await supabase.auth.getSession();
        if (cancelled) return;
        if (existing.session) {
          setAuth({ status: "ready", studentId: existing.session.user.id });
          return;
        }

        const { data, error } = await supabase.auth.signInAnonymously();
        if (cancelled) return;
        if (error || !data.user) {
          setAuth({
            status: "failed",
            reason: error?.message ?? "Supabase returned no user.",
          });
          return;
        }
        setAuth({ status: "ready", studentId: data.user.id });
      } catch (err) {
        if (cancelled) return;
        setAuth({
          status: "failed",
          reason: err instanceof Error ? err.message : "Unknown error.",
        });
      }
    }

    void signIn();
    return () => {
      cancelled = true;
    };
  }, []);

  const canStart = auth.status === "ready" && concept.trim().length > 0 && !starting;

  const start = useCallback(() => {
    if (!canStart) return;
    setStarting(true);
    const params = new URLSearchParams({
      classId,
      concept,
      difficulty: String(difficulty),
    });
    router.push(`/session/hair-check?${params.toString()}`);
  }, [canStart, classId, concept, difficulty, router]);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-10 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b-2 border-ink-edge pb-4">
        <p className="font-mono text-stamp uppercase text-paper/70">
          Professor Riso — session start
        </p>
        <p className="font-mono text-stamp uppercase text-paper/70">
          Class {classId}
        </p>
      </header>

      <div className="misreg">
        <h1 className="font-display text-marquee sm:text-poster text-balance">
          You&apos;re making a zine about{" "}
          <span className="text-pink">{concept || "your topic"}</span>.
        </h1>
      </div>

      <p className="max-w-prose text-lg leading-relaxed text-paper/85">
        Eight panels on one folded sheet. You sketch what you think each panel
        means, the professor tests it with a new problem, and the panel gets
        printed once you&apos;ve got it. Fifteen minutes, then you export the sheet.
      </p>

      <div className="grid gap-6 sm:grid-cols-2">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-mono text-stamp uppercase text-yellow">
            Class
          </legend>
          <select
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
            className="border-2 border-ink-edge bg-ink-deep px-4 py-3 font-mono text-base text-paper focus:border-paper/60"
          >
            {CLASSES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-mono text-stamp uppercase text-yellow">
            Topic
          </legend>
          {topicsState.status === "loading" ? (
            <p
              className="border-2 border-ink-edge bg-ink-deep px-4 py-3 font-mono text-stamp uppercase text-paper/60"
              role="status"
            >
              Loading topics…
            </p>
          ) : topicsState.status === "error" || topicsState.topics.length === 0 ? (
            <p className="border-2 border-ink-edge bg-ink-deep px-4 py-3 font-mono text-xs leading-snug text-yellow" role="alert">
              Couldn&apos;t load topics. Reload the page to try again.
            </p>
          ) : (
            <select
              value={concept}
              onChange={(e) => setConcept(e.target.value)}
              className="border-2 border-ink-edge bg-ink-deep px-4 py-3 font-mono text-base text-paper focus:border-paper/60"
            >
              {topicsState.topics.map((topic) => (
                <option key={topic.id} value={topic.label}>
                  {topic.label}
                </option>
              ))}
            </select>
          )}
        </fieldset>
      </div>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-4 font-mono text-stamp uppercase text-yellow">
          Pick how many panels you write
        </legend>

        <div className="grid gap-4 sm:grid-cols-3">
          {CHOICES.map((choice) => (
            <ChoiceCard
              key={choice.difficulty}
              choice={choice}
              selected={difficulty === choice.difficulty}
              onSelect={setDifficulty}
            />
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t-2 border-ink-edge pt-6">
        <button
          type="button"
          onClick={start}
          disabled={!canStart}
          className="bg-pink px-7 py-4 font-mono text-stamp uppercase text-ink-deep shadow-[3px_3px_0_var(--color-ink-deep)] transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:cursor-not-allowed disabled:bg-ink-edge disabled:text-paper/50 disabled:shadow-none disabled:hover:translate-y-0"
        >
          {starting ? "Opening the studio…" : "Start the session"}
        </button>

        <AuthNote auth={auth} />
      </div>
    </main>
  );
}

function ChoiceCard({
  choice,
  selected,
  onSelect,
}: {
  choice: Choice;
  selected: boolean;
  onSelect: (d: Difficulty) => void;
}) {
  return (
    <label
      className={`flex cursor-pointer flex-col gap-3 border-2 p-4 transition-colors has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-yellow ${selected
          ? "border-pink bg-ink-deep"
          : "border-ink-edge hover:border-paper/50"
        }`}
    >
      <input
        type="radio"
        name="difficulty"
        value={choice.difficulty}
        checked={selected}
        onChange={() => onSelect(choice.difficulty)}
        className="peer sr-only"
      />
      {/* The preview is the sheet itself, so it is the only paper here. */}
      <div className="relative">
        <SheetPreview printed={choice.difficulty} />
        {selected ? (
          <span
            // Decorative: the radio's checked state already announces this.
            aria-hidden="true"
            className="stamp absolute -top-2 -right-2 bg-paper text-yellow"
            style={{ ["--tilt" as string]: "-8deg" }}
          >
            Picked
          </span>
        ) : null}
      </div>
      <div>
        <p className="font-display text-xl leading-tight">{choice.label}</p>
        <p className="mt-1 text-sm leading-snug text-paper/70">{choice.detail}</p>
      </div>
    </label>
  );
}

/** A miniature of the fold sheet: printed panels carry ruled ink, yours don't. */
function SheetPreview({ printed }: { printed: number }) {
  return (
    <div className="paper p-[3px]">
      <div className="grid aspect-[4/2.4] grid-cols-4 grid-rows-2 gap-px bg-paper-shade">
        {Array.from({ length: PANEL_COUNT }, (_, i) => (
          <div
            key={i}
            className="flex flex-col justify-center gap-[3px] bg-paper px-1.5"
            aria-hidden="true"
          >
            {i < printed ? (
              <>
                <span className="block h-px bg-graphite/70" />
                <span className="block h-px w-4/5 bg-graphite/70" />
                <span className="block h-px w-3/5 bg-graphite/70" />
              </>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function AuthNote({ auth }: { auth: SignInState }) {
  if (auth.status === "signing-in") {
    return (
      <p className="font-mono text-stamp uppercase text-paper/60" role="status">
        Setting up your guest pass…
      </p>
    );
  }

  if (auth.status === "failed") {
    return (
      <p className="font-mono text-xs leading-snug text-yellow" role="alert">
        Your guest pass didn&apos;t come through ({auth.reason}). Reload the page
        to try again.
      </p>
    );
  }

  return (
    <p className="font-mono text-stamp uppercase text-paper/60" role="status">
      Guest {auth.studentId.slice(0, 8)} — no email, no password
    </p>
  );
}
