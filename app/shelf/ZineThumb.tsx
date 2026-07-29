import type { Panel } from "@/lib/types";
import { foldClass } from "@/lib/fold-sheet";

interface ZineThumbProps {
  panels: readonly (Panel | null)[];
}

/**
 * A read-only, scaled-down rendering of the same object ZinePane.tsx draws
 * live: the 4x2 grid, dashed fold lines, one solid cut — same classes
 * (.paper, .fold-sheet, .fold-line-*), just smaller. No ref (nothing exports
 * this one), no "next up" panel (a shelf card is a record of a session, not
 * a live surface with a next step) and no visual-note line (there isn't
 * room at this scale without the sheet turning into a wall of text).
 *
 * An empty slot renders as plain "blank" paper, matching how ZinePane.tsx
 * treats a not-yet-filled panel when it isn't the live "next up" one.
 */
export default function ZineThumb({ panels }: ZineThumbProps) {
  return (
    <div className="paper p-1.5 sm:p-2">
      <div className="fold-sheet">
        {panels.map((panel, index) => {
          const panelNumber = index + 1;
          const rowTwo = index >= 4;

          return (
            <article
              key={panelNumber}
              className={[
                "relative flex min-w-0 flex-col gap-0.5 overflow-hidden bg-paper p-1 sm:p-1.5",
                foldClass(index),
                rowTwo ? "border-t border-dashed border-graphite-soft" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span className="block font-mono text-[0.5rem] uppercase leading-none text-graphite-soft">
                {panelNumber}
              </span>

              {panel ? (
                <p className="min-w-0 break-words text-[0.5rem] leading-snug text-graphite">
                  {panel.text}
                </p>
              ) : (
                <p className="font-mono text-[0.45rem] uppercase tracking-widest text-graphite-soft/70">
                  blank
                </p>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
