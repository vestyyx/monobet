"use client";

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button, Card, Segmented } from "@/components/ui/primitives";
import {
  playCoinFlip,
  playDice,
  startTimerRound,
  stopTimerRound,
  playLimbo,
  playWheel,
  playSlots,
  playPlinko,
  playRedBlack,
  hiloStart,
  hiloPlay,
  blackjackDeal,
  blackjackHit,
  blackjackStand,
  blackjackDouble,
  blackjackSurrender,
} from "@/lib/actions";
import { levFeeCents, levFeeBpsEff, levWinCents, LEV_FEE_BPS } from "@/lib/liq";
import {
  GAME_LEVERAGES,
  MAX_GAME_STAKE_CENTS,
  COINFLIP_MULT,
  diceMult,
  diceWinChance,
  TIMER_TARGETS,
  TIMER_TIERS,
  timerMult,
  timerRevealMs,
  timerTopMult,
  LIMBO_MIN,
  LIMBO_MAX,
  LIMBO_PAYOUT,
  limboWinChance,
  WHEEL_SEGMENTS,
  WHEEL_STEP,
  PLINKO_ROWS,
  PLINKO_ROW_CHOICES,
  plinkoMults,
  SLOT_SYMBOLS,
  SLOT_TRIPLE,
  BJ_NATURAL_MULT,
  cardLabel,
  cardOrder,
  hiloMult,
  hiloWinRanks,
  REDBLACK_MULT,
  dealerFx,
  type HiloDir,
} from "@/lib/games";
import { fmtMonos } from "@/lib/money";
import { DealerAvatar } from "@/components/dealer-avatar";
import { type DealerFx, type Persona } from "@/lib/games";
import { playSfx } from "@/lib/sfx";
import { getT, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Coins, Dices, Timer, Rocket, Disc3, Cherry, Spade, Shuffle, CircleDot, X, ArrowUpDown, Contrast, Sparkles, FlaskConical, Zap } from "lucide-react";

type Net = { netCents: number; won: boolean; stamp: number; feeCents?: number; stakeCents?: number; skimCents?: number; demo?: boolean } | null;

// Demo rounds resolve entirely client-side — no balance, no ledger, no
// house stats. Results are rigged toward the player (DEMO_WIN) so trying
// a game feels generous; the fabricated result feeds the same reveal
// animations as a real settle.
const DEMO_WIN = 0.62;
const demoHit = (p = DEMO_WIN) => Math.random() < p;
const demoNet = (stakeCents: number, won: boolean, mult: number) =>
  won ? Math.round(stakeCents * (mult - 1)) : -stakeCents;
const demoDelay = <T extends { ok: boolean }>(r: T): Promise<T> =>
  new Promise((res) => setTimeout(() => res(r), 120));
// Games that support demo play — timer and blackjack are multi-phase and
// gain little from a canned outcome.
const DEMO_GAMES = new Set(["coinflip", "dice", "limbo", "wheel", "slots", "plinko", "redblack", "hilo"]);
const ri = (n: number) => Math.floor(Math.random() * n);
// Optional settle fields the reveal code reads — demo results carry the
// same shape so the existing .then() continuations run untouched.
const demoBase = { dealer: undefined as Persona | undefined, feeCents: 0, skimCents: 0, tavCents: undefined as number | undefined };

// Dealer-FX opt-out — persisted per device in localStorage.
const subscribeFx = (cb: () => void) => {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
};
const readFxOff = () => {
  try {
    return localStorage.getItem("mb_fx_off") === "1";
  } catch {
    return false;
  }
};

function useGame(lang?: Lang) {
  const t = getT(lang ?? "cs");
  const [pending, start] = useTransition();
  const router = useRouter();
  // Server error strings -> localized text; unknown strings pass through.
  const errText = (msg?: string) => t.serverErr(msg);
  const run = <T extends { ok: boolean; error?: string }>(fn: () => Promise<T>): Promise<T | null> =>
    new Promise((resolve) =>
      start(async () => {
        const r = await fn();
        if (!r.ok) {
          toast.error(errText(r.error));
          resolve(null);
          return;
        }
        router.refresh();
        resolve(r);
      })
    );
  return { pending, run };
}

// Shared result flash — pops in with the net win/loss.
function ResultTag({ net, lang }: { net: Net; lang?: Lang }) {
  useEffect(() => {
    // A push (exactly the stake back, minus any lever fee) gets a neutral
    // tick, not a lose sting.
    if (net) playSfx(net.won ? "win" : net.netCents === -(net.feeCents ?? 0) ? "trade" : "lose", 0.5);
  }, [net]);
  if (!net) return null;
  const t = getT(lang ?? "cs");
  // Headline = the win itself (stake + profit, before any debt garnish). A
  // debtor's profit may route to their loan, so a separate line shows what
  // actually landed on the balance — otherwise "+stake back" reads as
  // "won what I bet".
  const gross = net.netCents + (net.stakeCents ?? 0) + (net.feeCents ?? 0);
  const skim = net.skimCents ?? 0;
  // Push: the game returned exactly the stake (lever fee excluded).
  const isPush = !net.won && net.netCents === -(net.feeCents ?? 0) && (net.stakeCents ?? 0) > 0;
  const sub =
    net.won && net.stakeCents
      ? t.gameProfit(`+${fmtMonos(net.netCents + skim, { lang })}`)
      : !net.won && !isPush && gross > 0
        ? t.gameReturned(fmtMonos(gross, { lang }))
        : null;
  return (
    <div key={net.stamp} className="anim-win-pop num">
      <div className={cn("text-[15px] font-bold", net.won ? "text-yes-strong" : isPush ? "text-ink" : "text-no-strong")}>
        {net.won ? `+${fmtMonos(gross + skim, { lang })}` : isPush ? fmtMonos(gross, { lang }) : `−${fmtMonos(-net.netCents, { lang })}`}
        <span className="ml-1.5 text-[11px] font-semibold text-mute">{net.won ? t.win : isPush ? t.push : t.lose}</span>
        {net.demo && (
          <span className="ml-1.5 rounded-full border border-warn/50 bg-warn-soft px-1.5 py-0.5 text-[10px] font-bold text-warn-strong uppercase tracking-wide align-middle">
            {t.demoTag}
          </span>
        )}
        {(net.feeCents ?? 0) > 0 && (
          <span className="ml-1.5 rounded-full border border-no/40 bg-no-soft px-1.5 py-0.5 text-[10px] font-bold text-no-strong align-middle">
            {t.gameFeeChip(fmtMonos(net.feeCents!, { lang }))}
          </span>
        )}
      </div>
      {sub && <div className="text-[11px] font-semibold text-mute">{sub}</div>}
      {skim > 0 && (
        <>
          <div className="text-[11px] font-semibold text-mute">{t.debtGarnish(fmtMonos(skim, { lang }))}</div>
          <div className="text-[11px] font-semibold text-yes-strong">{t.gameCredited(`+${fmtMonos(gross, { lang })}`)}</div>
        </>
      )}
    </div>
  );
}

// The persona hosting the round — name shows while it plays, quip on settle.
function DealerTag({ dealer, won }: { dealer: Persona | null; won?: boolean | null }) {
  if (!dealer) return null;
  const quip = won == null ? null : won ? dealer.quipLose : dealer.quipWin;
  return (
    <div className="flex items-center justify-center gap-1.5 text-[11px] text-faint">
      <DealerAvatar avatar={dealer.avatar} className="size-4.5 rounded" />
      <span className="font-semibold text-mute">{dealer.name}</span>
      {quip && <span className="italic">“{quip}”</span>}
    </div>
  );
}


// Debtors play unleveraged — the display value is pinned to 1x so the ticket
// preview matches what the server will accept.
function lockedLev(lev: string, inDebt?: boolean) {
  return inDebt ? "1" : lev;
}

type WinFx = NonNullable<DealerFx["winFx"]>;

// Dealer win FX — some personas celebrate a player win with a full-screen
// moment (Bonnie's splash, Epstein's plane, Clavicular's parade). Name-keyed
// via dealerFx.
function dealerWinFx(dealer: Persona | null | undefined, won: boolean, netCents: number, cb?: (amt: number, fx: WinFx, tavCents?: number) => void, tavCents?: number) {
  const fx = dealerFx(dealer).winFx;
  if (won && netCents > 0 && fx) cb?.(netCents, fx, tavCents);
}

// Ɱ amount input + quick chips + leverage row — shared by every game card.
function BetControls({
  bet,
  setBet,
  lev,
  setLev,
  balanceCents,
  disabled,
  locked,
  lang,
  sideCents,
  winPreview,
  levCap,
  feeBps,
  maxBet,
}: {
  bet: string;
  setBet: (v: string) => void;
  lev: string;
  setLev: (v: string) => void;
  balanceCents: number;
  disabled?: boolean;
  locked?: boolean;
  lang?: Lang;
  sideCents?: number; // absolute side-bet stake in cents (blackjack PP / 21+3)
  // Multiplier a win pays — `max` marks a ceiling (variable-outcome games).
  // Shown lever-adjusted so the leverage's real effect is visible.
  winPreview?: { mult: number; max?: boolean };
  // Effective leverage cap for this game (global or per-game override).
  levCap?: number;
  // Funding-fee rate in bps of borrowed notional — matches the server config.
  feeBps?: number;
  // Effective base-stake ceiling in cents (global or per-game override).
  maxBet?: number;
}) {
  const t = getT(lang ?? "cs");
  const betCents = Math.round(parseFloat(bet || "0") * 100);
  const cap = levCap ?? GAME_LEVERAGES[GAME_LEVERAGES.length - 1];
  const bps = feeBps ?? LEV_FEE_BPS;
  const levers = GAME_LEVERAGES.filter((v) => v <= cap);
  // A lowered cap leaves a stale chip selected — pin down to the biggest
  // still-allowed lever so the submit can't fire a rejected value.
  useEffect(() => {
    if (Number(lev) > cap) setLev(String(levers[levers.length - 1] ?? 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- levers derives from cap
  }, [cap, lev]);
  const levN = Number(lev);
  const sides = sideCents ?? 0;
  const fee = levFeeCents(betCents, levN, bps);
  // Worst case is bigger than the stake: a total loss forfeits the collateral
  // AND leaves the borrowed notional as debt — show the true exposure.
  const borrowed = betCents * (levN - 1);
  const atRisk = betCents + sides + fee + borrowed;
  // Max stake: balance must cover stake + side bets + the tiered funding fee,
  // and the configured per-game base-stake ceiling still applies.
  const maxCents = Math.min(
    Math.floor((balanceCents - sides) / (1 + ((levN - 1) * levFeeBpsEff(levN, bps)) / 10_000)),
    maxBet ?? MAX_GAME_STAKE_CENTS // base stake ceiling — leverage can't stretch it
  );
  const clampBet = (v: string) => {
    const n = parseFloat(v);
    // Nothing above the cap enters state — the input can't hold a stake the
    // server would reject.
    if (Number.isFinite(n) && n * 100 > maxCents) return String(Math.max(0, Math.floor(maxCents / 100)));
    return v;
  };
  return (
    <div className="space-y-2">
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-mute font-semibold text-sm">Ɱ</span>
        <input
          type="number"
          min="0"
          max={Math.floor(maxCents / 100)}
          step="1"
          value={bet}
          disabled={disabled || maxCents <= 0}
          onChange={(e) => setBet(clampBet(e.target.value))}
          placeholder="0"
          className="num h-10 w-full rounded-lg border border-line bg-surface pl-8 pr-9 text-[14px] font-semibold text-ink placeholder:text-faint focus:outline-2 focus:outline-brand disabled:opacity-50"
        />
        {bet !== "" && !disabled && (
          <button
            type="button"
            onClick={() => setBet("")}
            title={t.clearInput}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 size-5 grid place-items-center rounded-full bg-surface-3 text-mute hover:text-ink hover:bg-line cursor-pointer"
          >
            <X className="size-3" />
          </button>
        )}
      </div>
      <div className="flex gap-1.5">
        {[10, 50, 100].map((v) => (
          <button
            key={v}
            disabled={disabled}
            onClick={() => setBet(clampBet(String((parseFloat(bet || "0") + v).toFixed(0))))}
            className="flex-1 h-6.5 rounded-md bg-surface-2 text-[11.5px] font-semibold text-mute hover:bg-surface-3 hover:text-ink cursor-pointer disabled:opacity-50"
          >
            +{v}
          </button>
        ))}
        <button
          disabled={disabled}
          onClick={() => setBet(String(Math.max(0, Math.floor(maxCents / 100))))}
          className="flex-1 h-6.5 rounded-md bg-surface-2 text-[11.5px] font-semibold text-mute hover:bg-surface-3 hover:text-ink cursor-pointer disabled:opacity-50"
        >
          {t.max}
        </button>
      </div>
      <div>
        <div className="flex items-center justify-between text-[12px] font-medium text-mute mb-1">
          <span>{t.leverage}</span>
          <span className="num">{t.atRisk} {fmtMonos(atRisk, { lang })}</span>
        </div>
        <Segmented
          options={levers.map((v) => ({ value: String(v), label: `${v}×` }))}
          value={lev}
          onChange={setLev}
          disabled={locked}
        />
        {levN > 1 && !locked && (
          <p className="mt-1.5 text-[11.5px] text-faint">
            {t.levFeeNote(fmtMonos(fee, { lang }))} · {t.levDebtNote(fmtMonos(borrowed, { lang }))}
          </p>
        )}
        {winPreview && betCents > 0 && (
          <p className="mt-1.5 text-[11.5px] font-medium text-yes-strong">
            {(winPreview.max ? t.winUpTo : t.winPays)(
              fmtMonos(levWinCents(betCents, levN, winPreview.mult), { lang })
            )}
          </p>
        )}
        {locked && <p className="mt-1.5 text-[11.5px] font-medium text-no-strong">{t.levLocked}</p>}
      </div>
    </div>
  );
}

// Autobet strip — queues repeated rounds of the card's own play routine.
// `onRound` must resolve with the round's netCents once the reveal lands
// (null = the round never fired, e.g. rejected bet). The loop stops on the
// round count, the stop-profit, the stop-loss, or a failed round — the
// daily cap and balance checks live server-side, so a thrown round just
// ends the run.
function AutoBar({
  onRound,
  disabled,
  lang,
  onRunning,
}: {
  onRound: () => Promise<number | null>;
  disabled?: boolean;
  lang?: Lang;
  onRunning?: (running: boolean) => void;
}) {
  const t = getT(lang ?? "cs");
  const [open, setOpen] = useState(false);
  const [rounds, setRounds] = useState("10");
  const [stopWin, setStopWin] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [prog, setProg] = useState<{ done: number; total: number; pl: number } | null>(null);
  const stopRef = useRef(false);
  const running = prog !== null;

  const start = async () => {
    const total = Math.min(100, Math.max(1, Math.round(parseFloat(rounds || "0") || 0)));
    const sp = stopWin.trim() ? Math.round(parseFloat(stopWin) * 100) : null;
    const sl = stopLoss.trim() ? Math.round(parseFloat(stopLoss) * 100) : null;
    stopRef.current = false;
    setOpen(false);
    let pl = 0;
    let done = 0;
    setProg({ done: 0, total, pl: 0 });
    onRunning?.(true);
    while (done < total && !stopRef.current) {
      const net = await onRound();
      if (net === null) break;
      done++;
      pl += net;
      setProg({ done, total, pl });
      if (sp != null && pl >= sp) break;
      if (sl != null && pl <= -sl) break;
      // Let the reveal breathe before the next stake flies.
      if (!stopRef.current) await new Promise((r) => setTimeout(r, 350));
    }
    setProg(null);
    onRunning?.(false);
    toast[pl >= 0 ? "success" : "error"](t.autoDone(done, `${pl >= 0 ? "+" : "−"}${fmtMonos(Math.abs(pl), { lang })}`));
  };

  return (
    <div className="rounded-xl border border-line bg-surface-2/60 px-3 py-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => !running && setOpen((o) => !o)}
          className="inline-flex items-center gap-1.5 text-[12px] font-bold text-mute hover:text-ink transition-colors cursor-pointer disabled:opacity-50"
          disabled={running}
        >
          <Zap className="size-3.5" />
          {t.autoTitle}
        </button>
        {prog && (
          <span className={cn("num text-[11.5px] font-semibold", prog.pl >= 0 ? "text-yes-strong" : "text-no-strong")}>
            {prog.done}/{prog.total} · {prog.pl >= 0 ? "+" : "−"}{fmtMonos(Math.abs(prog.pl), { lang })}
          </span>
        )}
        <span className="flex-1" />
        {running ? (
          <Button size="sm" variant="no" onClick={() => { stopRef.current = true; }}>
            {t.stop}
          </Button>
        ) : (
          <Button size="sm" variant="ghost" disabled={disabled} onClick={start}>
            {t.autoStart}
          </Button>
        )}
      </div>
      {open && !running && (
        <div className="grid grid-cols-3 gap-1.5 pt-2">
          <label className="space-y-0.5">
            <span className="block text-[10.5px] font-medium text-mute">{t.autoRounds}</span>
            <input type="number" min={1} max={100} step="1" value={rounds} onChange={(e) => setRounds(e.target.value)} className="num h-7.5 w-full rounded-md border border-line bg-surface px-2 text-[12px] font-semibold text-ink focus:outline-2 focus:outline-brand" />
          </label>
          <label className="space-y-0.5">
            <span className="block text-[10.5px] font-medium text-mute">{t.autoStopWin}</span>
            <input type="number" min={0} step="10" value={stopWin} placeholder="—" onChange={(e) => setStopWin(e.target.value)} className="num h-7.5 w-full rounded-md border border-line bg-surface px-2 text-[12px] font-semibold text-ink placeholder:text-faint focus:outline-2 focus:outline-brand" />
          </label>
          <label className="space-y-0.5">
            <span className="block text-[10.5px] font-medium text-mute">{t.autoStopLoss}</span>
            <input type="number" min={0} step="10" value={stopLoss} placeholder="—" onChange={(e) => setStopLoss(e.target.value)} className="num h-7.5 w-full rounded-md border border-line bg-surface px-2 text-[12px] font-semibold text-ink placeholder:text-faint focus:outline-2 focus:outline-brand" />
          </label>
        </div>
      )}
    </div>
  );
}

function GameCard({
  icon,
  title,
  sub,
  stage,
  controls,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  sub: string;
  stage: React.ReactNode;
  controls: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("p-5 flex flex-col gap-4", className)}>
      <div className="flex items-center gap-2.5">
        <span className="size-9 rounded-xl bg-brand-soft text-brand-strong grid place-items-center shrink-0">{icon}</span>
        <div className="min-w-0">
          <div className="text-[15px] font-bold tracking-tight leading-tight">{title}</div>
          <div className="text-[11.5px] text-faint leading-tight mt-0.5">{sub}</div>
        </div>
      </div>
      <div className="grid place-items-center min-h-[120px] rounded-xl bg-surface-2/60 border border-line-2 py-4">
        {stage}
      </div>
      {controls}
    </Card>
  );
}

// ---------- coin flip ----------

type GameProps = { balanceCents: number; lang?: Lang; dealerId?: string; inDebt?: boolean; demo?: boolean; onWinFx?: (amt: number, fx: WinFx, tavCents?: number) => void; levCap?: number; feeBps?: number; maxBet?: number; autobet?: boolean };

function CoinFlipCard({ balanceCents, lang, dealerId, inDebt, demo, onWinFx, levCap, feeBps, maxBet, autobet }: GameProps) {
  const t = getT(lang ?? "cs");
  const { pending, run } = useGame(lang);
  const [pick, setPick] = useState<"heads" | "tails">("heads");
  const [bet, setBet] = useState("10");
  const [lev, setLev] = useState("1");
  const [rot, setRot] = useState(0);
  const [net, setNet] = useState<Net>(null);
  const [spinning, setSpinning] = useState(false);
  const [autoRun, setAutoRun] = useState(false);
  const [dealer, setDealer] = useState<Persona | null>(null);

  // Resolves the round's net once the coin lands — autobet chains on it.
  const flip = (): Promise<number | null> => {
    const bc = Math.round(parseFloat(bet || "0") * 100);
    const levN = Number(lockedLev(lev, inDebt));
    return run(() => {
      if (!demo) return playCoinFlip({ dealerId, betCents: bc, leverage: levN, pick });
      const win = demoHit();
      const landed = win ? pick : pick === "heads" ? "tails" : "heads";
      const fake: Awaited<ReturnType<typeof playCoinFlip>> = { ...demoBase, ok: true, landed, netCents: demoNet(bc * levN, win, COINFLIP_MULT) };
      return demoDelay(fake);
    }).then(
      (r) => {
        if (!r || !r.landed) return null;
        playSfx("flip", 0.5);
        setNet(null);
        setDealer(r.dealer ?? null);
        setSpinning(true);
        // Land heads on a full rotation, tails on a half — always ≥5 turns.
        setRot((prev) => Math.ceil((prev + 1) / 360) * 360 + 4 * 360 + (r.landed === "tails" ? 180 : 0));
        return new Promise<number>((resolve) =>
          setTimeout(() => {
            setSpinning(false);
            setNet({ stamp: Date.now(), netCents: r.netCents ?? 0, won: (r.netCents ?? 0) > 0, feeCents: r.feeCents, stakeCents: bc, skimCents: r.skimCents, demo });
            dealerWinFx(r.dealer, (r.netCents ?? 0) > 0, (r.netCents ?? 0) + bc + (r.feeCents ?? 0) + (r.skimCents ?? 0), onWinFx, r.tavCents);
            resolve(r.netCents ?? 0);
          }, 1150)
        );
      }
    );
  };

  return (
    <GameCard
      icon={<Coins className="size-4.5" />}
      title={t.gCoinFlip}
      sub={t.gCoinFlipSub}
      stage={
        <div className="flex flex-col items-center gap-3" style={{ perspective: 500 }}>
          <div
            className="relative size-[76px]"
            style={{
              transform: `rotateX(${rot}deg)`,
              transformStyle: "preserve-3d",
              transition: "transform 1.1s cubic-bezier(0.2, 0.7, 0.25, 1)",
            }}
          >
            <div
              className="absolute inset-0 rounded-full grid place-items-center text-[26px] font-black bg-brand text-brand-on shadow-[0_3px_10px_rgba(15,157,88,0.35)]"
              style={{ backfaceVisibility: "hidden" }}
            >
              Ɱ
            </div>
            <div
              className="absolute inset-0 rounded-full grid place-items-center text-[26px] font-black bg-ink text-surface"
              style={{ backfaceVisibility: "hidden", transform: "rotateX(180deg)" }}
            >
              ✕
            </div>
          </div>
          <ResultTag net={spinning ? null : net} lang={lang} />
          <DealerTag dealer={dealer} won={spinning ? null : net?.won} />
        </div>
      }
      controls={
        <>
          <Segmented
            options={[
              { value: "heads", label: t.heads },
              { value: "tails", label: t.tails },
            ]}
            value={pick}
            onChange={(v) => setPick(v)}
          />
          <BetControls bet={bet} setBet={setBet} lev={lockedLev(lev, inDebt)} setLev={setLev} balanceCents={balanceCents} locked={inDebt} levCap={levCap} feeBps={feeBps} maxBet={maxBet} disabled={pending || spinning || autoRun} lang={lang} winPreview={{ mult: COINFLIP_MULT }} />
          <Button className="w-full" size="lg" disabled={pending || spinning || autoRun || !parseFloat(bet)} onClick={flip}>
            {spinning ? t.flipping : t.flip}
          </Button>
          {autobet && !demo && <AutoBar onRound={flip} disabled={pending || spinning || autoRun || !parseFloat(bet)} onRunning={setAutoRun} lang={lang} />}
        </>
      }
    />
  );
}

// ---------- dice ----------

const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function DiceFace({ value, rolling }: { value: number; rolling: boolean }) {
  return (
    <div className={cn("size-[72px] rounded-2xl bg-ink grid grid-cols-3 gap-1.5 p-3 shadow-[0_3px_10px_rgba(0,0,0,0.18)]", rolling && "anim-dice-shake")}>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={cn("rounded-full transition-colors", PIPS[value].includes(i) ? "bg-surface" : "bg-transparent")} />
      ))}
    </div>
  );
}

function DiceCard({ balanceCents, lang, dealerId, inDebt, demo, onWinFx, levCap, feeBps, maxBet, autobet }: GameProps) {
  const t = getT(lang ?? "cs");
  const { pending, run } = useGame(lang);
  const [over, setOver] = useState(3);
  const [bet, setBet] = useState("10");
  const [lev, setLev] = useState("1");
  const [face, setFace] = useState(6);
  const [rolling, setRolling] = useState(false);
  const [autoRun, setAutoRun] = useState(false);
  const [net, setNet] = useState<Net>(null);
  const [dealer, setDealer] = useState<Persona | null>(null);

  const roll = (): Promise<number | null> => {
    const bc = Math.round(parseFloat(bet || "0") * 100);
    setRolling(true);
    setNet(null);
    setDealer(null);
    playSfx("roll", 0.45);
    const cyc = setInterval(() => setFace(1 + Math.floor(Math.random() * 6)), 70);
    const levN = Number(lockedLev(lev, inDebt));
    return run(() => {
      if (!demo) return playDice({ dealerId, betCents: bc, leverage: levN, over });
      // Winning roll lands in over+1..6, a losing one in 1..over.
      const win = demoHit();
      const roll = win ? over + 1 + ri(6 - over) : 1 + ri(over);
      const fake: Awaited<ReturnType<typeof playDice>> = { ...demoBase, ok: true, roll, netCents: demoNet(bc * levN, win, diceMult(over)) };
      return demoDelay(fake);
    }).then((r) => {
      if (r?.dealer) setDealer(r.dealer);
      return new Promise<number | null>((resolve) =>
        setTimeout(() => {
          clearInterval(cyc);
          setRolling(false);
          if (!r?.roll) return resolve(null);
          setFace(r.roll);
          setNet({ stamp: Date.now(), netCents: r.netCents ?? 0, won: (r.netCents ?? 0) > 0, feeCents: r.feeCents, stakeCents: bc, skimCents: r.skimCents, demo });
          dealerWinFx(r.dealer, (r.netCents ?? 0) > 0, (r.netCents ?? 0) + bc + (r.feeCents ?? 0) + (r.skimCents ?? 0), onWinFx, r.tavCents);
          resolve(r.netCents ?? 0);
        }, 650)
      );
    });
  };

  return (
    <GameCard
      icon={<Dices className="size-4.5" />}
      title={t.gDice}
      sub={t.gDiceSub}
      stage={
        <div className="flex flex-col items-center gap-3">
          <DiceFace value={face} rolling={rolling} />
          <ResultTag net={rolling ? null : net} lang={lang} />
          <DealerTag dealer={dealer} won={rolling ? null : net?.won} />
        </div>
      }
      controls={
        <>
          <div>
            <div className="flex items-center justify-between text-[12px] font-medium text-mute mb-1">
              <span>{t.rollOver(over)}</span>
              <span className="num">
                {Math.round(diceWinChance(over) * 100)}% · {diceMult(over).toFixed(2)}×
              </span>
            </div>
            <input
              type="range"
              min={2}
              max={5}
              step={1}
              value={over}
              onChange={(e) => setOver(Number(e.target.value))}
              className="w-full accent-brand cursor-pointer"
            />
          </div>
          <BetControls bet={bet} setBet={setBet} lev={lockedLev(lev, inDebt)} setLev={setLev} balanceCents={balanceCents} locked={inDebt} levCap={levCap} feeBps={feeBps} maxBet={maxBet} disabled={pending || rolling || autoRun} lang={lang} winPreview={{ mult: diceMult(over) }} />
          <Button className="w-full" size="lg" disabled={pending || rolling || autoRun || !parseFloat(bet)} onClick={roll}>
            {rolling ? t.rolling : t.roll}
          </Button>
          {autobet && !demo && <AutoBar onRound={roll} disabled={pending || rolling || autoRun || !parseFloat(bet)} onRunning={setAutoRun} lang={lang} />}
        </>
      }
    />
  );
}

// ---------- stop the timer ----------

// Ticking digit readout — isolated in its own leaf so each frame only
// re-renders these two lines instead of the whole card. Runs on rAF.
function TimerDigits({ phase, clockRef, frozen, targetMs, lang }: {
  phase: "idle" | "running" | "done";
  clockRef: { current: number };
  frozen: number;
  targetMs: number;
  lang: Lang;
}) {
  const t = getT(lang);
  const [disp, setDisp] = useState(0);
  const hidden = phase === "running" && disp > timerRevealMs(targetMs);

  useEffect(() => {
    if (phase !== "running") return;
    let raf = 0;
    const tick = () => {
      setDisp(performance.now() - clockRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, clockRef]);

  // Audible cue the moment the digits hide.
  const wasHidden = useRef(false);
  useEffect(() => {
    if (hidden && !wasHidden.current) playSfx("trade", 0.25);
    wasHidden.current = hidden;
  }, [hidden]);

  const shown = phase === "done" ? frozen : disp;
  const err = phase === "done" ? Math.abs(frozen - targetMs) : null;
  return (
    <>
      <div
        className={cn(
          "num text-[44px] font-black tracking-tight leading-none tabular-nums",
          hidden && "anim-shimmer text-faint"
        )}
      >
        {hidden ? "?.??" : (shown / 1000).toFixed(2)}
        <span className="text-[18px] font-bold text-mute">s</span>
      </div>
      <div className="text-[12px] text-faint">
        {phase === "running" ? (hidden ? t.guessNow : t.memorize) : phase === "done" && err !== null ? t.offBy(err) : t.targetIs(`${(targetMs / 1000).toFixed(2)}s`)}
      </div>
    </>
  );
}

function TimerCard({ balanceCents, lang, dealerId, inDebt, onWinFx, levCap, feeBps, maxBet, autobet }: GameProps) {
  const t = getT(lang ?? "cs");
  const { pending, run } = useGame(lang);
  const [target, setTarget] = useState(String(TIMER_TARGETS[0] / 1000));
  const [bet, setBet] = useState("10");
  const [lev, setLev] = useState("1");
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [frozen, setFrozen] = useState(0);
  const [round, setRound] = useState(0); // mounts a fresh TimerDigits per round — no stale digits
  const [net, setNet] = useState<Net>(null);
  const [autoRun, setAutoRun] = useState(false);
  const [dealer, setDealer] = useState<Persona | null>(null);
  // Server-graded readout shown after settle: elapsed, miss distance, and the
  // jittered target the round was actually graded against — the checker.
  const [miss, setMiss] = useState<{ elapsed: number; err: number; graded: number } | null>(null);
  const tokenRef = useRef<Promise<string | null> | null>(null);
  const t0 = useRef(0);
  const phaseRef = useRef<"idle" | "running" | "done">("idle");
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  const targetMs = Number(target) * 1000;

  const start = () => {
    // Start the clock immediately — the signed round token arrives in the
    // background and is only needed when the player stops.
    setNet(null);
    setDealer(null);
    setMiss(null);
    t0.current = performance.now();
    setRound((r) => r + 1);
    setPhase("running");
    const bc = Math.round(parseFloat(bet || "0") * 100);
    tokenRef.current = run(() =>
      startTimerRound({ targetMs: Number(target) * 1000, betCents: bc, leverage: Number(lockedLev(lev, inDebt)) })
    ).then((r) => r?.token ?? null);
    tokenRef.current.then((token) => {
      if (!token) setPhase((p) => (p === "running" ? "idle" : p));
    });
  };

  // The stop body without the phase guard — autobet calls this on a timer,
  // where the closure's `phase` state is stale.
  const stopNow = (resolve?: (net: number | null) => void) => {
    const p = tokenRef.current;
    if (!p) {
      resolve?.(null);
      return;
    }
    const mine = Math.round(performance.now() - t0.current);
    const bc = Math.round(parseFloat(bet || "0") * 100);
    // Freeze the player's own measurement instantly — the server grades its
    // own reading and reports money, but the displayed stop never jumps.
    setFrozen(mine);
    setPhase("done");
    p.then((token) => {
      if (!token) return null;
      return run(() => stopTimerRound({ dealerId, token, elapsedMs: mine }));
    }).then((r) => {
      if (!r) {
        resolve?.(null);
        return;
      }
      setDealer(r.dealer ?? null);
      if (r.errMs !== undefined) setMiss({ elapsed: r.elapsedMs ?? mine, err: r.errMs, graded: r.gradedMs ?? targetMs });
      setNet({ stamp: Date.now(), netCents: r.netCents ?? 0, won: (r.netCents ?? 0) > 0, feeCents: r.feeCents, stakeCents: bc, skimCents: r.skimCents });
      dealerWinFx(r.dealer, (r.netCents ?? 0) > 0, (r.netCents ?? 0) + bc + (r.feeCents ?? 0) + (r.skimCents ?? 0), onWinFx, r.tavCents);
      resolve?.(r.netCents ?? 0);
    });
  };

  const stop = () => {
    if (phase !== "running") return;
    stopNow();
  };

  // Autobet round: start the clock, press at the nominal target. The server
  // still grades against its jittered target — a machine-perfect press wins
  // only what a machine-perfect human press would.
  const autoRound = (): Promise<number | null> => {
    // "done" is a valid re-entry — start() resets the round state.
    if (phaseRef.current === "running") return Promise.resolve(null);
    return new Promise((resolve) => {
      start();
      setTimeout(() => stopNow(resolve), Math.max(400, targetMs));
    });
  };

  return (
    <GameCard
      icon={<Timer className="size-4.5" />}
      title={t.gTimer}
      sub={t.gTimerSub}
      stage={
        <div className="flex flex-col items-center gap-2">
          <TimerDigits key={round} phase={phase} clockRef={t0} frozen={frozen} targetMs={targetMs} lang={lang ?? "cs"} />
          {phase === "done" && miss && (
            <div className="num text-[11.5px] text-mute">
              {(miss.elapsed / 1000).toFixed(2)}s · {t.offBy(miss.err)}
              <span className="text-faint"> · {t.timerGradedVs((miss.graded / 1000).toFixed(2))}</span>
            </div>
          )}
          <ResultTag net={phase === "done" ? net : null} lang={lang} />
          <DealerTag dealer={dealer} won={phase === "done" ? net?.won : null} />
        </div>
      }
      controls={
        <>
          <div>
            <Segmented
              options={TIMER_TARGETS.map((ms) => ({ value: String(ms / 1000), label: `${ms / 1000}s` }))}
              value={target}
              onChange={setTarget}
              disabled={phase === "running"}
            />
            {/* Payout table — stop error vs multiplier, per target. The
                selected target's column is lit; the last row is the miss. */}
            <div className="mt-2 rounded-lg border border-line overflow-hidden">
              <table className="w-full text-[10.5px] num text-center">
                <thead>
                  <tr className="bg-surface-2 text-faint">
                    <th className="px-2 py-1 text-left font-semibold">{t.timerColErr}</th>
                    {TIMER_TARGETS.map((ms) => (
                      <th key={ms} className={cn("px-2 py-1 font-semibold", ms === targetMs && "text-brand-strong")}>
                        {ms / 1000}s
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="text-mute">
                  {TIMER_TIERS.map((tier) => (
                    <tr key={tier.errMs} className="border-t border-line/60">
                      <td className="px-2 py-1 text-left">±{tier.errMs}ms</td>
                      {TIMER_TARGETS.map((ms) => (
                        <td key={ms} className={cn("px-2 py-1", ms === targetMs && "text-ink font-semibold")}>
                          ×{timerMult(tier.errMs, ms).toFixed(2)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr className="border-t border-line/60 text-no-strong">
                    <td className="px-2 py-1 text-left">{t.timerMiss}</td>
                    <td colSpan={TIMER_TARGETS.length} className="px-2 py-1">×0</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <BetControls bet={bet} setBet={setBet} lev={lockedLev(lev, inDebt)} setLev={setLev} balanceCents={balanceCents} locked={inDebt} levCap={levCap} feeBps={feeBps} maxBet={maxBet} disabled={pending || autoRun || phase === "running"} lang={lang} winPreview={{ mult: timerTopMult(targetMs), max: true }} />
          {phase === "running" ? (
            // Stop is never gated on `pending` — while the start request is
            // still in flight the stop queues on the token promise instead
            // of going dead. The click flips the phase and unmounts the
            // button, so it cannot fire twice.
            <Button className="w-full" size="lg" variant="no" onClick={stop}>
              {t.stop}
            </Button>
          ) : (
            <Button className="w-full" size="lg" disabled={pending || autoRun || !parseFloat(bet)} onClick={start}>
              {t.start}
            </Button>
          )}
          {/* AutoBar stays mounted while a round runs — its loop state lives
              inside; unmounting mid-round would strand the queue. */}
          {autobet && <AutoBar onRound={autoRound} disabled={pending || autoRun || phase !== "idle" || !parseFloat(bet)} onRunning={setAutoRun} lang={lang} />}
        </>
      }
    />
  );
}

// ---------- limbo ----------

function LimboCard({ balanceCents, lang, dealerId, inDebt, demo, onWinFx, levCap, feeBps, maxBet, autobet }: GameProps) {
  const t = getT(lang ?? "cs");
  const { pending, run } = useGame(lang);
  const [target, setTarget] = useState(2);
  const [bet, setBet] = useState("10");
  const [lev, setLev] = useState("1");
  const [shown, setShown] = useState(1);
  const [busy, setBusy] = useState(false);
  const [autoRun, setAutoRun] = useState(false);
  const [wonLast, setWonLast] = useState<boolean | null>(null);
  const [net, setNet] = useState<Net>(null);
  const [dealer, setDealer] = useState<Persona | null>(null);
  const raf = useRef(0);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const play = (): Promise<number | null> => {
    const bc = Math.round(parseFloat(bet || "0") * 100);
    const levN = Number(lockedLev(lev, inDebt));
    return run(() => {
      if (!demo) return playLimbo({ dealerId, betCents: bc, leverage: levN, target });
      // Wins crash above the target (sometimes way above), losses under it.
      const roll = demoHit() ? target * (1 + Math.random() * 1.5) : 1 + Math.random() * (target - 1);
      const won = roll >= target;
      const fake: Awaited<ReturnType<typeof playLimbo>> = { ...demoBase, ok: true, roll, won, netCents: demoNet(bc * levN, won, target * LIMBO_PAYOUT) };
      return demoDelay(fake);
    }).then(
      (r) => {
        if (r?.roll == null) return null;
        const roll = r.roll;
        playSfx("launch", 0.4);
        setBusy(true);
        setNet(null);
        setDealer(r.dealer ?? null);
        setWonLast(null);
        return new Promise<number>((resolve) => {
          const start = performance.now();
          const dur = Math.min(1400, 500 + Math.log2(roll) * 140);
          const step = () => {
            const p = Math.min(1, (performance.now() - start) / dur);
            setShown(1 + (roll - 1) * (1 - Math.pow(1 - p, 3)));
            if (p < 1) raf.current = requestAnimationFrame(step);
            else {
              setBusy(false);
              setWonLast(!!r.won);
              setNet({ stamp: Date.now(), netCents: r.netCents ?? 0, won: (r.netCents ?? 0) > 0, feeCents: r.feeCents, stakeCents: bc, skimCents: r.skimCents });
              dealerWinFx(r.dealer, (r.netCents ?? 0) > 0, (r.netCents ?? 0) + bc + (r.feeCents ?? 0) + (r.skimCents ?? 0), onWinFx, r.tavCents);
              resolve(r.netCents ?? 0);
            }
          };
          raf.current = requestAnimationFrame(step);
        });
      }
    );
  };

  // Bar scale: log from 1 to 50 — where most rounds land.
  const barPct = Math.min(100, (Math.log(shown) / Math.log(50)) * 100);
  const targetPct = (Math.log(target) / Math.log(50)) * 100;

  return (
    <GameCard
      icon={<Rocket className="size-4.5" />}
      title={t.gLimbo}
      sub={t.gLimboSub}
      stage={
        <div className="w-full flex flex-col items-center gap-3 px-2">
          <div
            className={cn(
              "num text-[40px] font-black leading-none tabular-nums",
              wonLast === true && "text-yes-strong",
              wonLast === false && "text-no-strong"
            )}
          >
            {shown.toFixed(2)}×
          </div>
          <div className="relative w-full h-3.5 rounded-full bg-surface-3 overflow-hidden">
            <div
              className={cn(
                "absolute inset-y-0 left-0 rounded-full transition-none",
                wonLast === false ? "bg-no" : "bg-brand"
              )}
              style={{ width: `${Math.max(4, barPct)}%` }}
            />
            <div
              className="absolute inset-y-0 w-0.5 bg-ink"
              style={{ left: `${targetPct}%` }}
            />
          </div>
          <ResultTag net={busy ? null : net} lang={lang} />
          <DealerTag dealer={dealer} won={busy ? null : net?.won} />
        </div>
      }
      controls={
        <>
          <div>
            <div className="flex items-center justify-between text-[12px] font-medium text-mute mb-1">
              <span>{t.targetX(target.toFixed(2))}</span>
              <span className="num">
                {(limboWinChance(target) * 100).toFixed(1)}% · {(target * LIMBO_PAYOUT).toFixed(2)}×
              </span>
            </div>
            <input
              type="range"
              min={LIMBO_MIN}
              max={LIMBO_MAX}
              step={0.05}
              value={target}
              onChange={(e) => setTarget(Number(e.target.value))}
              className="w-full accent-brand cursor-pointer"
            />
          </div>
          <BetControls bet={bet} setBet={setBet} lev={lockedLev(lev, inDebt)} setLev={setLev} balanceCents={balanceCents} locked={inDebt} levCap={levCap} feeBps={feeBps} maxBet={maxBet} disabled={pending || busy || autoRun} lang={lang} winPreview={{ mult: target * LIMBO_PAYOUT }} />
          <Button className="w-full" size="lg" disabled={pending || busy || autoRun || !parseFloat(bet)} onClick={play}>
            {busy ? t.launching : t.launch}
          </Button>
          {autobet && !demo && <AutoBar onRound={play} disabled={pending || busy || autoRun || !parseFloat(bet)} onRunning={setAutoRun} lang={lang} />}
        </>
      }
    />
  );
}

// ---------- wheel ----------

// Wedge color by payout tier — dead wedges stay muted, the 5× jackpot glows.
function wheelColor(m: number, i: number) {
  if (m <= 0) return "var(--color-surface-3)";
  if (m >= 5) return "#f59e0b";
  if (m >= 2) return "var(--color-yes)";
  return i % 2 ? "var(--color-brand-strong)" : "var(--color-brand)";
}

function WheelCard({ balanceCents, lang, dealerId, inDebt, demo, onWinFx, levCap, feeBps, maxBet, autobet }: GameProps) {
  const t = getT(lang ?? "cs");
  const { pending, run } = useGame(lang);
  const [bet, setBet] = useState("10");
  const [lev, setLev] = useState("1");
  const [rot, setRot] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [autoRun, setAutoRun] = useState(false);
  const [landed, setLanded] = useState<number | null>(null);
  const [net, setNet] = useState<Net>(null);
  const [dealer, setDealer] = useState<Persona | null>(null);

  const spin = (): Promise<number | null> => {
    const bc = Math.round(parseFloat(bet || "0") * 100);
    const levN = Number(lockedLev(lev, inDebt));
    return run(() => {
      if (!demo) return playWheel({ dealerId, betCents: bc, leverage: levN });
      // Winning wedges (≥1×) hit often; losses include the partial-return
      // wedges so the reveal stays honest-looking.
      const index = demoHit() ? [1, 10, 4, 8, 1, 10][ri(6)] : [0, 3, 5, 7, 9, 2, 6, 11][ri(8)];
      const mult = WHEEL_SEGMENTS[index];
      const fake: Awaited<ReturnType<typeof playWheel>> = { ...demoBase, ok: true, index, mult, netCents: Math.round(bc * levN * (mult - 1)) };
      return demoDelay(fake);
    }).then((r) => {
      if (r?.index == null) return null;
      playSfx("spin", 0.5);
      setNet(null);
      setDealer(r.dealer ?? null);
      setLanded(null);
      setSpinning(true);
      // Land segment `index` under the top pointer, plus ~6 full turns.
      const want = 360 - (r.index * WHEEL_STEP + WHEEL_STEP / 2);
      setRot((prev) => prev + 6 * 360 + (((want - (prev % 360)) % 360) + 360) % 360);
      return new Promise<number>((resolve) =>
        setTimeout(() => {
          setSpinning(false);
          setLanded(r.mult ?? null);
          // 0.5×/0.6×/0.8× segments return part of the stake — still a loss.
          setNet({ stamp: Date.now(), netCents: r.netCents ?? 0, won: (r.netCents ?? 0) > 0, feeCents: r.feeCents, stakeCents: bc, skimCents: r.skimCents, demo });
          dealerWinFx(r.dealer, (r.netCents ?? 0) > 0, (r.netCents ?? 0) + bc + (r.feeCents ?? 0) + (r.skimCents ?? 0), onWinFx, r.tavCents);
          resolve(r.netCents ?? 0);
        }, 3250)
      );
    });
  };

  const segs = WHEEL_SEGMENTS.map((m, i) => `${wheelColor(m, i)} ${i * WHEEL_STEP}deg ${(i + 1) * WHEEL_STEP}deg`).join(", ");

  return (
    <GameCard
      icon={<Disc3 className="size-4.5" />}
      title={t.gWheel}
      sub={t.gWheelSub}
      stage={
        <div className="relative flex flex-col items-center gap-3 pt-3">
          <div
            className="absolute top-0 z-20 size-0 border-x-[11px] border-t-[18px] border-x-transparent drop-shadow-sm"
            style={{ borderTopColor: "var(--color-ink)" }}
          />
          {/* static rim + rotating disc inside */}
          <div className="relative size-[196px] rounded-full bg-ink p-[7px] shadow-[0_8px_28px_rgba(0,0,0,0.22)] ring-1 ring-line-2">
            <div
              className="relative size-full rounded-full overflow-hidden"
              style={{
                background: `conic-gradient(${segs})`,
                transform: `rotate(${rot}deg)`,
                transition: "transform 3.2s cubic-bezier(0.12, 0.85, 0.15, 1)",
              }}
            >
              {WHEEL_SEGMENTS.map((_, i) => (
                <div key={`sep${i}`} className="absolute inset-0" style={{ transform: `rotate(${i * WHEEL_STEP}deg)` }}>
                  <div className="absolute left-1/2 top-0 h-1/2 w-px -translate-x-1/2 bg-white/25" />
                </div>
              ))}
              {WHEEL_SEGMENTS.map((m, i) => (
                <div key={i} className="absolute inset-0" style={{ transform: `rotate(${i * WHEEL_STEP + WHEEL_STEP / 2}deg)` }}>
                  <span
                    className="absolute left-1/2 top-2.5 -translate-x-1/2 text-[11px] font-black tracking-tight"
                    style={{ color: m > 0 ? "var(--color-yes-on)" : "var(--color-faint)" }}
                  >
                    {m > 0 ? `${m}×` : "—"}
                  </span>
                </div>
              ))}
              <div
                className="absolute inset-0 rounded-full pointer-events-none"
                style={{ background: "radial-gradient(circle at 35% 30%, rgba(255,255,255,0.22), transparent 55%)" }}
              />
            </div>
            <div className="absolute inset-0 m-auto z-10 size-11 rounded-full bg-surface border-[3px] border-line grid place-items-center text-[15px] font-black text-ink shadow-md">
              Ɱ
            </div>
          </div>
          <div className="min-h-5 flex items-center justify-center gap-2">
            {landed !== null && !spinning && (
              <span className="num text-[12px] font-bold text-mute anim-win-pop">{landed}×</span>
            )}
            <ResultTag net={spinning ? null : net} lang={lang} />
          </div>
          <DealerTag dealer={dealer} won={spinning ? null : net?.won} />
        </div>
      }
      controls={
        <>
          <BetControls bet={bet} setBet={setBet} lev={lockedLev(lev, inDebt)} setLev={setLev} balanceCents={balanceCents} locked={inDebt} levCap={levCap} feeBps={feeBps} maxBet={maxBet} disabled={pending || spinning || autoRun} lang={lang} winPreview={{ mult: Math.max(...WHEEL_SEGMENTS), max: true }} />
          <Button className="w-full" size="lg" disabled={pending || spinning || autoRun || !parseFloat(bet)} onClick={spin}>
            {spinning ? t.spinning : t.spin}
          </Button>
          {autobet && !demo && <AutoBar onRound={spin} disabled={pending || spinning || autoRun || !parseFloat(bet)} onRunning={setAutoRun} lang={lang} />}
        </>
      }
    />
  );
}

// ---------- slots ----------

const REEL_CELL = 64; // px — one symbol in view per window
const REEL_MS = [880, 1140, 1420]; // stop times, left to right
// Ɱ gold, 7 red, ★ amber, ◆ green, ♣ ink — classic machine palette.
const SLOT_TONE = ["text-brand-strong", "text-no-strong", "text-[#d9a521]", "text-yes-strong", "text-ink"];

type Strip = { cells: number[]; pos: number; anim: boolean };

// Strip = previous symbol, ~13 random cells, result last — the scroll reads
// like a real reel decelerating onto the drawn symbol.
function buildStrip(prevSym: number, final: number): number[] {
  const cells = [prevSym];
  for (let i = 0; i < 13; i++) cells.push(Math.floor(Math.random() * SLOT_SYMBOLS.length));
  cells.push(final);
  return cells;
}

function SlotsCard({ balanceCents, lang, dealerId, inDebt, demo, onWinFx, levCap, feeBps, maxBet, autobet }: GameProps) {
  const t = getT(lang ?? "cs");
  const { pending, run } = useGame(lang);
  const [bet, setBet] = useState("10");
  const [lev, setLev] = useState("1");
  // Each reel is a symbol strip in an overflow-hidden window — `pos` is the
  // cell index in view; a spin builds a fresh strip ending on the result and
  // the CSS transition scrolls it there.
  const [strips, setStrips] = useState<Strip[]>(() => [0, 1, 2].map((s) => ({ cells: [s], pos: 0, anim: false })));
  const [landed, setLanded] = useState(3); // reels stopped
  const [spinning, setSpinning] = useState(false);
  const [autoRun, setAutoRun] = useState(false);
  const [net, setNet] = useState<Net>(null);
  const [dealer, setDealer] = useState<Persona | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const spin = (): Promise<number | null> => {
    const bc = Math.round(parseFloat(bet || "0") * 100);
    const levN = Number(lockedLev(lev, inDebt));
    return run(() => {
      if (demo) {
        // Triples on the low-pay symbols, an occasional pair push, else a miss.
        const r0 = Math.random();
        let reels: number[];
        let mult: number;
        if (r0 < 0.5) {
          const s = [4, 3, 4, 2, 3, 4, 1, 0][ri(8)];
          reels = [s, s, s];
          mult = SLOT_TRIPLE[s];
        } else if (r0 < 0.62) {
          const s = ri(5);
          reels = [s, s, s === 0 ? 1 : s - 1];
          mult = 1;
        } else {
          const p = [0, 1, 2, 3, 4];
          reels = [p.splice(ri(p.length), 1)[0], p.splice(ri(p.length), 1)[0], p.splice(ri(p.length), 1)[0]];
          mult = 0;
        }
        const fake: Awaited<ReturnType<typeof playSlots>> = { ...demoBase, ok: true, reels, netCents: Math.round(bc * levN * (mult - 1)) };
        return demoDelay(fake);
      }
      return playSlots({ dealerId, betCents: bc, leverage: levN });
    }).then(
      (r) => {
        const drawn = r?.reels;
        if (!drawn) return null;
        timers.current.forEach(clearTimeout); // a mid-flight re-spin supersedes the old timers
        timers.current = [];
        playSfx("roll", 0.45);
        setNet(null);
        setDealer(r.dealer ?? null);
        setSpinning(true);
        setLanded(0);
        setStrips((prev) => prev.map((s, i) => ({ cells: buildStrip(s.cells[s.pos] ?? 0, drawn[i]), pos: 0, anim: false })));
        // Paint the strip top first, then scroll — two frames so the
        // transition is live before the transform changes.
        requestAnimationFrame(() =>
          requestAnimationFrame(() =>
            setStrips((prev) => prev.map((s) => ({ ...s, pos: s.cells.length - 1, anim: true })))
          )
        );
        drawn.forEach((_, i) =>
          timers.current.push(
            setTimeout(() => {
              playSfx("trade", 0.2);
              setLanded(i + 1);
            }, REEL_MS[i])
          )
        );
        return new Promise<number>((resolve) =>
          timers.current.push(
            setTimeout(() => {
              setSpinning(false);
              setNet({ stamp: Date.now(), netCents: r.netCents ?? 0, won: (r.netCents ?? 0) > 0, feeCents: r.feeCents, stakeCents: bc, skimCents: r.skimCents, demo });
              dealerWinFx(r.dealer, (r.netCents ?? 0) > 0, (r.netCents ?? 0) + bc + (r.feeCents ?? 0) + (r.skimCents ?? 0), onWinFx, r.tavCents);
              resolve(r.netCents ?? 0);
            }, REEL_MS[2] + 150)
          )
        );
      }
    );
  };

  const won = net?.won === true;
  const finals = strips.map((s) => s.cells[s.pos]);
  const counts = finals.reduce<Record<number, number>>((m, s) => ((m[s] = (m[s] ?? 0) + 1), m), {});
  const best = Math.max(...Object.values(counts));
  return (
    <GameCard
      icon={<Cherry className="size-4.5" />}
      title={t.gSlots}
      sub={t.gSlotsSub}
      stage={
        <div className="flex flex-col items-center gap-3">
          <div
            className={cn(
              "rounded-2xl border bg-surface-2 p-2.5 transition-shadow duration-300",
              won && best === 3 ? "border-brand/50 shadow-[0_0_28px_-4px_var(--color-brand)]" : "border-line-2 shadow-[inset_0_2px_10px_rgba(0,0,0,0.25)]"
            )}
          >
            <div className="flex gap-2">
              {strips.map((s, i) => (
                <div
                  key={i}
                  className={cn(
                    "relative h-16 w-16 overflow-hidden rounded-lg border",
                    !spinning && !pending && landed > i && finals[i] != null && counts[finals[i]] >= 2
                      ? won && best === 3
                        ? "border-brand/60 bg-brand-soft"
                        : "border-yes/50 bg-yes-soft"
                      : "border-line bg-surface"
                  )}
                >
                  <div
                    className="flex flex-col will-change-transform"
                    style={{
                      transform: `translateY(${-s.pos * REEL_CELL}px)`,
                      transition: s.anim ? `transform ${REEL_MS[i]}ms cubic-bezier(.18,.72,.28,1.06)` : "none",
                    }}
                  >
                    {s.cells.map((c, j) => (
                      <div key={j} className={cn("grid h-16 w-16 shrink-0 place-items-center text-[30px] font-black", SLOT_TONE[c])}>
                        {SLOT_SYMBOLS[c]}
                      </div>
                    ))}
                  </div>
                  {/* edge fades + payline sheen sell the reel-window depth */}
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-2.5 bg-gradient-to-b from-surface to-transparent" />
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2.5 bg-gradient-to-t from-surface to-transparent" />
                  <div className="pointer-events-none absolute inset-0 rounded-lg shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04),inset_0_-8px_12px_-8px_rgba(0,0,0,0.35),inset_0_8px_12px_-8px_rgba(0,0,0,0.35)]" />
                </div>
              ))}
            </div>
          </div>
          <div className="num text-[11px] font-semibold text-faint tabular-nums">
            {SLOT_SYMBOLS.map((s, i) => `${s}${s}${s} ${SLOT_TRIPLE[i]}×`).join(" · ")} · {t.slotPair}
          </div>
          <ResultTag net={spinning ? null : net} lang={lang} />
          <DealerTag dealer={dealer} won={spinning ? null : net?.won} />
        </div>
      }
      controls={
        <>
          <BetControls bet={bet} setBet={setBet} lev={lockedLev(lev, inDebt)} setLev={setLev} balanceCents={balanceCents} locked={inDebt} levCap={levCap} feeBps={feeBps} maxBet={maxBet} disabled={pending || spinning || autoRun} lang={lang} winPreview={{ mult: SLOT_TRIPLE[0], max: true }} />
          <Button className="w-full" size="lg" disabled={pending || autoRun || !parseFloat(bet)} onClick={spin}>
            {spinning ? t.spinning : t.spin}
          </Button>
          {autobet && !demo && <AutoBar onRound={spin} disabled={pending || spinning || autoRun || !parseFloat(bet)} onRunning={setAutoRun} lang={lang} />}
        </>
      }
    />
  );
}

// ---------- blackjack ----------
// Interactive hand against an automated dealer persona — the shoe lives
// server-side; the client only sends deal/hit/stand.

type BjSide = { stake: number; winCents: number; label: string | null };

type BjRound = {
  roundId: string;
  player: number[];
  dealer: number[];
  dealerHidden: boolean;
  playerTotal: number;
  dealerTotal: number | null;
  persona: { name: string; avatar: string; quipWin: string; quipLose: string };
  status: string;
  result?: string | null;
  netCents?: number | null;
  betCents?: number;
  feeCents?: number;
  skimCents?: number;
  tavCents?: number;
  sides?: Record<string, BjSide> | null;
  doubled?: boolean;
};

function PlayingCard({ v, hidden }: { v?: number; hidden?: boolean }) {
  if (hidden || v === undefined)
    return (
      <div className="w-10 h-14 rounded-md border border-line bg-ink p-1 shadow-sm">
        <div className="h-full w-full rounded-[3px] bg-[repeating-linear-gradient(45deg,rgba(255,255,255,0.14)_0px,rgba(255,255,255,0.14)_2px,transparent_2px,transparent_6px)]" />
      </div>
    );
  const c = cardLabel(v);
  return (
    <div
      className={cn(
        "w-10 h-14 rounded-md border border-line bg-surface grid grid-rows-[auto_1fr] px-1 pt-0.5 shadow-sm anim-win-pop",
        c.red ? "text-no-strong" : "text-ink"
      )}
    >
      <span className="num text-[12px] font-bold leading-none">{c.rank}</span>
      <span className="text-[15px] leading-none self-center justify-self-center">{c.suit}</span>
    </div>
  );
}

// Reveal queue — the server returns the whole hand state at once, but the
// table should feel like a table: cards land one at a time. `shown` tracks
// how much of `round` is on the felt; `steps` is the pending deal order.
type BjStep = "p" | "d" | "hole";
const BJ_REVEAL_MS = 460;

function BlackjackCard({ balanceCents, lang, dealerId, inDebt, onWinFx, levCap, feeBps, maxBet, autobet }: GameProps) {
  const t = getT(lang ?? "cs");
  const { pending, run } = useGame(lang);
  const [bet, setBet] = useState("10");
  const [lev, setLev] = useState("1");
  const [pp, setPp] = useState(false);
  const [ppAmt, setPpAmt] = useState("1");
  const [t3, setT3] = useState(false);
  const [t3Amt, setT3Amt] = useState("1");
  const [round, setRound] = useState<BjRound | null>(null);
  const [net, setNet] = useState<Net>(null);
  const [shown, setShown] = useState({ p: 0, d: 0, hole: false });
  const [steps, setSteps] = useState<BjStep[]>([]);
  const [autoRun, setAutoRun] = useState(false);
  const settledFor = useRef<string | null>(null);
  // Mirror of the reveal queue for the autobet loop — `steps` state is stale
  // inside an async iteration, the ref reads current.
  const stepsRef = useRef(0);
  useEffect(() => {
    stepsRef.current = steps.length;
  }, [steps.length]);
  const drain = () =>
    new Promise<void>((res) => {
      const chk = () => (stepsRef.current > 0 ? setTimeout(chk, 90) : res());
      chk();
    });

  // Deal order for a fresh hand: player, dealer up-card, player, then the
  // hole (face-down) — or the dealer's second card face-up if the hand is
  // already settled (e.g. a natural).
  const dealSteps = (s: { player: number[]; dealer: number[]; dealerHidden: boolean }): BjStep[] => {
    const st: BjStep[] = ["p", "d"];
    for (let i = 1; i < s.player.length; i++) st.push("p");
    if (s.dealerHidden) st.push("hole");
    else for (let i = 1; i < s.dealer.length; i++) st.push("d");
    return st;
  };
  // Everything the new state has that isn't on the felt yet — player first
  // (a hit/double), then the dealer's hole flip and draws in order.
  const catchupSteps = (s: { player: number[]; dealer: number[] }, cur: { p: number; d: number }): BjStep[] => [
    ...Array<BjStep>(Math.max(0, s.player.length - cur.p)).fill("p"),
    ...Array<BjStep>(Math.max(0, s.dealer.length - cur.d)).fill("d"),
  ];

  useEffect(() => {
    if (!steps.length) return;
    const id = setTimeout(() => {
      const [s, ...rest] = steps;
      playSfx("flip", 0.22);
      setShown((sh) => (s === "p" ? { ...sh, p: sh.p + 1 } : s === "d" ? { ...sh, d: sh.d + 1 } : { ...sh, hole: true }));
      setSteps(rest);
    }, BJ_REVEAL_MS);
    return () => clearTimeout(id);
  }, [steps]);

  const settle = (s?: BjRound) => {
    if (!s || s.status !== "settled") return;
    const won = s.result === "win" || s.result === "blackjack";
    playSfx(won ? "win" : "lose", 0.5);
    setNet({ stamp: Date.now(), netCents: s.netCents ?? 0, won, feeCents: s.feeCents, stakeCents: s.betCents, skimCents: s.skimCents });
    dealerWinFx(s.persona, won, (s.netCents ?? 0) + (s.betCents ?? 0) + (s.feeCents ?? 0) + (s.skimCents ?? 0), onWinFx, s.tavCents);
  };

  // The result lands only after the last card is on the felt.
  useEffect(() => {
    if (steps.length === 0 && round?.status === "settled" && settledFor.current !== round.roundId) {
      settledFor.current = round.roundId;
      settle(round);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- settle is stable enough for this purpose
  }, [steps, round]);

  const deal = () =>
    run(() => blackjackDeal({ dealerId, betCents: Math.round(parseFloat(bet || "0") * 100), leverage: Number(lockedLev(lev, inDebt)), sides: { pp: pp ? Math.round(parseFloat(ppAmt || "0") * 100) : 0, t3: t3 ? Math.round(parseFloat(t3Amt || "0") * 100) : 0 } })).then((r) => {
      if (!r?.state) return;
      setNet(null);
      setRound(r.state);
      setShown({ p: 0, d: 0, hole: false });
      setSteps(dealSteps(r.state));
    });

  const hit = () =>
    run(() => blackjackHit({ roundId: round!.roundId })).then((r) => {
      const s = r?.state;
      if (!s) return;
      setRound(s);
      setSteps((q) => [...q, ...catchupSteps(s, shown)]);
    });

  const stand = () =>
    run(() => blackjackStand({ roundId: round!.roundId })).then((r) => {
      const s = r?.state;
      if (!s) return;
      setRound(s);
      setSteps((q) => [...q, ...catchupSteps(s, shown)]);
    });

  const double = () =>
    run(() => blackjackDouble({ roundId: round!.roundId })).then((r) => {
      const s = r?.state;
      if (!s) return;
      setRound(s);
      setSteps((q) => [...q, ...catchupSteps(s, shown)]);
    });

  const surrender = () =>
    run(() => blackjackSurrender({ roundId: round!.roundId })).then((r) => {
      const s = r?.state;
      if (!s) return;
      setRound(s);
      setSteps((q) => [...q, ...catchupSteps(s, shown)]);
    });

  // Autobet hand: deal with no side bets, then house-basic play — hit while
  // under 17, stand at 17+. Moves queue onto the reveal queue by delta so a
  // fast auto round can't double-count cards still mid-flight.
  const autoRound = async (): Promise<number | null> => {
    const r = await run(() => blackjackDeal({ dealerId, betCents: Math.round(parseFloat(bet || "0") * 100), leverage: Number(lockedLev(lev, inDebt)), sides: { pp: 0, t3: 0 } }));
    if (!r?.state) return null;
    let s: BjRound = r.state;
    setNet(null);
    setRound(s);
    setShown({ p: 0, d: 0, hole: false });
    setSteps(dealSteps(s));
    let guard = 0;
    while (s.status === "playing" && guard++ < 24) {
      await drain();
      await new Promise((r2) => setTimeout(r2, 200));
      const prev = s;
      const rr = await run(() => (s.playerTotal < 17 ? blackjackHit({ roundId: s.roundId }) : blackjackStand({ roundId: s.roundId })));
      if (!rr?.state) return null;
      s = rr.state;
      setRound(s);
      setSteps((q) => [...q, ...catchupSteps(s, { p: prev.player.length, d: prev.dealer.length })]);
    }
    if (s.status !== "settled") return null;
    await drain(); // let the last card land before the net reports
    return s.netCents ?? 0;
  };

  const playing = round?.status === "playing";
  const busy = pending || steps.length > 0;
  const firstMove = playing && round!.player.length === 2 && !round!.doubled;
  const settledRound = round?.status === "settled" ? round : null;
  // Totals read once every card on that side has landed — keeps the count
  // from spoiling a card mid-flight.
  const playerDone = !round || shown.p >= round.player.length;
  const dealerDone = !round || (shown.d >= round.dealer.length && !round.dealerHidden);
  const resultLabel =
    settledRound?.result === "blackjack"
      ? t.bjNatural
      : settledRound?.result === "push"
        ? t.bjPush
        : settledRound?.result === "win"
          ? t.bjYouWin
          : settledRound?.result === "surrender"
            ? t.bjSurrendered
            : settledRound?.result === "lose"
              ? (round?.playerTotal ?? 0) > 21
                ? t.bjBust
                : t.bjDealerWins
              : null;
  const quip = settledRound
    ? settledRound.result === "lose" || settledRound.result === "surrender"
      ? settledRound.persona.quipWin
      : settledRound.persona.quipLose
    : null;

  return (
    <GameCard
      icon={<Spade className="size-4.5" />}
      title={t.gBlackjack}
      sub={round ? round.persona.name : t.gBlackjackSub}
      stage={
        <div className="w-full flex flex-col items-center gap-3 px-1">
          {/* dealer row */}
          <div className="w-full">
            <div className="flex items-center gap-2 mb-1.5">
              <DealerAvatar avatar={round?.persona.avatar ?? ""} className="size-6" />
              <span className="text-[12px] font-semibold text-mute">{round?.persona.name ?? t.gBlackjack}</span>
              {round?.dealerTotal != null && dealerDone && <span className="num ml-auto text-[12px] font-bold">{round.dealerTotal}</span>}
            </div>
            <div className="flex gap-1.5 flex-wrap min-h-14">
              {round
                ? round.dealer
                    .slice(0, shown.d)
                    .map((c, i) => <PlayingCard key={i} v={c} />)
                    .concat(shown.d < round.dealer.length || (round.dealerHidden && shown.hole) ? [<PlayingCard key="h" hidden />] : [])
                : <PlayingCard hidden />}
            </div>
          </div>
          {/* player row */}
          <div className="w-full">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[12px] font-semibold text-mute">{lang === "cs" ? "Vy" : "You"}</span>
              {/* funding fee paid at deal — visible for the whole hand */}
              {playing && (round.feeCents ?? 0) > 0 && (
                <span className="num text-[10.5px] font-medium text-faint">{t.gameFeeChip(fmtMonos(round.feeCents!, { lang }))}</span>
              )}
              {round && playerDone && <span className="num ml-auto text-[12px] font-bold">{round.playerTotal}</span>}
            </div>
            <div className="flex gap-1.5 flex-wrap min-h-14">
              {round ? round.player.slice(0, shown.p).map((c, i) => <PlayingCard key={i} v={c} />) : <PlayingCard hidden />}
            </div>
          </div>
          {/* side-bet results — resolved the moment the cards land */}
          {round?.sides && Object.keys(round.sides).length > 0 && (
            <div className="flex gap-1.5 flex-wrap justify-center">
              {(["pp", "t3"] as const).map((k) => {
                const s = round.sides![k];
                if (!s) return null;
                return (
                  <span
                    key={k}
                    className={cn(
                      "num inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold",
                      s.winCents > 0 ? "bg-yes-soft text-yes-strong" : "bg-surface-2 text-faint"
                    )}
                  >
                    {k === "pp" ? "PP" : "21+3"}
                    {s.winCents > 0 ? ` ${t[s.label as keyof typeof t] as string} +${fmtMonos(s.winCents, { lang })}` : " —"}
                  </span>
                );
              })}
            </div>
          )}
          <div className="min-h-5 flex flex-col items-center gap-0.5">
            {resultLabel && <span className="text-[12.5px] font-bold anim-win-pop">{resultLabel}</span>}
            {quip && <span className="text-[11.5px] text-faint italic">“{quip}”</span>}
            <ResultTag net={net} lang={lang} />
          </div>
        </div>
      }
      controls={
        <>
          {!playing && (
            <>
              <BetControls bet={bet} setBet={setBet} lev={lockedLev(lev, inDebt)} setLev={setLev} balanceCents={balanceCents} locked={inDebt} levCap={levCap} feeBps={feeBps} maxBet={maxBet} disabled={pending} lang={lang} sideCents={(pp ? Math.round(parseFloat(ppAmt || "0") * 100) : 0) + (t3 ? Math.round(parseFloat(t3Amt || "0") * 100) : 0)} winPreview={{ mult: BJ_NATURAL_MULT, max: true }} />
              <div className="flex gap-1.5">
                {([
                  { on: pp, set: setPp, amt: ppAmt, setAmt: setPpAmt, name: "PP", desc: t.bjSidePP },
                  { on: t3, set: setT3, amt: t3Amt, setAmt: setT3Amt, name: "21+3", desc: t.bjSide21 },
                ] as const).map((s) => (
                  <div key={s.name} className={cn("flex-1 rounded-lg border transition-colors", s.on ? "border-brand bg-brand-soft" : "border-line bg-surface-2")}>
                    <button
                      type="button"
                      onClick={() => s.set(!s.on)}
                      disabled={pending}
                      className={cn(
                        "h-7 w-full text-[11.5px] font-semibold cursor-pointer",
                        s.on ? "text-brand-strong" : "text-mute hover:text-ink"
                      )}
                      title={s.desc}
                    >
                      {s.name}
                    </button>
                    {s.on && (
                      <div className="relative px-1 pb-1">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 pb-0.5 text-[10px] font-semibold text-brand-strong/70">Ɱ</span>
                        <input
                          type="number"
                          min="0"
                          max={MAX_GAME_STAKE_CENTS / 100}
                          step="1"
                          value={s.amt}
                          disabled={pending}
                          onChange={(e) => s.setAmt(e.target.value)}
                          className="num h-6 w-full rounded-md border border-brand/30 bg-surface pl-4.5 pr-1 text-[11px] font-semibold text-ink focus:outline-1 focus:outline-brand"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
          {playing ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex gap-2">
                <Button className="flex-1" size="lg" disabled={busy || autoRun} onClick={hit}>
                  {t.bjHit}
                </Button>
                <Button className="flex-1" size="lg" variant="outline" disabled={busy || autoRun} onClick={stand}>
                  {t.bjStand}
                </Button>
              </div>
              {firstMove && (
                <div className="flex gap-2">
                  <Button className="flex-1" size="sm" variant="outline" disabled={busy || autoRun} onClick={double}>
                    {t.bjDouble}
                  </Button>
                  <Button className="flex-1" size="sm" variant="ghost" disabled={busy || autoRun} onClick={surrender}>
                    {t.bjSurrender}
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <Button className="w-full" size="lg" disabled={busy || autoRun || !parseFloat(bet) || (pp && !(parseFloat(ppAmt) >= 1 && parseFloat(ppAmt) <= MAX_GAME_STAKE_CENTS / 100)) || (t3 && !(parseFloat(t3Amt) >= 1 && parseFloat(t3Amt) <= MAX_GAME_STAKE_CENTS / 100))} onClick={deal}>
              {round ? t.bjNewHand : t.bjDeal}
            </Button>
          )}
          {autobet && <AutoBar onRound={autoRound} disabled={busy || autoRun || playing || !parseFloat(bet)} onRunning={setAutoRun} lang={lang} />}
        </>
      }
    />
  );
}

// ---------- plinko ----------

// Board geometry — `rows` peg rows as a triangle, pockets underneath. The
// ball's x at row r is (rights so far − r/2) peg-spacings off center, so a
// path of 0/1 steps maps onto a visible zigzag that ends over pocket
// `bucket`. Peg spacing shrinks for bigger boards so any row count fits the
// same viewBox.
const PK_TOP = 24;
const PK_BOTTOM = 260;
const PK_SEG_MS = 68; // one peg-to-pocket hop
const pkGap = (rows: number) => Math.min(30, 240 / rows);
const pkRowH = (rows: number) => (PK_BOTTOM - PK_TOP) / rows;
const pkX = (k: number, r: number, rows: number) => 140 + (k - r / 2) * pkGap(rows);
const pkY = (r: number, rows: number) => (r >= rows ? PK_BOTTOM : PK_TOP + r * pkRowH(rows));

type Ball = { id: number; path: number[]; bucket: number; t: number };

// Continuous position along the zigzag: t counts rows, the fraction eases
// into each hop with a small arc off the peg.
function pkPos(path: number[], t: number, rows: number) {
  const seg = Math.min(Math.max(t, 0), rows);
  const r = Math.min(Math.floor(seg), rows);
  const f = seg - r;
  let rights = 0;
  for (let i = 0; i < r && i < path.length; i++) rights += path[i];
  const r1 = Math.min(r + 1, rows);
  const rights1 = rights + (path[r] ?? 0);
  const e = f * f * (3 - 2 * f);
  return {
    x: pkX(rights, r, rows) + (pkX(rights1, r1, rows) - pkX(rights, r, rows)) * e,
    y: pkY(r, rows) + (pkY(r1, rows) - pkY(r, rows)) * e - Math.sin(f * Math.PI) * 5,
  };
}

const PK_MAX_BALLS = 16;
const PK_MAX_AIRBORNE = 8;

function PlinkoCard({ balanceCents, lang, dealerId, inDebt, demo, onWinFx, levCap, feeBps, maxBet, autobet }: GameProps) {
  const t = getT(lang ?? "cs");
  const { pending, run } = useGame(lang);
  const [bet, setBet] = useState("10");
  const [lev, setLev] = useState("1");
  const [rows, setRows] = useState(PLINKO_ROWS);
  const [balls, setBalls] = useState<Ball[]>([]);
  const [autoRun, setAutoRun] = useState(false);
  const [net, setNet] = useState<Net>(null);
  const [dealer, setDealer] = useState<Persona | null>(null);
  const nextId = useRef(1);
  const mults = plinkoMults(rows);
  const gap = pkGap(rows);

  const airborne = balls.filter((b) => b.t < rows).length;
  const dropping = airborne > 0;

  // One ticker advances every live ball — t lands on `rows` in the pocket.
  useEffect(() => {
    if (!balls.some((b) => b.t < b.path.length)) return;
    const id = setInterval(
      () => setBalls((bs) => bs.map((b) => (b.t < b.path.length ? { ...b, t: Math.min(b.t + 28 / PK_SEG_MS, b.path.length) } : b))),
      28
    );
    return () => clearInterval(id);
  }, [balls]);

  const drop = (): Promise<number | null> => {
    if (airborne >= PK_MAX_AIRBORNE) return Promise.resolve(null);
    const bc = Math.round(parseFloat(bet || "0") * 100);
    const levN = Number(lockedLev(lev, inDebt));
    return run(() => {
      if (!demo) return playPlinko({ dealerId, betCents: bc, leverage: levN, rows });
      // Wins land in paying pockets, losses drop into the sub-1× middle.
      const bucket = demoHit()
        ? Math.random() < 0.5 ? ri(3) : rows - ri(3)
        : Math.max(0, Math.min(rows, Math.round(rows / 2 + (ri(5) - 2))));
      const path: (0 | 1)[] = Array.from({ length: rows }, (_, i) => (i < bucket ? 1 : 0));
      for (let i = rows - 1; i > 0; i--) {
        const j = ri(i + 1);
        [path[i], path[j]] = [path[j], path[i]];
      }
      const mult = mults[bucket];
      const fake: Awaited<ReturnType<typeof playPlinko>> = { ...demoBase, ok: true, path, bucket, mult, rows, netCents: Math.round(bc * levN * (mult - 1)) };
      return demoDelay(fake);
    }).then((r) => {
      const path = r?.path;
      const bucket = r?.bucket;
      if (!path || bucket == null) return null;
      playSfx("roll", 0.4);
      setNet(null);
      setDealer(r.dealer ?? null);
      const id = nextId.current++;
      setBalls((bs) => [...bs.slice(-(PK_MAX_BALLS - 1)), { id, path, bucket, t: -0.4 }]);
      return new Promise<number>((resolve) =>
        setTimeout(() => {
          const won = (r.mult ?? 0) > 1;
          setNet({ stamp: Date.now(), netCents: r.netCents ?? 0, won, feeCents: r.feeCents, stakeCents: bc, skimCents: r.skimCents, demo });
          dealerWinFx(r.dealer, won, (r.netCents ?? 0) + bc + (r.feeCents ?? 0) + (r.skimCents ?? 0), onWinFx, r.tavCents);
          resolve(r.netCents ?? 0);
        }, rows * PK_SEG_MS + 300)
      );
    });
  };

  const landed = new Set(balls.filter((b) => b.t >= b.path.length).map((b) => b.bucket));

  return (
    <GameCard
      icon={<CircleDot className="size-4.5" />}
      title={t.gPlinko}
      sub={t.gPlinkoSub}
      stage={
        <div className="flex flex-col items-center gap-2">
          <svg viewBox="0 0 280 300" className="w-full max-w-[280px]" role="img" aria-label="Plinko">
            {/* pegs */}
            {Array.from({ length: rows }, (_, r) =>
              Array.from({ length: r + 1 }, (_, j) => (
                <circle key={`${r}-${j}`} cx={pkX(j, r, rows)} cy={PK_TOP + r * pkRowH(rows)} r={Math.max(1.6, gap * 0.12)} fill="var(--color-faint)" />
              ))
            )}
            {/* pockets */}
            {mults.map((m, k) => {
              const hit = landed.has(k);
              const big = m >= 10;
              const pays = m > 1;
              const pw = gap - 1.5;
              return (
                <g key={k}>
                  <rect
                    x={pkX(k, rows, rows) - pw / 2}
                    y={248}
                    width={pw}
                    height={44}
                    rx={4}
                    fill={big ? "var(--color-brand)" : pays ? "var(--color-yes-soft)" : "var(--color-surface-3)"}
                    stroke={hit ? "var(--color-ink)" : "transparent"}
                    strokeWidth={hit ? 2 : 0}
                    style={hit ? { filter: "drop-shadow(0 0 6px var(--color-brand))" } : undefined}
                  />
                  <text
                    x={pkX(k, rows, rows)}
                    y={286}
                    textAnchor="middle"
                    fontSize={pw < 17 ? 5.5 : 7.5}
                    fontWeight={700}
                    fill={big ? "var(--color-brand-on)" : pays ? "var(--color-yes-strong)" : "var(--color-mute)"}
                    className="num"
                  >
                    ×{m}
                  </text>
                </g>
              );
            })}
            {/* balls — continuous hop interpolation, several live at once */}
            {balls.map((b) => {
              const p = pkPos(b.path, b.t, rows);
              const down = b.t >= b.path.length;
              return (
                <g key={b.id} transform={`translate(${p.x}, ${p.y})`} style={down ? undefined : { filter: "drop-shadow(0 3px 4px rgba(0,0,0,0.35))" }}>
                  <circle r={down ? 5.5 : 6.5} fill={down ? "var(--color-mute)" : "var(--color-brand)"} />
                  {!down && <circle r={2.5} cy={-2} cx={-1.5} fill="var(--color-brand-on)" opacity={0.55} />}
                </g>
              );
            })}
          </svg>
          <ResultTag net={dropping ? null : net} lang={lang} />
          <DealerTag dealer={dealer} won={dropping ? null : net?.won} />
        </div>
      }
      controls={
        <>
          <div>
            <div className="text-[12px] font-medium text-mute mb-1">{t.plinkoRows}</div>
            <Segmented
              options={PLINKO_ROW_CHOICES.map((v) => ({ value: String(v), label: String(v) }))}
              value={String(rows)}
              onChange={(v) => setRows(Number(v))}
              disabled={dropping}
            />
          </div>
          <BetControls
            bet={bet}
            setBet={setBet}
            lev={lockedLev(lev, inDebt)}
            setLev={setLev}
            balanceCents={balanceCents}
            locked={inDebt} levCap={levCap} feeBps={feeBps} maxBet={maxBet}
            disabled={pending}
            lang={lang}
            winPreview={{ mult: mults[0], max: true }}
          />
          <Button className="w-full" size="lg" disabled={airborne >= PK_MAX_AIRBORNE || autoRun || !parseFloat(bet)} onClick={drop}>
            {t.plinkoDrop}
          </Button>
          {autobet && !demo && <AutoBar onRound={drop} disabled={pending || autoRun || !parseFloat(bet)} onRunning={setAutoRun} lang={lang} />}
        </>
      }
    />
  );
}

// ---------- hi-lo & red/black ----------

// 1.5× table card — the solo stage card for the card games.
function BigCard({ v, hidden }: { v?: number; hidden?: boolean }) {
  if (hidden || v === undefined)
    return (
      <div className="w-16 h-[88px] rounded-lg border border-line bg-ink p-1.5 shadow-md">
        <div className="h-full w-full rounded-[4px] bg-[repeating-linear-gradient(45deg,rgba(255,255,255,0.14)_0px,rgba(255,255,255,0.14)_2px,transparent_2px,transparent_7px)]" />
      </div>
    );
  const c = cardLabel(v);
  return (
    <div className={cn("w-16 h-[88px] rounded-lg border bg-surface grid grid-rows-[auto_1fr] px-1.5 pt-1 shadow-md anim-win-pop", c.red ? "border-no/50 text-no-strong" : "border-line text-ink")}>
      <span className="num text-[17px] font-black leading-none">{c.rank}</span>
      <span className="text-[26px] leading-none self-center justify-self-center">{c.suit}</span>
    </div>
  );
}

function RedBlackCard({ balanceCents, lang, dealerId, inDebt, demo, onWinFx, levCap, feeBps, maxBet, autobet }: GameProps) {
  const t = getT(lang ?? "cs");
  const { pending, run } = useGame(lang);
  const [pick, setPick] = useState<"red" | "black">("red");
  const [bet, setBet] = useState("10");
  const [lev, setLev] = useState("1");
  const [card, setCard] = useState<number>();
  const [drawing, setDrawing] = useState(false);
  const [autoRun, setAutoRun] = useState(false);
  const [net, setNet] = useState<Net>(null);
  const [dealer, setDealer] = useState<Persona | null>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const play = (): Promise<number | null> => {
    const bc = Math.round(parseFloat(bet || "0") * 100);
    const levN = Number(lockedLev(lev, inDebt));
    return run(() => {
      if (!demo) return playRedBlack({ dealerId, betCents: bc, leverage: levN, pick });
      const win = demoHit();
      // Suits 1,2 are red; 0,3 black. Win = card matches the pick.
      const suit = ((win === (pick === "red")) ? [1, 2] : [0, 3])[ri(2)];
      const card = suit * 13 + ri(13);
      const fake: Awaited<ReturnType<typeof playRedBlack>> = { ...demoBase, ok: true, card, netCents: demoNet(bc * levN, win, REDBLACK_MULT) };
      return demoDelay(fake);
    }).then((r) => {
      if (!r || r.card == null) return null;
      playSfx("flip", 0.5);
      setNet(null);
      setDealer(r.dealer ?? null);
      setDrawing(true);
      // The face cycles while the round is in flight — the drawn card lands last.
      const iv = window.setInterval(() => setCard(Math.floor(Math.random() * 52)), 75);
      return new Promise<number>((resolve) =>
        timers.current.push(
          window.setTimeout(() => {
            clearInterval(iv);
            setCard(r.card);
            setDrawing(false);
            setNet({ stamp: Date.now(), netCents: r.netCents ?? 0, won: (r.netCents ?? 0) > 0, feeCents: r.feeCents, stakeCents: bc, skimCents: r.skimCents, demo });
            dealerWinFx(r.dealer, (r.netCents ?? 0) > 0, (r.netCents ?? 0) + bc + (r.feeCents ?? 0) + (r.skimCents ?? 0), onWinFx, r.tavCents);
            resolve(r.netCents ?? 0);
          }, 750)
        )
      );
    });
  };

  const pickCls = (side: "red" | "black") =>
    cn(
      "flex-1 h-14 rounded-xl border-2 font-bold text-[15px] transition-all cursor-pointer",
      pick === side
        ? side === "red"
          ? "border-no bg-no/10 text-no-strong shadow-[0_0_0_3px_var(--color-no-soft)]"
          : "border-ink bg-ink/5 text-ink shadow-[0_0_0_3px_var(--color-surface-3)]"
        : "border-line bg-surface-2 text-mute hover:border-mute"
    );

  return (
    <GameCard
      icon={<Contrast className="size-4.5" />}
      title={t.gRedBlack}
      sub={t.gRedBlackSub}
      stage={
        <div className="flex flex-col items-center gap-3">
          <BigCard v={card} hidden={card === undefined} />
          <ResultTag net={drawing ? null : net} lang={lang} />
          <DealerTag dealer={dealer} won={drawing ? null : net?.won} />
        </div>
      }
      controls={
        <>
          <div className="flex gap-2">
            <button type="button" className={pickCls("red")} onClick={() => setPick("red")}>
              <span className="text-[17px]">♥♦</span> {t.rbRed}
            </button>
            <button type="button" className={pickCls("black")} onClick={() => setPick("black")}>
              <span className="text-[17px]">♠♣</span> {t.rbBlack}
            </button>
          </div>
          <BetControls bet={bet} setBet={setBet} lev={lockedLev(lev, inDebt)} setLev={setLev} balanceCents={balanceCents} locked={inDebt} levCap={levCap} feeBps={feeBps} maxBet={maxBet} disabled={pending || drawing || autoRun} lang={lang} winPreview={{ mult: REDBLACK_MULT }} />
          <Button className="w-full" size="lg" disabled={pending || drawing || autoRun || !parseFloat(bet)} onClick={play}>
            {drawing ? t.drawing : t.draw}
          </Button>
          {autobet && !demo && <AutoBar onRound={play} disabled={pending || drawing || autoRun || !parseFloat(bet)} onRunning={setAutoRun} lang={lang} />}
        </>
      }
    />
  );
}

function HiLoCard({ balanceCents, lang, dealerId, inDebt, demo, onWinFx, levCap, feeBps, maxBet, autobet }: GameProps) {
  const t = getT(lang ?? "cs");
  const { pending, run } = useGame(lang);
  const [bet, setBet] = useState("10");
  const [lev, setLev] = useState("1");
  const [roundId, setRoundId] = useState<string>();
  const [face, setFace] = useState<number>();
  const [next, setNext] = useState<number>();
  const [net, setNet] = useState<Net>(null);
  const [autoRun, setAutoRun] = useState(false);
  const [dealer, setDealer] = useState<Persona | null>(null);
  const inRound = roundId != null;

  const deal = () => {
    const bc = Math.round(parseFloat(bet || "0") * 100);
    run(() =>
      demo
        ? demoDelay({ ...demoBase, ok: true, roundId: "demo", faceCard: ri(52) } satisfies Awaited<ReturnType<typeof hiloStart>>)
        : hiloStart({ dealerId, betCents: bc, leverage: Number(lockedLev(lev, inDebt)) })
    ).then((r) => {
      if (!r || !r.roundId || r.faceCard == null) return;
      playSfx("flip", 0.4);
      setRoundId(r.roundId);
      setFace(r.faceCard);
      setNext(undefined);
      setNet(null);
      setDealer(r.dealer ?? null);
    });
  };

  const call = (dir: HiloDir) => {
    if (!roundId) return;
    const bc = Math.round(parseFloat(bet || "0") * 100);
    const levN = Number(lockedLev(lev, inDebt));
    run(() => {
      if (!demo) return hiloPlay({ roundId, dir, dealerId });
      const fo = cardOrder(face ?? 0);
      // Ranks that beat the face for this call, the losing ones, and a
      // small push slice — same shape the real settle returns.
      const wins = Array.from({ length: 13 }, (_, i) => i + 1).filter((o) => (dir === "higher" ? o > fo : o < fo));
      const losses = Array.from({ length: 13 }, (_, i) => i + 1).filter((o) => (dir === "higher" ? o < fo : o > fo));
      const r0 = Math.random();
      const order =
        r0 < 0.58 && wins.length ? wins[ri(wins.length)] : r0 < 0.66 || !losses.length ? fo : losses[ri(losses.length)];
      const card = ri(4) * 13 + (order === 13 ? 0 : order);
      const push = order === fo;
      const won = !push && (dir === "higher" ? order > fo : order < fo);
      const fake: Awaited<ReturnType<typeof hiloPlay>> = { ...demoBase, ok: true, card, push, won, netCents: push ? 0 : demoNet(bc * levN, won, hiloMult(face ?? 0, dir)) };
      return demoDelay(fake);
    }).then((r) => {
      if (!r || r.card == null) return;
      playSfx(r.push ? "trade" : r.won ? "win" : "lose", 0.5);
      setNext(r.card);
      setRoundId(undefined);
      const won = !!r.won && !r.push && (r.netCents ?? 0) > 0;
      setNet({ stamp: Date.now(), netCents: r.netCents ?? 0, won, feeCents: r.feeCents, stakeCents: bc, skimCents: r.skimCents, demo });
      dealerWinFx(r.dealer ?? dealer, won, (r.netCents ?? 0) + bc + (r.feeCents ?? 0) + (r.skimCents ?? 0), onWinFx, r.tavCents);
    });
  };

  // Autobet round: deal, then call the side with more winning ranks — an
  // ace-low/mid card goes higher, a face card goes lower; a 7 splits evenly
  // and takes higher by convention.
  const autoRound = async (): Promise<number | null> => {
    const bc = Math.round(parseFloat(bet || "0") * 100);
    const r = await run(() => hiloStart({ dealerId, betCents: bc, leverage: Number(lockedLev(lev, inDebt)) }));
    const rid = r?.roundId;
    if (!rid || r.faceCard == null) return null;
    playSfx("flip", 0.4);
    setRoundId(rid);
    setFace(r.faceCard);
    setNext(undefined);
    setNet(null);
    setDealer(r.dealer ?? null);
    await new Promise((r2) => setTimeout(r2, 550));
    const o = cardOrder(r.faceCard);
    const dir: HiloDir = hiloWinRanks(o, "higher") >= hiloWinRanks(o, "lower") ? "higher" : "lower";
    const r2 = await run(() => hiloPlay({ roundId: rid, dir, dealerId }));
    if (!r2 || r2.card == null) return null;
    playSfx(r2.push ? "trade" : r2.won ? "win" : "lose", 0.5);
    setNext(r2.card);
    setRoundId(undefined);
    const won = !!r2.won && !r2.push && (r2.netCents ?? 0) > 0;
    setNet({ stamp: Date.now(), netCents: r2.netCents ?? 0, won, feeCents: r2.feeCents, stakeCents: bc, skimCents: r2.skimCents });
    dealerWinFx(r2.dealer ?? dealer, won, (r2.netCents ?? 0) + bc + (r2.feeCents ?? 0) + (r2.skimCents ?? 0), onWinFx, r2.tavCents);
    return r2.netCents ?? 0;
  };

  const callBtn = (dir: HiloDir) => {
    const mult = face != null ? hiloMult(face, dir) : 0;
    return (
      <button
        type="button"
        disabled={pending || autoRun || mult <= 0}
        onClick={() => call(dir)}
        className="flex-1 h-14 rounded-xl border-2 border-brand bg-brand-soft font-bold text-[15px] text-brand-strong transition-all hover:bg-brand/20 disabled:opacity-40 disabled:hover:bg-brand-soft cursor-pointer disabled:cursor-not-allowed"
      >
        <span className="block">{dir === "higher" ? `↑ ${t.hiloHigher}` : `↓ ${t.hiloLower}`}</span>
        <span className="block num text-[11.5px] font-semibold opacity-75">{mult > 0 ? `×${mult.toFixed(2)}` : "—"}</span>
      </button>
    );
  };

  return (
    <GameCard
      icon={<ArrowUpDown className="size-4.5" />}
      title={t.gHilo}
      sub={t.gHiloSub}
      stage={
        <div className="flex items-center gap-4">
          <BigCard v={face} hidden={face === undefined} />
          <ArrowUpDown className="size-4 text-faint rotate-90" />
          <div className="flex flex-col items-center gap-1">
            <BigCard v={next} hidden={next === undefined} />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-faint">{t.hiloNext}</span>
          </div>
        </div>
      }
      controls={
        <>
          {net && <div className="flex justify-center"><ResultTag net={net} lang={lang} /></div>}
          {inRound ? (
            <>
              <div className="flex gap-2">
                {callBtn("higher")}
                {callBtn("lower")}
              </div>
              <p className="text-[11px] text-faint text-center">{t.hiloPush}</p>
            </>
          ) : (
            <>
              <BetControls bet={bet} setBet={setBet} lev={lockedLev(lev, inDebt)} setLev={setLev} balanceCents={balanceCents} locked={inDebt} levCap={levCap} feeBps={feeBps} maxBet={maxBet} disabled={pending || autoRun} lang={lang} />
              <Button className="w-full" size="lg" disabled={pending || autoRun || !parseFloat(bet)} onClick={deal}>
                {t.bjDeal}
              </Button>
            </>
          )}
          {autobet && !demo && <AutoBar onRound={autoRound} disabled={pending || autoRun || inRound || !parseFloat(bet)} onRunning={setAutoRun} lang={lang} />}
        </>
      }
    />
  );
}

export const GAME_COMPONENTS = {
  coinflip: CoinFlipCard,
  dice: DiceCard,
  timer: TimerCard,
  limbo: LimboCard,
  wheel: WheelCard,
  slots: SlotsCard,
  blackjack: BlackjackCard,
  plinko: PlinkoCard,
  hilo: HiLoCard,
  redblack: RedBlackCard,
} as const;

export type GameSlug = keyof typeof GAME_COMPONENTS;

// Bonnie Blue win easter egg — a cream pie hits mid-screen: one irregular
// splat with radiating fingers and stray droplets, then the mass sticks and
// slides down off the screen.
function BonnieSplash({ amountCents, lang }: { amountCents: number; lang?: Lang }) {
  const t = getT(lang ?? "cs");
  return (
    <div className="absolute inset-0 grid place-items-center overflow-hidden pointer-events-none" role="status" aria-live="polite">
      <div className="anim-pie-out relative" style={{ width: "44vmin", height: "44vmin" }}>
        <svg aria-hidden viewBox="0 0 100 100" className="anim-pie-in absolute inset-0 w-full h-full" style={{ filter: "drop-shadow(0 16px 34px rgba(60,45,15,0.28))" }}>
          <g fill="#f7f1e3">
            <ellipse cx="48" cy="52" rx="31" ry="26" transform="rotate(-8 48 52)" />
            <ellipse cx="52" cy="20" rx="6" ry="14" transform="rotate(6 52 20)" />
            <ellipse cx="77" cy="33" rx="5" ry="12" transform="rotate(50 77 33)" />
            <ellipse cx="80" cy="63" rx="6" ry="15" transform="rotate(84 80 63)" />
            <ellipse cx="62" cy="82" rx="5" ry="13" transform="rotate(164 62 82)" />
            <ellipse cx="27" cy="76" rx="6" ry="11" transform="rotate(212 27 76)" />
            <ellipse cx="17" cy="41" rx="5" ry="13" transform="rotate(282 17 41)" />
            <ellipse cx="38" cy="16" rx="4" ry="9" transform="rotate(330 38 16)" />
            <circle cx="89" cy="17" r="3.4" /><circle cx="10" cy="70" r="3" /><circle cx="72" cy="92" r="2.6" /><circle cx="15" cy="12" r="2.8" /><circle cx="92" cy="53" r="2.4" />
          </g>
        </svg>
        <div className="anim-pie-in relative h-full grid place-items-center text-center px-6">
          <div>
            <div className="text-[13px] font-bold uppercase tracking-[0.2em] text-[#6b5a33]">{t.bonnieWin}</div>
            <div className="num text-5xl font-black text-[#3d3119] mt-1">+{fmtMonos(amountCents, { lang })}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// J. EPST. win easter egg — the jet crosses over the island's aerial photo
// (pushing in like a chase cam), then nose-dives into the hillside; the
// flash blooms at the impact point before the scene fades.
function JetSvg() {
  return (
    <svg aria-hidden viewBox="0 0 440 140" className="anim-plane-crash absolute left-0 top-0 w-44" style={{ filter: "drop-shadow(0 8px 14px rgba(0,0,0,.45))" }}>
      <defs>
        <linearGradient id="epst-fus" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset=".55" stopColor="#eef1f6" />
          <stop offset="1" stopColor="#b9c2d0" />
        </linearGradient>
        <linearGradient id="epst-wing" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e6eaf1" />
          <stop offset="1" stopColor="#aab4c4" />
        </linearGradient>
        <linearGradient id="epst-eng" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f2f4f8" />
          <stop offset="1" stopColor="#9aa6b8" />
        </linearGradient>
      </defs>
      <path d="M236 78 L168 116 L196 118 L262 82 Z" fill="#8d99ac" />
      <path d="M18 60 C18 44 42 34 92 30 L332 24 C376 22 414 34 428 52 C434 60 430 68 414 72 L96 82 C50 84 18 76 18 60 Z" fill="url(#epst-fus)" />
      <path d="M22 56 C30 36 46 16 64 8 L78 8 L62 36 L52 58 Z" fill="url(#epst-fus)" />
      <path d="M40 52 L20 40 L30 38 L56 48 Z" fill="#c3ccda" />
      <path d="M58 46 L104 42 C112 42 114 52 106 56 L62 62 C52 62 50 50 58 46 Z" fill="url(#epst-eng)" />
      <ellipse cx="104" cy="49" rx="5" ry="6" fill="#3a4556" />
      <path d="M250 74 L176 124 L210 126 L286 78 Z" fill="url(#epst-wing)" />
      <path d="M356 32 L392 38 L398 48 L366 46 Z" fill="#22303f" />
      <path d="M348 34 L356 33 L362 46 L352 45 Z" fill="#22303f" />
      <g fill="#2a3a4d">
        {[330, 308, 286, 264, 242, 220, 198, 176, 154].map((x, i) => (
          <ellipse key={x} cx={x} cy={44 + i} rx="4.5" ry="4" />
        ))}
      </g>
      <rect x="394" y="40" width="2.5" height="22" rx="1" fill="#c0c8d4" opacity=".8" />
      <path d="M30 68 C120 74 300 70 410 60 L410 64 C300 74 120 78 34 72 Z" fill="#cfd6e2" opacity=".7" />
    </svg>
  );
}

function PlaneSplash({ amountCents, lang }: { amountCents: number; lang?: Lang }) {
  const t = getT(lang ?? "cs");
  return (
    <div className="anim-plane-veil absolute inset-0 overflow-hidden bg-[#0b1d33]" role="status" aria-live="polite">
      {/* Bounded aerial frame — a framed approach-cam photo with margins,
          not an edge-to-edge scene. Jet crosses inside the frame. */}
      <div aria-hidden className="absolute inset-x-7 top-6 bottom-12 rounded-xl overflow-hidden border-4 border-[#33506b] shadow-[0_18px_50px_rgba(0,0,0,.55),inset_0_0_0_1px_rgba(255,255,255,.08)]">
        <div
          className="anim-island-zoom absolute -inset-[4%] bg-cover bg-center"
          style={{ backgroundImage: "url(/fx/island.webp)" }}
        />
        <div className="absolute inset-0" style={{ background: "radial-gradient(115% 85% at 50% 42%, transparent 52%, rgba(6,16,30,.55) 100%)" }} />
        <JetSvg />
        <div
          className="anim-crash-flash absolute rounded-full"
          style={{
            left: "74%",
            top: "66%",
            width: "130px",
            height: "130px",
            translate: "-50% -50%",
            background: "radial-gradient(closest-side, #fff7d6 0%, #fbbf24 40%, rgba(249,115,22,0.55) 68%, transparent 72%)",
          }}
        />
      </div>
      {/* caption strip — the cam label under the frame */}
      <div aria-hidden className="absolute inset-x-8 bottom-5 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.18em] text-[#7fa3c4]">
        <span>Little St. James</span>
        <span className="flex items-center gap-1.5 text-[#e06c5b]">
          <span className="live-dot size-1.5 rounded-full bg-[#e06c5b]" />
          approach cam
        </span>
      </div>
      <div className="relative h-full grid place-items-center">
        <div className="anim-win-pop text-center px-6 [text-shadow:0_2px_18px_rgba(0,0,0,.65)]">
          <div className="text-[13px] font-bold uppercase tracking-[0.2em] text-white/80">{t.bonnieWin}</div>
          <div className="num text-5xl font-black text-white mt-1">+{fmtMonos(amountCents, { lang })}</div>
        </div>
      </div>
    </div>
  );
}

// Clavicular win easter egg — a bounded flag on a pole: stripes ripple in
// sequence like cloth while confetti rains over the payout.
const PRIDE_STRIPES = ["#e40303", "#ff8c00", "#ffed00", "#008026", "#24408e", "#732982"] as const;
const CONFETTI_COLORS = [...PRIDE_STRIPES, "#ff69b4", "#5bcffa", "#ffffff"] as const;
// Fixed seeds — deterministic, no per-render randomness.
const CONFETTI = Array.from({ length: 42 }, (_, i) => ({
  x: (i * 37 + 11) % 100,
  d: (i * 97) % 900,
  s: 5 + ((i * 13) % 7),
  c: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  drift: ((i * 29) % 40) - 20,
}));

function PrideSplash({ amountCents, lang }: { amountCents: number; lang?: Lang }) {
  const t = getT(lang ?? "cs");
  return (
    <div className="anim-pride-veil absolute inset-0 overflow-hidden pointer-events-none bg-[#170a24]" role="status" aria-live="polite">
      {/* Bounded flag on a pole — the cloth waves center-stage instead of
          flooding the card; confetti stays inside the card bounds. */}
      <div aria-hidden className="absolute left-1/2 top-[13%] -translate-x-1/2 w-[68%] max-w-80">
        <div className="flex items-stretch gap-0" style={{ transform: "rotate(-2deg)" }}>
          <div className="w-[5px] self-stretch rounded-full bg-gradient-to-b from-[#b8ac93] via-[#8a7f6a] to-[#5d5445] shadow-[1px_0_2px_rgba(0,0,0,.4)]" />
          <div className="h-32 sm:h-36 flex-1 flex flex-col rounded-r-md overflow-hidden shadow-[0_14px_34px_rgba(0,0,0,.45)]">
            {PRIDE_STRIPES.map((c, i) => (
              <div key={c} className="anim-pride-stripe flex-1" style={{ background: c, animationDelay: `${i * 110}ms` }} />
            ))}
          </div>
        </div>
      </div>
      <div aria-hidden className="absolute inset-0" style={{ background: "radial-gradient(120% 90% at 50% 46%, transparent 40%, rgba(20,7,31,.55) 100%)" }} />
      {CONFETTI.map((c, i) => (
        <div
          key={i}
          aria-hidden
          className="anim-confetti absolute -top-3 rounded-[1px]"
          style={{
            left: `${c.x}%`,
            width: c.s,
            height: Math.round(c.s * 1.7),
            background: c.c,
            animationDelay: `${c.d}ms`,
            ["--drift" as string]: `${c.drift}px`,
          }}
        />
      ))}
      <div className="relative h-full grid place-items-center pt-16">
        <div className="anim-win-pop text-center px-6 [text-shadow:0_2px_18px_rgba(0,0,0,.65)]">
          <div className="text-[13px] font-bold uppercase tracking-[0.2em] text-white/85">{t.bonnieWin}</div>
          <div className="num text-5xl font-black text-white mt-1">+{fmtMonos(amountCents, { lang })}</div>
        </div>
      </div>
    </div>
  );
}

// Bibi win easter egg — the flag behind, shekel notes raining down, and the
// man himself dancing over the payout. Fixed seeds — deterministic rain.
const SHEKEL_GIF = "https://media1.tenor.com/m/FD0RSSUxM9gAAAAd/benjamin-netanyahu-epstein.gif";
const MONEY_RAIN = Array.from({ length: 56 }, (_, i) => ({
  x: (i * 41 + 7) % 100,
  d: (i * 131) % 1100,
  s: 14 + ((i * 17) % 18),
  drift: ((i * 23) % 60) - 30,
  o: 0.55 + ((i * 29) % 45) / 100,
}));

function ShekelSplash({ amountCents, tavCents, lang }: { amountCents: number; tavCents?: number; lang?: Lang }) {
  const t = getT(lang ?? "cs");
  return (
    <div className="anim-shekel-veil absolute inset-0 overflow-hidden pointer-events-none bg-[#0c1428]" role="status" aria-live="polite">
      {/* Bounded flag banner — the white field with blue bands is an inset
          panel; ₪ rain falls inside it, gif + payout float on top. */}
      <div aria-hidden className="absolute inset-x-7 inset-y-6 rounded-xl overflow-hidden bg-[#f4f7ff] shadow-[0_18px_50px_rgba(0,0,0,.5),inset_0_0_0_1px_rgba(0,56,184,.15)]">
        <div className="absolute inset-x-0 top-[13%] h-[13%] bg-[#0038b8]" />
        <div className="absolute inset-x-0 bottom-[13%] h-[13%] bg-[#0038b8]" />
        <svg aria-hidden viewBox="0 0 100 100" className="absolute left-1/2 top-1/2 w-[46%] -translate-x-1/2 -translate-y-1/2 opacity-[0.10]">
          <g fill="none" stroke="#0038b8" strokeWidth="5">
            <path d="M50 14 L82 68 L18 68 Z" />
            <path d="M50 86 L18 32 L82 32 Z" />
          </g>
        </svg>
        {MONEY_RAIN.map((m, i) => (
          <span
            key={i}
            aria-hidden
            className="anim-money absolute -top-8 font-black text-[#0a7d2c] select-none"
            style={{
              left: `${m.x}%`,
              fontSize: m.s,
              opacity: m.o,
              animationDelay: `${m.d}ms`,
              ["--drift" as string]: `${m.drift}px`,
              textShadow: "0 1px 2px rgba(255,255,255,.7)",
            }}
          >
            ₪
          </span>
        ))}
      </div>
      <div className="relative h-full grid place-items-center">
        <div className="anim-gif-pop text-center px-6">
          {/* eslint-disable-next-line @next/next/no-img-element -- user-provided remote gif */}
          <img
            src={SHEKEL_GIF}
            alt=""
            className="mx-auto w-40 sm:w-48 rounded-xl shadow-[0_18px_50px_rgba(0,30,90,.45)] border-4 border-white/90"
          />
          <div className="mt-3 [text-shadow:0_2px_14px_rgba(255,255,255,.9)]">
            <div className="text-[13px] font-bold uppercase tracking-[0.2em] text-[#0038b8]/90">{t.bonnieWin}</div>
            <div className="num text-4xl font-black text-[#0a3d1a] mt-1">+{fmtMonos(amountCents, { lang })}</div>
            {tavCents ? (
              <div className="num mt-2 inline-block rounded-full bg-white/90 px-3 py-1 text-sm font-bold text-[#0038b8] shadow-sm">{t.tavBonus(fmtMonos(tavCents, { lang }))}</div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export function GameView({
  game,
  balanceCents,
  lang,
  dealers,
  inDebt,
  levCap,
  levFeeBps,
  maxBetCents,
  autobet,
}: {
  game: GameSlug;
  balanceCents: number;
  lang?: Lang;
  dealers?: (Persona & { id: string })[];
  inDebt?: boolean;
  levCap?: number;
  levFeeBps?: number;
  maxBetCents?: number;
  // Admin kill-switch — when off, no card renders the AutoBar.
  autobet?: boolean;
}) {
  const t = getT(lang ?? "cs");
  const Game = GAME_COMPONENTS[game];
  const [dealerId, setDealerId] = useState<string>();
  const [splash, setSplash] = useState<{ amt: number; fx: WinFx; tav?: number } | null>(null);
  // Dealer celebrations are opt-out per device — some are loud on purpose.
  const fxOff = useSyncExternalStore(subscribeFx, readFxOff, () => false);
  // Demo mode — rounds resolve locally, no money moves. Rigged toward the
  // player so trying a game feels generous.
  const [demo, setDemo] = useState(false);
  const demoOk = DEMO_GAMES.has(game);
  const toggleFx = () => {
    try {
      localStorage.setItem("mb_fx_off", fxOff ? "0" : "1");
    } catch {}
    // `storage` doesn't fire in the writing tab — poke subscribers ourselves.
    window.dispatchEvent(new Event("storage"));
  };
  useEffect(() => {
    if (splash == null) return;
    const id = setTimeout(() => setSplash(null), 2600);
    return () => clearTimeout(id);
  }, [splash]);
  const chipCls = (on: boolean) =>
    cn(
      "flex shrink-0 flex-col items-center gap-1 rounded-xl border px-3 py-2 cursor-pointer transition-colors min-w-[72px]",
      on ? "border-brand bg-brand-soft" : "border-line bg-surface hover:border-mute"
    );
  const picked = dealers?.find((d) => d.id === dealerId);
  const toolbar = (
    <div className="flex items-center gap-1.5">
      {demoOk && (
        <button
          type="button"
          onClick={() => setDemo((d) => !d)}
          aria-pressed={demo}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold transition-colors cursor-pointer",
            demo ? "border-warn/60 bg-warn-soft text-warn-strong" : "border-line bg-surface text-faint hover:text-mute"
          )}
        >
          <FlaskConical className="size-3" />
          {t.demoToggle}
        </button>
      )}
      <button
        type="button"
        onClick={toggleFx}
        aria-pressed={!fxOff}
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold transition-colors cursor-pointer",
          fxOff ? "border-line bg-surface text-faint" : "border-brand bg-brand-soft text-brand-strong"
        )}
      >
        <Sparkles className="size-3" />
        {t.dealerFxToggle}
      </button>
    </div>
  );
  return (
    <div>
      {dealers && dealers.length > 0 ? (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[12px] font-semibold text-mute">{t.dealerPick}</div>
            {toolbar}
          </div>
          <div className="scrollbar-none -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
            <button type="button" onClick={() => setDealerId(undefined)} className={chipCls(dealerId == null)}>
              <span className={cn("size-10 grid place-items-center rounded-full", dealerId == null ? "bg-brand-soft" : "bg-surface-2")}>
                <Shuffle className="size-4.5 text-mute" />
              </span>
              <span className="text-[10.5px] font-semibold text-ink leading-tight">{t.dealerRandom}</span>
            </button>
            {dealers.map((d) => (
              <button type="button" key={d.id} onClick={() => setDealerId(d.id)} className={chipCls(dealerId === d.id)}>
                <DealerAvatar avatar={d.avatar} className="size-10 rounded-full shrink-0" />
                <span className="text-[10.5px] font-semibold text-ink leading-tight max-w-[72px] truncate">{d.name}</span>
              </button>
            ))}
          </div>
          {picked && (
            <div className="mt-1.5 flex items-center gap-2 text-[11px] text-mute">
              {picked.quipWin && <span className="min-w-0 flex-1 truncate italic">“{picked.quipWin}”</span>}
              {dealerFx(picked).rigged && <span className="shrink-0 rounded-full bg-no-soft px-1.5 py-px text-[9.5px] font-bold text-no-strong uppercase tracking-wide">{t.dealerRigged}</span>}
              {dealerFx(picked).blessed && <span className="shrink-0 rounded-full bg-yes-soft px-1.5 py-px text-[9.5px] font-bold text-yes-strong uppercase tracking-wide">{t.dealerBlessed}</span>}
            </div>
          )}
        </div>
      ) : (
        <div className="mb-3 flex justify-end">{toolbar}</div>
      )}
      {demo && demoOk && (
        <div className="mb-3 rounded-xl border border-warn/40 bg-warn-soft px-3.5 py-2 text-[12px] font-semibold text-warn-strong">
          {t.demoNotice}
        </div>
      )}
      <Game balanceCents={balanceCents} lang={lang} dealerId={dealerId} inDebt={inDebt} demo={demo && demoOk} levCap={levCap} feeBps={levFeeBps} maxBet={maxBetCents} autobet={autobet && !(demo && demoOk)}
        onWinFx={(amt, fx, tav) => { if (!fxOff) setSplash({ amt, fx, tav }); }} />
      {/* Dealer celebrations run inside a bounded card, not the viewport —
          any click dismisses. */}
      {splash && !fxOff && (
        <button
          type="button"
          aria-label={t.clearInput}
          onClick={() => setSplash(null)}
          className="fixed inset-0 z-[100] grid place-items-center bg-ink/30 cursor-pointer"
        >
          <span className="relative block w-[min(92vw,540px)] h-[min(64vh,420px)] rounded-2xl overflow-hidden shadow-2xl border border-line">
            {splash.fx === "splash" && <BonnieSplash amountCents={splash.amt} lang={lang} />}
            {splash.fx === "plane" && <PlaneSplash amountCents={splash.amt} lang={lang} />}
            {splash.fx === "pride" && <PrideSplash amountCents={splash.amt} lang={lang} />}
            {splash.fx === "shekel" && <ShekelSplash amountCents={splash.amt} tavCents={splash.tav} lang={lang} />}
          </span>
        </button>
      )}
    </div>
  );
}
