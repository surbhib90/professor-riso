# Professor Riso

A generic teach → probe → artifact tutor, instantiated here as a patient, adaptive CS tutor teaching recursion: students write their own understanding of a concept on a shared canvas, Professor Riso tests it and re-explains once if shaky, then a finished 8-panel zine assembles live from the student's own notes.

More on the motivation behind Professor Riso - [One Pager](https://github.com/surbhib90/professor-riso/ONE-PAGER.md)

Stack: Next.js + TypeScript, deployed on Vercel. `@tavus/cvi-ui` (video conversation), `@excalidraw/excalidraw` (shared canvas), Supabase (Realtime + Postgres + Auth).

## Prerequisites

- Node.js 20+
- A [Tavus](https://tavus.io) account and API key
- A [Supabase](https://supabase.com) project
- An [Anthropic](https://console.anthropic.com) API key

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Configure environment**

   ```bash
   cp .env.local.example .env.local
   ```

   Fill in `.env.local`:
   - `TAVUS_API_KEY` — from maker.tavus.io/dev/api-keys
   - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase project Settings → API
   - `ANTHROPIC_API_KEY` — used to gate mid-session document uploads
   - `TAVUS_PAL_ID` / `TAVUS_REPLICA_ID` — leave blank for now, filled in by step 4

3. **Set up the Supabase database and storage**

   Run `supabase/schema.sql` against your project (SQL Editor in the Supabase dashboard, or `psql`). It creates tables and RLS policies and is safe to re-run.

   Then provision the storage bucket used for mid-session document uploads:

   ```bash
   set -a && source .env.local && set +a
   node scripts/setup-storage.mjs
   ```

4. **Provision the Tavus PAL**

   ```bash
   set -a && source .env.local && set +a
   node scripts/setup-tavus.mjs
   ```

   This creates the tools, objectives graph, and PAL on the Tavus side, then prints a `TAVUS_PAL_ID` and `TAVUS_REPLICA_ID` — paste both back into `.env.local`.

5. **Run the app**

   ```bash
   npm run dev
   ```

   Open http://localhost:3000.

## Dependencies

- **next, react, react-dom** — app framework/UI
- **@daily-co/daily-js, @daily-co/daily-react** — WebRTC video call (Tavus runs on Daily)
- **@excalidraw/excalidraw** — shared drawing canvas
- **@supabase/supabase-js, @supabase/ssr** — Postgres, Realtime, Auth
- **@anthropic-ai/sdk** — Claude, gates mid-session uploads by topic relevance
- **@modelcontextprotocol/ext-apps** — tool-call plumbing for the PAL
- **jotai** — client state
- **html-to-image** — renders finished zine panels to images
- **@vercel/analytics, @vercel/speed-insights** — Vercel telemetry
- Dev: **typescript, tailwindcss, eslint, vitest, @playwright/test**

## Testing

```bash
npx vitest        # unit tests
npm run test:e2e  # Playwright end-to-end tests
npm run lint
```
