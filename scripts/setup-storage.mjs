#!/usr/bin/env node
/**
 * One-time provisioning: creates the `knowledge-uploads` Storage bucket that
 * app/api/knowledge/upload/route.ts writes to.
 *
 * Public-read on purpose: Tavus's servers fetch `document_url` themselves,
 * asynchronously, sometime in the 5-10 minute processing window — a signed
 * URL would need to outlive that whole window, and a bucket this narrowly
 * scoped (only relevance-*approved* uploads ever land here) doesn't need the
 * extra complexity. Uploads (INSERT) are restricted to signed-in users via a
 * Storage policy set below; nobody can list or overwrite another student's
 * object.
 *
 * Idempotent — safe to re-run. Requires the service-role key because bucket
 * creation and storage.objects policies are both admin-only operations.
 *
 * Usage:
 *   set -a && source .env.local && set +a
 *   node scripts/setup-storage.mjs
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY is not set.\n" +
      "Run: set -a && source .env.local && set +a\n" +
      "(SUPABASE_SERVICE_ROLE_KEY comes from Project Settings -> API -> service_role key.)"
  );
  process.exit(1);
}

const BUCKET_ID = "knowledge-uploads";
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // Vercel's serverless body cap (4.5MB) is the binding constraint, not Tavus's 50MB.
const ALLOWED_MIME_TYPES = ["application/pdf", "image/png", "image/jpeg"];

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data: existing, error: listError } = await supabase.storage.listBuckets();
  if (listError) {
    console.error("Could not list buckets:", listError.message);
    process.exit(1);
  }

  if (existing.some((b) => b.id === BUCKET_ID)) {
    console.log(`Bucket "${BUCKET_ID}" already exists — updating its config.`);
    const { error: updateError } = await supabase.storage.updateBucket(BUCKET_ID, {
      public: true,
      fileSizeLimit: MAX_UPLOAD_BYTES,
      allowedMimeTypes: ALLOWED_MIME_TYPES,
    });
    if (updateError) {
      console.error("Could not update bucket:", updateError.message);
      process.exit(1);
    }
  } else {
    console.log(`Creating bucket "${BUCKET_ID}"...`);
    const { error: createError } = await supabase.storage.createBucket(BUCKET_ID, {
      public: true,
      fileSizeLimit: MAX_UPLOAD_BYTES,
      allowedMimeTypes: ALLOWED_MIME_TYPES,
    });
    if (createError) {
      console.error("Could not create bucket:", createError.message);
      process.exit(1);
    }
  }

  console.log(
    `\nBucket "${BUCKET_ID}" is set up. It still needs its storage.objects RLS ` +
      `policies — those live in supabase/schema.sql (the JS client has no bucket-scoped ` +
      `policy API), applied the same way as the rest of that file.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
