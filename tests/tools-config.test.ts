/**
 * Config-shape test for lib/tavus/tools-config.json's post_call_summary tool
 * (Task 6 territory — already implemented by a concurrent session, verified
 * here against the real Tavus post-call-tool schema per the plan's own
 * self-review note: no `origin`, `delivery.api` with `body_template`/`{param}`
 * substitution, no `on_call`/`on_resolve` — the original plan draft had those
 * last two and would have been wrong).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function loadToolsConfig() {
  return JSON.parse(readFileSync(path.resolve(process.cwd(), "lib/tavus/tools-config.json"), "utf8"));
}

describe("tools-config.json — post_call_summary (Task 6)", () => {
  const toolsConfig = loadToolsConfig();
  const tool = toolsConfig.tools.find((t: { name: string }) => t.name === "post_call_summary");

  it("exists", () => {
    expect(tool).toBeDefined();
  });

  it("is trigger_type post_call, not something the model calls mid-conversation", () => {
    expect(tool.trigger_type).toBe("post_call");
  });

  it("delivers via delivery.api with the unresolved __WEBHOOK_URL__ sentinel", () => {
    expect(tool.delivery.api.url).toBe("__WEBHOOK_URL__");
    expect(tool.delivery.api.method).toBe("POST");
  });

  it("uses a {param} body_template, not a raw payload", () => {
    expect(tool.delivery.api.body_template).toEqual({ summary: "{summary}" });
  });

  it("does not use on_call/on_resolve — those fields don't exist in the real post-call-tool schema", () => {
    expect(tool.on_call).toBeUndefined();
    expect(tool.on_resolve).toBeUndefined();
  });

  it("does not set origin — post_call tools aren't LLM-invoked", () => {
    expect(tool.origin).toBeUndefined();
  });

  it("requires a summary parameter", () => {
    expect(tool.parameters.required).toEqual(["summary"]);
  });
});
