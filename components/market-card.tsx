import Link from "next/link";
import {
  MessageSquare,
  Users,
  Clock,
  Flame,
  Layers,
} from "lucide-react";
import type { MarketRow } from "@/lib/queries";
import { marketYesPrice, groupPrices } from "@/lib/queries";
import { MarketIcon, OptionChip } from "@/components/market-icon";
import { fmtMonos, fmtDate } from "@/lib/money";
import { Sparkline } from "@/components/sparkline";

import { LikeButton } from "@/components/like-button";
import { AnimatedPct } from "@/components/animated-number";
import { Badge } from "@/components/ui/primitives";
import { getT, type Lang } from "@/lib/i18n";
import { cn, openPct, slugifyLabel } from "@/lib/utils";

const CARD =
  "group flex flex-col rounded-[14px] border border-line bg-surface p-4 shadow-[0_1px_2px_rgba(16,16,20,0.04)] hover:shadow-[0_6px_20px_rgba(16,16,20,0.09)] hover:border-faint/60 hover:-translate-y-0.5 transition-all duration-200 anim-rise";

export function MarketCard({
  market,
  spark,
  comments = 0,
  index = 0,
  options,
  lang,
  watching,
  liked,
  likes = 0,
  trending,
  groupTraders,
}: {
  market: MarketRow;
  spark: number[];
  comments?: number;
  index?: number;
  options?: MarketRow[];
  lang?: Lang;
  watching?: boolean;
  liked?: boolean;
  likes?: number;
  trending?: boolean;
  groupTraders?: number;
}) {
  const t = getT(lang ?? "cs");
  if (market.kind === "group") return <GroupCard market={market} options={options ?? []} index={index} lang={lang} watching={watching} liked={liked} likes={likes} trending={trending} traders={groupTraders} />;

  const py = marketYesPrice(market);
  const resolved = market.status === "resolved";
  const cancelled = market.status === "cancelled" || market.status === "rejected";
  // Live markets past closesAt stop taking bets — they're just awaiting resolution.
  const expired = market.status === "live" && !!market.closesAt && market.closesAt <= new Date();

  return (
    <Link href={`/market/${market.slug}`} className={CARD} style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}>
      <div className="flex gap-3">
        <MarketIcon market={market} />
        <h3 className="font-semibold text-[15px] leading-snug text-ink line-clamp-2 flex-1 group-hover:underline decoration-1 underline-offset-2">
          {trending && <Flame className="inline size-3.5 -mt-0.5 mr-1 text-orange-500" aria-label={t.trendingBadge} />}
          {market.question}
        </h3>
        <Sparkline points={spark} className="shrink-0 self-start" />
      </div>

      <div className="mt-3 flex items-end justify-between">
        <div>
          <div className="num text-[26px] font-bold leading-none tracking-tight">
            {resolved ? (
              <Badge tone={market.outcome === "yes" ? "yes" : "no"}>
                {(market.outcome === "yes" ? t.yes : t.no).toUpperCase()} {t.won}
              </Badge>
            ) : cancelled ? (
              <Badge tone="mute">{t.cancelled}</Badge>
            ) : market.status === "pending" ? (
              <Badge tone="warn">{t.pendingApproval}</Badge>
            ) : expired ? (
              <Badge tone="warn">{t.closedAwaiting}</Badge>
            ) : (
              <AnimatedPct value={openPct(py) / 100} className={py >= 0.5 ? "text-yes" : "text-ink"} />
            )}
          </div>
          {market.status === "live" && <div className="text-[11px] text-mute mt-1.5 font-medium">{t.chance}</div>}
        </div>
      </div>

      {market.status === "live" && !expired && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <span className="grid place-items-center h-8.5 rounded-md bg-yes-soft text-yes-strong text-[13px] font-semibold">
            {t.buyYes} {fmtMonos(openPct(py), { lang })}
          </span>
          <span className="grid place-items-center h-8.5 rounded-md bg-no-soft text-no-strong text-[13px] font-semibold">
            {t.buyNo} {fmtMonos(openPct(1 - py), { lang })}
          </span>
        </div>
      )}

      <div className="mt-auto pt-3 flex items-center gap-3.5 text-[11.5px] text-mute font-medium">
        <span className="num">{fmtMonos(market.volumeCents, { lang })} {t.vol}</span>
        <span className="inline-flex items-center gap-1">
          <Users className="size-3" />
          {market.traderCount}
        </span>
        <span className="inline-flex items-center gap-1">
          <MessageSquare className="size-3" />
          {comments}
        </span>
        <span className={cn("inline-flex items-center gap-1", watching === undefined && liked === undefined && "ml-auto")}>
          <Clock className="size-3" />
          {fmtDate(market.closesAt, lang)}
        </span>
        {liked !== undefined && (
          <span className="ml-auto inline-flex items-center gap-1">
            <LikeButton marketId={market.id} liked={liked} count={likes} lang={lang} />
          </span>
        )}
      </div>
    </Link>
  );
}

// Multi-outcome card — Polymarket's "X by when?" style. Each option row links
// to its own binary market; resolved options collapse under "View resolved".
function GroupCard({ market, options, index, lang, watching, liked, likes = 0, trending, traders }: { market: MarketRow; options: MarketRow[]; index: number; lang?: Lang; watching?: boolean; liked?: boolean; likes?: number; trending?: boolean; traders?: number }) {
  const t = getT(lang ?? "cs");
  const parentExpired = !!market.closesAt && market.closesAt <= new Date();
  const live = options.filter((o) => o.status === "live");
  const closed = options.filter((o) => o.status !== "live");
  // Shared book — the group's probabilities are exclusive and sum to 100%.
  const livePrices = groupPrices(live);
  const volume = options.reduce((s, o) => s + o.volumeCents, 0);
  // Summing per-option counts double-counts users who traded several options —
  // the caller passes the distinct count; the sum stays as a fallback.
  const traderCount = traders ?? options.reduce((s, o) => s + o.traderCount, 0);
  // Color index must match the option's position in the full list — same color
  // on the card, the group page, and the chart.
  const idxOf = new Map(options.map((o, i) => [o.id, i]));

  return (
    <div className={CARD} style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}>
      <div className="flex gap-3">
        <MarketIcon market={market} />
        <h3 className="font-semibold text-[15px] leading-snug text-ink line-clamp-2 flex-1">
          <Link href={`/market/${market.slug}`} className="hover:underline decoration-1 underline-offset-2">
            {trending && <Flame className="inline size-3.5 -mt-0.5 mr-1 text-orange-500" aria-label={t.trendingBadge} />}
            {market.question}
          </Link>
        </h3>
        <span className="inline-flex items-center gap-1 h-5 rounded-full bg-surface-2 border border-line-2 px-2 text-[10.5px] font-semibold text-mute shrink-0 select-none">
          <Layers className="size-3" />
          {options.length}
        </span>
      </div>

      <div className="mt-3 -mx-1 divide-y divide-line-2">
        {live.slice(0, 4).map((o) => (
          <OptionRow key={o.id} option={o} parentSlug={market.slug} index={idxOf.get(o.id) ?? 0} lang={lang} expired={parentExpired} price={livePrices.get(o.id)} />
        ))}
        {live.length > 4 && (
          <Link href={`/market/${market.slug}`} className="block px-1 pt-2 text-[12px] font-semibold text-brand-strong hover:underline">
            {t.moreOptions(live.length - 4)}
          </Link>
        )}
      </div>

      {closed.length > 0 && (
        <details className="group/det mt-1 -mx-1">
          <summary className="cursor-pointer list-none px-1 py-1.5 text-[12px] font-semibold text-mute hover:text-ink select-none">
            {t.viewResolved(closed.length)}
          </summary>
          <div className="divide-y divide-line-2">
            {closed.map((o) => (
              <OptionRow key={o.id} option={o} parentSlug={market.slug} index={idxOf.get(o.id) ?? 0} lang={lang} />
            ))}
          </div>
        </details>
      )}

      <div className="mt-auto pt-3 flex items-center gap-3.5 text-[11.5px] text-mute font-medium">
        <span className="num">{fmtMonos(volume, { lang })} {t.vol}</span>
        <span className="inline-flex items-center gap-1">
          <Users className="size-3" />
          {traderCount}
        </span>
        <span className={cn("inline-flex items-center gap-1", watching === undefined && liked === undefined && "ml-auto")}>
          <Clock className="size-3" />
          {fmtDate(market.closesAt, lang)}
        </span>
        {liked !== undefined && (
          <span className="ml-auto inline-flex items-center gap-1">
            <LikeButton marketId={market.id} liked={liked} count={likes} lang={lang} />
          </span>
        )}
      </div>
    </div>
  );
}

function OptionRow({ option: o, parentSlug, index, lang, expired, price }: { option: MarketRow; parentSlug: string; index: number; lang?: Lang; expired?: boolean; price?: number }) {
  const t = getT(lang ?? "cs");
  const py = price ?? marketYesPrice(o);
  const resolved = o.status === "resolved";
  return (
    <Link
      href={`/market/${parentSlug}?opt=${slugifyLabel(o.label ?? o.question)}`}
      className="flex items-center gap-2.5 px-1 py-2 rounded-md hover:bg-surface-2 transition-colors"
    >
      <OptionChip label={o.label ?? o.question} index={index} imageUrl={o.imageUrl} />
      <span className="text-[13px] font-medium text-ink truncate min-w-0 flex-1">
        {o.label}
        {o.volumeCents > 0 && (
          <span className="num text-[10.5px] text-faint font-medium ml-1.5 whitespace-nowrap">
            {fmtMonos(o.volumeCents, { lang })} {t.vol}
          </span>
        )}
      </span>
      {resolved ? (
        <Badge tone={o.outcome === "yes" ? "yes" : "no"} className="shrink-0">
          {(o.outcome === "yes" ? t.yes : t.no).toUpperCase()}
        </Badge>
      ) : o.status === "cancelled" ? (
        <Badge tone="mute" className="shrink-0">{t.cancelled}</Badge>
      ) : expired ? (
        <span className={cn("num w-10 text-right text-[14px] font-bold shrink-0", py >= 0.5 ? "text-yes" : "text-ink")}>
          {openPct(py)}%
        </span>
      ) : (
        <>
          <span className={cn("num w-10 text-right text-[14px] font-bold shrink-0", py >= 0.5 ? "text-yes" : "text-ink")}>
            {openPct(py)}%
          </span>
          <span className="num grid place-items-center h-7 w-20 rounded-md bg-yes-soft text-yes-strong text-[12px] font-semibold whitespace-nowrap shrink-0">
            {t.yes} {fmtMonos(openPct(py), { lang })}
          </span>
          <span className="num grid place-items-center h-7 w-20 rounded-md bg-no-soft text-no-strong text-[12px] font-semibold whitespace-nowrap shrink-0">
            {t.no} {fmtMonos(openPct(1 - py), { lang })}
          </span>
        </>
      )}
    </Link>
  );
}
