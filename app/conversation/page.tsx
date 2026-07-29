"use client";

import { Suspense } from "react";
import ConversationSurface from "./ConversationSurface";

/**
 * `useSearchParams` needs a Suspense boundary; the fallback is the same ink
 * field with a quiet status line so the page never flashes empty.
 */
export default function ConversationPage() {
  return (
    <Suspense
      fallback={
        <main className="flex flex-1 items-center justify-center p-6">
          <p className="font-mono text-stamp uppercase text-paper/70">
            Setting up the worktable
          </p>
        </main>
      }
    >
      <ConversationSurface />
    </Suspense>
  );
}
