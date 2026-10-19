"use client";

import { useEffect, useState } from "react";
import { Hourglass } from "lucide-react";
import { GAME_WINDOW_MS, GAME_DAILY_LIMIT_MS, GAME_IDLE_MS } from "@/lib/games";
import { getT, type Lang } from "@/lib/i18n";

// Daily-cap indicator: ticks down the in-game budget of the rolling 24h
// window (admin-tunable — props fall back to the shipped defaults). A gap
// past the idle threshold since the last stake means the clock stopped —
// the chip then freezes instead of draining idle time. Renders nothing
// before the first stake or after the window lapses — the next stake
// reopens it.
export function SessionChip({
  windowStart,
  lastPlayAt,
  playedMs,
  dailyMs,
  idleMs,
  lang,
}: {
  windowStart: number | null;
  lastPlayAt: number | null;
  playedMs: number;
  dailyMs?: number;
  idleMs?: number;
  lang?: Lang;
}) {
  const t = getT(lang ?? "cs");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  if (windowStart === null) return null;
  const windowEnd = windowStart + GAME_WINDOW_MS;
  if (now >= windowEnd) return null;

  const limit = dailyMs ?? GAME_DAILY_LIMIT_MS;
  const idle = idleMs ?? GAME_IDLE_MS;
  // In-game time = banked ms + the open stretch since the last stake (only
  // while it's under the idle gap — past that the clock already stopped).
  const openStretch = lastPlayAt !== null && now - lastPlayAt < idle ? now - lastPlayAt : 0;
  const used = playedMs + openStretch;
  const capped = used >= limit;
  const shown = capped ? windowEnd - now : limit - used;
  let hrs = Math.floor(shown / 3_600_000);
  let mins = Math.ceil((shown % 3_600_000) / 60000);
  if (mins === 60) { hrs += 1; mins = 0; }
  const label = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;

  return (
    <span
      title={t.sessionCapHint}
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold num " +
        (capped ? "border-warn/40 bg-warn-soft/50 text-warn-strong" : "border-line bg-surface-2 text-mute")
      }
    >
      <Hourglass className="size-3" />
      {capped ? t.sessionBreak(label) : t.sessionLeft(label)}
    </span>
  );
}
