/**
 * A student attaches an image or PDF mid-session (a photo of their notes, a
 * textbook page) and, if it actually relates to the topic they're working
 * on, it becomes part of that topic's Tavus knowledge base — fully
 * automatic, no instructor review step.
 *
 * Pipeline: validate -> ask Claude whether the file is actually about
 * `concept` (lib/anthropic/relevance.ts) -> only on a pass, upload to the
 * public `knowledge-uploads` Storage bucket (Tavus fetches document_url
 * itself, so it has to be a real URL, not raw bytes) -> POST
 * /v2/documents -> record a `topic_documents` row so /api/topics and
 * /api/conversation can find it once Tavus finishes processing.
 *
 * A rejected file touches nothing: no Storage object, no Tavus document, no
 * DB row. This is deliberately a *different* route from the existing
 * app/api/knowledge/route.ts (URL-based, operator/CLI-facing, no relevance
 * gate, no DB write) — that path stays exactly as it was.
 */

import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import {
  MAX_CLASS_ID_LENGTH,
  MAX_CONCEPT_LENGTH,
  SAFE_ID_PATTERN,
  parseString,
} from "@/lib/http-validation";
import { buildTavusWebhookUrl } from "@/lib/tavus/webhook-url";
import { checkRelevance, RelevanceCheckError } from "@/lib/anthropic/relevance";
import {
  MAX_UPLOAD_BYTES,
  isUploadMimeType,
  sanitizeFilename,
} from "@/lib/knowledge-upload-validation";

const TAVUS_BASE_URL = "https://tavusapi.com/v2";
const STORAGE_BUCKET = "knowledge-uploads";

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.TAVUS_API_KEY;
  if (!apiKey) {
    console.error("/api/knowledge/upload: TAVUS_API_KEY missing from the server environment.");
    return jsonError(500, "Server is not configured: TAVUS_API_KEY is missing.");
  }

  // Identity and RLS both come from the session cookie — never trust a
  // body-supplied student id, same rule /api/conversation follows.
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return jsonError(401, "Sign in before uploading.");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(400, "Request body must be multipart/form-data.");
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return jsonError(400, `"file" is required.`);
  }
  if (!isUploadMimeType(file.type)) {
    return jsonError(400, `Unsupported file type "${file.type}". Allowed: PDF, PNG, JPEG.`);
  }
  if (file.size === 0) {
    return jsonError(400, "The uploaded file is empty.");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return jsonError(413, `File is larger than ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB.`);
  }

  const classId = parseString(form.get("classId"), "classId", MAX_CLASS_ID_LENGTH, SAFE_ID_PATTERN);
  if (!classId.ok) return jsonError(400, classId.error);

  const concept = parseString(form.get("concept"), "concept", MAX_CONCEPT_LENGTH);
  if (!concept.ok) return jsonError(400, concept.error);

  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const fileBase64 = fileBuffer.toString("base64");

  let verdict;
  try {
    verdict = await checkRelevance(fileBase64, file.type, concept.value);
  } catch (err) {
    if (err instanceof RelevanceCheckError) {
      console.error(`/api/knowledge/upload: relevance check failed: ${err.message}`);
      return jsonError(502, "Could not verify relevance right now. Try again in a moment.");
    }
    throw err;
  }

  if (!verdict.relevant) {
    return Response.json({ added: false, reason: verdict.reason });
  }

  // --- passed the relevance gate: upload, then register with Tavus --------

  const objectPath = `${classId.value}/${sanitizeFilename(concept.value)}/${randomUUID()}-${sanitizeFilename(file.name)}`;
  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(objectPath, fileBuffer, { contentType: file.type, upsert: false });
  if (uploadError) {
    console.error(`/api/knowledge/upload: Storage upload failed: ${uploadError.message}`);
    return jsonError(502, "Could not store the file. Try again.");
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(objectPath);

  const documentWebhookUrl = buildTavusWebhookUrl("/api/tavus/document-status");

  let created: { document_id?: string };
  try {
    const createRes = await fetch(`${TAVUS_BASE_URL}/documents`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        document_url: publicUrl,
        document_name: file.name,
        tags: [concept.value],
        ...(documentWebhookUrl ? { callback_url: documentWebhookUrl } : {}),
      }),
    });
    if (!createRes.ok) {
      const errorText = await createRes.text();
      console.error(`/api/knowledge/upload: POST /documents -> HTTP ${createRes.status}: ${errorText}`);
      await supabase.storage.from(STORAGE_BUCKET).remove([objectPath]);
      return jsonError(502, `Tavus rejected the document (HTTP ${createRes.status}).`);
    }
    created = await createRes.json();
  } catch (err) {
    console.error("/api/knowledge/upload: could not reach Tavus", err);
    await supabase.storage.from(STORAGE_BUCKET).remove([objectPath]);
    return jsonError(502, "Could not reach Tavus.");
  }

  const documentId = created.document_id;
  if (!documentId) {
    console.error("/api/knowledge/upload: no document_id in Tavus response", created);
    await supabase.storage.from(STORAGE_BUCKET).remove([objectPath]);
    return jsonError(502, "Tavus did not return a document id.");
  }

  // Bookkeeping only, at this point — the document already exists in Tavus's
  // KB regardless of whether this insert succeeds. A failure here means the
  // upload won't show up as a selectable topic yet, not that anything is
  // lost; logged loudly so it's not silently invisible.
  const { error: insertError } = await supabase.from("topic_documents").insert({
    class_id: classId.value,
    topic_label: concept.value,
    tavus_document_id: documentId,
    source: "student_upload",
    uploaded_by: user.id,
    status: "processing",
  });
  if (insertError) {
    console.error(
      `/api/knowledge/upload: topic_documents insert failed for ${documentId}: ${insertError.message}`
    );
  }

  return Response.json({ added: true, documentId, status: "processing" }, { status: 201 });
}
