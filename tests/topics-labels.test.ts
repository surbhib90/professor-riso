/**
 * Unit tests for buildTopicList() in app/api/topics/route.ts.
 *
 * The route itself reads from Supabase and cannot be imported in unit tests
 * without a real request context (next/headers). buildTopicList() is the
 * pure subset — deduplication, sort, id=label shape — extracted for exactly
 * this reason (same precedent as tests/inert-text.test.ts mirroring
 * lib/http-validation.ts's pure helpers).
 */
import { describe, expect, it } from "vitest";
import { buildTopicList } from "@/app/api/topics/route";

describe("buildTopicList", () => {
    it("returns an empty array for no labels", () => {
        expect(buildTopicList([])).toEqual([]);
    });

    it("maps each label to { id, label } with id === label", () => {
        const result = buildTopicList(["Recursion"]);
        expect(result).toEqual([{ id: "Recursion", label: "Recursion" }]);
    });

    it("deduplicates repeated labels", () => {
        const result = buildTopicList(["Recursion", "Recursion", "Recursion"]);
        expect(result).toHaveLength(1);
        expect(result[0].label).toBe("Recursion");
    });

    it("sorts labels locale-aware ascending", () => {
        const result = buildTopicList(["Sorting", "Iteration", "Recursion"]);
        expect(result.map((t) => t.label)).toEqual(["Iteration", "Recursion", "Sorting"]);
    });

    it("deduplicates before sorting — no duplicates in output regardless of input order", () => {
        const result = buildTopicList(["Sorting", "Recursion", "Sorting", "Iteration", "Recursion"]);
        expect(result).toHaveLength(3);
        expect(result.map((t) => t.label)).toEqual(["Iteration", "Recursion", "Sorting"]);
    });

    it("preserves label casing — does not normalise or lowercase", () => {
        const result = buildTopicList(["Binary Search", "binary search"]);
        // Two distinct labels (case-sensitive Set) — both present, sorted
        expect(result).toHaveLength(2);
        expect(result.map((t) => t.label)).toContain("Binary Search");
        expect(result.map((t) => t.label)).toContain("binary search");
    });

    it("id is exactly equal to label, not an opaque key", () => {
        const result = buildTopicList(["Hash Tables"]);
        expect(result[0].id).toBe(result[0].label);
        expect(result[0].id).toBe("Hash Tables");
    });
});
