import { describe, expect, it, vi } from "vitest";
import { fetchDocumentGroundingText } from "@/lib/tavus/document-summary";

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response;
}

describe("fetchDocumentGroundingText", () => {
  it("joins page_summaries into a labeled block per document", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        document_name: "Lecture 15",
        page_summaries: { "6": "Recursion intro.", "7": "Base case." },
      }),
    );
    const text = await fetchDocumentGroundingText(["dc-1"], "key", fetchImpl);
    expect(text).toContain("--- Lecture 15 ---");
    expect(text).toContain("p6: Recursion intro.");
    expect(text).toContain("p7: Base case.");
  });

  it("joins multiple documents with a blank line between them", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ document_name: "A", page_summaries: { "1": "a" } }))
      .mockResolvedValueOnce(jsonResponse({ document_name: "B", page_summaries: { "1": "b" } }));
    const text = await fetchDocumentGroundingText(["dc-1", "dc-2"], "key", fetchImpl);
    expect(text).toBe("--- A ---\np1: a\n\n--- B ---\np1: b");
  });

  it("skips a document whose fetch returns non-ok, without throwing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, false));
    const text = await fetchDocumentGroundingText(["dc-1"], "key", fetchImpl);
    expect(text).toBe("");
  });

  it("skips a document whose fetch throws, without throwing itself", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const text = await fetchDocumentGroundingText(["dc-1"], "key", fetchImpl);
    expect(text).toBe("");
  });

  it("skips a document with no page_summaries content", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ document_name: "Empty" }));
    const text = await fetchDocumentGroundingText(["dc-1"], "key", fetchImpl);
    expect(text).toBe("");
  });

  it("falls back to the document id when document_name is missing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ page_summaries: { "1": "x" } }));
    const text = await fetchDocumentGroundingText(["dc-42"], "key", fetchImpl);
    expect(text).toContain("--- dc-42 ---");
  });

  it("returns an empty string for an empty document id list", async () => {
    const fetchImpl = vi.fn();
    const text = await fetchDocumentGroundingText([], "key", fetchImpl);
    expect(text).toBe("");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
