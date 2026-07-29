# Professor Riso

*A teach → probe → artifact tutor, built on Tavus CVI.*

*Trivia: "Riso" nods to Risograph, the print duplicator behind zines' bold, flat-color look.*

## What it is

Professor Riso teaches one concept — recursion, for an intro CS class — over a live Tavus video conversation. The student writes or sketches their own understanding on a shared canvas first; the tutor then tests it with a new, small problem, never "explain it back." Across one 10-minute session, an 8-panel zine assembles live, panel by panel, each one stamped solid, solid after one retry, or corrected by the tutor. The retry is capped structurally — one re-explanation, then resolution — so every session finishes with a complete sheet.

CS101/recursion is the demo instance, not the product's identity. Nothing in the conversation graph, the tool schema, or the artifact-rendering pipeline assumes CS: swap the system prompt, the panel schema, and the attached Knowledge Base documents, and the same teach → probe → artifact loop applies to a different concept, a different subject, or a non-education flow like onboarding or compliance training.

## Why I built this

I chose this project because it highlights what Tavus does especially well: high-trust, face-to-face interactions where real understanding is revealed through conversation, not typed responses. A video tutor can adapt explanations in real time and probe deeper when an answer is shallow — something a static lesson or a text chatbot can't do. Just as important, I wanted to demonstrate a reusable customer pattern rather than a one-off demo: teach → probe → evaluate understanding → generate a structured artifact, with CS/recursion as one instantiation of it, not a special case baked into the architecture.

## Personas

**Student** — joins with zero setup (anonymous sign-in, no account to create). Picks a topic and a difficulty, talks to the tutor, writes on the canvas before being tested, and leaves with a finished zine saved to a personal shelf, grouped by topic.

**Instructor** — signs in once via magic link, claims a class, and curates which topics and course documents students can draw on. Gets a per-panel ledger across their class: how many students reached each panel, how many needed the retry, and the average number of attempts — a quick read on which part of the material is actually landing.

## Customers & market

The primary customers are large ed-tech platforms that already have the ecosystem this needs — content, students, and teachers in place, and the business scale to make an integration worthwhile — namely **Instructure** (Canvas) and **Pearson**. One integration into infrastructure they already own reaches their entire installed base, rather than requiring this to be sold institution by institution. Secondary market: CS bootcamps and university departments directly, adopted as design partners.

Competitively, the whitespace is real: today's AI tutoring products (Khanmigo, Codecademy AI, Replit AI, CodeHS) are all text-chat or in-editor. None use a real-time talking video persona. A patient, testing, adaptive tutor that's an actual video conversation is a genuinely open position. The more defensible pitch isn't "a CS tutor," though — it's the reusable pattern underneath it: an Objectives-enforced teach/probe/retry-cap state machine, tool-call-to-live-artifact routing, and a "read what the student actually wrote before testing them on it" bridge. None of that is CS-specific by construction.

## High-level architecture

1. **Conversation orchestration** — Tavus Objectives encode the teach → probe → retry-once → confirm loop as an actual branching state machine; there is no edge back to the retry step, so a panel cannot loop forever.
2. **The notes-first bridge** — reads the student's real canvas element data (not a screenshot) and injects it into the live conversation as if spoken, so the tutor reacts to what the student actually wrote. This is also the anti-cheat mechanism: pasted text can sit on the canvas, but it can't survive the transfer question that follows.
3. **Tavus integration** — tool calls render each zine panel and its mastery stamp on the client the instant it's confirmed; Knowledge Base (RAG) grounds explanations in the real course material.
4. **Auth & data** — Supabase anonymous sign-in for students and magic-link for instructors, with row-level security scoping who can read or write what, per class.
5. **Artifact generation** — the zine pane renders the same fold-sheet live during the session and again, read-only, on the student's shelf afterward; export turns it into an image.

## Future directions

Not built — noting where the pattern naturally extends:

- **Gamification** — edutech's clearest hits (Kahoot, Duolingo) are game-shaped. A zine-puzzle mode or multiplayer practice round would apply the same teach/probe loop competitively, not just 1:1.
- **Sell instructors out of writing quizzes** — the live session is the proof of learning. An instructor stops authoring assessment questions because the transfer-question conversation already did that job, verified in real time.
- **Adaptive zines via memory** — a returning student's history informs pacing, so material adjusts to what they've already shown they know rather than running a fixed script every session.
- **Difficulty scaling by student level** — stronger students get harder transfer problems automatically, staying challenged instead of bored. Because every student's problem is personalized, there's no shared answer key to copy — less incentive to cheat as a side effect of personalization, not a bolted-on anti-cheat feature.
- **Student incentives** — top zines get shared, earning the student points or rewards to spend on the platform, turning the shelf into something worth competing over, not just an archive.

*Stack: Next.js + TypeScript, deployed on Vercel. Tavus CVI (Objectives, tool calls, Knowledge Base), Excalidraw canvas, Supabase (Auth, Postgres, Realtime).*
