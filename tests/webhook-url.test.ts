import { afterEach, describe, expect, it } from "vitest";
import { buildTavusWebhookUrl } from "@/lib/tavus/webhook-url";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("buildTavusWebhookUrl", () => {
  it("returns null when PUBLIC_APP_URL is unset", () => {
    delete process.env.PUBLIC_APP_URL;
    process.env.TAVUS_WEBHOOK_SECRET = "s3cret";
    expect(buildTavusWebhookUrl("/api/tavus/document-status")).toBeNull();
  });

  it("returns null when TAVUS_WEBHOOK_SECRET is unset", () => {
    process.env.PUBLIC_APP_URL = "https://example.com";
    delete process.env.TAVUS_WEBHOOK_SECRET;
    expect(buildTavusWebhookUrl("/api/tavus/document-status")).toBeNull();
  });

  it("builds the callback URL with the secret as a query param", () => {
    process.env.PUBLIC_APP_URL = "https://example.com";
    process.env.TAVUS_WEBHOOK_SECRET = "s3cret";
    expect(buildTavusWebhookUrl("/api/tavus/document-status")).toBe(
      "https://example.com/api/tavus/document-status?key=s3cret"
    );
  });

  it("strips a trailing slash from PUBLIC_APP_URL so the path doesn't double up", () => {
    process.env.PUBLIC_APP_URL = "https://example.com/";
    process.env.TAVUS_WEBHOOK_SECRET = "s3cret";
    expect(buildTavusWebhookUrl("/api/tavus/session-summary")).toBe(
      "https://example.com/api/tavus/session-summary?key=s3cret"
    );
  });

  it("URL-encodes a secret with special characters", () => {
    process.env.PUBLIC_APP_URL = "https://example.com";
    process.env.TAVUS_WEBHOOK_SECRET = "a b&c";
    expect(buildTavusWebhookUrl("/api/tavus/document-status")).toBe(
      "https://example.com/api/tavus/document-status?key=a%20b%26c"
    );
  });
});
