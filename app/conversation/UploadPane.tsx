"use client";

/**
 * Attach a photo of your notes or a PDF, mid-session. Checked against the
 * session's topic before it goes anywhere — a rejected file never leaves the
 * browser's memory, an approved one lands in the Tavus knowledge base and
 * (once processing finishes) starts grounding future sessions on this topic.
 * See app/api/knowledge/upload/route.ts for the pipeline.
 */

import { useState, type ChangeEvent } from "react";
import type { UploadKnowledgeResult } from "./data-adapter";

const ACCEPT = "application/pdf,image/png,image/jpeg";

export type UploadPaneStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "added" }
  | { kind: "rejected"; reason: string }
  | { kind: "error"; message: string };

interface UploadPaneProps {
  concept: string;
  onUpload(file: File): Promise<UploadKnowledgeResult>;
}

export default function UploadPane({ concept, onUpload }: UploadPaneProps) {
  const [status, setStatus] = useState<UploadPaneStatus>({ kind: "idle" });

  const handleChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset immediately so picking the same file again still fires onChange.
    event.target.value = "";
    if (!file) return;

    setStatus({ kind: "checking" });
    const result = await onUpload(file);
    if (result.ok && result.added) {
      setStatus({ kind: "added" });
    } else if (result.ok) {
      setStatus({ kind: "rejected", reason: result.reason });
    } else {
      setStatus({ kind: "error", message: result.message });
    }
  };

  const busy = status.kind === "checking";
  const notice = noticeFor(status, concept);

  const label = busy ? "Checking relevance…" : "Attach a photo or PDF";

  return (
    // Icon-only and quieter than ScratchPane's send button on purpose: this is
    // an occasional, optional aside, not a second control competing for
    // attention next to the timed send-notes button it shares a row with —
    // see ScratchPane's `children` slot, where ConversationSurface renders this.
    <>
      <input
        type="file"
        accept={ACCEPT}
        onChange={(e) => void handleChange(e)}
        disabled={busy}
        className="sr-only"
        id="knowledge-upload-input"
      />
      <label
        htmlFor="knowledge-upload-input"
        aria-label={label}
        title={label}
        className={`inline-flex size-9 shrink-0 cursor-pointer items-center justify-center border border-paper/35 text-paper/65 transition-colors hover:border-yellow hover:text-yellow ${
          busy ? "pointer-events-none opacity-50" : ""
        }`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21.44 11.05l-9.19 9.19a5 5 0 0 1-7.07-7.07l9.19-9.19a3 3 0 0 1 4.24 4.24L9.6 17.24a1 1 0 0 1-1.42-1.42l8.49-8.48" />
        </svg>
      </label>
      {notice ? (
        <span aria-live="polite" className="basis-full text-xs text-paper/60">
          {notice}
        </span>
      ) : null}
    </>
  );
}

export function noticeFor(status: UploadPaneStatus, concept: string): string | null {
  switch (status.kind) {
    case "idle":
      return null;
    case "checking":
      return "Checking whether this is about " + (concept || "your topic") + "…";
    case "added":
      return "Added — Professor Riso can use this once it finishes processing (a few minutes).";
    case "rejected":
      return `Not added — ${status.reason}`;
    case "error":
      return status.message;
    default:
      return null;
  }
}
