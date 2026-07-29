/**
 * Difficulty picker constants (D10). Purely a UI/session-start concern.
 *
 * D19 superseded the client-side prefill mechanism this file used to hold:
 * `prefill_panels` table reads/writes, `prefillZine`, `loadPrefillPanels`.
 * Worked-example panels are now generated live by the PAL itself at session
 * start (see lib/tavus/objectives-config.json's leadIn node and
 * lib/tavus/pal-config.json's system prompt) and arrive through the same
 * tool-call path as every other panel — there is nothing left for the client
 * to precompute or persist ahead of time. Only the picker's own vocabulary
 * (which difficulties exist, which is the default) survives here.
 */

export type Difficulty = 0 | 2 | 4;

export const DIFFICULTY_OPTIONS: readonly Difficulty[] = [0, 2, 4];

/** D10: 10 minutes cannot fit 8 student-authored panels. Half is the demo. */
export const DEFAULT_DIFFICULTY: Difficulty = 4;
