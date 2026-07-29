import { test, expect, type ConsoleMessage, type Page } from "@playwright/test";

/**
 * D13 smoke coverage (docs/ARCHITECTURE.md "Test scope"). This suite exists
 * only to catch build/routing/auth-render breakage — a broken import, a
 * route that 500s, a page that doesn't mount. It deliberately does NOT stub
 * the Daily call object @tavus/cvi-ui wraps (that's 2-3h of plumbing the
 * vitest fixture suite already proves is unnecessary) and it deliberately
 * does NOT wait on real Supabase network calls to resolve — both would trade
 * a fast, reliable build-health check for a slow, flaky one.
 */

/** Fails the test on any console error or uncaught page exception. */
function watchForErrors(page: Page): { errors: string[] } {
  const state = { errors: [] as string[] };
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") state.errors.push(msg.text());
  });
  page.on("pageerror", (err) => state.errors.push(err.message));
  return state;
}

test.describe("D13 smoke: build/routing/auth-render only", () => {
  test("/ loads and renders without a console error or thrown exception", async ({
    page,
  }) => {
    const watch = watchForErrors(page);

    const response = await page.goto("/");
    expect(response?.ok()).toBe(true);

    // Title comes from the root layout's static metadata, so it's stable
    // across landing-page copy iteration; a heading assertion (any h1, not
    // its wording) proves the page actually mounted rather than rendering
    // blank.
    await expect(page).toHaveTitle(/Professor Riso/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    expect(watch.errors).toEqual([]);
  });

  test("/session shows the sign-in/difficulty-picker UI without waiting on auth", async ({
    page,
  }) => {
    // No watchForErrors here, deliberately: this route fires a real
    // supabase.auth.signInAnonymously() network call on mount, and in this
    // environment that call itself comes back as a non-2xx (e.g. anonymous
    // sign-in disabled on the project), which the browser logs as a
    // console-level "Failed to load resource" error 1-3s after load —
    // observed directly while auditing this suite. A blanket
    // no-console-errors assertion on this route would fail on exactly the
    // live-credential dependency D13 says to avoid, and non-deterministically
    // so: it only "passed" before because the structural assertions below
    // resolve fast enough to run before that delayed error is logged. Asserting
    // is provably not equivalent to being correct here, so the check is
    // dropped for this route rather than kept as a coin flip.
    await page.goto("/session?class=cs101&concept=recursion");
    await expect(page).toHaveTitle(/Start a session \| Professor Riso/);

    // These all render synchronously from props/mount state, independent of
    // whether the anonymous-sign-in network call has resolved yet — so
    // Playwright's auto-waiting on them is a real signal, not a race against
    // Supabase. We deliberately do NOT assert on the "Guest ..." ready state
    // or on the start button's disabled/enabled flag, since both depend on
    // that async call succeeding against live credentials.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("Pick how many panels you write")).toBeVisible();
    await expect(page.getByRole("radio")).toHaveCount(3);
    await expect(page.getByText("You write all 8")).toBeVisible();
    await expect(page.getByText("You write 6", { exact: true })).toBeVisible();
    await expect(page.getByText("You write 4", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Start the session" })
    ).toBeVisible();
  });

  test("/class/[classId] shows the magic-link login gate, not a 500 or blank page", async ({
    page,
  }) => {
    const watch = watchForErrors(page);

    // No auth cookie is set, so the server component's `!user` branch
    // renders LoginGate. We only assert the gate mounted — never send or
    // complete the actual magic-link flow.
    const response = await page.goto("/class/some-class-id");
    expect(response?.ok()).toBe(true);

    await expect(
      page.getByRole("heading", { name: "Sign in to see how the class is doing." })
    ).toBeVisible();
    await expect(page.getByLabel("Your email")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Email me a link" })
    ).toBeVisible();

    expect(watch.errors).toEqual([]);
  });

  test("an unknown route renders Next's not-found page, not a crash", async ({
    page,
  }) => {
    const response = await page.goto("/nope-this-route-does-not-exist");

    // The real signal here is the HTTP status and the built-in not-found
    // markup — a thrown render error would come back as a 500 with a
    // different body, not a 404 with Next's own "not found" copy.
    expect(response?.status()).toBe(404);
    await expect(page.getByText("This page could not be found.")).toBeVisible();
  });

  test("/conversation without class/concept shows the app's own missing-params state, not a crash", async ({
    page,
  }) => {
    const watch = watchForErrors(page);

    // No searchParams at all means ConversationSurface's `missingParams`
    // check trips before any Daily/Tavus call is ever attempted (it derives
    // `error` status synchronously from the absent params). This is pure
    // React logic with no external dependency, which is exactly the slice of
    // /conversation that's safe to smoke-test per D13.
    const response = await page.goto("/conversation");
    expect(response?.ok()).toBe(true);

    await expect(page.getByRole("heading", { name: "Not connected" })).toBeVisible();
    await expect(
      page.getByText("This page is missing its class and concept.")
    ).toBeVisible();

    expect(watch.errors).toEqual([]);
  });
});
