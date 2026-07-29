import { describe, expect, it } from "vitest";
import {
  MAX_CLASS_ID_LENGTH,
  SAFE_ID_PATTERN,
  isRecord,
  parseString,
} from "@/lib/http-validation";

describe("parseString", () => {
  it("accepts a trimmed value within the length limit", () => {
    const result = parseString("  recursion  ", "concept", 20);
    expect(result).toEqual({ ok: true, value: "recursion" });
  });

  it("rejects missing values", () => {
    const result = parseString(undefined, "concept", 20);
    expect(result.ok).toBe(false);
  });

  it("rejects an empty or whitespace-only string", () => {
    expect(parseString("   ", "concept", 20).ok).toBe(false);
  });

  it("rejects a non-string value", () => {
    expect(parseString(42, "concept", 20).ok).toBe(false);
  });

  it("rejects a value over the length limit", () => {
    expect(parseString("a".repeat(21), "concept", 20).ok).toBe(false);
  });

  it("enforces a pattern when given one", () => {
    const bad = parseString("cs 101!", "classId", MAX_CLASS_ID_LENGTH, SAFE_ID_PATTERN);
    expect(bad.ok).toBe(false);

    const good = parseString("cs101", "classId", MAX_CLASS_ID_LENGTH, SAFE_ID_PATTERN);
    expect(good).toEqual({ ok: true, value: "cs101" });
  });
});

describe("isRecord", () => {
  it("accepts plain objects", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });

  it("rejects arrays, null, and primitives", () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord("x")).toBe(false);
    expect(isRecord(42)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });
});
