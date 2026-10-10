"use client";

import { Avatar, Button } from "./ui";

/** Seconds → "m:ss". */
export function mmss(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The app's logo — two rings slowly orbiting a spark. Used as the live status
 * mark while an AI Horde job waits in the community queue.
 */
export function StudioLogo({ size = 52 }: { size?: number }) {
  return (
    <div
      className="relative grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <span className="absolute inset-0 animate-horde-orbit rounded-full border-2 border-violet-500/20 border-t-violet-300 border-r-indigo-400" />
      <span
        className="absolute animate-horde-orbit-reverse rounded-full border-2 border-indigo-500/15 border-b-violet-300 border-l-indigo-300"
        style={{ inset: size * 0.18 }}
      />
      <span
        className="animate-horde-spark leading-none text-violet-200"
        style={{ fontSize: size * 0.32, filter: "drop-shadow(0 0 6px rgba(167,139,250,0.85))" }}
      >
        ✦
      </span>
    </div>
  );
}

/**
 * Replaces the normal streaming bubble for AI Horde connections: the queue card
 * shows a counting-down queue position, the stage and an elapsed timer. No
 * progress bar — only the orbit logo, the number and a Stop button.
 */
export function HordeQueueCard({
  queue,
  waitTime,
  elapsed,
  stage,
  avatar,
  name,
  onStop,
}: {
  queue: number;
  waitTime: number;
  elapsed: number;
  stage: string;
  avatar?: string;
  name: string;
  onStop: () => void;
}) {
  return (
    <div className="flex animate-fade-in gap-2.5">
      <Avatar src={avatar} name={name} size={32} />
      <div className="w-full max-w-[88%] rounded-2xl border border-violet-500/25 bg-gradient-to-br from-[#171b33] to-[#101430] px-4 py-3.5 shadow-lg shadow-indigo-950/30 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <StudioLogo size={54} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black leading-none tabular-nums text-violet-200">
                {queue}
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-violet-400/80">
                in queue
              </span>
            </div>
            <p className="mt-1 text-xs font-medium text-indigo-200/90">{stage}</p>
            <p className="mt-0.5 text-[11px] tabular-nums text-slate-400">
              ~{Math.max(0, Math.round(waitTime))}s est. · {mmss(elapsed)} elapsed
            </p>
          </div>
          <Button size="xs" variant="danger" className="shrink-0 rounded-full" onClick={onStop}>
            ■ Stop
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The minimal wait indicator for Horde's non-streaming calls (impersonate and
 * summaries): "Waiting for AI Horde… 0:12" with a Stop button.
 */
export function HordeWaitBar({
  label,
  elapsed,
  onStop,
}: {
  label: string;
  elapsed: number;
  onStop: () => void;
}) {
  return (
    <div className="relative z-10 shrink-0 border-t border-violet-500/20 bg-[#111528]/95 px-3 py-2 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-3xl items-center gap-3">
        <StudioLogo size={22} />
        <span className="text-sm text-violet-200">
          {label} <span className="font-mono tabular-nums text-violet-300">{mmss(elapsed)}</span>
        </span>
        <Button size="xs" variant="danger" className="ml-auto shrink-0 rounded-full" onClick={onStop}>
          ■ Stop
        </Button>
      </div>
    </div>
  );
}
