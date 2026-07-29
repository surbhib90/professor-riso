"use client";

/**
 * The cover of the print shop.
 *
 * The hero is the artifact, not a headline over a gradient: a real 8-panel
 * single-sheet fold, filled with a recursion zine the way a finished session
 * leaves it — animated, so a visitor watches it get built the same way a
 * real session builds one, then it resets and loops.
 *
 * Below the fold, the print-shop motifs recur rather than stopping at the
 * hero: stamp-styled step numbers, a taped highlight on the thesis, and
 * stamp-styled instructor stats. Section backgrounds alternate ink/ink-deep
 * for scroll rhythm, each carrying its own halftone texture.
 *
 * Panel geometry mirrors app/conversation/ZinePane.tsx exactly (dashed folds,
 * one solid cut down the centre) so the sheet a visitor sees here is the same
 * sheet they end up making.
 */

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";

/** The demo link. Read by /session as a search param; topic is picked there. */
const DEMO_CLASS = "cs101";
const START_HREF = `/session?class=${DEMO_CLASS}`;

interface HeroPanel {
  text: string;
  visualNote?: string;
}

/**
 * A plausible finished sheet: a student's own words after light polish.
 * Nothing here is a quote from a real student — it is a worked example of
 * the format.
 */
const HERO_PANELS: readonly HeroPanel[] = [
  {
    text: "A function that calls itself on a smaller version of the same problem.",
    visualNote: "nesting dolls, one cut open",
  },
  {
    text: "The base case is the smallest input you can answer without calling again.",
  },
  {
    text: "No base case, no stopping. That is the call stack running out of room.",
    visualNote: "stack of trays, one too many",
  },
  {
    text: "Each call waits on the one under it. The stack is the waiting.",
  },
  {
    text: "factorial(4) waits on 3, waits on 2, waits on 1. One is the floor.",
    visualNote: "ladder down a well",
  },
  {
    text: "Then the answers climb back up: 1, then 2, then 6, then 24.",
  },
  {
    text: "Tree recursion branches twice, so the same subproblem gets solved twice.",
  },
  {
    text: "Memoise: write each answer down once, look it up every time after.",
    visualNote: "index card taped to the wall",
  },
];

interface Step {
  number: string;
  heading: string;
  body: string;
}

interface FoldStep {
  swatch: "cut" | "fold" | null;
  body: string;
}

/**
 * The real assembly sequence for a single-sheet 8-page zine — the same fold
 * the hero's dashed/solid lines describe. Matches the classic no-staple fold:
 * cut the centre line halfway, accordion-fold the sides, fold in half again
 * so the cut opens into a star, then push the ends into a booklet.
 */
const FOLD_STEPS: readonly FoldStep[] = [
  { swatch: "cut", body: "Cut the solid centre line — stop halfway, at the sheet's middle." },
  { swatch: "fold", body: "Fold the two dashed lines like a fan, accordion-style." },
  { swatch: "cut", body: "Fold the sheet in half along the cut. It opens into a star." },
  { swatch: null, body: "Push the ends together and flatten into a booklet — that's the zine, your study guide." },
];

const STEPS: readonly Step[] = [
  {
    number: "01",
    heading: "You write first",
    body: "Type or sketch your own idea on the canvas before anything else. Professor Riso reads what you wrote and have a conversation with you.",
  },
  {
    number: "02",
    heading: "It tests what you wrote",
    body: "Not “say it back.” A new problem checks whether your idea actually holds up, and it listens for real hesitation, not just your words. Wobble, and you get one re-explanation, then one more try. Still stuck, and it shows you the real lecture slide instead of guessing.",
  },
  {
    number: "03",
    heading: "The panel gets printed",
    body: "Once it holds, your own words go on the sheet — proof you actually learned it. Still shaky after the retry? No shame — the professor fills it in, clearly marked as theirs, so you always know what's truly yours. Eight panels, ten minutes, then export.",
  },
];

/** Panels reveal one at a time, then hold fully filled, then fade and loop. */
const FILL_STEP_MS = 450;
const HOLD_MS = 3500;
const FADE_MS = 400;

type HeroPhase = "filling" | "hold" | "fading";

/**
 * Drives the hero's fill → hold → fade → loop cycle.
 *
 * Starts fully filled (not empty): that's the correct state for the initial
 * server-rendered paint and for any client that never runs the effect (no
 * JS, or `prefers-reduced-motion`), so the hero always has a complete,
 * readable sheet as its baseline rather than a blank one.
 *
 * `prefers-reduced-motion` is checked explicitly and short-circuits the
 * whole loop back to the static filled state — relying on the global CSS
 * rule that zeroes animation durations would instead produce a rapid
 * flicker between blank and filled, which is the opposite of what a
 * reduced-motion user wants.
 */
function useHeroFold(panelCount: number): { visibleCount: number; phase: HeroPhase } {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [visibleCount, setVisibleCount] = useState(panelCount);
  const [phase, setPhase] = useState<HeroPhase>("hold");

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (reduced) return;

    let cancelled = false;
    let count = 0;
    const timers: number[] = [];

    const fillNext = () => {
      if (cancelled) return;
      count += 1;
      setVisibleCount(count);
      if (count < panelCount) {
        timers.push(window.setTimeout(fillNext, FILL_STEP_MS));
      } else {
        setPhase("hold");
        timers.push(window.setTimeout(startFade, HOLD_MS));
      }
    };

    const startFade = () => {
      if (cancelled) return;
      setPhase("fading");
      timers.push(window.setTimeout(restart, FADE_MS));
    };

    const restart = () => {
      if (cancelled) return;
      count = 0;
      setVisibleCount(0);
      setPhase("filling");
      timers.push(window.setTimeout(fillNext, FILL_STEP_MS));
    };

    timers.push(window.setTimeout(restart, 0));

    return () => {
      cancelled = true;
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [reduced, panelCount]);

  if (reduced) return { visibleCount: panelCount, phase: "hold" };
  return { visibleCount, phase };
}

export default function Home() {
  const { visibleCount, phase } = useHeroFold(HERO_PANELS.length);

  return (
    <main className="flex flex-1 flex-col">
      {/* --- Hero band: the sheet is the argument -------------------------- */}
      <section className="band-ink">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-16 px-5 py-10 sm:gap-20 sm:px-8 sm:py-14">
          <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b-2 border-ink-edge pb-4">
            <p className="font-mono text-stamp uppercase text-paper/70">
              Professor Riso
            </p>
            <p className="font-mono text-stamp uppercase text-paper/70">
              A tutor who notices when you&apos;re stuck
            </p>
          </header>

          <div className="grid items-start gap-10 lg:grid-cols-12 lg:gap-12">
            <div className="flex flex-col gap-6 lg:col-span-5">
              <h1 className="text-balance font-display text-marquee sm:text-poster">
                Explain the concept yourself.{" "}
                <span className="text-pink">The sheet is the proof.</span>
              </h1>

              <p className="max-w-prose text-lg leading-relaxed text-paper/85">
                Professor Riso is a video AI tutor built for real
                understanding, not repetition. Students explain a concept,
                then it&apos;s tested against a problem they haven&apos;t
                seen — listening for real hesitation, not just words. What
                holds up prints onto a single-sheet study zine, in the
                student&apos;s own voice.
              </p>

              <div className="flex flex-col gap-3 border-t-2 border-ink-edge pt-6">
                <Link
                  href={START_HREF}
                  className="self-start bg-pink px-7 py-4 font-mono text-stamp uppercase text-ink-deep shadow-[3px_3px_0_var(--color-ink-deep)] transition-transform hover:-translate-y-0.5 active:translate-y-0"
                >
                  Start a ten-minute session
                </Link>
                <p className="font-mono text-stamp uppercase text-paper/60">
                  No sign-up — you get a guest pass when the session opens
                </p>
              </div>
            </div>

            <figure className="flex flex-col gap-3 lg:col-span-7">
              {/*
                A sheet of paper does not reflow, so the fold stays 4x2 on a
                phone and pans inside its own box instead of restacking.
              */}
              <div className="-mx-1 overflow-x-auto px-1 pb-1">
                <div className="paper min-w-[27rem] p-2 sm:p-3">
                  <div className="fold-sheet">
                    {HERO_PANELS.map((panel, index) => {
                      const visible = phase !== "fading" && index < visibleCount;
                      return (
                        <article
                          key={panel.text}
                          className={[
                            "relative flex min-w-0 flex-col gap-1 overflow-hidden bg-paper p-2 transition-opacity duration-300 sm:p-2.5",
                            visible ? "opacity-100" : "opacity-0",
                            foldClass(index),
                            index >= 4 ? "border-t border-dashed border-graphite-soft" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          <span className="font-mono text-stamp uppercase text-graphite-soft">
                            {index + 1}
                          </span>

                          <p className="min-w-0 break-words text-[0.72rem] leading-snug text-graphite sm:text-[0.78rem]">
                            {panel.text}
                          </p>
                          {panel.visualNote ? (
                            <p className="break-words font-mono text-[0.6rem] leading-snug text-graphite-soft">
                              {panel.visualNote}
                            </p>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>

                  {/* Cut-and-fold assembly: the same sheet the visitor is
                      looking at, turned into physical instructions. */}
                  <ol className="mt-2 flex flex-col gap-1.5 border-t border-dashed border-graphite-soft/60 px-1 pt-3">
                    {FOLD_STEPS.map((step, index) => (
                      <li key={step.body} className="flex items-start gap-2">
                        <span className="font-mono text-[0.62rem] text-graphite-soft">
                          {index + 1}.
                        </span>
                        {step.swatch ? (
                          <span
                            className={[
                              "swatch-line mt-[0.45rem] shrink-0",
                              step.swatch === "cut" ? "swatch-cut" : "swatch-fold",
                            ].join(" ")}
                            aria-hidden="true"
                          />
                        ) : (
                          <span className="w-[1.1rem] shrink-0" aria-hidden="true" />
                        )}
                        <span className="font-mono text-[0.62rem] leading-snug text-graphite-soft">
                          {step.body}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>

              <figcaption className="font-mono text-stamp uppercase leading-relaxed text-paper/50">
                A finished sheet on recursion. Dashed lines fold, the centre
                line cuts.
                <span className="sm:hidden"> Swipe it to reach panels 4 and 8.</span>
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      {/* --- How the ten minutes goes --------------------------------------- */}
      <section className="band-ink-deep border-t border-ink-edge">
        <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
          <section aria-labelledby="how-heading" className="flex flex-col gap-8">
            <h2 id="how-heading" className="font-display text-marquee text-balance">
              How one panel gets made
            </h2>

            <ol className="grid gap-8 sm:grid-cols-3 sm:gap-6">
              {STEPS.map((step, index) => (
                <li key={step.number} className="flex flex-col gap-2">
                  <span
                    className="stamp w-fit text-yellow"
                    style={{ "--tilt": tiltFor(index + 1) } as CSSProperties}
                  >
                    {step.number}
                  </span>
                  <h3 className="font-display text-xl leading-tight">
                    {step.heading}
                  </h3>
                  <p className="text-base leading-relaxed text-paper/80">
                    {step.body}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </section>

      {/* --- The thesis ------------------------------------------------------ */}
      <section className="band-ink border-t border-ink-edge">
        <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
          <section aria-labelledby="thesis-heading" className="flex flex-col gap-6">
            {/* The page's one misregistration. `.misreg` prints an offset pink
                impression behind a transparent-background element, so it belongs
                on a small label like this — behind a poster-sized heading the
                same rectangle just reads as a highlighter swipe. */}
            <p className="misreg w-fit px-2 py-1 font-mono text-stamp uppercase text-yellow">
              Why the format matters
            </p>
            <h2 id="thesis-heading" className="max-w-3xl text-balance font-display text-marquee">
              You cannot cram for a problem you haven&apos;t seen.
            </h2>

            <p className="max-w-prose text-lg leading-relaxed text-paper/85">
              A concept that only survives being repeated back does not
              survive a new problem. Every panel on this sheet is tested
              against one the student has never seen — so what gets stamped
              is{" "}
              <span className="misreg-hover text-pink">
                evidence of understanding, not a transcript
              </span>
              .
            </p>
          </section>
        </div>
      </section>

      {/* --- Instructor side --------------------------------------------------- */}
      <section className="band-ink-deep border-t border-ink-edge">
        <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
          <section aria-labelledby="instructor-heading" className="flex flex-col gap-5">
            <h2 id="instructor-heading" className="font-display text-marquee text-balance">
              What instructors see after each session
            </h2>
            <p className="max-w-prose text-base leading-relaxed text-paper/80">
              Every session is time-boxed and transparently documented. Work a
              student completes is credited as theirs. Concepts they haven&apos;t
              mastered yet are flagged so instructors know where to help next.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <span className="stamp text-paper/80" style={{ "--tilt": "-2deg" } as CSSProperties}>
                8 panels tracked
              </span>
              <span className="stamp text-paper/80" style={{ "--tilt": "3deg" } as CSSProperties}>
                10 min hard cap
              </span>
              <span className="stamp text-paper/80" style={{ "--tilt": "-3deg" } as CSSProperties}>
                1 re-explanation max per panel
              </span>
              <span className="stamp text-paper/80" style={{ "--tilt": "2deg" } as CSSProperties}>
                Unfinished panels marked for support
              </span>
            </div>
            <Link
              href={`/class/${DEMO_CLASS}`}
              className="misreg-hover self-start font-mono text-stamp uppercase text-yellow underline underline-offset-4 hover:text-pink"
            >
              Open the {DEMO_CLASS} ledger — instructors sign in
            </Link>
          </section>
        </div>
      </section>

      {/* --- Close -------------------------------------------------------------- */}
      <section className="band-ink border-t border-ink-edge">
        <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
          <footer className="flex flex-col gap-6">
            <p className="max-w-prose font-mono text-sm leading-relaxed text-paper/60">
              Built on Tavus CVI.
            </p>
            <Link
              href={START_HREF}
              className="self-start bg-pink px-7 py-4 font-mono text-stamp uppercase text-ink-deep shadow-[3px_3px_0_var(--color-ink-deep)] transition-transform hover:-translate-y-0.5 active:translate-y-0"
            >
              Start a ten-minute session
            </Link>
          </footer>
        </div>
      </section>
    </main>
  );
}

/** Deterministic per panel, so the stamps never all tilt the same way. */
function tiltFor(panelNumber: number): string {
  return `${((panelNumber * 37) % 9) - 4}deg`;
}

/** Column 2 is the single cut; columns 1 and 3 are folds. */
function foldClass(index: number): string {
  const column = index % 4;
  if (column === 2) return "fold-line-cut";
  if (column === 1 || column === 3) return "fold-line-v";
  return "";
}
