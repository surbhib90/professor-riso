"use client";

import type { CanvasRendererProps } from "@/app/components/cvi/components/magic-canvas";

/**
 * Native renderer for Magic Canvas's canvas.question@v1 component.
 *
 * Registered in ConversationSurface as renderComponent["canvas.question@v1"].
 * Renders at the transfer-test step (panelChain "test" node) — the PAL poses
 * a new problem and asks whether and how the concept applies. Answering here
 * is additional to the spoken answer, not a replacement: the PAL still judges
 * the verbal response per the objective prompt; this gives the student a
 * visible record of the question and optionally captures a structured answer.
 *
 * Uses the project's existing Tailwind classes (paper, ink-edge, pink, etc.)
 * so it integrates with the zine aesthetic without extra CSS.
 */
export default function CanvasQuestionCard({ args, submit }: CanvasRendererProps) {
    const question = typeof args.question === "string" ? args.question : "";
    const options = Array.isArray(args.options)
        ? (args.options as unknown[]).filter((o): o is string => typeof o === "string")
        : [];

    return (
        <div className="paper flex flex-col gap-3 p-4 shadow-[2px_2px_0_var(--color-ink-deep)]">
            <p className="font-display text-lg text-ink-deep">{question}</p>

            {options.length > 0 ? (
                <div className="flex flex-col gap-2">
                    {options.map((option, i) => (
                        <button
                            key={i}
                            type="button"
                            onClick={() =>
                                submit({
                                    type: "submit",
                                    value: { selected_option_id: String(i), skipped: false },
                                })
                            }
                            className="border-2 border-ink-edge px-4 py-2 text-left font-mono text-sm text-ink-deep hover:border-pink hover:text-pink transition-colors"
                        >
                            {option}
                        </button>
                    ))}
                </div>
            ) : (
                <p className="font-mono text-xs uppercase text-graphite-soft">
                    Answer out loud — this card is just a record of the question.
                </p>
            )}
        </div>
    );
}
