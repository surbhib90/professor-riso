"use client";

/**
 * The signature element: one 8-panel single-sheet fold, not eight cards.
 *
 * 4x2 grid, hairline gaps, dashed fold lines on the two fold boundaries and a
 * single solid cut line down the centre — the way a zine template is printed.
 * Paper appears here because this surface IS the stock.
 */

import { memo, type CSSProperties, type RefObject } from "react";
import type { Panel } from "@/lib/types";
import { foldClass } from "@/lib/fold-sheet";

interface ZinePaneProps {
  panels: readonly (Panel | null)[];
  nextPanel: number | null;
  concept: string;
  /** Target for the PNG export. */
  sheetRef: RefObject<HTMLDivElement | null>;
}

function ZinePane({ panels, nextPanel, concept, sheetRef }: ZinePaneProps) {
  const filled = panels.filter((panel) => panel !== null).length;

  return (
    <section aria-labelledby="zine-heading" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="zine-heading" className="font-display text-2xl tracking-tight">
          Your sheet
        </h2>
        <p className="font-mono text-stamp uppercase text-paper/70">
          {filled} of 8 panels
          {concept ? ` · ${concept}` : ""}
        </p>
      </div>

      {/*
        A sheet of paper does not reflow, so the fold never becomes 2x4 on a
        phone: it keeps a legible minimum width and pans inside its own box.
        The scroll lives on the wrapper, not on `sheetRef`, so the PNG export
        still captures the whole sheet rather than the visible slice.
      */}
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <div ref={sheetRef} className="paper min-w-[28rem] p-2 sm:p-3">
          <div className="fold-sheet">
            {panels.map((panel, index) => {
              const panelNumber = index + 1;
              const isNext = panel === null && panelNumber === nextPanel;
              const rowTwo = index >= 4;

              return (
                <article
                  key={panelNumber}
                  className={[
                    "relative flex min-w-0 flex-col gap-1 overflow-hidden bg-paper p-2 sm:p-2.5",
                    foldClass(index),
                    rowTwo ? "border-t border-dashed border-graphite-soft" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-mono text-stamp uppercase text-graphite-soft">
                      {panelNumber}
                    </span>
                    {panel && panel.mastery !== "none" ? (
                      <span
                        className={
                          panel.mastery === "first-try"
                            ? "stamp stamp-first"
                            : "stamp stamp-retry"
                        }
                        style={{ "--tilt": panel.mastery === "first-try" ? "-4deg" : "3deg" } as CSSProperties}
                      >
                        {panel.mastery === "first-try" ? "1st try" : "retry"}
                      </span>
                    ) : null}
                  </div>

                  {panel ? (
                    <>
                      <p className="min-w-0 break-words text-[0.74rem] leading-snug text-graphite">
                        {panel.text}
                      </p>
                      {panel.visualNote ? (
                        <p className="break-words font-mono text-[0.6rem] leading-snug text-graphite-soft">
                          {panel.visualNote}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <p className="font-mono text-[0.6rem] uppercase tracking-widest text-graphite-soft/70">
                      {isNext ? "next up" : "blank"}
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      </div>

      <p className="font-mono text-stamp uppercase text-paper/50">
        Dashed lines fold. The centre line cuts.
        {/* The sheet pans below the sm breakpoint; say so rather than let a
            student assume four panels is all there is. */}
        <span className="sm:hidden"> Swipe the sheet to reach panels 4 and 8.</span>
      </p>
    </section>
  );
}

export default memo(ZinePane);
