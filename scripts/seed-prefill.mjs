#!/usr/bin/env node
/**
 * Generates the prefill_panels seed SQL from the actual KB document, instead
 * of hand-paraphrasing lecture content into a one-off SQL blob (which is what
 * this replaced — that copy existed nowhere else, couldn't be regenerated,
 * and had no link back to the source pages it claimed to summarize).
 *
 * This script fetches the real document from Tavus (failing loudly if it
 * isn't `ready`), prints its page summaries so the content below can be
 * checked against the actual source before anyone runs the SQL, and then
 * emits idempotent INSERT ... ON CONFLICT ... DO UPDATE statements.
 *
 * The panel copy itself is still human-authored — a script cannot write good
 * zine copy — but PANEL_CONTENT below cites the exact source page for every
 * panel, so a reviewer (or a future re-run after the doc changes) can verify
 * each claim against real material instead of trusting memory.
 *
 * Usage:
 *   set -a && source .env.local && set +a && node scripts/seed-prefill.mjs
 *   node scripts/seed-prefill.mjs --class cs102 --doc <other-doc-id>
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "https://tavusapi.com/v2";

const API_KEY = process.env.TAVUS_API_KEY;
if (!API_KEY) {
  fail("TAVUS_API_KEY is not set.", "set -a && source .env.local && set +a && node scripts/seed-prefill.mjs");
}

function fail(what, whatToDo) {
  console.error(`\nFAILED: ${what}`);
  if (whatToDo) console.error(`FIX:    ${whatToDo}`);
  process.exit(1);
}

async function api(pathname) {
  const res = await fetch(`${BASE}${pathname}`, { headers: { "x-api-key": API_KEY } });
  const text = await res.text();
  if (!res.ok) {
    console.error(`\nGET ${BASE}${pathname} -> HTTP ${res.status}`);
    console.error(text);
    fail(`GET ${pathname} returned ${res.status}`, "Check the document id and TAVUS_API_KEY.");
  }
  return JSON.parse(text || "{}");
}

const args = process.argv.slice(2);
const argValue = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i === -1 ? fallback : args[i + 1];
};

const CLASS_ID = argValue("--class", "cs101");
const DOCUMENT_ID = argValue(
  "--doc",
  process.env.TAVUS_DOCUMENT_IDS?.split(",")[0]?.trim() ?? "dc-9cf86e66ffaf",
);

/**
 * Human-authored panel copy, each entry citing the source page(s) it claims
 * to summarize (verified 2026-07-28 against dc-9cf86e66ffaf, 6.100L Lecture
 * 15 "RECURSION"). Re-check these page numbers if DOCUMENT_ID changes — the
 * script does not verify the citation automatically, only that the document
 * exists and is ready; the printed page_summaries below are what to check it
 * against by eye.
 */
const PANEL_CONTENT = [
  {
    panelNumber: 1,
    difficulties: [2, 4],
    sourcePages: "pp. 6-16 (mult_recur decomposition)",
    text: "A recursive step splits a problem into something you already know, plus a smaller version of the same problem. mult_recur(a, b) = a + mult_recur(a, b-1).",
    visualNote: "a*b shown decomposing into a + (a * smaller b), one layer at a time",
  },
  {
    panelNumber: 2,
    difficulties: [2, 4],
    sourcePages: "p. 16 (base case: b == 1 -> return a)",
    text: "The base case is where recursion stops: when b == 1, mult_recur just returns a. No base case, or one that never gets reached, means the calls never stop.",
    visualNote: 'a single box labeled "b = 1: return a" at the bottom of the call stack',
  },
  {
    panelNumber: 3,
    difficulties: [4],
    sourcePages: "p. 22 (factorial recursive step + base case)",
    text: "Factorial follows the same shape: fact(n) = n * fact(n-1), stopping at fact(1) = 1. Same pattern, different operation.",
    visualNote: "n! unrolling into n times (n-1)! until it hits 1",
  },
  {
    panelNumber: 4,
    difficulties: [4],
    sourcePages: "pp. 23-24 (independent call scopes)",
    text: "Every recursive call gets its own separate scope. fact(4) calling fact(3) does not share or overwrite fact(4)'s copy of n — each call waits on the one below it, then the answers return back up.",
    visualNote: "stack of call frames, each with its own n, waiting on the frame below",
  },
];

function sqlString(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

async function main() {
  console.log(`Fetching document ${DOCUMENT_ID}...`);
  const doc = await api(`/documents/${DOCUMENT_ID}`);
  if (doc.status !== "ready") {
    fail(
      `document ${DOCUMENT_ID} is not ready (status: ${doc.status})`,
      "Wait for ingestion to finish, or pick a different --doc that is already ready.",
    );
  }
  console.log(`document:   ${doc.document_name} (ready)\n`);

  console.log("Source pages this seed cites — check them against the panels below:");
  const summaries = doc.page_summaries ?? {};
  const cited = new Set(
    PANEL_CONTENT.flatMap((p) => p.sourcePages.match(/\d+/g) ?? []).map(Number),
  );
  for (const page of [...cited].sort((a, b) => a - b)) {
    const summary = summaries[String(page)];
    if (summary) console.log(`  p${page}: ${summary.slice(0, 140)}${summary.length > 140 ? "…" : ""}`);
    else console.log(`  p${page}: (not present in this document's page_summaries — verify manually)`);
  }
  console.log();

  const lines = [
    "-- Generated by scripts/seed-prefill.mjs — do not hand-edit the VALUES below;",
    "-- edit PANEL_CONTENT in the script and re-run so the citations stay attached.",
    `-- Source: ${doc.document_name} (${DOCUMENT_ID}), fetched ${new Date().toISOString()}`,
    "",
    "insert into public.prefill_panels (class_id, difficulty, panel_number, text, visual_note) values",
  ];

  const rows = [];
  for (const panel of PANEL_CONTENT) {
    for (const difficulty of panel.difficulties) {
      rows.push({
        value: `  (${sqlString(CLASS_ID)}, ${difficulty}, ${panel.panelNumber}, ${sqlString(panel.text)}, ${sqlString(panel.visualNote)})`,
        sourcePages: panel.sourcePages,
      });
    }
  }
  // The comma has to land BEFORE the trailing `--` comment, not after: a line
  // comment runs to end of line, so a comma placed after it is swallowed and
  // the two tuples on either side of that newline silently lose their
  // separator — the exact bug this comment is here to stop reintroducing.
  lines.push(
    rows
      .map((row, i) => `${row.value}${i < rows.length - 1 ? "," : ""} -- ${row.sourcePages}`)
      .join("\n"),
  );
  lines.push(
    "on conflict (class_id, difficulty, panel_number) do update set",
    "  text = excluded.text,",
    "  visual_note = excluded.visual_note;",
  );

  const sql = lines.join("\n") + "\n";
  console.log("--- Paste into Supabase SQL Editor ---\n");
  console.log(sql);

  const outPath = path.join(ROOT, "supabase", `seed-prefill-${CLASS_ID}.sql`);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(outPath, sql);
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
