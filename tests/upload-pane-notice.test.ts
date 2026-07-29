import { describe, expect, it } from "vitest";
import { noticeFor } from "@/app/conversation/UploadPane";

describe("noticeFor", () => {
  it("shows nothing before the student has picked a file", () => {
    expect(noticeFor({ kind: "idle" }, "Recursion")).toBeNull();
  });

  it("names the topic while checking", () => {
    expect(noticeFor({ kind: "checking" }, "Recursion")).toContain("Recursion");
  });

  it("falls back to generic wording when concept is empty", () => {
    expect(noticeFor({ kind: "checking" }, "")).toContain("your topic");
  });

  it("confirms once added", () => {
    expect(noticeFor({ kind: "added" }, "Recursion")).toMatch(/added/i);
  });

  it("surfaces the model's reason on rejection", () => {
    const notice = noticeFor(
      { kind: "rejected", reason: "This is a grocery list, not about recursion." },
      "Recursion"
    );
    expect(notice).toContain("This is a grocery list, not about recursion.");
  });

  it("surfaces a hard error message as-is", () => {
    expect(noticeFor({ kind: "error", message: "Could not reach the server. Try again." }, "Recursion")).toBe(
      "Could not reach the server. Try again."
    );
  });
});
