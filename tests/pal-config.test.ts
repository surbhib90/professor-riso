/**
 * Config-shape tests for lib/tavus/pal-config.json — regression coverage for
 * Task 2 (spoken-brevity + emotional-delivery), Task 3 (perception layer),
 * and Task 1c (presentation skill, on-demand mode). These are the fields
 * scripts/setup-tavus.mjs patches onto the live PAL; a silent shape drift
 * here (e.g. someone "cleans up" the system_prompt and drops a section)
 * would ship without any other test catching it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function loadPalConfig() {
  return JSON.parse(readFileSync(path.resolve(process.cwd(), "lib/tavus/pal-config.json"), "utf8"));
}

describe("pal-config.json — Task 2 (response style + emotional cues)", () => {
  const palConfig = loadPalConfig();

  it("constrains turns to 1-3 spoken sentences", () => {
    expect(palConfig.system_prompt).toMatch(/1[–-]3 sentences/);
  });

  it("forbids markdown/bullets/lists in the spoken response", () => {
    expect(palConfig.system_prompt).toMatch(/markdown|bullet/i);
  });

  it("has emotional-delivery cues for a shaky/confused answer", () => {
    expect(palConfig.system_prompt).toContain("soften your tone");
  });

  it("has emotional-delivery cues for a concept clicking", () => {
    expect(palConfig.system_prompt).toMatch(/warmth/i);
  });

  it("Tavus-side PAL identity matches the app-facing name (Professor Riso)", () => {
    expect(palConfig.pal_name).toBe("Professor Riso");
  });
});

describe("pal-config.json — Task 3 (perception layer)", () => {
  const palConfig = loadPalConfig();

  it("defines an audio-only perception layer (no visual_query — text/voice-only session)", () => {
    const perception = palConfig.layers.perception;
    expect(perception).toBeDefined();
    expect(perception.perception_model).toBe("raven-1");
    expect(perception.visual_query).toBeUndefined();
  });

  it("has at least one live audio_awareness_query for frustration/confusion", () => {
    const queries = palConfig.layers.perception.audio_awareness_queries;
    expect(Array.isArray(queries)).toBe(true);
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.join(" ")).toMatch(/frustrat|confus/i);
  });

  it("has end-of-call perception_analysis_queries feeding the instructor summary", () => {
    const queries = palConfig.layers.perception.perception_analysis_queries;
    expect(Array.isArray(queries)).toBe(true);
    expect(queries.length).toBeGreaterThan(0);
  });
});

describe("pal-config.json — Task 1c (presentation skill)", () => {
  const palConfig = loadPalConfig();
  const presentation = palConfig.skills?.presentation;

  it("exists as a skill on the PAL", () => {
    expect(presentation).toBeDefined();
  });

  it("is on_demand, not walk_the_deck (must not auto-narrate the whole deck)", () => {
    expect(presentation.slides_trigger).toBe("on_demand");
  });

  it("only shows slides on struggle, per its prompt", () => {
    expect(presentation.prompt).toMatch(/struggl/i);
  });

  it("scopes document_ids to the curated topic list, not the full 50-doc KB", () => {
    // Unresolved in the repo — scripts/setup-tavus.mjs resolves this sentinel
    // against the live topic_documents table at provisioning time.
    expect(presentation.document_ids).toBe("__SAME_AS_TOPIC_DOCUMENT_IDS__");
  });
});
