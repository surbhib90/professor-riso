"use client";

/**
 * Pre-call device check screen (Task 8 — hair-check).
 *
 * Per the Tavus latency-optimization guide, letting the student configure
 * camera and mic here — before the PAL call is created — means the 15-minute
 * clock doesn't start ticking during an awkward "connecting..." wait (the
 * clock starts at Daily join, not at Tavus conversation creation).
 *
 * This screen also now creates the Tavus conversation itself and, when the
 * difficulty pick calls for it, generates and writes the prefilled worked-
 * example panels — both server-side, during this same dead time. That used
 * to happen on /conversation's mount, with the PAL generating prefill panels
 * itself live via a chain of silent tool calls; observed unreliable (0-4 of
 * the requested panels actually landing, the rest either never attempted or
 * hallucinated as fake JSON text). Doing it here, before Join, removes the
 * live model's tool-calling reliability from the critical path entirely —
 * see lib/anthropic/prefill.ts.
 *
 * HairCheck uses useDaily() internally, so it must be wrapped in DailyProvider.
 * This screen has no existing call object: DailyProvider without a callObject
 * prop creates its own internal instance for the device preview only. That
 * instance is discarded when the student clicks Join; ConversationSurface
 * creates the real call object once it mounts.
 */

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DailyProvider } from "@daily-co/daily-react";
import { HairCheck } from "@/app/components/cvi/components/hair-check";
import {
    rememberConversation,
    resolveStudentId,
    startConversation,
    type StartedConversation,
} from "@/app/conversation/data-adapter";

function HairCheckScreen() {
    const router = useRouter();
    const params = useSearchParams();
    const classId = params.get("classId") ?? "";
    const concept = params.get("concept") ?? "";
    const difficulty = Number(params.get("difficulty") ?? "") || 0;

    // Fired once on mount, in parallel with the student setting up their
    // camera/mic — that setup time is what hides this request's latency.
    // A ref (not state) because nothing here needs to re-render while it's
    // in flight; `proceed` just awaits it when Join is actually clicked.
    const conversationRef = useRef<Promise<StartedConversation> | null>(null);
    const [waiting, setWaiting] = useState(false);

    useEffect(() => {
        if (!classId || !concept) return;
        if (conversationRef.current) return;
        const createdAt = Date.now();
        conversationRef.current = (async () => {
            const studentId = await resolveStudentId();
            const conversation = await startConversation({ classId, studentId, concept, difficulty });
            rememberConversation(classId, concept, difficulty, conversation, createdAt);
            return conversation;
        })();
    }, [classId, concept, difficulty]);

    const proceed = useCallback(() => {
        void (async () => {
            if (conversationRef.current) {
                setWaiting(true);
                try {
                    await conversationRef.current;
                } catch {
                    // startConversation already logs; /conversation's own boot
                    // falls back to creating a fresh conversation if resuming
                    // finds nothing usable, so a failed pre-create here is not
                    // fatal — it just loses the head start.
                } finally {
                    setWaiting(false);
                }
            }
            router.push(`/conversation?${params.toString()}`);
        })();
    }, [router, params]);

    return (
        <DailyProvider>
            <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-5 py-10 sm:px-8 sm:py-14">
                <header className="border-b-2 border-ink-edge pb-4">
                    <p className="font-mono text-stamp uppercase text-paper/70">
                        Professor Riso — device check
                    </p>
                </header>
                <h1 className="font-display text-marquee text-balance">
                    Check your camera and mic
                </h1>
                <p className="text-paper/80">
                    Make sure your devices are ready before the session starts. The fifteen-minute
                    clock only begins once you join.
                </p>
                <HairCheck onJoin={proceed} />
                {waiting ? (
                    <p aria-live="polite" className="font-mono text-stamp uppercase text-paper/60">
                        {difficulty > 0 ? "Setting up your worked examples…" : "One moment…"}
                    </p>
                ) : null}
            </main>
        </DailyProvider>
    );
}

export default function HairCheckPage() {
    return (
        <Suspense fallback={null}>
            <HairCheckScreen />
        </Suspense>
    );
}
