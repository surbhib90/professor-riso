-- ===========================================================================
-- Professor Byte — schema + RLS (ARCHITECTURE.md, Seam 3 / D4 / D14 / D15)
--
-- Trust model: the client is the state authority. It writes panels and
-- understanding events directly from the browser under RLS. RLS therefore
-- scopes WHO may write a row, not WHAT the row says — a student can forge
-- their own data but never another student's. Accepted (see "Known gaps").
--
-- Both roles are Supabase `authenticated`: students arrive via anonymous
-- sign-in (D14) and instructors via magic link. Anonymous users get real,
-- stable `auth.uid()` values, so every policy below works identically for
-- them; nothing keys off `is_anonymous`.
--
-- Idempotent — safe to re-run against a partially built project.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- panels — one row per zine panel. The zine itself, and the shelf's source.
-- ---------------------------------------------------------------------------
create table if not exists public.panels (
  id              uuid primary key default gen_random_uuid(),

  -- Tavus conversation id. Not a FK: conversations live in Tavus, not here.
  conversation_id text        not null,
  student_id      uuid        not null references auth.users (id) on delete cascade,
  class_id        text        not null,

  -- Denormalised onto the row so the shelf can group by concept without
  -- a sessions table we would otherwise never read.
  concept         text        not null default '',

  panel_number    smallint    not null check (panel_number between 1 and 8),
  text            text        not null,
  visual_note     text,

  -- Only 'student' rows count toward class stats; 'prefill' are worked
  -- examples the student did not author.
  source          text        not null check (source in ('prefill', 'student')),

  -- Mirrors lib/types.ts Mastery. Prefilled panels are always 'none'.
  mastery         text        not null default 'none'
                    check (mastery in ('first-try', 'after-retry', 'none')),

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- The upsert target. A re-confirmed panel overwrites; it never duplicates.
  unique (conversation_id, panel_number)
);

-- Rehydrate-on-mount reads the whole conversation; the shelf reads by student.
create index if not exists panels_conversation_idx on public.panels (conversation_id);
create index if not exists panels_student_idx      on public.panels (student_id, concept);

-- ---------------------------------------------------------------------------
-- understanding_events — every transfer-test verdict. Append-only; the pair
-- (attempt 1 shaky, attempt 2 solid) is the signal the instructor view reads,
-- so we keep both rows rather than overwriting.
-- ---------------------------------------------------------------------------
create table if not exists public.understanding_events (
  id           uuid        primary key default gen_random_uuid(),
  class_id     text        not null,
  student_id   uuid        not null references auth.users (id) on delete cascade,
  panel_number smallint    not null check (panel_number between 1 and 8),
  level        text        not null check (level in ('confused', 'shaky', 'solid')),

  -- Capped at 2 by the objective graph: `reexplain_once` has no edge to itself.
  attempt      smallint    not null check (attempt between 1 and 2),
  created_at   timestamptz not null default now()
);

create index if not exists understanding_events_class_idx
  on public.understanding_events (class_id, panel_number);

-- ---------------------------------------------------------------------------
-- tool_call_events — raw audit log of every conversation.tool_call the PAL
-- sends, success or rejected. Separate from panels/understanding_events
-- (which only ever hold validated, applied writes) because a tool call that
-- never arrives, or arrives malformed, leaves no trace in those tables — this
-- is what answers "did the model even try to call log_zine_page" during
-- debugging, per docs.tavus.io/sections/onboarding-guide/tool-calling-examples's
-- observability guidance (log conversation id, tool call id, tool name,
-- parameters, status, timestamp).
-- ---------------------------------------------------------------------------
create table if not exists public.tool_call_events (
  id              uuid        primary key default gen_random_uuid(),
  conversation_id text        not null,
  class_id        text        not null,
  student_id      uuid        not null references auth.users (id) on delete cascade,
  tool_name       text        not null,
  tool_call_id    text        not null,
  arguments       jsonb       not null default '{}'::jsonb,
  status          text        not null check (status in ('ok', 'rejected')),
  reason          text,
  created_at      timestamptz not null default now()
);

create index if not exists tool_call_events_conversation_idx
  on public.tool_call_events (conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- webhook_events — raw audit log of every event Tavus sends to this app's
-- callback_url (system.shutdown, transcription_ready, perception_analysis,
-- post_call_action_executed, ...), not just the ones a route currently acts
-- on. Motivated by two 2026-07-30 incidents: a session that died early with
-- no visible reason (system.shutdown was being silently dropped), and a
-- PUBLIC_APP_URL bug that broke webhook delivery entirely with no way to
-- notice short of manually diffing session_summaries against known
-- conversations. This table plus the /api/cron/webhook-health check make
-- both failure modes visible without a live-session postmortem. Written
-- only by the service-role webhook handlers (same model as
-- session_summaries below) — no client write path, no RLS policies needed.
-- ---------------------------------------------------------------------------
create table if not exists public.webhook_events (
  id              uuid        primary key default gen_random_uuid(),
  conversation_id text,
  event_type      text        not null,
  properties      jsonb       not null default '{}'::jsonb,
  received_at     timestamptz not null default now()
);

create index if not exists webhook_events_conversation_idx
  on public.webhook_events (conversation_id);
create index if not exists webhook_events_type_time_idx
  on public.webhook_events (event_type, received_at);

-- ---------------------------------------------------------------------------
-- class_owners — the instructor gate.
--
-- One owner per class_id, enforced by the unique constraint below, not just
-- app logic: the claim flow (Seam 3) does "insert if nobody owns this class
-- yet", and two instructors racing to claim the same class_id must have the
-- loser fail at the database, not silently create a second owner.
-- ---------------------------------------------------------------------------
create table if not exists public.class_owners (
  class_id      text not null unique,
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (class_id, owner_user_id)
);

-- ---------------------------------------------------------------------------
-- prefill_panels — UNUSED as of D19. D11 originally had the client precompute
-- worked examples here so join time was a select instead of a KB round trip;
-- D19 reversed that back to agent-driven generation (the PAL writes prefill
-- panels itself, live, at session start, accepting the 30-90s it costs) and
-- nothing in the app reads or writes this table anymore. Left in place rather
-- than dropped — no app code depends on its absence either, and dropping it
-- is one more thing to paste into the SQL editor for zero behavior change.
-- Safe to drop whenever convenient.
-- ---------------------------------------------------------------------------
create table if not exists public.prefill_panels (
  class_id     text     not null,
  difficulty   smallint not null check (difficulty in (0, 2, 4)),
  panel_number smallint not null check (panel_number between 1 and 8),
  text         text     not null,
  visual_note  text,
  primary key (class_id, difficulty, panel_number)
);

-- ---------------------------------------------------------------------------
-- updated_at — the shelf orders by "last touched"; without this an upsert that
-- rewrites a panel would keep reporting its original timestamp.
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists panels_touch_updated_at on public.panels;
create trigger panels_touch_updated_at
  before update on public.panels
  for each row execute function public.touch_updated_at();

-- ===========================================================================
-- Row Level Security
--
-- Every table is deny-by-default: RLS on, and only the policies below open
-- anything. Absent policies are deliberate — no delete policy anywhere, no
-- client write path to prefill_panels. class_owners allows exactly one
-- narrow insert (claim-if-unowned, below), nothing broader.
--
-- `(select auth.uid())` rather than bare `auth.uid()`: Postgres hoists the
-- subselect to an InitPlan and evaluates it once per statement instead of
-- once per row.
-- ===========================================================================

alter table public.panels               enable row level security;
alter table public.understanding_events enable row level security;
alter table public.class_owners         enable row level security;
alter table public.prefill_panels       enable row level security;
alter table public.tool_call_events     enable row level security;
-- No policies below for webhook_events, deliberately: nobody but service_role
-- (which bypasses RLS) should ever read or write this table.
alter table public.webhook_events       enable row level security;

-- --- panels ----------------------------------------------------------------

-- Intent: a student reads back their own zines — for mid-session rehydrate
-- after a refresh, and for the shelf. Instructors are NOT granted panel reads:
-- the aggregation view needs counts, not anyone's actual work.
drop policy if exists "panels: students read their own" on public.panels;
create policy "panels: students read their own"
  on public.panels for select to authenticated
  using (student_id = (select auth.uid()));

-- Intent: a student may only author panels attributed to themselves. This is
-- the policy that makes forging a row *as another student* impossible.
drop policy if exists "panels: students insert as themselves" on public.panels;
create policy "panels: students insert as themselves"
  on public.panels for insert to authenticated
  with check (student_id = (select auth.uid()));

-- Intent: re-confirming a panel overwrites it (upsert on
-- conversation_id+panel_number). USING gates which rows are visible to the
-- update; WITH CHECK stops an update from reassigning student_id to someone
-- else — both halves are required, one alone leaks.
drop policy if exists "panels: students update their own" on public.panels;
create policy "panels: students update their own"
  on public.panels for update to authenticated
  using (student_id = (select auth.uid()))
  with check (student_id = (select auth.uid()));

-- --- understanding_events --------------------------------------------------

-- Intent: same authorship rule as panels — you can only record a verdict
-- about yourself.
drop policy if exists "events: students insert as themselves" on public.understanding_events;
create policy "events: students insert as themselves"
  on public.understanding_events for insert to authenticated
  with check (student_id = (select auth.uid()));

-- Intent: a student may see their own history (the session recap).
drop policy if exists "events: students read their own" on public.understanding_events;
create policy "events: students read their own"
  on public.understanding_events for select to authenticated
  using (student_id = (select auth.uid()));

-- Intent: the instructor aggregation. Scoped by ownership, not by URL — a
-- non-owner hitting /class/<id> gets zero rows from the database itself, so
-- the page has nothing to hide. Multiple SELECT policies are OR'd, so this
-- widens instructors without narrowing students.
drop policy if exists "events: instructors read classes they own" on public.understanding_events;
create policy "events: instructors read classes they own"
  on public.understanding_events for select to authenticated
  using (
    exists (
      select 1
      from public.class_owners co
      where co.class_id = understanding_events.class_id
        and co.owner_user_id = (select auth.uid())
    )
  );

-- --- tool_call_events --------------------------------------------------------

-- Intent: same authorship rule as panels/understanding_events — you can only
-- log a tool call about your own session.
drop policy if exists "tool_calls: students insert as themselves" on public.tool_call_events;
create policy "tool_calls: students insert as themselves"
  on public.tool_call_events for insert to authenticated
  with check (student_id = (select auth.uid()));

-- Intent: debugging a student's own session (e.g. from a support conversation).
drop policy if exists "tool_calls: students read their own" on public.tool_call_events;
create policy "tool_calls: students read their own"
  on public.tool_call_events for select to authenticated
  using (student_id = (select auth.uid()));

-- Intent: instructors debugging "did the model even try to call this tool"
-- for a class they own, same ownership rule as understanding_events.
drop policy if exists "tool_calls: instructors read classes they own" on public.tool_call_events;
create policy "tool_calls: instructors read classes they own"
  on public.tool_call_events for select to authenticated
  using (
    exists (
      select 1
      from public.class_owners co
      where co.class_id = tool_call_events.class_id
        and co.owner_user_id = (select auth.uid())
    )
  );

-- --- class_owners ----------------------------------------------------------

-- Intent: an instructor can confirm which classes are theirs (and the EXISTS
-- above needs the row readable under the caller's own privileges).
drop policy if exists "class_owners: owners read their own rows" on public.class_owners;
create policy "class_owners: owners read their own rows"
  on public.class_owners for select to authenticated
  using (owner_user_id = (select auth.uid()));

-- A WITH CHECK subquery reading class_owners from inside a policy ON
-- class_owners makes Postgres re-evaluate RLS on that inner read too — which
-- re-enters the same INSERT policy's own evaluation and errors with
-- "infinite recursion detected in policy for relation" (42P17, reproduced
-- and confirmed 2026-07-28 against a real local Postgres instance, not just
-- reasoned about). The fix is to move the "does anyone already own this
-- class" read into a SECURITY DEFINER function: it runs with the function
-- owner's privileges, so it reads the table directly instead of through the
-- caller's RLS — no recursive policy evaluation, because it isn't evaluating
-- a policy at all for that read.
create or replace function public.class_is_owned(target_class_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.class_owners where class_id = target_class_id);
$$;

revoke all on function public.class_is_owned(text) from public;
grant execute on function public.class_is_owned(text) to authenticated;

-- Intent: first authenticated visit to an unowned class claims it — no SQL
-- editor, no manually pasted UUID. WITH CHECK requires BOTH that the caller is
-- claiming for themselves AND that no owner row exists for this class_id yet;
-- the unique constraint on class_id is the real enforcement if two claims
-- race, this predicate is what makes the loser's attempt rejected outright
-- rather than erroring past RLS into a constraint violation.
--
-- Anonymous users are also `authenticated` (D14), so this technically lets a
-- guest claim a class. Acceptable for now: the instructor-facing UI is the
-- only thing this gates, and a guest who bothers to visit /class/<id> before
-- any real instructor does is a demo-day edge case, not a security hole — the
-- claimed row still only grants access to the ledger, never to another
-- student's panels.
drop policy if exists "class_owners: first signed-in visitor claims it" on public.class_owners;
create policy "class_owners: first signed-in visitor claims it"
  on public.class_owners for insert to authenticated
  with check (
    owner_user_id = (select auth.uid())
    and not public.class_is_owned(class_id)
  );

-- --- prefill_panels --------------------------------------------------------

-- Intent: worked examples are course material. Any signed-in user may read
-- them (students need them at join to render the zine instantly). Nobody
-- writes them from the client.
drop policy if exists "prefill: readable when signed in" on public.prefill_panels;
create policy "prefill: readable when signed in"
  on public.prefill_panels for select to authenticated
  using (true);

-- --- conversation_owners ---------------------------------------------------

-- Records who opened a Tavus conversation, so ending one can be authorised.
-- Without this the end endpoint takes a conversation id straight off the query
-- string and anyone can kill anyone else's live call. It also lets the create
-- path reap a caller's own stale conversation before opening another, which
-- matters because the Tavus account caps concurrent conversations at a low
-- number and nothing reaps them on disconnect (see ARCHITECTURE.md T1 #3).
create table if not exists public.conversation_owners (
  conversation_id text primary key,
  student_id      uuid        not null references auth.users (id) on delete cascade,
  created_at      timestamptz not null default now(),
  ended_at        timestamptz
);

-- class_id was added after this table's first release; ADD COLUMN IF NOT
-- EXISTS keeps re-running this file safe against an already-created table,
-- which `create table if not exists` above does not cover for new columns.
alter table public.conversation_owners add column if not exists class_id text;

create index if not exists conversation_owners_student_live_idx
  on public.conversation_owners (student_id)
  where ended_at is null;

alter table public.conversation_owners enable row level security;

-- Intent: a student sees and closes only conversations they opened. Insert is
-- constrained to their own uid so a row cannot be planted against someone else.
drop policy if exists "conversations: students read their own" on public.conversation_owners;
create policy "conversations: students read their own"
  on public.conversation_owners for select to authenticated
  using (student_id = (select auth.uid()));

drop policy if exists "conversations: students insert as themselves" on public.conversation_owners;
create policy "conversations: students insert as themselves"
  on public.conversation_owners for insert to authenticated
  with check (student_id = (select auth.uid()));

-- USING alone would let an update reassign student_id to another user, so the
-- same predicate is repeated in WITH CHECK.
drop policy if exists "conversations: students close their own" on public.conversation_owners;
create policy "conversations: students close their own"
  on public.conversation_owners for update to authenticated
  using (student_id = (select auth.uid()))
  with check (student_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- session_summaries — one AI-generated recap per conversation, produced by
-- the PAL's post_call_summary tool after the call ends (docs.tavus.io/
-- sections/conversational-video-interface/pal/post-call-tool) and written by
-- the /api/tavus/session-summary webhook.
--
-- No insert/update policy anywhere, on purpose: the webhook is the only
-- writer, and it runs under the service-role key (bypasses RLS entirely —
-- see lib/supabase/service.ts). A shared-secret check in that route is what
-- stands in for RLS on the write side, because the request has no Supabase
-- user session to bind a policy to.
-- ---------------------------------------------------------------------------
create table if not exists public.session_summaries (
  conversation_id text        primary key,
  student_id      uuid        not null references auth.users (id) on delete cascade,
  class_id        text        not null,
  summary         text        not null,
  created_at      timestamptz not null default now()
);

create index if not exists session_summaries_class_idx on public.session_summaries (class_id);

alter table public.session_summaries enable row level security;

-- Intent: a student can read their own session recaps.
drop policy if exists "summaries: students read their own" on public.session_summaries;
create policy "summaries: students read their own"
  on public.session_summaries for select to authenticated
  using (student_id = (select auth.uid()));

-- Intent: same instructor-ownership rule as understanding_events.
drop policy if exists "summaries: instructors read classes they own" on public.session_summaries;
create policy "summaries: instructors read classes they own"
  on public.session_summaries for select to authenticated
  using (
    exists (
      select 1
      from public.class_owners co
      where co.class_id = session_summaries.class_id
        and co.owner_user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- topic_documents — replaces the hardcoded TOPIC_DOCUMENT_IDS array that used
-- to live in app/api/topics/route.ts. One row per Tavus document; several
-- rows can share a (class_id, topic_label) — the curated seed row below plus
-- any number of student uploads that passed the relevance check
-- (app/api/knowledge/upload/route.ts). /api/topics groups by topic_label into
-- one dropdown entry per label; /api/conversation pulls every 'ready' row
-- under the picked (class_id, concept) pair to scope that call's grounding.
--
-- No update/delete policy for `authenticated` anywhere below, on purpose:
-- 'processing' -> 'ready'/'error' is written only by the
-- /api/tavus/document-status webhook, under the service-role key (same
-- shape as session_summaries above) — a student who inserted a row cannot
-- also mark it ready themselves.
-- ---------------------------------------------------------------------------
create table if not exists public.topic_documents (
  id                uuid        primary key default gen_random_uuid(),
  class_id          text        not null,
  topic_label       text        not null,

  -- Not a FK: the document lives in Tavus, not here (same reasoning as
  -- panels.conversation_id above).
  tavus_document_id text        not null unique,

  source            text        not null check (source in ('curated', 'student_upload')),
  -- null for curated rows (no uploader); required for student_upload rows,
  -- enforced by the insert policy below rather than a check constraint here.
  uploaded_by       uuid        references auth.users (id) on delete set null,

  status            text        not null default 'processing'
                       check (status in ('processing', 'ready', 'error')),
  created_at        timestamptz not null default now()
);

create index if not exists topic_documents_class_topic_idx
  on public.topic_documents (class_id, topic_label);

alter table public.topic_documents enable row level security;

-- Intent: topics are public course content, same as prefill_panels — but
-- unlike prefill_panels, /api/topics is fetched from session-start.tsx in an
-- effect that races the anonymous-sign-in effect on the same mount (no
-- ordering guaranteed between the two), so this has to work before a
-- session cookie exists too. Granted to `anon` as well as `authenticated`
-- below for that reason — none of these columns are sensitive.
drop policy if exists "topic_documents: readable when signed in" on public.topic_documents;
create policy "topic_documents: readable when signed in"
  on public.topic_documents for select to anon, authenticated
  using (true);

-- Intent: a student may only insert a row attributing the upload to
-- themselves, and only ever as 'student_upload' — 'curated' rows are seeded
-- by hand below, never through this policy.
drop policy if exists "topic_documents: students insert their own uploads" on public.topic_documents;
create policy "topic_documents: students insert their own uploads"
  on public.topic_documents for insert to authenticated
  with check (uploaded_by = (select auth.uid()) and source = 'student_upload');

-- ===========================================================================
-- service_role — discovered 2026-07-29, testing the topic_documents webhook:
-- this project never got Supabase's usual `GRANT ... TO service_role`
-- bootstrap. BYPASSRLS (which service_role has) only skips RLS *policies*;
-- it does not skip ordinary GRANT-based privilege checks, so every
-- service-role write in this app — including the already-shipped
-- /api/tavus/session-summary webhook — was failing with "permission denied"
-- before this statement existed. ALTER DEFAULT PRIVILEGES covers tables
-- created after this runs too, so future ones don't need a manual grant.
-- ===========================================================================

grant usage on schema public to service_role;
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;

-- ===========================================================================
-- Grants. RLS filters rows; grants decide whether the role may attempt the
-- statement at all. Both must line up — deleting is blocked here (no grant)
-- and above (no policy).
-- ===========================================================================

grant select, insert, update on public.panels               to authenticated;
grant select, insert         on public.understanding_events to authenticated;
grant select, insert         on public.tool_call_events     to authenticated;
grant select, insert         on public.class_owners         to authenticated;
grant select                 on public.prefill_panels       to authenticated;
grant select, insert, update on public.conversation_owners  to authenticated;
-- No insert/update grant here for `authenticated` — session_summaries is
-- written only by the service-role webhook, which gets its own blanket
-- grant above (see the service_role section).
grant select                 on public.session_summaries    to authenticated;
-- Insert only for authenticated — status transitions are the document-status
-- webhook's job, under the service-role key, same as session_summaries.
-- select also to anon: see the policy comment above (pre-sign-in race).
grant select, insert         on public.topic_documents      to authenticated;
grant select                 on public.topic_documents      to anon;

-- ===========================================================================
-- Demo seed. prefill_panels content is generated by scripts/seed-prefill.mjs,
-- not hand-pasted here — run that instead of writing INSERTs by hand.
--
-- class_owners needs no manual seed either: the "first signed-in visitor
-- claims it" policy above means visiting /class/cs101 while signed in as the
-- instructor's real account is the entire setup step.
--
-- topic_documents needs exactly one seed row: the topic that already existed
-- before this table did (formerly the sole entry in TOPIC_DOCUMENT_IDS).
-- 'ready' because it was already live and tagged on the Tavus side — this
-- insert is catching the DB record up to Tavus's existing state, not
-- creating a new document.
-- ===========================================================================

insert into public.topic_documents (class_id, topic_label, tavus_document_id, source, status)
values ('cs101', 'Recursion', 'dc-9cf86e66ffaf', 'curated', 'ready')
on conflict (tavus_document_id) do nothing;

-- ===========================================================================
-- Storage — the `knowledge-uploads` bucket (created by scripts/setup-storage.mjs,
-- which handles the bucket itself; storage.objects RLS is plain Postgres RLS,
-- same as every other table above, so it belongs here rather than split into
-- a second SQL source).
--
-- Public select so Tavus's servers can fetch document_url themselves,
-- asynchronously, during the 5-10 minute processing window — see
-- app/api/knowledge/upload/route.ts. Insert restricted to signed-in users;
-- no update/delete policy, so an uploaded object is immutable once written.
-- ===========================================================================

drop policy if exists "knowledge-uploads: authenticated users upload" on storage.objects;
create policy "knowledge-uploads: authenticated users upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'knowledge-uploads');

drop policy if exists "knowledge-uploads: public read" on storage.objects;
create policy "knowledge-uploads: public read"
  on storage.objects for select to public
  using (bucket_id = 'knowledge-uploads');
