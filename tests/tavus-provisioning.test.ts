/**
 * Unit tests for scripts/lib/tavus-provisioning.mjs — the pure objectives-graph
 * expansion and post-call-tool resolution logic extracted out of
 * setup-tavus.mjs so it can be imported without triggering that script's
 * top-level TAVUS_API_KEY check (process.exit(1) if unset).
 *
 * These exercise the exact logic that turns lib/tavus/objectives-config.json
 * (Task 1/1b) into the flat, acyclic graph Tavus actually receives — the
 * shape most likely to silently break when panelChain is edited again.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildObjectivesGraph,
  resolvePostCallTools,
  fetchTopicDocumentIds,
} from "../scripts/lib/tavus-provisioning.mjs";

const minimalTemplate = {
  leadIn: {
    objective_name: "lead_in",
    objective_prompt: "Start.",
    confirmation_mode: "auto",
    conditional: { panel_1_await: "difficulty is 0" },
  },
  panelChain: [
    { suffix: "await", objective_prompt: "Await panel {N}.", next: "test" },
    {
      suffix: "test",
      objective_prompt: "Test panel {N}.",
      conditional: { reexplain: "shaky", confirm: "solid" },
    },
    { suffix: "reexplain", objective_prompt: "Reexplain panel {N}.", next: "confirm" },
    { suffix: "confirm", objective_prompt: "Confirm panel {N}.", next: "ADVANCE" },
  ],
  terminal: { objective_name: "wrap_up", objective_prompt: "Done.", confirmation_mode: "auto" },
};

describe("buildObjectivesGraph", () => {
  it("produces one lead-in node, one node per panelChain step per panel, and one terminal node", () => {
    const { data } = buildObjectivesGraph(minimalTemplate);
    // 1 lead-in + (8 panels * 4 steps) + 1 terminal
    expect(data).toHaveLength(1 + 8 * 4 + 1);
  });

  it("names the lead-in node from the template verbatim", () => {
    const { data } = buildObjectivesGraph(minimalTemplate);
    expect(data[0].objective_name).toBe("lead_in");
    expect(data[0].next_conditional_objectives).toEqual({ panel_1_await: "difficulty is 0" });
  });

  it("interpolates {N} into each panel's objective_prompt", () => {
    const { data } = buildObjectivesGraph(minimalTemplate);
    const panel3Test = data.find((n) => n.objective_name === "panel_3_test");
    expect(panel3Test?.objective_prompt).toBe("Test panel 3.");
  });

  it("expands a conditional step into next_conditional_objectives scoped to that panel", () => {
    const { data } = buildObjectivesGraph(minimalTemplate);
    const panel2Test = data.find((n) => n.objective_name === "panel_2_test");
    expect(panel2Test?.next_conditional_objectives).toEqual({
      panel_2_reexplain: "shaky",
      panel_2_confirm: "solid",
    });
  });

  it("chains a plain .next step to the same-panel node", () => {
    const { data } = buildObjectivesGraph(minimalTemplate);
    const panel1Reexplain = data.find((n) => n.objective_name === "panel_1_reexplain");
    expect(panel1Reexplain?.next_required_objective).toBe("panel_1_confirm");
  });

  it("advances an ADVANCE step to the next panel's first step", () => {
    const { data } = buildObjectivesGraph(minimalTemplate);
    const panel1Confirm = data.find((n) => n.objective_name === "panel_1_confirm");
    expect(panel1Confirm?.next_required_objective).toBe("panel_2_await");
  });

  it("advances the last panel's ADVANCE step to the terminal node, not a 9th panel", () => {
    const { data } = buildObjectivesGraph(minimalTemplate);
    const panel8Confirm = data.find((n) => n.objective_name === "panel_8_confirm");
    expect(panel8Confirm?.next_required_objective).toBe("wrap_up");
    expect(data.some((n) => n.objective_name === "panel_9_await")).toBe(false);
  });

  it("the terminal node is last and has no outgoing edge (graph must be startable)", () => {
    const { data } = buildObjectivesGraph(minimalTemplate);
    const terminal = data[data.length - 1];
    expect(terminal.objective_name).toBe("wrap_up");
    expect(terminal.next_required_objective).toBeUndefined();
    expect(terminal.next_conditional_objectives).toBeUndefined();
  });

  it("produces no edge back to an earlier step within the same panel (acyclic per panel)", () => {
    const { data } = buildObjectivesGraph(minimalTemplate);
    for (const node of data) {
      const match = node.objective_name.match(/^panel_(\d+)_(\w+)$/);
      if (!match || match[2] !== "reexplain") continue;
      expect(node.next_required_objective).not.toMatch(/_reexplain$/);
      expect(node.next_required_objective).not.toMatch(/_test$/);
      expect(node.next_required_objective).not.toMatch(/_await$/);
    }
  });

  it("matches the real lib/tavus/objectives-config.json template: 54 nodes (1 lead-in + 4 prefill + 48 panel + 1 terminal), acyclic reexplain->retest->{gentle_correct|confirm}", () => {
    const template = JSON.parse(
      readFileSync(path.resolve(process.cwd(), "lib/tavus/objectives-config.json"), "utf8")
    );
    const { data } = buildObjectivesGraph(template);
    expect(data).toHaveLength(1 + template.prefillChain.length + template.panelChain.length * 8 + 1);

    const names = new Set(data.map((n) => n.objective_name));
    for (let n = 1; n <= 8; n++) {
      expect(names.has(`panel_${n}_retest`)).toBe(true);
      expect(names.has(`panel_${n}_gentle_correct`)).toBe(true);
    }
    for (let n = 1; n <= 4; n++) {
      expect(names.has(`prefill_panel_${n}`)).toBe(true);
    }

    // The leadIn catch-all (Task 1) must still route difficulty 0 into panel_1_await.
    expect(data[0].next_conditional_objectives.panel_1_await).toContain("missing, unrecognized, or ambiguous");
    // Prefill is now a per-panel checkpoint chain, not one self-counted loop (fixes the
    // observed live stall: 3 of 4 prefill panels logged, then nothing).
    expect(data[0].next_conditional_objectives.prefill_panel_1).toBeDefined();
    expect(names.has("prefill_panel_1")).toBe(true);
  });
});

interface TestTool {
  tool_name: string;
  delivery?: { api?: { url?: string } };
}

function resolve(tools: TestTool[], env: Record<string, string | undefined>): TestTool[] {
  return resolvePostCallTools(tools, env);
}

describe("resolvePostCallTools", () => {
  const tools: TestTool[] = [
    { tool_name: "log_zine_page" },
    { tool_name: "post_call_summary", delivery: { api: { url: "__WEBHOOK_URL__" } } },
  ];

  it("resolves the __WEBHOOK_URL__ sentinel when both env vars are set", () => {
    const resolved = resolve(tools, {
      PUBLIC_APP_URL: "https://example.com",
      TAVUS_WEBHOOK_SECRET: "s3cret",
    });
    const summaryTool = resolved.find((t) => t.tool_name === "post_call_summary");
    expect(summaryTool?.delivery?.api?.url).toBe(
      "https://example.com/api/tavus/session-summary?key=s3cret"
    );
  });

  it("strips a trailing slash from PUBLIC_APP_URL before appending the path", () => {
    const resolved = resolve(tools, {
      PUBLIC_APP_URL: "https://example.com/",
      TAVUS_WEBHOOK_SECRET: "s3cret",
    });
    const summaryTool = resolved.find((t) => t.tool_name === "post_call_summary");
    expect(summaryTool?.delivery?.api?.url).toBe(
      "https://example.com/api/tavus/session-summary?key=s3cret"
    );
  });

  it("URL-encodes the webhook secret", () => {
    const resolved = resolve(tools, {
      PUBLIC_APP_URL: "https://example.com",
      TAVUS_WEBHOOK_SECRET: "a b&c",
    });
    const summaryTool = resolved.find((t) => t.tool_name === "post_call_summary");
    expect(summaryTool?.delivery?.api?.url).toBe(
      "https://example.com/api/tavus/session-summary?key=a%20b%26c"
    );
  });

  it("leaves tools without the sentinel untouched", () => {
    const resolved = resolve(tools, {
      PUBLIC_APP_URL: "https://example.com",
      TAVUS_WEBHOOK_SECRET: "s3cret",
    });
    expect(resolved.find((t) => t.tool_name === "log_zine_page")).toEqual({
      tool_name: "log_zine_page",
    });
  });

  it("drops the post_call_summary tool entirely when PUBLIC_APP_URL is missing", () => {
    const resolved = resolve(tools, { TAVUS_WEBHOOK_SECRET: "s3cret" });
    expect(resolved.some((t) => t.tool_name === "post_call_summary")).toBe(false);
    expect(resolved).toHaveLength(1);
  });

  it("drops the post_call_summary tool entirely when TAVUS_WEBHOOK_SECRET is missing", () => {
    const resolved = resolve(tools, { PUBLIC_APP_URL: "https://example.com" });
    expect(resolved.some((t) => t.tool_name === "post_call_summary")).toBe(false);
    expect(resolved).toHaveLength(1);
  });

  it("drops the post_call_summary tool when both env vars are missing", () => {
    const resolved = resolve(tools, {});
    expect(resolved).toHaveLength(1);
  });
});

describe("fetchTopicDocumentIds", () => {
  it("throws when url or anonKey is missing, without calling fetch", async () => {
    const fetchImpl = vi.fn();
    await expect(fetchTopicDocumentIds({ url: undefined, anonKey: "k", fetchImpl })).rejects.toThrow(
      /NEXT_PUBLIC_SUPABASE_URL/
    );
    await expect(fetchTopicDocumentIds({ url: "https://x.supabase.co", anonKey: undefined, fetchImpl })).rejects.toThrow(
      /NEXT_PUBLIC_SUPABASE_URL/
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("queries topic_documents filtered to status=ready with the anon key as both apikey and bearer", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ tavus_document_id: "dc-1" }],
    });
    await fetchTopicDocumentIds({ url: "https://proj.supabase.co", anonKey: "anon-key", fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://proj.supabase.co/rest/v1/topic_documents?select=tavus_document_id&status=eq.ready",
      { headers: { apikey: "anon-key", Authorization: "Bearer anon-key" } }
    );
  });

  it("deduplicates repeated tavus_document_id rows", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { tavus_document_id: "dc-1" },
        { tavus_document_id: "dc-2" },
        { tavus_document_id: "dc-1" },
      ],
    });
    const ids = await fetchTopicDocumentIds({ url: "https://x.supabase.co", anonKey: "k", fetchImpl });
    expect(ids).toEqual(["dc-1", "dc-2"]);
  });

  it("returns an empty array when there are no ready rows, rather than throwing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    const ids = await fetchTopicDocumentIds({ url: "https://x.supabase.co", anonKey: "k", fetchImpl });
    expect(ids).toEqual([]);
  });

  it("throws with the response body when the request fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "invalid api key",
    });
    await expect(
      fetchTopicDocumentIds({ url: "https://x.supabase.co", anonKey: "bad", fetchImpl })
    ).rejects.toThrow(/HTTP 401/);
  });
});
