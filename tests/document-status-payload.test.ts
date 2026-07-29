import { describe, expect, it } from "vitest";
import { extractDocumentStatusPayload, isRecord } from "@/lib/tavus/document-status-payload";

describe("extractDocumentStatusPayload", () => {
  it("reads a flat payload shaped like GET /v2/documents/{id}", () => {
    expect(
      extractDocumentStatusPayload({ document_id: "dc-abc123", status: "ready" })
    ).toEqual({ documentId: "dc-abc123", status: "ready" });
  });

  it("reads an error status the same way", () => {
    expect(
      extractDocumentStatusPayload({ document_id: "dc-abc123", status: "error" })
    ).toEqual({ documentId: "dc-abc123", status: "error" });
  });

  it("falls back to a nested `properties` envelope", () => {
    expect(
      extractDocumentStatusPayload({
        event_type: "document.status_changed",
        properties: { document_id: "dc-abc123", status: "ready" },
      })
    ).toEqual({ documentId: "dc-abc123", status: "ready" });
  });

  it("prefers the flat shape over properties when both are present", () => {
    expect(
      extractDocumentStatusPayload({
        document_id: "dc-flat",
        status: "ready",
        properties: { document_id: "dc-nested", status: "error" },
      })
    ).toEqual({ documentId: "dc-flat", status: "ready" });
  });

  it("ignores in-progress updates (started/processing/recrawling) rather than erroring", () => {
    expect(extractDocumentStatusPayload({ document_id: "dc-abc123", status: "processing" })).toBeNull();
    expect(extractDocumentStatusPayload({ document_id: "dc-abc123", status: "started" })).toBeNull();
  });

  it("returns null when document_id is missing", () => {
    expect(extractDocumentStatusPayload({ status: "ready" })).toBeNull();
  });

  it("returns null when status is missing or unrecognized", () => {
    expect(extractDocumentStatusPayload({ document_id: "dc-abc123" })).toBeNull();
    expect(extractDocumentStatusPayload({ document_id: "dc-abc123", status: "unknown" })).toBeNull();
  });

  it("returns null for a payload with no usable shape at all", () => {
    expect(extractDocumentStatusPayload({ hello: "world" })).toBeNull();
  });
});

describe("isRecord", () => {
  it("accepts plain objects, rejects arrays/null/primitives", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord("x")).toBe(false);
  });
});
