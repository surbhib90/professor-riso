"use client";

/**
 * The worktable: one Tavus call, one scratch sheet, one zine sheet.
 *
 * The client is the state authority (ARCHITECTURE D1). It rehydrates panels
 * before joining, whitelists inbound events, answers tool calls, and owns the
 * wrap-up clock because `max_call_duration` gives the agent no warning.
 *
 * Call lifecycle: DailyIframe.createCallObject() produces a DailyCall that is
 * lifted into React state so <DailyProvider callObject={call}> can share it
 * with @daily-co/daily-react hooks used by MagicCanvas and HairCheck.
 * The call object itself is still created and joined the same way as before —
 * DailyProvider just registers it in context so the SDK's hooks can find it.
 */

import { useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  DailyCall,
  DailyEventObjectAppMessage,
  DailyEventObjectTrack,
} from "@daily-co/daily-js";
import { DailyProvider } from "@daily-co/daily-react";
import {
  submitBlockMessage,
  submitNotes,
  injectWrapUp,
  type MessageSender,
} from "@/lib/bridge";
import { createAppMessageHandler, type HandlerDeps } from "@/lib/app-message-handler";
import { summarizeNotesPane, type SceneElement } from "@/lib/excalidraw-summarize";
import type { Panel, SessionContext } from "@/lib/types";
import {
  createZineStore,
  emptyZineState,
  nextUnfinishedPanel,
  panelSlots,
} from "@/lib/zine";
import {
  endConversation,
  fetchSessionPanels,
  forgetConversation,
  readResumableConversation,
  rememberConversation,
  resolveStudentId,
  savePanel,
  saveCheck,
  startConversation,
  uploadKnowledgeFile,
} from "./data-adapter";
import ScratchPane from "./ScratchPane";
import UploadPane from "./UploadPane";
import ZinePane from "./ZinePane";
import CanvasQuestionCard from "./CanvasQuestionCard";
import { MagicCanvas, type CanvasRenderRegistry } from "@/app/components/cvi/components/magic-canvas";
import { useSendAppMessage } from "@/app/components/cvi/hooks/cvi-events-hooks";

// Hoisted: MagicCanvas is wrapped in React.memo, but a new object literal here
// on every render (defeating that memo) would make it fully re-execute —
// including its tool-call subscription and layout math — on every tick of the
// wrap-up clock below, whether or not a canvas card is even showing.
const CANVAS_RENDER_COMPONENTS: CanvasRenderRegistry = {
  "canvas.question@v1": CanvasQuestionCard,
};

/** Matches the conversation's `max_call_duration` (D10). */
const MAX_CALL_SECONDS = 900;
const WRAP_UP_AT_SECONDS = MAX_CALL_SECONDS - 120;
/** A missed stopped_speaking must not lock the submit button for the session. */
const SPEAKING_WATCHDOG_MS = 25_000;
const IN_FLIGHT_TIMEOUT_MS = 15_000;

type Status = "loading" | "connecting" | "live" | "ended" | "error";

const STATUS_COPY: Record<Status, string> = {
  loading: "Loading your sheet",
  connecting: "Connecting",
  live: "Live",
  ended: "Session ended",
  error: "Not connected",
};

function clock(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function fileSlug(concept: string): string {
  const slug = concept.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug || "zine";
}

/**
 * Outer shell: owns the DailyCall instance in state so DailyProvider can
 * receive it as a prop. The call is null until the boot effect creates it —
 * DailyProvider accepts null and initialises with no call, which is correct
 * for the loading/connecting states.
 */
export default function ConversationSurface() {
  const [callObject, setCallObject] = useState<DailyCall | null>(null);

  return (
    <DailyProvider callObject={callObject}>
      <ConversationInner setCallObject={setCallObject} />
    </DailyProvider>
  );
}

/**
 * Inner component: has access to all @daily-co/daily-react hooks because it
 * renders inside DailyProvider. The call object is created here and hoisted
 * up to the shell via setCallObject so DailyProvider stays in sync.
 */
function ConversationInner({
  setCallObject,
}: {
  setCallObject: (call: DailyCall | null) => void;
}) {
  // /session hands over the class, the concept and the difficulty. The call
  // itself is opened here, so a refresh lands on a page that can rejoin.
  const params = useSearchParams();
  const classId = params.get("classId") ?? "";
  const concept = params.get("concept") ?? "";
  const difficulty = Number(params.get("difficulty") ?? "") || 0;

  const store = useMemo(() => createZineStore(), []);
  const state = useSyncExternalStore(
    store.subscribe,
    store.getState,
    () => emptyZineState,
  );

  // Missing search params are knowable at render, so this is derived rather
  // than pushed into state from an effect. Setting state synchronously inside
  // an effect costs an extra render pass and trips react-hooks/set-state-in-effect.
  const missingParams = !classId || !concept;

  const [status, setStatus] = useState<Status>("loading");
  const [errorText, setErrorText] = useState("");
  const effectiveStatus: Status = missingParams ? "error" : status;
  const effectiveErrorText = missingParams
    ? "This page is missing its class and concept. Start a new session to pick them."
    : errorText;
  const [conversationId, setConversationId] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [inFlight, setInFlight] = useState(false);
  const [notice, setNotice] = useState<string | null>(
    "Write or sketch your understanding, then send it.",
  );
  const [elapsed, setElapsed] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [slidePlayable, setSlidePlayable] = useState(false);

  const callRef = useRef<DailyCall | null>(null);
  const ctxRef = useRef<SessionContext | null>(null);
  const joinedAtRef = useRef<number | null>(null);
  /** Conversation-creation time, matching Tavus's max_call_duration clock — set
   *  once at boot (fresh start or resume) and never re-stamped on rejoin. */
  const startedAtRef = useRef<number | null>(null);
  const wrapUpSentRef = useRef(false);
  const bootedRef = useRef(false);
  const speakingTimerRef = useRef<number | undefined>(undefined);
  const inFlightTimerRef = useRef<number | undefined>(undefined);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const slideVideoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  /** Conversation ids already released. Ending twice is harmless at the route,
   *  but several exit paths can fire in the same instant (left-meeting, then
   *  unmount, then pagehide) and one DELETE per exit is enough. */
  const releasedRef = useRef<Set<string>>(new Set());
  /** True between `pagehide` and a possible `pageshow` restore. Lets the unmount
   *  cleanup tell "React tore this component down" from "the document is going
   *  away", which are not the same decision. */
  const unloadingRef = useRef(false);

  // panelSlots allocates a fresh array every call — memoized on `state` so a
  // render triggered by something unrelated (the once-a-second wrap-up clock
  // tick, in particular) doesn't hand ZinePane a new array reference and
  // defeat its memo for no reason.
  const panels = useMemo(() => panelSlots(state), [state]);
  const nextPanel = useMemo(() => nextUnfinishedPanel(state), [state]);

  // useSendAppMessage from @tavus/cvi-ui — uses DailyProvider's shared call
  // context. Adapts to MessageSender so lib/bridge.ts stays untouched.
  const rawSendAppMessage = useSendAppMessage();
  const senderRef = useRef<MessageSender>({
    sendAppMessage: (data) =>
      rawSendAppMessage(data as Parameters<typeof rawSendAppMessage>[0]),
  });
  // Keep the adapter's reference stable but always call the latest hook value.
  useEffect(() => {
    senderRef.current = {
      sendAppMessage: (data) =>
        rawSendAppMessage(data as Parameters<typeof rawSendAppMessage>[0]),
    };
  }, [rawSendAppMessage]);

  // --- inbound events ------------------------------------------------------

  const handlerDeps = useMemo<HandlerDeps>(() => {
    const markSpeaking = (isSpeaking: boolean) => {
      setSpeaking(isSpeaking);
      window.clearTimeout(speakingTimerRef.current);
      if (isSpeaking) {
        // The professor taking the floor means our last submit landed.
        setInFlight(false);
        speakingTimerRef.current = window.setTimeout(
          () => setSpeaking(false),
          SPEAKING_WATCHDOG_MS,
        );
      }
    };

    return {
      // Read through the ref: the conversation is created during boot, after
      // this object is built.
      get conversationId(): string {
        return ctxRef.current?.conversationId ?? "";
      },
      get sender(): MessageSender | null {
        return senderRef.current;
      },
      applyPanel: (panel: Panel) => {
        store.dispatch({ type: "panel", panel });
      },
      applyCheck: (check) => {
        store.dispatch({ type: "check", check });
        // A check can also land *after* its panel — a re-assessment restamps a
        // row that is already written — so the stored row has to be refreshed
        // too, not just the one written by persistPanel below.
        if (!ctxRef.current) return;
        const restamped = store.getState().panels[check.panelNumber];
        if (restamped) savePanel(ctxRef.current, restamped);
      },
      persistPanel: (panel) => {
        if (!ctxRef.current) return;
        // The reducer owns mastery, so the panel handed to us still reads
        // "none"; the stamp only exists in state, after applyPanel merged the
        // understanding check. Persisting the argument would write "none" every
        // time, and since hydrate replays panel rows, every stamp would
        // disappear on refresh and never reach the shelf. Read the stamped row
        // back out instead — the handler always applies before it persists,
        // which tests/session-seam.test.ts pins.
        const stamped = store.getState().panels[panel.panelNumber] ?? panel;
        savePanel(ctxRef.current, stamped);
      },
      persistCheck: (check) => {
        if (ctxRef.current) saveCheck(ctxRef.current, check);
      },
      nextUnfinishedPanel: () => nextUnfinishedPanel(store.getState()),
      setProfessorSpeaking: markSpeaking,
    };
  }, [store]);

  // --- boot: rehydrate, then join -----------------------------------------

  useEffect(() => {
    if (bootedRef.current) return;
    // The error surface for this case is derived at render; boot simply refuses
    // to run without the params it needs.
    if (missingParams) return;
    bootedRef.current = true;

    let cancelled = false;
    const onAppMessage = createAppMessageHandler(handlerDeps);

    const attachTrack = (event: DailyEventObjectTrack) => {
      if (!event.participant || event.participant.local) return;
      const stream = new MediaStream([event.track]);
      if (event.track.kind === "video" && videoRef.current) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play().catch(() => undefined);
      }
      if (event.track.kind === "audio" && audioRef.current) {
        audioRef.current.srcObject = stream;
        void audioRef.current.play().catch(() => undefined);
      }
      // Presentation skill: PAL's screen-share track carries slide content.
      // object-contain (not object-cover) prevents cropping — per Tavus docs.
      if (event.track.kind === "screenVideo" && slideVideoRef.current) {
        slideVideoRef.current.srcObject = stream;
        void slideVideoRef.current.play().catch(() => undefined);
        setSlidePlayable(true);
      }
    };

    void (async () => {
      const studentId = await resolveStudentId();
      if (cancelled) return;

      const resumed = readResumableConversation(classId, concept, difficulty);
      let panels: Panel[];
      let conversation;

      if (resumed) {
        // Rehydrate BEFORE joining: Daily does not replay app-messages, so a
        // mid-session refresh would otherwise blank a sheet the student earned.
        // No prefill fallback needed here (D19): whatever prefill panels exist
        // for this conversation were already written by the PAL's own tool
        // calls, so an empty result just means generation had not landed yet
        // when the refresh happened — the PAL is still mid-generation and will
        // pick up where the objectives graph left off.
        conversation = resumed;
        startedAtRef.current = resumed.startedAt;
        panels = await fetchSessionPanels(conversation.conversationId);
      } else {
        // D19: the PAL generates the prefilled panels itself, live, as the
        // first thing it does — there is nothing for the client to precompute
        // or write before starting the call. The sheet starts empty and fills
        // in through the same tool-call path as every other panel.
        panels = [];
        const createdAt = Date.now();
        conversation = await startConversation({ classId, studentId, concept, difficulty });
        rememberConversation(classId, concept, difficulty, conversation, createdAt);
        startedAtRef.current = createdAt;
      }
      if (cancelled) return;

      store.dispatch({ type: "hydrate", panels });
      ctxRef.current = {
        conversationId: conversation.conversationId,
        studentId,
        classId,
        concept,
        prefilledPanels: panels
          .filter((panel) => panel.source === "prefill")
          .map((panel) => panel.panelNumber),
      };
      setConversationId(conversation.conversationId);
      setStatus("connecting");

      const DailyIframe = (await import("@daily-co/daily-js")).default;
      if (cancelled) return;

      const call = DailyIframe.getCallInstance() ?? DailyIframe.createCallObject();
      callRef.current = call;
      // Hoist into DailyProvider so @daily-co/daily-react hooks (MagicCanvas,
      // HairCheck) can find it via useDaily().
      setCallObject(call);

      call.on("app-message", (event?: DailyEventObjectAppMessage) => {
        onAppMessage({ data: event?.data });
      });
      call.on("track-started", (event?: DailyEventObjectTrack) => {
        if (event) attachTrack(event);
      });
      call.on("track-stopped", (event?: DailyEventObjectTrack) => {
        if (event?.track.kind === "screenVideo") setSlidePlayable(false);
      });
      call.on("joined-meeting", () => {
        // Sourced from startedAtRef (conversation-creation time), not re-stamped
        // here — a rejoin after a refresh must not reset the wrap-up clock.
        joinedAtRef.current = startedAtRef.current ?? Date.now();
        setStatus("live");
      });
      call.on("left-meeting", () => setStatus("ended"));
      call.on("error", (event?: { errorMsg?: string }) => {
        setStatus("error");
        setErrorText(
          event?.errorMsg ??
          "The call dropped. Reload the page to rejoin — your saved panels come back with you.",
        );
      });

      // Guard against re-joining an already-connecting/connected call — NOT a
      // narrower "new"/"left-meeting" allowlist. The call object reaching here
      // is often the hair-check page's, reused via DailyIframe.getCallInstance()
      // (that page's DailyProvider never destroys it on the Join path, only on
      // Cancel), and its startCamera() preview already moved meetingState from
      // "new" to "loaded". An allowlist of "new"/"left-meeting" silently skips
      // join() for that (very common) case — no error, no event, permanently
      // stuck on "connecting". daily-js's own join() only refuses when already
      // "joining-meeting"/"joined-meeting", so match that instead.
      if (call.meetingState() !== "joining-meeting" && call.meetingState() !== "joined-meeting") {
        await call.join({ url: conversation.conversationUrl, startVideoOff: true });
      }
    })().catch((err: unknown) => {
      console.error("[conversation] boot failed", err);
      if (cancelled) return;
      setStatus("error");
      setErrorText(
        err instanceof Error
          ? err.message
          : "Could not start the call. Reload the page to try again.",
      );
    });

    return () => {
      cancelled = true;
      bootedRef.current = false;
      window.clearTimeout(speakingTimerRef.current);
      window.clearTimeout(inFlightTimerRef.current);
      const call = callRef.current;
      callRef.current = null;
      setCallObject(null);
      if (call) {
        void call.leave().catch(() => undefined);
        void call.destroy().catch(() => undefined);
      }
    };
    // missingParams is derived from classId and concept, both already listed.
    // setCallObject is stable (useState setter) — omitting it is safe.
  }, [classId, concept, difficulty, handlerDeps, missingParams, store, setCallObject]);

  // --- releasing the conversation slot -------------------------------------

  /**
   * Hand the Tavus slot back. Idempotent per conversation id.
   *
   * The account caps concurrent conversations at ~2 and a held slot does not
   * present as a quota error — the next conversation is created and then dies
   * with a generic startup exception that reads like a network fault (T1
   * finding 3). Nothing called DELETE before this, so every abandoned session
   * squatted a slot until a timeout expired.
   */
  const releaseConversation = useCallback(
    (id: string, options: { keepalive?: boolean } = {}) => {
      if (!id || releasedRef.current.has(id)) return;
      releasedRef.current.add(id);
      // Clear the resume record first: if the DELETE is in flight when the tab
      // dies, we still must not leave a pointer to a room we asked Tavus to end.
      forgetConversation();
      void endConversation(id, { keepalive: options.keepalive === true });
    },
    [],
  );

  /**
   * Normal completion. `left-meeting` fires both when the student's call ends
   * and when Tavus hits `max_call_duration`; either way the session is over and
   * there is nothing left to rejoin, so this is the one unambiguous exit.
   *
   * Deliberately NOT hooked to `status === "error"`: the error copy tells the
   * student to reload and rejoin, and ending here would make that a lie.
   */
  useEffect(() => {
    if (status !== "ended") return;
    releaseConversation(ctxRef.current?.conversationId ?? conversationId);
  }, [status, conversationId, releaseConversation]);

  /**
   * Unmount. A full page reload tears the document down without running React
   * cleanups, so reaching here almost always means an in-app navigation away —
   * a deliberate leave. `unloadingRef` covers the browsers that do run cleanup
   * during unload, where "leaving" might really be a refresh.
   *
   * Empty deps on purpose: this must fire on true unmount only, not whenever a
   * callback identity changes.
   */
  useEffect(() => {
    return () => {
      if (unloadingRef.current) return;
      const id = ctxRef.current?.conversationId;
      // keepalive because an in-app navigation can be followed immediately by a
      // full-document one, and a cancelled DELETE releases nothing.
      if (id) releaseConversation(id, { keepalive: true });
    };
  }, [releaseConversation]);

  /**
   * Tab close / refresh. `pagehide` is the only unload signal that fires
   * reliably on mobile Safari and with bfcache; `beforeunload` does not.
   *
   * The refresh-versus-leave ambiguity: pagehide cannot distinguish a reload
   * from a close, and neither can anything else the page can observe — the
   * signal that would separate them only exists after the document is gone.
   * So this deliberately does NOT end a live call. `participant_left_timeout`
   * is 60s precisely so a reload can rejoin the same conversation (Seam 5
   * rehydrates panels keyed on the conversation id, so a new conversation is a
   * blank zine, not a recovered one). Ending eagerly here would buy back a slot
   * 60s sooner and break every refresh to do it. The 60s timeout is the
   * backstop for the close case; correctness of the session wins.
   *
   * What is left is the case where the session is already over: nothing to
   * rejoin, so release immediately rather than waiting out the timeout.
   */
  useEffect(() => {
    const onPageHide = (event: PageTransitionEvent) => {
      unloadingRef.current = true;
      // persisted means frozen into bfcache, not destroyed — the page can come
      // back and rejoin, so this is never a leave.
      if (event.persisted) return;
      if (status !== "ended") return;
      const id = ctxRef.current?.conversationId ?? conversationId;
      if (id) releaseConversation(id, { keepalive: true });
    };
    // A bfcache restore means we never actually left; unmount is meaningful again.
    const onPageShow = () => {
      unloadingRef.current = false;
    };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [status, conversationId, releaseConversation]);

  /**
   * The one explicit "I am leaving" the UI offers: the error screen's link back
   * to /session. That is a plain anchor, so a full document load follows and
   * only a keepalive request survives it. Unlike a mid-call error, this is the
   * student choosing to start over — no rejoin is coming.
   */
  const handleLeave = useCallback(() => {
    releaseConversation(ctxRef.current?.conversationId ?? conversationId, {
      keepalive: true,
    });
  }, [conversationId, releaseConversation]);

  // --- wrap-up clock -------------------------------------------------------

  useEffect(() => {
    if (status !== "live") return;
    const tick = window.setInterval(() => {
      const startedAt = joinedAtRef.current;
      if (startedAt === null) return;
      const seconds = (Date.now() - startedAt) / 1000;
      setElapsed(seconds);

      if (seconds >= WRAP_UP_AT_SECONDS && !wrapUpSentRef.current) {
        wrapUpSentRef.current = true;
        injectWrapUp(senderRef.current, conversationId);
        setNotice("Two minutes left. Professor Riso is wrapping up the sheet.");
      }
    }, 1000);
    return () => window.clearInterval(tick);
  }, [status, conversationId]);

  // --- submit --------------------------------------------------------------

  const handleSubmit = useCallback(
    (elements: readonly SceneElement[]) => {
      const summary = summarizeNotesPane(elements);
      const result = submitNotes(senderRef.current, conversationId, summary, {
        connected: status === "live",
        professorSpeaking: speaking,
        inFlight,
      });

      if (!result.ok) {
        setNotice(submitBlockMessage(result.block));
        return;
      }

      setInFlight(true);
      setNotice("Notes sent. Professor Riso is reading them.");
      window.clearTimeout(inFlightTimerRef.current);
      inFlightTimerRef.current = window.setTimeout(
        () => setInFlight(false),
        IN_FLIGHT_TIMEOUT_MS,
      );
    },
    [conversationId, status, speaking, inFlight],
  );

  // --- magic canvas ---------------------------------------------------------

  const handleCanvasInteraction = useCallback(
    (event: { component: string; type: string }) => {
      // Client-side only — no server-side persistence for canvas interactions
      // in this version (no dedicated route for canvas.interaction events yet).
      console.log("[magic-canvas]", event.component, event.type);
    },
    [],
  );

  // --- export --------------------------------------------------------------

  const handleExport = useCallback(async () => {
    const node = sheetRef.current;
    if (!node) return;
    setExporting(true);
    try {
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(node, {
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor: "#f2f1ec",
      });
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `professor-riso-${fileSlug(concept)}.png`;
      link.click();
      setNotice("Sheet saved as a PNG. Print it, fold it, cut the centre line.");
    } catch (err) {
      console.error("[conversation] export failed", err);
      setNotice("The export did not render. Try again once the sheet finishes drawing.");
    } finally {
      setExporting(false);
    }
  }, [concept]);

  // --- render --------------------------------------------------------------

  const remaining = clock(MAX_CALL_SECONDS - elapsed);

  if (effectiveStatus === "error") {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="font-display text-marquee">Not connected</h1>
        <p className="max-w-md text-paper/80">{effectiveErrorText}</p>
        <a
          href="/session"
          onClick={handleLeave}
          className="bg-yellow px-4 py-2 font-mono text-stamp uppercase text-ink-deep"
        >
          Start a session
        </a>
      </main>
    );
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-ink-edge px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <h1 className="misreg inline-block font-display text-3xl leading-none tracking-tight sm:text-marquee">
            Professor Riso
          </h1>
          {/* Not aria-live: "speaking" flips on every turn and would make a
              screen reader talk over the professor. The scratch pane's notice
              is the announced surface. */}
          <p className="font-mono text-stamp uppercase text-paper/70">
            {concept ? `${concept} · ` : ""}
            {STATUS_COPY[status]}
            {speaking ? " · speaking" : ""}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="font-mono text-stamp uppercase text-paper/70">
            {remaining} left
          </span>
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={exporting}
            className="border-2 border-paper/60 px-3 py-2 font-mono text-stamp uppercase text-paper transition-colors hover:border-yellow hover:text-yellow disabled:opacity-50"
          >
            {exporting ? "Exporting" : "Export the sheet"}
          </button>
          {/* Explicit mid-call exit. Reuses the same releaseConversation the
              error screen's equivalent link already uses — a plain anchor,
              not a Link, so the keepalive DELETE survives the ensuing full
              document unload the same way it does there. */}
          <a
            href="/session"
            onClick={handleLeave}
            className="border-2 border-paper/60 px-3 py-2 font-mono text-stamp uppercase text-paper transition-colors hover:border-pink hover:text-pink"
          >
            End session
          </a>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-6 p-4 sm:p-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="flex h-full min-h-[280px] flex-col">
            <div className="relative flex min-h-0 flex-1 flex-col rotate-[-0.75deg] bg-paper p-3 shadow-[4px_4px_0_var(--color-ink-deep)] sm:p-4">
              {/* Two tape corners instead of the thumbnail's single top-center
                  strip — reads as a large photo actually taped up, not a
                  stretched sticker. Rotation is reduced from the thumbnail's
                  -2deg to -0.75deg: the same angular value that reads as a
                  charming tilt at thumbnail size reads as broken at full
                  column height. */}
              <span
                aria-hidden="true"
                className="absolute -top-3 left-6 h-4 w-16 -rotate-[4deg] bg-yellow/45"
              />
              <span
                aria-hidden="true"
                className="absolute -top-3 right-6 h-4 w-16 rotate-[6deg] bg-yellow/45"
              />
              {/* Slide video: shown when the PAL's presentation skill is active.
                  object-contain prevents cropping (per Tavus docs for screenVideo).
                  Swaps with the face video — only one is visible at a time. */}
              <video
                ref={slideVideoRef}
                autoPlay
                playsInline
                muted
                aria-label="Course slide"
                className={`min-h-0 flex-1 bg-ink-deep object-contain ${slidePlayable ? "" : "hidden"}`}
              />
              {/* Face video: hidden when a slide is playing. */}
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                aria-label="Professor Riso"
                className={`min-h-0 flex-1 bg-ink-deep object-cover ${slidePlayable ? "hidden" : ""}`}
              />
              {/* Baked-in caption, like an instant photo's handwritten strip.
                  Tracks the same STATUS_COPY the header uses so the two
                  never disagree about whether the call is actually live. */}
              <p className="mt-2 shrink-0 text-center font-mono text-stamp uppercase text-graphite-soft">
                {concept ? `${concept} · ` : ""}
                {STATUS_COPY[status]}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <ScratchPane
              onSubmit={handleSubmit}
              busy={inFlight}
              notice={notice}
              panelHint={nextPanel}
            >
              <UploadPane
                concept={concept}
                onUpload={(file) => uploadKnowledgeFile(file, classId, concept)}
              />
            </ScratchPane>
          </div>
        </div>

        <ZinePane
          panels={panels}
          nextPanel={nextPanel}
          concept={concept}
          sheetRef={sheetRef}
        />
      </main>

      {/* Magic Canvas: only mount once the call is live — no Daily call context
          exists before that point, so the canvas observable hooks would be inert.
          canvas.question@v1 renders as CanvasQuestionCard (native renderer);
          all other component types fall back to the iframe sandbox path. */}
      {status === "live" && (
        <MagicCanvas onInteraction={handleCanvasInteraction} renderComponent={CANVAS_RENDER_COMPONENTS} />
      )}

      {/* Video is muted so it can autoplay; the professor's voice lives here. */}
      <audio ref={audioRef} autoPlay className="sr-only" />
    </div>
  );
}
