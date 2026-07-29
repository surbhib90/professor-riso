/**
 * Builds a Tavus-facing callback URL for one of this app's webhook routes
 * (app/api/tavus/session-summary, app/api/tavus/document-status).
 *
 * Both PUBLIC_APP_URL and TAVUS_WEBHOOK_SECRET are optional in local dev,
 * where there usually isn't a Tavus-reachable address to hand back — callers
 * treat a null return as "skip the callback_url field", not as an error, the
 * same way app/api/conversation/route.ts already does for session-summary.
 */
export function buildTavusWebhookUrl(path: string): string | null {
  const publicAppUrl = process.env.PUBLIC_APP_URL;
  const webhookSecret = process.env.TAVUS_WEBHOOK_SECRET;
  if (!publicAppUrl || !webhookSecret) return null;
  return `${publicAppUrl.replace(/\/$/, "")}${path}?key=${encodeURIComponent(webhookSecret)}`;
}
