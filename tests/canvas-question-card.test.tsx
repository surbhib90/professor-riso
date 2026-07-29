/**
 * Render tests for CanvasQuestionCard (Task 10) — the native renderer Magic
 * Canvas mounts for canvas.question@v1 at the transfer-test step. Pure
 * component, no Daily/Tavus dependency, so it renders standalone against a
 * mocked `submit` the same shape the real MagicCanvas host passes in
 * (CanvasRendererProps).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import CanvasQuestionCard from "@/app/conversation/CanvasQuestionCard";
import type { CanvasRendererProps } from "@/app/components/cvi/components/magic-canvas";

afterEach(cleanup);

function renderCard(args: Record<string, unknown>) {
  const submit = vi.fn<CanvasRendererProps["submit"]>();
  render(
    <CanvasQuestionCard
      component="canvas.question"
      version="v1"
      args={args}
      submit={submit}
      sendContext={vi.fn()}
      respond={vi.fn()}
      onError={vi.fn()}
    />
  );
  return { submit };
}

describe("CanvasQuestionCard", () => {
  it("renders the question text", () => {
    renderCard({ question: "Does this recurse forever without a base case?" });
    expect(
      screen.getByText("Does this recurse forever without a base case?")
    ).toBeTruthy();
  });

  it("renders a button per option, in order", () => {
    renderCard({ question: "Pick one", options: ["Yes", "No", "Depends"] });
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Yes", "No", "Depends"]);
  });

  it("submits the selected option's index as selected_option_id, skipped: false", () => {
    const { submit } = renderCard({ question: "Pick one", options: ["Yes", "No"] });
    fireEvent.click(screen.getByText("No"));
    expect(submit).toHaveBeenCalledWith({
      type: "submit",
      value: { selected_option_id: "1", skipped: false },
    });
  });

  it("falls back to a spoken-answer notice when there are no options", () => {
    renderCard({ question: "Explain out loud" });
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText(/Answer out loud/)).toBeTruthy();
  });

  it("falls back to a spoken-answer notice when options is an empty array", () => {
    renderCard({ question: "Explain out loud", options: [] });
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("silently ignores non-string entries in options rather than crashing", () => {
    renderCard({ question: "Pick one", options: ["Yes", 42, null, "No"] });
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Yes", "No"]);
  });

  it("renders an empty question rather than crashing when args.question is missing", () => {
    renderCard({});
    // No throw; the card still mounts with an empty question paragraph.
    expect(screen.getByText(/Answer out loud/)).toBeTruthy();
  });
});
