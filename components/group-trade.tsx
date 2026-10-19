"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/primitives";
import { OptionChip } from "@/components/market-icon";
import { Sparkline } from "@/components/sparkline";
import { TradeTicket } from "@/components/trade-ticket";
import { ResolutionPanel, type NoteView } from "@/components/resolution-panel";
import { MultiPriceChart, type Series, type ChartMarker } from "@/components/multi-chart";
import { multiCoords, multiPrices } from "@/lib/lmsr";
import { fmtMonos } from "@/lib/money";
import { getT, type Lang } from "@/lib/i18n";
import { cn, openPct, slugifyLabel } from "@/lib/utils";
import type { MyPositionEntry } from "@/lib/queries";

export type GroupOption = {
  id: string;
  slug: string;
  label: string;
  imageUrl: string | null;
  status: string;
  outcome: string | null;
  qYes: number;
  qNo: number;
  b: number;
  volumeCents: number;
  traderCount: number;
  index: number;
  proposedOutcome?: string | null;
  proposedById?: string | null;
  resolutionReason?: string | null;
  opensAt?: Date | string | null;
};

export type ResolutionState = { confirms: number; disputes: number; myVote: string | null; proposer: string | null };

// Client-side option selection — picking an outcome swaps the ticket without a
// server round-trip, so it feels instant. ?opt= stays in the URL via
// replaceState so selection remains shareable.
export function GroupTrade({
  slug,
  options,
  sparks,
  positions,
  balanceCents,
  signedIn,
  maxLeverage,
  levFeeBps,
  maxSpendCents,
  lang,
  initialOpt,
  initialSide,
  resStates,
  notesByOption,
  noteCounts,
  viewerId,
  isResolver,
  adminGate,
  parentClosed,
  chartSeries,
  chartNow,
  chartTrades,
  chartLive,
  chartFooter,
  left,
  rail,
}: {
  slug: string;
  options: GroupOption[];
  sparks: Record<string, number[]>;
  positions: Record<string, MyPositionEntry>;
  balanceCents: number | null;
  signedIn: boolean;
  maxLeverage: number;
  levFeeBps?: number;
  maxSpendCents?: number;
  lang?: Lang;
  initialOpt?: string;
  initialSide?: string;
  resStates?: Record<string, ResolutionState>;
  // Resolver-only: every note per option; public viewers get published notes
  // in the page card instead. noteCounts feeds the heading badge for all.
  notesByOption?: Record<string, NoteView[]>;
  noteCounts?: Record<string, number>;
  viewerId?: string;
  isResolver?: boolean;
  adminGate?: boolean;
  parentClosed?: boolean;
  // The chart renders inside this client component so the selected option's
  // line can be spotlighted while the rest fade — function props can't cross
  // the server boundary, so the page passes plain data instead.
  chartSeries?: Series[];
  chartTrades?: ChartMarker[];
  chartNow: number;
  chartLive?: boolean;
  chartFooter?: React.ReactNode;
  left?: React.ReactNode;
  rail?: React.ReactNode;
}) {
  const t = getT(lang ?? "cs");
  const live = options.filter((o) => o.status === "live");
  const closed = options.filter((o) => o.status !== "live");
  // ?opt= accepts the option label slug (readable), the child market slug, or the id (legacy links).
  const byOpt = (o: GroupOption) => o.id === initialOpt || o.slug === initialOpt || slugifyLabel(o.label) === initialOpt;
  const [selId, setSelId] = useState(() => live.find(byOpt)?.id ?? live[0]?.id ?? "");
  const [side, setSide] = useState<"yes" | "no">(initialSide === "no" ? "no" : "yes");
  // Chart spotlight is separate from the ticket pick — re-clicking the active
  // row unfocuses it so every line draws at full opacity again.
  const [focusId, setFocusId] = useState<string | null>(() => live.find(byOpt)?.id ?? live[0]?.id ?? null);

  const sel = live.find((o) => o.id === selId) ?? live[0];
  const selIdx = sel ? live.indexOf(sel) : -1;
  const selPos = sel ? positions[sel.id] : undefined;

  // Options share one book — softmax over live siblings, so the percentages
  // sum to 100% (mutually exclusive outcomes).
  const coords = multiCoords(live.map((o) => ({ qYes: o.qYes, qNo: o.qNo })));
  const probs = multiPrices(coords, live[0]?.b ?? 300);

  const select = (o: GroupOption, s?: "yes" | "no") => {
    if (!s && o.id === selId) {
      setFocusId((f) => (f === o.id ? null : o.id));
      return;
    }
    setSelId(o.id);
    setFocusId(o.id);
    if (s) setSide(s);
    // Shareable URL without a server fetch — slugged option label.
    window.history.replaceState(null, "", `/market/${slug}?opt=${slugifyLabel(o.label)}${s ? `&side=${s}` : ""}`);
  };

  const ticket = sel && (
    <TradeTicket
      key={`${sel.id}:${side}`}
      marketId={sel.id}
      qYes={sel.qYes}
      qNo={sel.qNo}
      b={sel.b}
      live={!(parentClosed ?? false)}
      signedIn={signedIn}
      userBalanceCents={balanceCents}
      heldYes={selPos?.yes ?? 0}
      heldNo={selPos?.no ?? 0}
      stops={selPos ? { tpYes: selPos.tpYes, slYes: selPos.slYes, tpNo: selPos.tpNo, slNo: selPos.slNo, yesPct: selPos.yesPct, noPct: selPos.noPct } : null}
      maxLeverage={maxLeverage}
      levFeeBps={levFeeBps}
      maxSpendCents={maxSpendCents}
      lang={lang}
      defaultOutcome={side}
      opensAt={sel.opensAt}
      sharedQ={coords}
      sharedIndex={selIdx}
      title={
        <div className="mb-3 flex items-center gap-2.5">
          <OptionChip label={sel.label} index={sel.index} imageUrl={sel.imageUrl} />
          <span className="min-w-0 flex-1 text-[14px] font-semibold truncate">{sel.label}</span>
          <span className="num text-[15px] font-bold shrink-0">
            {openPct(probs[selIdx] ?? 0)}%
          </span>
        </div>
      }
    />
  );

  return (
    <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_340px]">
      <div className="min-w-0">
        {chartSeries && (
          <div className="rounded-[14px] border border-line bg-surface p-4">
            {chartSeries.length > 0 ? (
              <MultiPriceChart
                series={chartSeries}
                now={chartNow}
                live={chartLive}
                trades={chartTrades}
                focusKey={focusId}
                onSelectKey={(key) => {
                  const o = live.find((x) => x.id === key);
                  if (o) select(o);
                }}
                lang={lang}
              />
            ) : (
              <div className="h-40 grid place-items-center text-[13px] text-faint">{t.noTradesYet}</div>
            )}
            {chartFooter}
          </div>
        )}

        <div className="mt-8 rounded-[14px] border border-line bg-surface overflow-hidden">
          <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_90px_72px_56px_auto] items-center gap-3 px-4 py-2.5 border-b border-line text-[11px] font-semibold uppercase tracking-wide text-faint">
            <span>{t.option}</span>
            <span className="hidden sm:block text-right">{t.volume}</span>
            <span className="hidden sm:block text-right">{t.tradersW}</span>
            <span className="text-right">{t.chance}</span>
            <span className="hidden sm:block" />
          </div>
          <div className="divide-y divide-line-2">
            {live.map((o, i) => {
              const py = probs[i];
              const active = sel?.id === o.id;
              return (
                <div
                  key={o.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => select(o)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      select(o);
                    }
                  }}
                  className={cn(
                    "grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_90px_72px_56px_auto] items-center gap-3 px-4 py-3 hover:bg-surface-2 transition-colors cursor-pointer",
                    active && "bg-surface-2 shadow-[inset_2px_0_0_var(--brand)]"
                  )}
                >
                  <span className="min-w-0 flex items-center gap-3">
                    <OptionChip label={o.label} index={o.index} imageUrl={o.imageUrl} />
                    <span className="text-[14px] font-semibold text-ink truncate">{o.label}</span>
                    <Sparkline points={sparks[o.id] ?? []} className="hidden md:block shrink-0 opacity-80" />
                  </span>
                  <span className="num hidden sm:block text-right text-[12.5px] text-mute">
                    {fmtMonos(o.volumeCents, { lang })}
                  </span>
                  <span className="num hidden sm:block text-right text-[12.5px] text-mute">{o.traderCount}</span>
                  <span className={cn("num text-right text-[15px] font-bold", py >= 0.5 ? "text-yes" : "text-ink")}>
                    {openPct(py)}%
                  </span>
                  {!parentClosed && (
                  <span className="hidden sm:grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        select(o, "yes");
                      }}
                      className="num grid place-items-center h-8 w-20 rounded-md bg-yes-soft text-yes-strong text-[12px] font-semibold whitespace-nowrap hover:brightness-95 transition cursor-pointer"
                    >
                      {t.yes} {fmtMonos(openPct(py), { lang })}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        select(o, "no");
                      }}
                      className="num grid place-items-center h-8 w-20 rounded-md bg-no-soft text-no-strong text-[12px] font-semibold whitespace-nowrap hover:brightness-95 transition cursor-pointer"
                    >
                      {t.no} {fmtMonos(openPct(1 - py), { lang })}
                    </button>
                  </span>
                  )}
                </div>
              );
            })}
            {live.length === 0 && <p className="px-4 py-6 text-[13px] text-mute">{t.allClosed}</p>}
          </div>
          {closed.length > 0 && (
            <details className="border-t border-line">
              <summary className="cursor-pointer list-none px-4 py-3 text-[13px] font-semibold text-mute hover:text-ink select-none">
                {t.viewResolved(closed.length)}
              </summary>
              <div className="divide-y divide-line-2 border-t border-line-2">
                {closed.map((o) => (
                  <Link
                    key={o.id}
                    href={`/market/${o.slug}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2 transition-colors"
                  >
                    <OptionChip label={o.label} index={o.index} imageUrl={o.imageUrl} />
                    <span className="text-[14px] font-medium text-mute truncate flex-1">{o.label}</span>
                    <span className="num text-[12px] text-faint">
                      {fmtMonos(o.volumeCents, { lang })} {t.vol}
                    </span>
                    <Badge tone={o.status === "resolved" ? (o.outcome === "yes" ? "yes" : "no") : "mute"}>
                      {o.status === "resolved"
                        ? `${(o.outcome === "yes" ? t.yes : t.no).toUpperCase()} ${t.won}`
                        : t.cancelled}
                    </Badge>
                  </Link>
                ))}
              </div>
            </details>
          )}
        </div>

        {/* Community resolution for the selected option — the poll is always
            visible; the resolver declares, everyone else confirms/disputes. */}
        {sel && (
          <div className="mt-4">
            <ResolutionPanel
              marketId={sel.id}
              proposedOutcome={sel.proposedOutcome ?? null}
              reason={sel.resolutionReason ?? ""}
              proposer={resStates?.[sel.id]?.proposer ?? null}
              proposedById={sel.proposedById ?? null}
              viewerId={viewerId}
              confirms={resStates?.[sel.id]?.confirms ?? 0}
              disputes={resStates?.[sel.id]?.disputes ?? 0}
              myVote={resStates?.[sel.id]?.myVote ?? null}
              closed={parentClosed ?? false}
              isResolver={isResolver ?? false}
              notes={notesByOption?.[sel.id] ?? []}
              noteGate={!!adminGate && (noteCounts?.[sel.id] ?? 0) > 5}
              contextLabel={sel.label}
              lang={lang}
            />
          </div>
        )}

        {/* On phones the ticket and rail (other markets, manage) sit right
            under the options; on desktop they live in the sticky column. */}
        {ticket && <div className="mt-4 lg:hidden">{ticket}</div>}
        <div className="mt-4 space-y-4 lg:hidden">{rail}</div>

        {left}
      </div>

      <div className="space-y-4 lg:sticky lg:top-20 self-start max-lg:hidden">
        {ticket}
        {rail}
      </div>
    </div>
  );
}
