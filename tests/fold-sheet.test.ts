import { describe, expect, it } from "vitest";
import { foldClass } from "@/lib/fold-sheet";

describe("foldClass", () => {
  it("marks column 2 (and every 4th panel after) as the cut line", () => {
    expect(foldClass(2)).toBe("fold-line-cut");
    expect(foldClass(6)).toBe("fold-line-cut");
  });

  it("marks columns 1 and 3 as vertical folds", () => {
    expect(foldClass(1)).toBe("fold-line-v");
    expect(foldClass(3)).toBe("fold-line-v");
    expect(foldClass(5)).toBe("fold-line-v");
    expect(foldClass(7)).toBe("fold-line-v");
  });

  it("marks column 0 with no fold class", () => {
    expect(foldClass(0)).toBe("");
    expect(foldClass(4)).toBe("");
  });
});
