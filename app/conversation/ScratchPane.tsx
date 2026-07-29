"use client";

/**
 * The scratch sheet: the student's own stock. Excalidraw is client-only, so it
 * is dynamically imported with ssr:false. This pane owns the scene API and
 * hands raw elements up — summarizing is the bridge's job, not the view's.
 */

import dynamic from "next/dynamic";
import { memo, useRef, type ReactNode } from "react";
import type { SceneElement } from "@/lib/excalidraw-summarize";
import "@excalidraw/excalidraw/index.css";

const Excalidraw = dynamic(
  async () => (await import("@excalidraw/excalidraw")).Excalidraw,
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center font-mono text-stamp uppercase text-graphite-soft">
        Loading the scratch sheet
      </div>
    ),
  },
);

interface SceneApi {
  getSceneElements(): readonly SceneElement[];
}

// Hoisted so these object literals are never recreated across renders — a new
// reference passed into Excalidraw on every re-render (e.g. the wrap-up
// clock's once-a-second setElapsed in ConversationSurface) is unnecessary
// churn for a canvas library this heavy.
const INITIAL_DATA = { appState: { viewBackgroundColor: "#f2f1ec" } };
const UI_OPTIONS = {
  canvasActions: {
    changeViewBackgroundColor: false,
    export: false,
    loadScene: false,
    saveToActiveFile: false,
    toggleTheme: false,
    saveAsImage: false,
  },
} as const;

interface ScratchPaneProps {
  onSubmit(elements: readonly SceneElement[]): void;
  /** A submission is in flight; a second click would send a duplicate turn. */
  busy: boolean;
  /** Live explanation of why a send would not go through, or the last result. */
  notice: string | null;
  /** Panel the professor is waiting on, for the pane's own heading. */
  panelHint: number | null;
  /** Secondary controls (the attach button) rendered beside Send, same row. */
  children?: ReactNode;
}

function ScratchPane({
  onSubmit,
  busy,
  notice,
  panelHint,
  children,
}: ScratchPaneProps) {
  const apiRef = useRef<SceneApi | null>(null);

  return (
    <section aria-labelledby="scratch-heading" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="scratch-heading" className="font-display text-2xl tracking-tight">
          Scratch sheet
        </h2>
        <p className="font-mono text-stamp uppercase text-paper/70">
          {panelHint === null ? "sheet full" : `working on panel ${panelHint}`}
        </p>
      </div>

      <div className="paper h-[46vh] min-h-[280px] p-2 lg:h-[52vh]">
        <div className="h-full w-full overflow-hidden">
          <Excalidraw
            excalidrawAPI={(api) => {
              apiRef.current = api;
            }}
            initialData={INITIAL_DATA}
            UIOptions={UI_OPTIONS}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => onSubmit(apiRef.current?.getSceneElements() ?? [])}
          className="bg-yellow px-4 py-2.5 font-mono text-stamp uppercase text-ink-deep shadow-[2px_2px_0_var(--color-ink-deep)] transition-colors hover:bg-pink hover:text-paper disabled:cursor-not-allowed disabled:opacity-50 sm:py-2"
        >
          {busy ? "Sending notes" : "Send notes to Professor Riso"}
        </button>
        {children}
        <p aria-live="polite" className="min-w-0 flex-1 text-sm text-paper/80">
          {notice}
        </p>
      </div>
    </section>
  );
}

export default memo(ScratchPane);
