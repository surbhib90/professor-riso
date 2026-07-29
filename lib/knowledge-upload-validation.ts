/**
 * Pure validation for app/api/knowledge/upload/route.ts, split out so it can
 * be unit-tested without pulling in that route's Supabase server client
 * (which needs request-scoped cookies and cannot be constructed under
 * vitest — see tests/inert-text.test.ts's original comment for the same
 * problem elsewhere in this app).
 */

export type UploadMimeType = "application/pdf" | "image/png" | "image/jpeg";

export const ALLOWED_MIME_TYPES: readonly UploadMimeType[] = [
  "application/pdf",
  "image/png",
  "image/jpeg",
];

// Tavus itself allows up to 50MB; the binding constraint is this app's
// Vercel deployment, whose serverless functions cap request bodies at
// 4.5MB. Kept comfortably under that ceiling.
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export function isUploadMimeType(value: string): value is UploadMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(value);
}

/** Storage object paths and Tavus tags both end up in URLs/logs, so the
 *  filename gets the same treatment classId/concept already get elsewhere:
 *  strip anything that isn't a plain path segment. */
export function sanitizeFilename(name: string): string {
  const base = name.trim().slice(-120) || "upload";
  return base.replace(/[^A-Za-z0-9._-]/g, "_");
}
