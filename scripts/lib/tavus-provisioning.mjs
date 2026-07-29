/**
 * Pure, side-effect-free provisioning logic shared between setup-tavus.mjs
 * and its unit tests. Extracted so tests can import these functions directly
 * without executing setup-tavus.mjs's top-level script body (which reads
 * TAVUS_API_KEY from the environment and calls process.exit(1) if it's
 * missing) — same reasoning as tests/inert-text.test.ts mirroring pure
 * helpers instead of importing files with request/process-scoped side
 * effects.
 */

/**
 * Expand the per-panel template into a flat objectives graph.
 *
 * The graph MUST be acyclic. Tavus accepts a cyclic graph at POST /v2/objectives
 * and returns 200, but any conversation using that PAL dies about a second after
 * creation with `exception_encountered_during_conversation_startup` — the graph
 * is only validated when a conversation instantiates it, so the 200 is a false
 * green. Verified 2026-07-27; see docs/ARCHITECTURE.md T1 finding 2 (D16).
 *
 * The graph always covers all 8 panels (D19 supersedes D11 and the earlier
 * TAVUS_PREFILL_COUNT-shaped graph): difficulty is a per-session runtime choice
 * told to the PAL via conversational_context, not a provisioning-time shape, so
 * the graph has to define every panel and let the lead-in node's conditional
 * branch pick where a given session actually enters. Panels before the entry
 * point are simply unreached for that session — still part of the static
 * graph, never traversed.
 *
 * Each panel N contributes one node per panelChain step. The retry cap is
 * structural: reexplain/retest have no edge back to an earlier step in the
 * same panel, only forward. The last panel's confirm/gentle_correct chains to
 * the terminal wrap_up node, which has no outgoing edge — that terminal is
 * what keeps the graph startable.
 */
export function buildObjectivesGraph(template) {
  const PANEL_COUNT = 8;
  const panelNumbers = Array.from({ length: PANEL_COUNT }, (_, i) => i + 1);
  const nodeName = (n, suffix) => `panel_${n}_${suffix}`;
  const data = [];

  data.push({
    objective_name: template.leadIn.objective_name,
    objective_prompt: template.leadIn.objective_prompt,
    confirmation_mode: template.leadIn.confirmation_mode,
    next_conditional_objectives: { ...template.leadIn.conditional },
  });

  // Fixed, non-repeating nodes (unlike panelChain, never {N}-expanded or
  // looped over panelNumbers) — one per prefilled panel, so a stall has a
  // structural checkpoint to be caught at instead of relying on the model
  // self-counting "1 through the difficulty count" in one silent turn.
  for (const node of template.prefillChain || []) {
    data.push({ ...node });
  }

  panelNumbers.forEach((n, i) => {
    const nextPanel = panelNumbers[i + 1];
    for (const step of template.panelChain) {
      const node = {
        objective_name: nodeName(n, step.suffix),
        objective_prompt: step.objective_prompt.replaceAll("{N}", String(n)),
        confirmation_mode: "auto",
      };
      if (step.conditional) {
        node.next_conditional_objectives = Object.fromEntries(
          Object.entries(step.conditional).map(([suffix, cond]) => [nodeName(n, suffix), cond])
        );
      } else if (step.next === "ADVANCE") {
        // Forward to the next panel, or out to the terminal node when this is the last.
        node.next_required_objective = nextPanel
          ? nodeName(nextPanel, template.panelChain[0].suffix)
          : template.terminal.objective_name;
      } else if (step.next) {
        node.next_required_objective = nodeName(n, step.next);
      }
      data.push(node);
    }
  });

  data.push({ ...template.terminal });
  return { data };
}

/**
 * Fetches the curated topic list's live Tavus document ids from Supabase's
 * topic_documents table (ready rows only) — the presentation skill's
 * document set, kept scoped to "documents worth presenting" rather than the
 * full 50-doc KB. RLS grants anon read on this table (topics must be
 * fetchable before a session cookie exists), so the anon key is enough; no
 * service-role key needed for this script.
 *
 * Throws (rather than calling process.exit) on missing config or a failed
 * request, so callers decide how to report it — setup-tavus.mjs calls its
 * own fail() helper; tests can assert on the thrown message directly.
 */
export async function fetchTopicDocumentIds({ url, anonKey, fetchImpl = fetch }) {
  if (!url || !anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY not set.");
  }

  const res = await fetchImpl(`${url}/rest/v1/topic_documents?select=tavus_document_id&status=eq.ready`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GET topic_documents -> HTTP ${res.status}\n${body}`);
  }
  const rows = await res.json();
  return Array.from(new Set(rows.map((row) => row.tavus_document_id)));
}

/**
 * Resolves the __WEBHOOK_URL__ sentinel in the post_call_summary tool
 * (lib/tavus/tools-config.json) against PUBLIC_APP_URL + TAVUS_WEBHOOK_SECRET.
 * Same env vars app/api/conversation/route.ts reads at request time — both
 * have to agree, or the tool posts to a URL the webhook route will reject.
 *
 * Missing either var drops the tool entirely rather than creating a tool
 * whose delivery URL is a placeholder Tavus would dutifully POST to and get
 * a 404/DNS failure from forever. Every other tool still gets created.
 */
export function resolvePostCallTools(tools, env) {
  const publicAppUrl = env.PUBLIC_APP_URL;
  const webhookSecret = env.TAVUS_WEBHOOK_SECRET;
  if (publicAppUrl && webhookSecret) {
    const webhookUrl = `${publicAppUrl.replace(/\/$/, "")}/api/tavus/session-summary?key=${encodeURIComponent(webhookSecret)}`;
    return tools.map((tool) =>
      tool.delivery?.api?.url === "__WEBHOOK_URL__"
        ? { ...tool, delivery: { ...tool.delivery, api: { ...tool.delivery.api, url: webhookUrl } } }
        : tool
    );
  }
  return tools.filter((tool) => tool.delivery?.api?.url !== "__WEBHOOK_URL__");
}
