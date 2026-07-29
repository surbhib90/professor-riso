"use client";

/**
 * Pre-call device check screen (Task 8 — hair-check).
 *
 * Per the Tavus latency-optimization guide, letting the student configure
 * camera and mic here — before the PAL call is created — means the 10-minute
 * clock doesn't start ticking during an awkward "connecting..." wait.
 *
 * HairCheck uses useDaily() internally, so it must be wrapped in DailyProvider.
 * This screen has no existing call object: DailyProvider without a callObject
 * prop creates its own internal instance for the device preview only. That
 * instance is discarded when the student clicks Join; ConversationSurface
 * creates the real call object once it mounts.
 */

import { Suspense, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DailyProvider } from "@daily-co/daily-react";
import { HairCheck } from "@/app/components/cvi/components/hair-check";

function HairCheckScreen() {
    const router = useRouter();
    const params = useSearchParams();

    const proceed = useCallback(() => {
        router.push(`/conversation?${params.toString()}`);
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
                    Make sure your devices are ready before the session starts. The ten-minute
                    clock only begins once you join.
                </p>
                <HairCheck onJoin={proceed} />
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
