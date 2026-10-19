"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Coins, Timer } from "lucide-react";
import { getT, type Lang } from "@/lib/i18n";

// Compact: whole hours ("19h"), or minutes under an hour ("42m").
function fmtCountdown(ms: number) {
  const mins = Math.max(0, Math.ceil(ms / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h + (m > 0 ? 1 : 0)}h` : `${m}m`;
}

// Nav chip — countdown when the daily is cooling, claim prompt when ready.
// Both states just link to /rewards; the real claim button lives there.
export function ClaimButton({ lang, nextAt }: { lang?: Lang; nextAt: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  const t = getT(lang ?? "cs");

  useEffect(() => {
    if (!nextAt || nextAt <= Date.now()) return;
    const id = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= nextAt) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [nextAt]);

  const cooling = !!nextAt && nextAt > now;

  return (
    <Link
      href="/rewards"
      className="hidden sm:inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-semibold transition-all duration-150
        bg-brand-soft text-brand-strong hover:bg-brand active:scale-[0.97] hover:text-brand-on"
      title={cooling ? t.availableIn(Math.max(1, Math.ceil((nextAt - now) / 3600000))) : t.claimTitle}
    >
      {cooling ? <Timer className="size-4" /> : <Coins className="size-4" />}
      <span className="hidden sm:inline num" suppressHydrationWarning>
        {cooling ? fmtCountdown(nextAt - now) : t.claim}
      </span>
    </Link>
  );
}
