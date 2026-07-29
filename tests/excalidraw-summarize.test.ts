import { describe, expect, it } from "vitest";

import {
  summarizeNotesPane,
  type SceneElement,
} from "@/lib/excalidraw-summarize";

/**
 * Fixtures mirror the structural subset of an Excalidraw scene element the
 * module reads (type / id / isDeleted / text / containerId / bindings). Real
 * scene elements carry ~30 more fields; none of them change the output.
 */
const rect = (id: string): SceneElement => ({ id, type: "rectangle" });
const arrow = (id: string, from: string, to: string): SceneElement => ({
  id,
  type: "arrow",
  startBinding: { elementId: from },
  endBinding: { elementId: to },
});
/** A label is a text element bound to a shape via containerId. */
const label = (id: string, text: string, containerId: string): SceneElement => ({
  id,
  type: "text",
  text,
  containerId,
});
const note = (id: string, text: string): SceneElement => ({ id, type: "text", text });

describe("summarizeNotesPane", () => {
  it("passes text-only notes through as spoken lines", () => {
    const summary = summarizeNotesPane([
      note("t1", "A recursive function calls itself."),
      note("t2", "The base case is what stops it."),
    ]);

    expect(summary).toBe(
      "A recursive function calls itself.\nThe base case is what stops it.",
    );
  });

  it("collapses the whitespace Excalidraw preserves inside a text element", () => {
    // Excalidraw stores wrapped text with hard newlines; the professor hears one turn.
    const summary = summarizeNotesPane([note("t1", "  base   case\nstops it  ")]);

    expect(summary).toBe("base case stops it");
  });

  it("produces a meaningful summary for a sketch with no free-standing text", () => {
    // The student who only draws must still reach the professor (D5).
    const summary = summarizeNotesPane([
      rect("r1"),
      rect("r2"),
      rect("r3"),
      arrow("a1", "r1", "r2"),
      arrow("a2", "r2", "r3"),
      label("l1", "base case", "r1"),
      label("l2", "recurse", "r2"),
    ]);

    expect(summary).not.toBe("");
    expect(summary).toContain("3 rectangles");
    expect(summary).toContain("2 arrows");
    expect(summary).toContain('Labelled: "base case" and "recurse".');
    expect(summary).toContain('Arrows run "base case" to "recurse"');
  });

  it("names an unlabelled arrow endpoint by its shape instead of dropping the connection", () => {
    const summary = summarizeNotesPane([
      rect("r1"),
      rect("r2"),
      arrow("a1", "r1", "r2"),
      label("l1", "base case", "r1"),
    ]);

    expect(summary).toContain('Arrows run "base case" to a rectangle.');
  });

  it("reports a label bound to the arrow itself as what the arrow is marked", () => {
    const summary = summarizeNotesPane([
      rect("r1"),
      rect("r2"),
      arrow("a1", "r1", "r2"),
      label("l1", "then", "a1"),
    ]);

    expect(summary).toContain('marked "then"');
  });

  it("keeps both halves of a mixed text-and-sketch scene, text first", () => {
    const summary = summarizeNotesPane([
      note("t1", "Recursion needs a base case."),
      rect("r1"),
      rect("r2"),
      arrow("a1", "r1", "r2"),
      label("l1", "n-1", "r2"),
    ]);

    const lines = summary.split("\n");
    expect(lines[0]).toBe("Recursion needs a base case.");
    expect(summary).toContain("Sketch: 2 rectangles and 1 arrow.");
    expect(summary).toContain('Labelled: "n-1".');
  });

  it("returns an empty string for a genuinely empty scene", () => {
    // This is exactly what gates the submit button.
    expect(summarizeNotesPane([])).toBe("");
  });

  it("returns an empty string when the scene has not loaded yet", () => {
    expect(summarizeNotesPane(null)).toBe("");
    expect(summarizeNotesPane(undefined)).toBe("");
  });

  it("returns an empty string when the only text element is blank", () => {
    expect(summarizeNotesPane([note("t1", "   \n  ")])).toBe("");
  });

  it("does not leak deleted elements into the summary", () => {
    // Excalidraw tombstones erased elements with isDeleted rather than removing them.
    const summary = summarizeNotesPane([
      { id: "t1", type: "text", text: "wrong first guess", isDeleted: true },
      { id: "r1", type: "rectangle", isDeleted: true },
      note("t2", "second attempt"),
    ]);

    expect(summary).toBe("second attempt");
    expect(summary).not.toContain("wrong first guess");
    expect(summary).not.toContain("rectangle");
  });

  it("returns an empty string when every element has been erased", () => {
    const summary = summarizeNotesPane([
      { id: "t1", type: "text", text: "erased", isDeleted: true },
      { id: "r1", type: "rectangle", isDeleted: true },
      { id: "a1", type: "arrow", isDeleted: true },
    ]);

    expect(summary).toBe("");
  });

  it("drops a connection whose endpoint was erased rather than inventing one", () => {
    const summary = summarizeNotesPane([
      rect("r1"),
      { id: "r2", type: "rectangle", isDeleted: true },
      arrow("a1", "r1", "r2"),
    ]);

    expect(summary).toContain("Sketch: 1 rectangle and 1 arrow.");
    expect(summary).not.toContain("Arrows run");
  });

  it("describes an unrecognised element type generically instead of failing", () => {
    const summary = summarizeNotesPane([{ id: "x1", type: "magic-widget" }]);

    expect(summary).toBe("Sketch: 1 shape.");
  });

  it("deduplicates repeated labels so the summary stays readable", () => {
    const summary = summarizeNotesPane([
      rect("r1"),
      rect("r2"),
      label("l1", "n-1", "r1"),
      label("l2", "n-1", "r2"),
    ]);

    expect(summary).toContain('Labelled: "n-1".');
  });

  it("stays bounded on a pathological scene", () => {
    // 400 shapes and 200 labels must not produce a novel for the bridge to cap.
    const elements: SceneElement[] = [];
    for (let i = 0; i < 200; i += 1) {
      elements.push(rect(`r${i}`));
      elements.push(arrow(`a${i}`, `r${i}`, `r${(i + 1) % 200}`));
      elements.push(label(`l${i}`, `label ${i}`, `r${i}`));
    }

    const summary = summarizeNotesPane(elements);

    // Census is one clause per type regardless of count; labels and connections capped.
    expect(summary).toContain("200 rectangles");
    expect(summary.split(";").length).toBeLessThanOrEqual(8);
    expect(summary.length).toBeLessThan(1500);
  });
});
