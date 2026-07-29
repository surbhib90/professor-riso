import { describe, expect, it } from "vitest";
import {
  MAX_UPLOAD_BYTES,
  isUploadMimeType,
  sanitizeFilename,
} from "@/lib/knowledge-upload-validation";

describe("isUploadMimeType", () => {
  it("accepts the allowed types", () => {
    expect(isUploadMimeType("application/pdf")).toBe(true);
    expect(isUploadMimeType("image/png")).toBe(true);
    expect(isUploadMimeType("image/jpeg")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isUploadMimeType("image/gif")).toBe(false);
    expect(isUploadMimeType("text/html")).toBe(false);
    expect(isUploadMimeType("application/zip")).toBe(false);
    expect(isUploadMimeType("")).toBe(false);
  });
});

describe("MAX_UPLOAD_BYTES", () => {
  it("stays comfortably under Vercel's 4.5MB serverless body limit", () => {
    expect(MAX_UPLOAD_BYTES).toBeLessThan(4.5 * 1024 * 1024);
  });
});

describe("sanitizeFilename", () => {
  it("leaves an ordinary filename untouched", () => {
    expect(sanitizeFilename("notes.pdf")).toBe("notes.pdf");
  });

  it("replaces path separators and other unsafe characters", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe(".._.._etc_passwd");
    expect(sanitizeFilename("my notes (final).pdf")).toBe("my_notes__final_.pdf");
  });

  it("strips characters a URL or tag would otherwise need to escape", () => {
    const out = sanitizeFilename('weird<script>"name.pdf');
    expect(out).not.toMatch(/["<>]/);
  });

  it("falls back to a default name when the input is empty after trimming", () => {
    expect(sanitizeFilename("   ")).toBe("upload");
  });

  it("caps length by keeping the tail of a very long name", () => {
    const long = "a".repeat(200) + ".pdf";
    const out = sanitizeFilename(long);
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out.endsWith(".pdf")).toBe(true);
  });
});
