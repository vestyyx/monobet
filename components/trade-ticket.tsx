"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Segmented, Button } from "@/components/ui/primitives";
import { sharesForSpend, tradeCost, yesPrice, multiPrices, multiTradeCost, multiSharesForSpend, MAX_TRADE_CENTS, MAX_TRADE_SPEND_CENTS, MIN_TRADE_CENTS, TRADE_FEE_CENTS } from "@/lib/lmsr";
import { levFeeCents, LEV_FEE_BPS } from "@/lib/liq";
import { fmtMonos, fmtCents, fmtShares, fmtDateTime } from "@/lib/money";
import { playSfx } from "@/lib/sfx";
import { getT, type Lang } from "@/lib/i18n";
import { cn, openPct } from "@/lib/utils";
import { Clock, Crosshair, TrendingDown } from "lucide-react";
import { placeTrade, setStops } from "@/lib/actions";

export function TradeTicket({
  marketId,
  qYes,
  qNo,
  b,
  live,
  userBalanceCents,
  signedIn,
  heldYes,
  heldNo,
  maxLeverage = 10,
  levFeeBps,
  maxSpendCents = MAX_TRADE_SPEND_CENTS,
  lang,
  title,
  defaultOutcome,
  opensAt,
  sharedQ,
  sharedIndex,
  stops,
}: {
  marketId: string;
  qYes: number;
  qNo: number;
  b: number;
  live: boolean;
  userBalanceCents: number | null;
  signedIn: boolean;
  heldYes: number;
  heldNo: number;
  maxLeverage?: number;
  // Funding-fee rate in bps of borrowed notional — matches the server config.
  levFeeBps?: number;
  // Own-cash spend ceiling — per-market cap when set, else the global config.
  maxSpendCents?: number;
  lang?: Lang;
  // Optional header (e.g. the selected option label on group markets).
  title?: React.ReactNode;
  // Preselected outcome — group rows' YES/NO chips carry ?side= into the ticket.
  defaultOutcome?: "yes" | "no";
  // Scheduled markets show a clock instead of the trade form until opens_at.
  opensAt?: Date | string | null;
  // Group options price off the shared book: live-sibling coordinates plus
  // this option's index in them. Absent → standalone binary market.
  sharedQ?: number[];
  sharedIndex?: number;
  // Resting TP/SL triggers on the viewer's position (share price 0..1, per
  // side). Null → none set.
  stops?: { tpYes: number | null; slYes: number | null; tpNo: number | null; slNo: number | null; yesPct?: number | null; noPct?: number | null } | null;
}) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [outcome, setOutcome] = useState<"yes" | "no">(defaultOutcome ?? "yes");
  const [amount, setAmount] = useState("");
  const [leverage, setLeverage] = useState("1");
  const [pending, start] = useTransition();
  const router = useRouter();
  const t = getT(lang ?? "cs");

  const shared = sharedQ != null && sharedIndex != null && sharedIndex >= 0;
  const py = shared ? multiPrices(sharedQ, b)[sharedIndex] ?? 0 : yesPrice(qYes, qNo, b);
  const held = outcome === "yes" ? heldYes : heldNo;
  const spendCents = Math.round(parseFloat(amount || "0") * 100);
  const sellShares = parseFloat(amount || "0");

  const lev = Math.min(Number(leverage), maxLeverage);
  const overCap = side === "buy" && (spendCents > maxSpendCents || spendCents * lev > MAX_TRADE_CENTS);
  const est = useMemo(() => {
    if (side === "buy") {
      if (spendCents < MIN_TRADE_CENTS) return null;
      const sh = shared
        ? multiSharesForSpend(sharedQ, b, sharedIndex!, outcome, (spendCents * lev) / 100)
        : sharesForSpend(qYes, qNo, b, outcome, (spendCents * lev) / 100);
      return { shares: sh, avg: (spendCents * lev) / 100 / sh, toWin: sh * 100 };
    }
    if (sellShares <= 0) return null;
    // tradeCost of a negative delta is negative — negate for the refund.
    const refund = -(shared
      ? multiTradeCost(sharedQ, b, sharedIndex!, outcome, -sellShares)
      : tradeCost(qYes, qNo, b, outcome, -sellShares));
    return { shares: sellShares, avg: refund / sellShares, toWin: Math.round(refund * 100) };
  }, [side, spendCents, sellShares, qYes, qNo, b, outcome, lev, shared, sharedQ, sharedIndex]);

  if (!live) return null;

  if (opensAt && new Date(opensAt) > new Date()) {
    return (
      <div className="rounded-[14px] border border-line bg-surface p-5 text-center">
        <Clock className="size-5 text-mute mx-auto" />
        <p className="mt-2 text-sm font-medium text-ink">{t.tradingOpensTitle}</p>
        {/* Localized datetime — SSR prints server TZ, hydration corrects. */}
        <p className="text-[13px] text-mute mt-1" suppressHydrationWarning>{t.opensAtDate(fmtDateTime(opensAt, lang))}</p>
      </div>
    );
  }

  if (!signedIn) {
    return (
      <div className="rounded-[14px] border border-line bg-surface p-5 text-center">
        <p className="text-sm font-medium text-ink">{t.loginToTrade}</p>
        <p className="text-[13px] text-mute mt-1">{t.signupBonusNote}</p>
        <Link href="/login">
          <Button className="mt-4 w-full">{t.loginSignup}</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-[14px] border border-line bg-surface p-4 shadow-[0_1px_2px_rgba(16,16,20,0.04)]">
      {title}
      <Segmented
        options={[
          { value: "buy", label: t.buy },
          { value: "sell", label: t.sell },
        ]}
        value={side}
        onChange={(v) => {
          setSide(v);
          setAmount("");
        }}
      />

      <div className="mt-3">
        <Segmented
          options={[
            { value: "yes", label: `${t.yes} ${fmtMonos(openPct(py), { lang })}`, tone: "yes" },
            { value: "no", label: `${t.no} ${fmtMonos(openPct(1 - py), { lang })}`, tone: "no" },
          ]}
          value={outcome}
          onChange={setOutcome}
        />
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-[13px] font-medium text-mute">
          <label htmlFor="amt">{side === "buy" ? t.amount : t.sharesLabel}</label>
          <span className="num">
            {side === "buy" ? `${t.balance} ${fmtMonos(userBalanceCents ?? 0, { lang })}` : `${t.holding} ${fmtShares(held, lang)}`}
          </span>
        </div>
        <div className="mt-1.5 relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-mute font-semibold text-sm">
            {side === "buy" ? "Ɱ" : "#"}
          </span>
          <input
            id="amt"
            type="number"
            min="0"
            step={side === "buy" ? "1" : "0.01"}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="num h-11 w-full rounded-lg border border-line bg-surface pl-8 pr-3 text-[15px] font-semibold text-ink placeholder:text-faint focus:outline-2 focus:outline-brand"
          />
        </div>
        <div className="mt-2 flex gap-1.5">
          {(side === "buy" ? [10, 50, 100, 500] : [10, 25, 50, 100]).map((v) => (
            <button
              key={v}
              onClick={() => {
                if (side === "buy") setAmount(String((parseFloat(amount || "0") + v).toFixed(0)));
                else setAmount(((held * v) / 100).toFixed(2));
              }}
              className="flex-1 h-7 rounded-md bg-surface-2 text-[12px] font-semibold text-mute hover:bg-surface-3 hover:text-ink cursor-pointer"
            >
              {side === "buy" ? `+Ɱ ${v}` : `${v}%`}
            </button>
          ))}
          <button
            onClick={() => setAmount(side === "buy" ? String(Math.max(0, Math.min((userBalanceCents ?? 0) - TRADE_FEE_CENTS, maxSpendCents) / 100)) : held.toFixed(2))}
            className="flex-1 h-7 rounded-md bg-surface-2 text-[12px] font-semibold text-mute hover:bg-surface-3 hover:text-ink cursor-pointer"
          >
            {t.max}
          </button>
        </div>
        {overCap && (
          <p className="mt-2 text-[12px] font-medium text-warn-strong">
            {t.tradeLimit(fmtMonos(maxSpendCents, { lang }))}
          </p>
        )}
        {side === "buy" && spendCents > 0 && spendCents < MIN_TRADE_CENTS && (
          <p className="mt-2 text-[12px] font-medium text-warn-strong">
            {t.minTrade(fmtMonos(MIN_TRADE_CENTS, { lang }))}
          </p>
        )}
      </div>

      {side === "buy" && maxLeverage > 1 && (
        <div className="mt-3">
          <div className="text-[13px] font-medium text-mute mb-1.5">{t.leverage}</div>
          <Segmented
            options={["1", "2", "3", "5", "10", "20", "50", "100"]
              .filter((v) => Number(v) <= maxLeverage)
              .map((v) => ({ value: v, label: `${v}×` }))}
            value={leverage}
            onChange={setLeverage}
          />
          {lev > 1 && spendCents > 0 && (
            <p className="num mt-1.5 text-[11.5px] font-medium text-ink-2">
              {t.levBreakdown(
                fmtMonos(spendCents, { lang }),
                fmtMonos(spendCents * (lev - 1), { lang }),
                fmtMonos(spendCents * lev, { lang })
              )}
            </p>
          )}
          {lev > 1 && <p className="mt-1.5 text-[11px] text-faint">{t.liqNote}</p>}
        </div>
      )}

      {est && (
        <div className="mt-4 space-y-1.5 text-[13px]">
          <Row k={side === "buy" ? t.estShares : t.selling} v={fmtShares(est.shares, lang)} />
          <Row k={t.avgPrice} v={fmtCents(est.avg)} />
          {/* A big order sweeps the book — flag it when the fill price is far
              from the quoted chance so the numbers don't look contradictory. */}
          {side === "buy" &&
            (() => {
              const px = outcome === "yes" ? py : 1 - py;
              return est.avg > px * 1.15 && est.avg - px > 0.08 ? (
                <p className="text-[11px] leading-snug text-warn-strong">
                  {t.priceImpact(fmtCents(px), fmtCents(est.avg))}
                </p>
              ) : null;
            })()}
          {side === "buy" && lev > 1 && (
            <Row k={t.loanLabel} v={fmtMonos(spendCents * (lev - 1), { lang })} />
          )}
          <Row k={t.orderFee} v={fmtMonos(TRADE_FEE_CENTS, { lang })} />
          {side === "buy" && lev > 1 && (
            <Row k={t.levFee} v={fmtMonos(levFeeCents(spendCents, lev, levFeeBps ?? LEV_FEE_BPS), { lang })} />
          )}
          {side === "buy" ? (
            <Row k={t.paysIfRight} v={fmtMonos(est.toWin, { lang })} accent />
          ) : (
            <Row k={t.youReceive} v={fmtMonos(est.toWin - Math.min(TRADE_FEE_CENTS, est.toWin), { lang })} accent />
          )}
        </div>
      )}

      {/* Auto-exit: resting TP/SL triggers on the held side. Inputs are ¢ per
          share — the whole side sells when the book price crosses the level. */}
      {held > 0.001 && (
        <StopsEditor
          key={outcome}
          marketId={marketId}
          outcome={outcome}
          held={held}
          px={outcome === "yes" ? py : 1 - py}
          current={
            outcome === "yes"
              ? { tp: stops?.tpYes ?? null, sl: stops?.slYes ?? null, pct: stops?.yesPct ?? null }
              : { tp: stops?.tpNo ?? null, sl: stops?.slNo ?? null, pct: stops?.noPct ?? null }
          }
          lang={lang}
          onDone={() => router.refresh()}
        />
      )}

      <Button
        className="mt-4 w-full"
        size="lg"
        variant={side === "buy" ? (outcome === "yes" ? "yes" : "no") : "primary"}
        disabled={pending || !est || overCap}
        onClick={() =>
          start(async () => {
            const r = await placeTrade({
              marketId,
              outcome,
              side,
              spendCents: side === "buy" ? spendCents : undefined,
              shares: side === "sell" ? sellShares : undefined,
              leverage: side === "buy" ? lev : undefined,
            });
            if (r.ok) {
              playSfx("trade", 0.4);
              const oc = (outcome === "yes" ? t.yes : t.no).toUpperCase();
              toast.success(
                side === "buy"
                  ? t.boughtToast(fmtShares(r.shares, lang), oc, fmtMonos(r.costCents, { lang }))
                  : t.soldToast(fmtShares(r.shares, lang), oc, fmtMonos(r.costCents, { lang })),
                { description: t.priceMoved(Math.round(py * 100), Math.round(r.price * 100)) }
              );
              setAmount("");
              router.refresh();
            } else {
              toast.error(t.serverErr(r.error));
            }
          })
        }
      >
        {pending
          ? t.placing
          : `${side === "buy" ? t.buy : t.sell} ${(outcome === "yes" ? t.yes : t.no).toUpperCase()}`}
      </Button>

      <p className="mt-3 text-center text-[11px] text-faint">{t.playMoneyNote}</p>
    </div>
  );
}

// Resting TP/SL editor — ¢ per share; empty field clears that trigger. The
// whole held side sells at the book price when a later trade crosses it.
function StopsEditor({
  marketId,
  outcome,
  held,
  px,
  current,
  lang,
  onDone,
}: {
  marketId: string;
  outcome: "yes" | "no";
  held: number;
  px: number;
  current: { tp: number | null; sl: number | null; pct: number | null };
  lang?: Lang;
  onDone: () => void;
}) {
  const t = getT(lang ?? "cs");
  const [tpIn, setTpIn] = useState(current.tp == null ? "" : String(Math.round(current.tp * 100)));
  const [slIn, setSlIn] = useState(current.sl == null ? "" : String(Math.round(current.sl * 100)));
  const [pct, setPct] = useState(current.pct ?? 100);
  const [pending, start] = useTransition();
  const tpC = tpIn.trim() === "" ? null : Number(tpIn);
  const slC = slIn.trim() === "" ? null : Number(slIn);
  const bad =
    (tpC != null && (!Number.isFinite(tpC) || tpC < 1 || tpC > 99)) ||
    (slC != null && (!Number.isFinite(slC) || slC < 1 || slC > 99)) ||
    (tpC != null && tpC <= Math.round(px * 100)) ||
    (slC != null && slC >= Math.round(px * 100)) ||
    (tpC != null && slC != null && tpC <= slC);
  const dirty =
    tpC !== (current.tp == null ? null : Math.round(current.tp * 100)) ||
    slC !== (current.sl == null ? null : Math.round(current.sl * 100)) ||
    pct !== (current.pct ?? 100);

  return (
    <div className="mt-3 rounded-lg border border-line bg-surface-2/40 p-3">
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-mute">
        <Crosshair className="size-3.5" />
        {t.stopsTitle}
        {(current.tp != null || current.sl != null) && (
          <span className="num ml-auto text-[10.5px] font-bold">
            {current.tp != null && <span className="text-yes-strong">TP ¢{Math.round(current.tp * 100)}</span>}
            {current.tp != null && current.sl != null && " · "}
            {current.sl != null && <span className="text-no-strong">SL ¢{Math.round(current.sl * 100)}</span>}
          </span>
        )}
      </div>
      <p className="mt-0.5 text-[10.5px] text-faint">{t.stopsHint(fmtShares(held, lang), (outcome === "yes" ? t.yes : t.no).toUpperCase(), pct)}</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[10.5px] font-semibold text-yes-strong flex items-center gap-1"><Crosshair className="size-3" />{t.stopsTp}</span>
          <div className="mt-0.5 relative">
            <input
              type="number"
              min="1"
              max="99"
              value={tpIn}
              onChange={(e) => setTpIn(e.target.value)}
              placeholder={`> ${Math.ceil(px * 100)}`}
              className="num h-8 w-full rounded-md border border-line bg-surface px-2.5 pr-7 text-[13px] font-semibold text-ink placeholder:text-faint focus:outline-2 focus:outline-yes"
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-bold text-faint">¢</span>
          </div>
        </label>
        <label className="block">
          <span className="text-[10.5px] font-semibold text-no-strong flex items-center gap-1"><TrendingDown className="size-3" />{t.stopsSl}</span>
          <div className="mt-0.5 relative">
            <input
              type="number"
              min="1"
              max="99"
              value={slIn}
              onChange={(e) => setSlIn(e.target.value)}
              placeholder={`< ${Math.floor(px * 100)}`}
              className="num h-8 w-full rounded-md border border-line bg-surface px-2.5 pr-7 text-[13px] font-semibold text-ink placeholder:text-faint focus:outline-2 focus:outline-no"
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-bold text-faint">¢</span>
          </div>
        </label>
      </div>
      <div className="mt-2 flex items-center gap-1">
        <span className="text-[10.5px] font-semibold text-mute mr-0.5">{t.stopsSize}</span>
        {[25, 50, 75, 100].map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setPct(v)}
            className={cn(
              "h-6 flex-1 rounded-md text-[11px] font-bold num cursor-pointer transition-colors",
              pct === v ? "bg-accent/15 text-accent ring-1 ring-accent/40" : "bg-surface-3 text-mute hover:bg-line"
            )}
          >
            {v}%
          </button>
        ))}
      </div>
      {bad && (tpIn !== "" || slIn !== "") && (
        <p className="mt-1.5 text-[10.5px] font-medium text-no-strong">{t.stopsBad(Math.round(px * 100))}</p>
      )}
      <button
        type="button"
        disabled={pending || bad || !dirty}
        onClick={() =>
          start(async () => {
            const r = await setStops({ marketId, outcome, tpPrice: tpC == null ? null : tpC / 100, slPrice: slC == null ? null : slC / 100, sellPct: pct });
            if (r.ok) {
              playSfx("trade", 0.3);
              toast.success(t.stopsSaved);
              onDone();
            } else {
              toast.error(t.serverErr(r.error));
            }
          })
        }
        className="mt-2 h-7 w-full rounded-md bg-surface-3 text-[11.5px] font-bold text-ink hover:bg-line cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {pending ? t.placing : t.stopsSet}
      </button>
    </div>
  );
}

function Row({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-mute">{k}</span>
      <span className={cn("num font-semibold", accent && "text-yes-strong")}>{v}</span>
    </div>
  );
}
