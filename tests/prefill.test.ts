import { describe, expect, it } from "vitest";
import { DEFAULT_DIFFICULTY, DIFFICULTY_OPTIONS } from "@/lib/prefill";

describe("DIFFICULTY_OPTIONS / DEFAULT_DIFFICULTY", () => {
  it("offers exactly 0, 2, 4", () => {
    expect(DIFFICULTY_OPTIONS).toEqual([0, 2, 4]);
  });

  it("defaults to the hardest (fewest pre-filled panels)", () => {
    expect(DEFAULT_DIFFICULTY).toBe(4);
  });
});
