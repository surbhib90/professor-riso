#!/usr/bin/env node
/**
 * Provisions the Tavus side of Professor Byte: the two registry tools, the
 * per-panel acyclic objectives graph, the PAL, and the tool->PAL attachment.
 *
 * Usage:
 *   set -a && source .env.local && set +a && node scripts/setup-tavus.mjs
 *   node scripts/setup-tavus.mjs --force     # recreate everything from scratch
 *
 * This script never parses .env itself — the caller sources it. That keeps the
 * key out of a second code path and matches how the spike scripts are run.
 *
 * Idempotent-ish, not idempotent: it reuses IDs recorded in .tavus-ids.json
 * when the objects still exist on the Tavus side, and creates what is missing.
 * Editing a config file does NOT update an already-created object — Tavus has
 * no stable upsert for these — so re-run with --force after changing a config.
 */

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildObjectivesGraph,
  resolvePostCallTools,
  fetchTopicDocumentIds,
} from "./lib/tavus-provisioning.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IDS_FILE = path.join(ROOT, ".tavus-ids.json");
const BASE = "https://tavusapi.com/v2";

const API_KEY = process.env.TAVUS_API_KEY;
if (!API_KEY) {
  fail(
    "TAVUS_API_KEY is not set.",
    "Run: set -a && source .env.local && set +a && node scripts/setup-tavus.mjs"
  );
}

const FORCE = process.argv.includes("--force");

function fail(what, whatToDo) {
  console.error(`\nFAILED: ${what}`);
  if (whatToDo) console.error(`FIX:    ${whatToDo}`);
  process.exit(1);
}

/** Throws with the full response body on non-2xx — a silent failure here costs build-day hours. */
async function api(pathname, method = "GET", body) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: { "x-api-key": API_KEY, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = text;
  }
  if (!res.ok) {
    console.error(`\n${method} ${BASE}${pathname} -> HTTP ${res.status}`);
    console.error(typeof json === "string" ? json : JSON.stringify(json, null, 2));
    if (body !== undefined) console.error(`\nrequest body was:\n${JSON.stringify(body, null, 2)}`);
    fail(
      `${method} ${pathname} returned ${res.status}`,
      res.status === 401 || res.status === 403
        ? "Check TAVUS_API_KEY — the key in .env.local may be stale or from another account."
        : "Read the response body above; the failing field is usually named in it."
    );
  }
  return json;
}

/** Wraps the extracted fetchTopicDocumentIds with this script's env + fail() reporting. */
async function loadTopicDocumentIds() {
  let ids;
  try {
    ids = await fetchTopicDocumentIds({
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    });
  } catch (e) {
    fail(
      e.message,
      "Check NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local and that topic_documents exists (supabase/schema.sql)."
    );
  }
  if (!ids.length) {
    console.warn(
      "\nWARNING: topic_documents has no 'ready' rows — the presentation skill will have\n" +
      "         an empty document set and won't be able to show any slides.\n"
    );
  }
  return ids;
}

/** Existence probe only. Returns null instead of exiting so a stale ID falls through to create. */
async function apiSoft(pathname) {
  try {
    const res = await fetch(`${BASE}${pathname}`, { headers: { "x-api-key": API_KEY } });
    if (!res.ok) return null;
    return JSON.parse((await res.text()) || "{}");
  } catch {
    return null;
  }
}

async function loadJson(relPath) {
  const abs = path.join(ROOT, relPath);
  try {
    return JSON.parse(await readFile(abs, "utf8"));
  } catch (e) {
    fail(`could not read config ${relPath} (${e.message})`, `Confirm the file exists at ${abs}.`);
  }
}

const main = async () => {
  const toolsConfig = await loadJson("lib/tavus/tools-config.json");
  if (!process.env.PUBLIC_APP_URL || !process.env.TAVUS_WEBHOOK_SECRET) {
    console.warn(
      "\nWARNING: PUBLIC_APP_URL and/or TAVUS_WEBHOOK_SECRET not set — skipping post_call_summary.\n" +
      "         Instructor session recaps will not be recorded. Set both in .env.local\n" +
      "         (PUBLIC_APP_URL must be reachable from Tavus's servers, not localhost) and re-run.\n"
    );
  }
  toolsConfig.tools = resolvePostCallTools(toolsConfig.tools, process.env);
  const objectivesTemplate = await loadJson("lib/tavus/objectives-config.json");
  const palConfig = await loadJson("lib/tavus/pal-config.json");

  // Difficulty (0/2/4) is a per-session runtime choice, not a provisioning-time
  // one (D19) — the graph always covers all 8 panels, so it is built once here
  // regardless of any particular session's pick.
  const objectivesConfig = buildObjectivesGraph(objectivesTemplate);
  console.log(
    `objectives: all 8 panels + lead-in + terminal -> ${objectivesConfig.data.length} nodes, acyclic\n`
  );

  const previous =
    !FORCE && existsSync(IDS_FILE) ? JSON.parse(await readFile(IDS_FILE, "utf8")) : {};
  if (FORCE) console.log("--force: ignoring .tavus-ids.json, creating everything fresh.\n");

  // ---- 1. Replica (face) ---------------------------------------------------
  // TAVUS_REPLICA_ID pins a specific stock replica across runs; without it we
  // take the account's first, which is what the spike did.
  let replicaId = process.env.TAVUS_REPLICA_ID || palConfig.default_face_id;
  if (!replicaId) {
    const replicas = await api("/replicas");
    const list = Array.isArray(replicas) ? replicas : replicas.data || replicas.replicas || [];
    if (!list.length) {
      fail(
        "no replicas on this Tavus account, so the PAL has no face",
        "Enable a stock replica at maker.tavus.io/dev, or export TAVUS_REPLICA_ID=<id>."
      );
    }
    replicaId = list[0].replica_id || list[0].id;
    console.log(`replica:    ${replicaId} (first on account; pin with TAVUS_REPLICA_ID)`);
  } else {
    console.log(`replica:    ${replicaId}`);
  }

  // ---- 2. Tools ------------------------------------------------------------
  // Both tools are client-delivered (delivery.app_message) per decision D1: the
  // browser is the state authority — it alone knows classId/studentId and owns
  // the zine pane — so a server webhook would have to be told things the client
  // already has.
  //
  // on_call is "silent" for both. The default, "generate_filler", makes the PAL
  // speak while the tool runs; inside a 10-minute budget that is dead air, and
  // for log_understanding_check it would leak the assessment to the student,
  // which the anti-exam framing (D15) forbids.
  //
  // on_resolve differs on purpose:
  //   log_zine_page         -> "generate_response". The loop advances per panel,
  //                            so the PAL must learn the panel actually landed
  //                            before moving to the next one; the client's
  //                            "panel N saved" tool_result is what tells it.
  //                            Cost: a short spoken ack per panel, including
  //                            during the wrap-up burst. Accepted — the ack is
  //                            also what the audience hears as progress.
  //   log_understanding_check -> "fire_and_forget". The result is an instructor-
  //                            side DB write the PAL must never react to or
  //                            mention; the objective's conditional edges branch
  //                            on its own judgment, not on this result. Also
  //                            avoids a stall between test and re-explain.
  const toolIds = {};
  const previousTools = previous.tools || {};
  let anyToolCreated = false;

  for (const tool of toolsConfig.tools) {
    const known = previousTools[tool.name];
    if (known && (await apiSoft(`/tools/${known}`))) {
      toolIds[tool.name] = known;
      console.log(`tool:       ${tool.name} -> ${known} (reused)`);
      continue;
    }
    const created = await api("/tools", "POST", tool);
    const id = created.tool_id || created.id || created.uuid;
    if (!id) {
      console.error(JSON.stringify(created, null, 2));
      fail(`POST /tools succeeded for ${tool.name} but no id field was returned`, "Inspect the response above and update the id extraction in this script.");
    }
    toolIds[tool.name] = id;
    anyToolCreated = true;
    console.log(`tool:       ${tool.name} -> ${id} (created)`);
  }

  // ---- 2.5. Guardrails -------------------------------------------------------
  // Behavioral boundaries the PAL must hold regardless of what the system
  // prompt says: no PII collection, PG-13 content, one-on-one focus only.
  // These exist as objects independent of any PAL, then get attached below.
  const guardrailsConfig = await loadJson("lib/tavus/guardrails-config.json");
  const guardrailIds = {};
  const previousGuardrails = previous.guardrails || {};

  for (const guardrail of guardrailsConfig.guardrails) {
    const known = previousGuardrails[guardrail.guardrail_name];
    if (known && (await apiSoft(`/guardrails/${known}`))) {
      guardrailIds[guardrail.guardrail_name] = known;
      console.log(`guardrail:  ${guardrail.guardrail_name} -> ${known} (reused)`);
      continue;
    }
    const created = await api("/guardrails", "POST", guardrail);
    const id = created.guardrail_id || created.uuid || created.id;
    if (!id) {
      console.error(JSON.stringify(created, null, 2));
      fail(`POST /guardrails succeeded for ${guardrail.guardrail_name} but no id field was returned`, "Inspect the response above and update the id extraction in this script.");
    }
    guardrailIds[guardrail.guardrail_name] = id;
    console.log(`guardrail:  ${guardrail.guardrail_name} -> ${id} (created)`);
  }

  // ---- 3. Objectives -------------------------------------------------------
  // The whole graph goes up in one call (verified). It is acyclic (D16) — no
  // allow_loops, no edge back to an earlier panel.
  let objectivesId = previous.objectivesId;
  if (!objectivesId || !(await apiSoft(`/objectives/${objectivesId}`))) {
    const created = await api("/objectives", "POST", objectivesConfig);
    objectivesId = created.objectives_id || created.uuid || created.id;
    if (!objectivesId) {
      console.error(JSON.stringify(created, null, 2));
      fail("POST /objectives succeeded but no objectives_id was returned", "Inspect the response above and update the id extraction in this script.");
    }
    console.log(`objectives: ${objectivesId} (created, ${objectivesConfig.data.length} nodes, acyclic)`);
  } else {
    console.log(`objectives: ${objectivesId} (reused)`);
  }

  // ---- 4. PAL --------------------------------------------------------------
  // Patches the existing live PAL in place via JSON Patch (RFC 6902) against
  // ?target=live, rather than creating a new PAL. Verified live during
  // planning: objectives_id, system_prompt, document_ids, guardrail_ids, and
  // layers are all patchable this way — but `skills` is NOT part of this
  // bulk patch (confirmed live: HTTP 422 "can't replace a non-existent
  // object 'skills'"). Skills use their own dedicated endpoint, PATCH
  // /pals/{pal_id}/skills/{skill_id} with body {"config": {...}} — a
  // partial merge into the existing config, not a replace (per
  // docs.tavus.io/api-reference/pal-skills/update-pal-skill, verified live
  // against the memory skill). Recreating a PAL was the prior approach;
  // it's avoided now because newly-created PALs on this account were found
  // (2026-07-28, spike/t2-magic-canvas-test.py) to fail replica activation
  // 100% of the time, while the existing live PAL keeps working.
  const documentIds = process.env.TAVUS_DOCUMENT_IDS
    ? process.env.TAVUS_DOCUMENT_IDS.split(",").map((s) => s.trim()).filter(Boolean)
    : palConfig.document_ids || [];
  if (!documentIds.length) {
    console.warn(
      "\nWARNING: no document_ids — the PAL will answer from general CS knowledge, not the\n" +
      "         course material. Set TAVUS_DOCUMENT_IDS in .env.local to ground it.\n"
    );
  }

  const patchOps = [
    { op: "replace", path: "/system_prompt", value: palConfig.system_prompt },
    { op: "replace", path: "/greeting", value: palConfig.greeting },
    { op: "replace", path: "/objectives_id", value: objectivesId },
    { op: "replace", path: "/document_ids", value: documentIds },
    { op: "replace", path: "/guardrail_ids", value: Object.values(guardrailIds) },
    { op: "replace", path: "/layers", value: { ...palConfig.layers } },
  ];

  const palId = process.env.TAVUS_PAL_ID || previous.palId;
  if (!palId) {
    fail(
      "No PAL id found — TAVUS_PAL_ID is not set and .tavus-ids.json has no palId.",
      "Set TAVUS_PAL_ID in .env.local or run with --force to create a fresh PAL."
    );
  }

  const patchRes = await fetch(`${BASE}/pals/${palId}?target=live`, {
    method: "PATCH",
    headers: { "x-api-key": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(patchOps),
  });
  if (!patchRes.ok && patchRes.status !== 304) {
    console.error(`\nPATCH /pals/${palId}?target=live -> HTTP ${patchRes.status}`);
    console.error(await patchRes.text());
    fail(
      `patching the live PAL failed`,
      "Check the response body above for which field was rejected."
    );
  }
  console.log(
    patchRes.status === 304
      ? `pal:        ${palId} (patched, no changes — already up to date)`
      : `pal:        ${palId} (patched in place)`
  );

  // Skills: one PATCH per skill via the dedicated skills endpoint.
  // skills cannot be part of the bulk JSON Patch above (HTTP 422 confirmed).
  // __SAME_AS_document_ids__ resolves to the full 50-doc KB (same as the PAL).
  // __SAME_AS_TOPIC_DOCUMENT_IDS__ resolves to the curated topic list. That
  // list moved from a hardcoded array in app/api/topics/route.ts into the
  // Supabase topic_documents table (student uploads can add to it at
  // runtime), so it's fetched live here rather than mirrored by hand.
  const TOPIC_DOCUMENT_IDS = await loadTopicDocumentIds();

  for (const [skillId, config] of Object.entries(palConfig.skills || {})) {
    const resolvedConfig = JSON.parse(
      JSON.stringify(config)
        .replace('"__SAME_AS_document_ids__"', JSON.stringify(documentIds))
        .replace('"__SAME_AS_TOPIC_DOCUMENT_IDS__"', JSON.stringify(TOPIC_DOCUMENT_IDS))
    );
    const skillPatchRes = await fetch(`${BASE}/pals/${palId}/skills/${skillId}`, {
      method: "PATCH",
      headers: { "x-api-key": API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ config: resolvedConfig }),
    });
    if (!skillPatchRes.ok && skillPatchRes.status !== 304) {
      console.error(`\nPATCH /pals/${palId}/skills/${skillId} -> HTTP ${skillPatchRes.status}`);
      console.error(await skillPatchRes.text());
      fail(
        `patching skill ${skillId} failed`,
        "Check the response body above."
      );
    }
    const skillStatus = skillPatchRes.status === 304 ? "no changes" : "patched";
    console.log(`skill:      ${skillId} -> ${skillStatus}`);
  }

  // ---- 5. Attach tools to the PAL -----------------------------------------
  // PAL is never recreated (patch-in-place only), so attach whenever any tool
  // or guardrail was newly created — POST /pals/{id}/tools is idempotent for
  // already-attached ids.
  const toolIdList = Object.values(toolIds);
  if (anyToolCreated) {
    await api(`/pals/${palId}/tools`, "POST", { tool_ids: toolIdList });
    console.log(`attached:   ${toolIdList.length} tools -> pal ${palId}`);
  } else {
    console.log(`attached:   skipped (all tools already attached)`);
  }

  // ---- 6. Record ----------------------------------------------------------
  const ids = {
    palId,
    objectivesId,
    replicaId,
    documentIds,
    tools: toolIds,
    guardrails: guardrailIds,
    provisionedAt: new Date().toISOString(),
  };
  await writeFile(IDS_FILE, JSON.stringify(ids, null, 2) + "\n");

  console.log(`\nWrote ${IDS_FILE}`);
  // PAL id is fixed (patched in place, never recreated) — no need to update .env.local for it.
  // Only replica id could change if you ever swap the face; log it as a reminder.
  console.log(`  TAVUS_REPLICA_ID=${replicaId} (update .env.local if this changed)`);

  // .tavus-ids.json holds account object IDs, not secrets, but it is machine
  // state and should not be committed. Warn rather than edit — .gitignore is
  // shared with other build lanes right now.
  const gitignorePath = path.join(ROOT, ".gitignore");
  if (existsSync(gitignorePath)) {
    const gitignore = await readFile(gitignorePath, "utf8");
    if (!gitignore.split(/\r?\n/).some((line) => line.trim() === ".tavus-ids.json")) {
      console.warn("\nWARNING: .tavus-ids.json is not in .gitignore. Add this line:\n  .tavus-ids.json");
    }
  }
};

main().catch((e) => {
  console.error(e);
  fail("provisioning aborted (see stack above)", "Re-run after fixing; already-created objects are recorded in .tavus-ids.json and will be reused.");
});
