#!/usr/bin/env node
/**
 * Tags a Tavus document and prints the exact values to add to
 * the topic_documents table in Supabase (via supabase/schema.sql's seed
 * or a manual INSERT).
 *
 * Usage:
 *   set -a && source .env.local && set +a
 *   node scripts/tag-document.mjs <document_id> <tag>
 *
 * Example:
 *   node scripts/tag-document.mjs dc-a3f0c2867514 "iteration"
 *
 * After running, add a row to topic_documents in Supabase:
 *   insert into public.topic_documents (class_id, topic_label, tavus_document_id, source, status)
 *   values ('cs101', 'Iteration', '<document_id>', 'curated', 'ready')
 *   on conflict (tavus_document_id) do nothing;
 */

const API_KEY = process.env.TAVUS_API_KEY;
if (!API_KEY) {
    console.error("TAVUS_API_KEY is not set. Run: set -a && source .env.local && set +a");
    process.exit(1);
}

const [documentId, tag] = process.argv.slice(2);
if (!documentId || !tag) {
    console.error("Usage: node scripts/tag-document.mjs <document_id> <tag>");
    process.exit(1);
}

const BASE = "https://tavusapi.com/v2";

async function main() {
    const patchRes = await fetch(`${BASE}/documents/${documentId}`, {
        method: "PATCH",
        headers: { "x-api-key": API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ tags: [tag] }),
    });
    if (!patchRes.ok) {
        console.error(`PATCH failed: HTTP ${patchRes.status}`);
        console.error(await patchRes.text());
        process.exit(1);
    }

    // Re-fetch rather than trust the PATCH response, to prove it actually persisted.
    const getRes = await fetch(`${BASE}/documents/${documentId}`, {
        headers: { "x-api-key": API_KEY },
    });
    const doc = await getRes.json();

    if (!doc.tags || !doc.tags.includes(tag)) {
        console.error(`Tag did not persist. Live tags: ${JSON.stringify(doc.tags)}`);
        process.exit(1);
    }

    console.log(`Tagged ${documentId} (${doc.document_name}) with "${tag}".`);
    console.log(`\nTo register this as a topic, add to Supabase topic_documents:`);
    console.log(`  insert into public.topic_documents (class_id, topic_label, tavus_document_id, source, status)`);

    // Title-case the tag for the label
    const label = tag.replace(/\b\w/g, (c) => c.toUpperCase());
    console.log(`  values ('cs101', '${label}', '${documentId}', 'curated', 'ready')`);
    console.log(`  on conflict (tavus_document_id) do nothing;`);
}

main();
