/**
 * Shared geometry for rendering the 8-panel fold sheet.
 *
 * Extracted from ZinePane.tsx and shelf/ZineThumb.tsx, which had drifted into
 * two copies of the same "column 2 is the cut line" logic — a real DRY
 * violation flagged in /plan-ceo-review (2026-07-28). Both surfaces render
 * the same physical object (a live sheet, and a read-only thumbnail of a
 * past one) and must agree on its geometry by construction, not by two
 * developers remembering to keep two files in sync.
 */

export function foldClass(index: number): string {
  const column = index % 4;
  if (column === 2) return "fold-line-cut"; // the one cut
  if (column === 1 || column === 3) return "fold-line-v"; // folds
  return "";
}
