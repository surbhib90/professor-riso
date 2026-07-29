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

  return (
    <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
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
        className={`w-full cursor-pointer border-2 border-paper/60 px-4 py-2.5 text-center font-mono text-stamp uppercase text-paper transition-colors hover:border-yellow hover:text-yellow sm:w-auto sm:py-2 ${
          busy ? "pointer-events-none opacity-50" : ""
        }`}
      >
        {busy ? "Checking relevance" : "Attach a photo or PDF"}
      </label>
      <p aria-live="polite" className="min-w-0 text-sm text-paper/80 sm:flex-1">
        {notice}
      </p>
    </div>
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
