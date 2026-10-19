import Link from "next/link";
import { fmtMonos } from "@/lib/money";
import { cn } from "@/lib/utils";
import { getT, type Lang } from "@/lib/i18n";
import type { getGlobalTrades } from "@/lib/queries";

type T = Awaited<ReturnType<typeof getGlobalTrades>>[number];

// Scrolling "live bets" tape — pure CSS marquee, duplicated once for a
// seamless loop. Pauses on hover; each item links to its market.
export function TradeTicker({ trades, lang }: { trades: T[]; lang?: Lang }) {
  const tt = getT(lang ?? "cs");
  if (trades.length === 0) return null;
  const items = [...trades, ...trades];
  return (
    <div className="border-b border-line overflow-hidden select-none" aria-hidden>
      <div className="anim-ticker flex w-max items-center hover:[animation-play-state:paused]">
        {items.map((t, i) => (
          <Link
            key={`${t.id}-${i}`}
            href={`/market/${t.slug}`}
            className="group inline-flex items-center gap-1.5 px-4 py-[7px] text-[12px] whitespace-nowrap"
            tabIndex={-1}
          >
            <span className={cn("size-1.5 rounded-full", t.side === "buy" ? "bg-yes" : "bg-no")} />
            <span className="font-semibold text-ink-2">@{t.username ?? t.name}</span>
            <span className="text-mute">{t.side === "buy" ? tt.bought : tt.sold}</span>
            <span
              className={cn(
                "font-bold",
                t.outcome === "yes" ? "text-yes-strong" : "text-no-strong"
              )}
            >
              {(t.outcome === "yes" ? tt.yes : tt.no).toUpperCase()}
            </span>
            <span className="num font-semibold text-ink">{fmtMonos(t.amountCents, { lang })}</span>
            <span className="text-faint max-w-52 truncate group-hover:text-mute transition-colors">
              {t.question}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
