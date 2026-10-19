"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Swords, Trophy, AlertTriangle, Check, X, Play, OctagonX, Mountain, Newspaper, Scissors, Coins, Heart, Spade } from "lucide-react";
import { Button, Input } from "@/components/ui/primitives";
import { respondDuel, cancelDuel, proposeDuelWinner, duelPlay } from "@/lib/actions";
import { fmtMonos } from "@/lib/money";
import { getT, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { cardLabel, handTotal, DUEL_TIMER_MS } from "@/lib/games";
import { KIND_ICONS, duelFmtMove, duelKindLabels, duelMoveLabel, type DuelRow, type DuelState } from "@/components/duels-panel";

// Full-screen event stage for a single duel — a dedicated route so the fight
// is deep-linkable and survives refreshes. Polls for the opponent's moves.
export function DuelArena({ row, me, lang }: { row: DuelRow; me: string; lang?: Lang }) {
  const t = getT(lang ?? "cs");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [limboTarget, setLimboTarget] = useState("2");

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 3000);
    return () => clearInterval(id);
  }, [router]);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(ok);
      else toast.error(t.serverErr(r.error));
      router.refresh();
    });

  const play = (id: string, move?: string) =>
    start(async () => {
      const r = await duelPlay({ id, move });
      if (!r.ok) toast.error(t.serverErr(r.error));
      else if (r.tie) toast(t.duelTieToast);
      else if (r.waiting && !r.mid) toast.success(t.duelMoveLockedToast);
      router.refresh();
    });

  const d = row.duel;
  const moves = ((d.state as DuelState)?.moves) ?? {};
  const myMove = moves[me];
  const otherId = d.creatorId === me ? d.opponentId : d.creatorId;
  const otherMove = moves[otherId];
  // A structured move with done:false is a mid-round state (hilo face, live
  // timer, blackjack hand) — the player is still acting, not locked in.
  const midRound = typeof myMove === "object" && myMove !== null && !myMove.done ? myMove : null;
  const myDone = myMove !== undefined && midRound === null;
  const oppDone = otherMove !== undefined && (typeof otherMove !== "object" || otherMove.done);
  const myName = (d.creatorId === me ? row.creatorName : row.opponentName) ?? "?";
  const otherName = (d.creatorId === me ? row.opponentName : row.creatorName) ?? "?";
  const title = d.kind === "claim" ? d.claim : (duelKindLabels(t)[d.kind] ?? d.claim);
  const settled = d.status === "settled";
  const open = d.status === "open";
  const disputed = d.status === "disputed";
  const dead = ["declined", "cancelled"].includes(d.status);
  const skimCents = ((d.state as DuelState)?.skimCents) ?? 0;
  const iWon = settled && d.winnerId === me;
  const draw = settled && !d.winnerId;
  const game = d.kind !== "claim";
  const awaiting = d.pendingById === me;
  const toMove = !settled && !open && !disputed && game && !myDone;

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-[#0b0e0d] text-[#eef3ee]">
      {/* stage glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[46vh] opacity-60"
        style={{ background: "radial-gradient(60% 100% at 50% 0%, rgba(64,128,92,0.28), transparent 70%)" }}
      />
      {/* floor glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[30vh] opacity-40"
        style={{ background: "radial-gradient(60% 100% at 50% 100%, rgba(255,217,112,0.14), transparent 70%)" }}
      />
      <div className="relative mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 pb-10">
        {/* top bar */}
        <div className="flex items-center gap-3 py-4">
          <button
            type="button"
            onClick={() => router.push("/duels")}
            className="grid size-9 place-items-center rounded-full border border-white/15 bg-white/5 hover:bg-white/10 transition cursor-pointer"
            aria-label={t.duelArenaClose}
          >
            <ArrowLeft className="size-4" />
          </button>
          <div className="flex-1 min-w-0 text-center">
            <div className="inline-flex items-center gap-2">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-[#9fd4b4]">
                {KIND_ICONS[d.kind] ?? <Swords className="size-3" />}
                {duelKindLabels(t)[d.kind] ?? d.kind}
              </div>
              {d.status === "accepted" && (
                <span className="inline-flex items-center gap-1 rounded-full border border-no/40 bg-no-soft/10 px-2.5 py-1 text-[10px] font-black tracking-widest text-[#ff9d94]">
                  <span className="size-1.5 rounded-full bg-[#ff9d94] animate-pulse" />
                  {t.duelLive}
                </span>
              )}
            </div>
          </div>
          <span className="w-9" />
        </div>

        {/* title + pot */}
        <div className="mt-2 text-center">
          <h1 className="text-[19px] font-bold leading-snug px-2">{title}</h1>
          <div className="mt-3 inline-flex items-baseline gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-2.5">
            <span className="num text-[26px] font-black tabular-nums text-[#ffd970]">{fmtMonos(d.stakeCents * 2, { lang })}</span>
            <span className="text-[12px] font-semibold uppercase tracking-widest text-white/50">{t.duelPot}</span>
          </div>
        </div>

        {/* matchup */}
        <div className="mt-8 flex items-start justify-center gap-5 sm:gap-8">
          <Fighter
            name={myName}
            you
            active={toMove}
            state={!game || settled || open || dead ? undefined : myDone ? "locked" : midRound ? "playing" : "idle"}
            stateText={t}
          />
          <span className="num pt-8 text-[15px] font-black tracking-[0.3em] text-white/35">VS</span>
          <Fighter
            name={otherName}
            active={!settled && !open && !disputed && game && myDone && !oppDone}
            state={!game || settled || open || dead ? undefined : otherMove === undefined ? "idle" : oppDone ? "locked" : "playing"}
            stateText={t}
          />
        </div>

        {/* stage */}
        <div className="mt-10 flex flex-1 flex-col items-center justify-start gap-5">
          {dead && (
            <div className="text-[14px] font-medium text-white/50">{d.status}</div>
          )}

          {open && (
            <>
              <div className="flex items-center gap-2 text-[13.5px] text-white/60">
                <span className="size-2 rounded-full bg-[#9fd4b4] animate-pulse" />
                {d.creatorId === me ? t.duelWaitAccept(otherName) : t.duelChallengedYou(myName)}
              </div>
              {d.opponentId === me && (
                <div className="flex gap-3 w-full max-w-sm">
                  <Button size="lg" variant="yes" className="flex-1 text-[15px]" disabled={pending}
                    onClick={() => run(() => respondDuel({ id: d.id, accept: true }), t.duelAcceptedToast)}>
                    <Check className="size-4" /> {t.duelAccept}
                  </Button>
                  <Button size="lg" variant="outline" className="flex-1 text-[15px]" disabled={pending}
                    onClick={() => run(() => respondDuel({ id: d.id, accept: false }), t.duelDeclinedToast)}>
                    <X className="size-4" /> {t.duelDecline}
                  </Button>
                </div>
              )}
              {d.creatorId === me && (
                <Button variant="outline" disabled={pending}
                  onClick={() => run(() => cancelDuel({ id: d.id }), t.duelCancelledToast)}>
                  {t.duelCancel}
                </Button>
              )}
            </>
          )}

          {disputed && (
            <div className="flex max-w-sm items-center gap-2 rounded-xl border border-no/40 bg-no-soft/10 px-4 py-3 text-[13px] font-medium text-[#ff9d94]">
              <AlertTriangle className="size-4 shrink-0" /> {t.duelDisputed} — {t.duelRulesNote}
            </div>
          )}

          {settled && (
            <>
              {Object.keys(moves).length === 2 && (
                <div className="anim-win-pop flex items-center gap-6 num text-[40px] font-black tabular-nums">
                  <span className={iWon ? "text-[#6fdc9c]" : "text-white/45"}>{duelFmtMove(t, d.kind, myMove)}</span>
                  <span className="text-[16px] text-white/25">:</span>
                  <span className={!iWon && !draw ? "text-[#6fdc9c]" : "text-white/45"}>{duelFmtMove(t, d.kind, otherMove)}</span>
                </div>
              )}
              <div className={cn("flex items-center gap-2.5 text-[19px] font-bold", iWon ? "text-[#6fdc9c]" : draw ? "text-white/60" : "text-[#ff9d94]")}>
                <Trophy className="size-6" />
                {draw ? t.duelRefunded : iWon ? t.duelWonYou : t.duelLostYou}
              </div>
              {iWon && skimCents > 0 && (
                <div className="text-[12px] font-semibold text-[#ffcf7a]">
                  {t.debtGarnish(fmtMonos(skimCents, { lang }))} ·{" "}
                  {t.gameCredited(`+${fmtMonos(d.stakeCents * 2 - skimCents, { lang })}`)}
                </div>
              )}
              <Button variant="outline" onClick={() => router.push("/duels")}>{t.duelBackToDuels}</Button>
            </>
          )}

          {!settled && !open && !disputed && game && (
            midRound ? (
              // Mid-round phases — the round is live, keep playing.
              d.kind === "hilo" ? (
                <div className="flex flex-col items-center gap-4">
                  <MiniCard v={Number(midRound.data?.face)} size="lg" />
                  <div className="flex gap-3 w-full max-w-xs">
                    <Button size="lg" variant="yes" className="flex-1" disabled={pending} onClick={() => play(d.id, "higher")}>{t.hiloHigher}</Button>
                    <Button size="lg" variant="outline" className="flex-1" disabled={pending} onClick={() => play(d.id, "lower")}>{t.hiloLower}</Button>
                  </div>
                </div>
              ) : d.kind === "blackjack" ? (
                <div className="flex flex-col items-center gap-4">
                  <div className="flex flex-wrap justify-center gap-2">
                    {((midRound.data?.hand as number[] | undefined) ?? []).map((v, i) => <MiniCard key={i} v={v} />)}
                  </div>
                  <div className="num text-[30px] font-black text-[#9fd4b4]">{handTotal((midRound.data?.hand as number[] | undefined) ?? []).total}</div>
                  <div className="flex gap-3 w-full max-w-xs">
                    <Button size="lg" variant="yes" className="flex-1" disabled={pending} onClick={() => play(d.id, "hit")}>{t.bjHit}</Button>
                    <Button size="lg" variant="outline" className="flex-1" disabled={pending} onClick={() => play(d.id, "stand")}>{t.bjStand}</Button>
                  </div>
                </div>
              ) : (
                <TimerStage t0={Number(midRound.data?.t0)} targetMs={DUEL_TIMER_MS} pending={pending} label={t.duelTimedTarget} onStop={() => play(d.id, "stop")} stopLabel={t.duelStop} />
              )
            ) : myDone ? (
              <>
                <div className="num text-[46px] font-black tabular-nums text-[#6fdc9c]">{duelFmtMove(t, d.kind, myMove)}</div>
                <div className="flex items-center gap-2 text-[13.5px] text-white/60">
                  <span className="size-2 rounded-full bg-[#9fd4b4] animate-pulse" />
                  {oppDone ? t.duelWaitMove : t.duelWaitingArena}
                </div>
              </>
            ) : d.kind === "rps" ? (
              <div className="grid w-full max-w-sm grid-cols-3 gap-3">
                {([["rock", <Mountain key="r" className="size-6" />], ["paper", <Newspaper key="p" className="size-6" />], ["scissors", <Scissors key="s" className="size-6" />]] as const).map(([m, icon]) => (
                  <button
                    key={m}
                    disabled={pending}
                    onClick={() => play(d.id, m)}
                    className="aspect-square rounded-2xl border border-white/12 bg-white/[0.05] text-[13px] font-bold flex flex-col items-center justify-center gap-1.5 hover:border-[#9fd4b4]/60 hover:bg-[#9fd4b4]/10 active:scale-95 transition disabled:opacity-50 cursor-pointer"
                  >
                    {icon}
                    {duelMoveLabel(t, m)}
                  </button>
                ))}
              </div>
            ) : d.kind === "coinflip" || d.kind === "redblack" ? (
              <div className="w-full max-w-sm space-y-3">
                <div className="text-center text-[12px] font-semibold uppercase tracking-widest text-white/45">{t.duelPickSide}</div>
                <div className="grid grid-cols-2 gap-3">
                  {(d.kind === "coinflip" ? (["heads", "tails"] as const) : (["red", "black"] as const)).map((m) => (
                    <button
                      key={m}
                      disabled={pending}
                      onClick={() => play(d.id, m)}
                      className={cn(
                        "h-14 rounded-2xl border text-[15px] font-bold flex items-center justify-center gap-2 active:scale-95 transition disabled:opacity-50 cursor-pointer",
                        m === "red" ? "border-no/50 bg-no-soft/10 text-[#ff9d94] hover:bg-no-soft/20"
                          : m === "black" ? "border-white/15 bg-white/[0.07] text-white hover:bg-white/[0.12]"
                          : "border-white/12 bg-white/[0.05] hover:border-[#9fd4b4]/60 hover:bg-[#9fd4b4]/10",
                      )}
                    >
                      {d.kind === "coinflip" ? <Coins className="size-4" /> : m === "red" ? <Heart className="size-4" /> : <Spade className="size-4" />}
                      {duelMoveLabel(t, m)}
                    </button>
                  ))}
                </div>
              </div>
            ) : d.kind === "limbo" ? (
              <div className="w-full max-w-sm space-y-3">
                <Input value={limboTarget} onChange={(e) => setLimboTarget(e.target.value)} placeholder={t.duelTargetPh} inputMode="decimal" className="text-center text-[17px]" />
                <Button size="lg" variant="yes" className="w-full h-14 text-[17px]" disabled={pending || !Number.isFinite(Number(limboTarget))} onClick={() => play(d.id, limboTarget)}>
                  {KIND_ICONS[d.kind]} {t.duelLaunch}
                </Button>
              </div>
            ) : d.kind === "hilo" || d.kind === "blackjack" ? (
              <Button size="lg" variant="yes" className="w-full max-w-sm h-14 text-[17px]" disabled={pending} onClick={() => play(d.id, "deal")}>
                {KIND_ICONS[d.kind]} {t.bjDeal}
              </Button>
            ) : d.kind === "timer" ? (
              <div className="w-full max-w-sm space-y-3">
                <div className="text-center text-[12px] font-semibold uppercase tracking-widest text-white/45">{t.duelTimedTarget}</div>
                <Button size="lg" variant="yes" className="w-full h-14 text-[17px]" disabled={pending} onClick={() => play(d.id, "start")}>
                  <Play className="size-4" /> {t.duelStart}
                </Button>
              </div>
            ) : (
              <Button
                size="lg"
                variant="yes"
                className="w-full max-w-sm text-[17px] h-14"
                disabled={pending}
                onClick={() => play(d.id)}
              >
                {KIND_ICONS[d.kind]} {d.kind === "roll" || d.kind === "dice" ? t.duelRollBtn : d.kind === "wheel" ? t.duelSpinBtn : t.duelDrawBtn}
              </Button>
            )
          )}

          {!settled && !open && !disputed && !game && (
            awaiting ? (
              <div className="flex items-center gap-2 text-[13.5px] text-white/60">
                <span className="size-2 rounded-full bg-[#9fd4b4] animate-pulse" />
                {t.duelAwaiting}
              </div>
            ) : (
              <div className="w-full max-w-sm space-y-3">
                <Button variant="yes" className="w-full h-13 text-[15px]" disabled={pending}
                  onClick={() => run(() => proposeDuelWinner({ id: d.id, winnerId: me }), t.duelVotedToast)}>
                  <Trophy className="size-4" /> {t.duelIWon}
                </Button>
                <Button variant="outline" className="w-full h-13 text-[15px]" disabled={pending}
                  onClick={() => run(() => proposeDuelWinner({ id: d.id, winnerId: otherId }), t.duelVotedToast)}>
                  {t.duelTheyWon}
                </Button>
                <p className="text-center text-[11.5px] text-white/40">{t.duelRulesNote}</p>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

function Fighter({ name, you, active, state, stateText }: {
  name: string;
  you?: boolean;
  active?: boolean;
  state?: "idle" | "playing" | "locked";
  stateText: ReturnType<typeof getT>;
}) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-2">
      <span
        className={cn(
          "grid size-20 sm:size-24 place-items-center rounded-full text-[30px] font-black transition-shadow",
          you ? "bg-[#9fd4b4] text-[#0b0e0d]" : "bg-white/10 text-white border border-white/15",
          active && "shadow-[0_0_0_4px_rgba(159,212,180,0.25),0_0_32px_rgba(159,212,180,0.25)]"
        )}
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
      <span className="max-w-[130px] truncate text-[14px] font-semibold text-white/85">@{name}</span>
      {state && (
        <span
          className={cn(
            "inline-flex h-6 min-w-6 items-center justify-center gap-1 rounded-full border px-2 text-[10px] font-bold uppercase tracking-wider",
            state === "locked" ? "border-[#9fd4b4]/50 bg-[#9fd4b4]/15 text-[#9fd4b4]"
              : state === "playing" ? "border-[#ffd970]/40 bg-[#ffd970]/10 text-[#ffd970]"
              : "border-white/15 bg-white/5 text-white/40",
          )}
        >
          {state === "locked" ? <><Check className="size-3" /> {stateText.duelMoveDone}</>
            : state === "playing" ? <><span className="size-1.5 rounded-full bg-[#ffd970] animate-pulse" /> {stateText.duelMovePlaying}</>
            : "…"}
        </span>
      )}
    </div>
  );
}

// Compact playing card for duel hands — rank + suit, red suits in red.
function MiniCard({ v, size }: { v: number; size?: "lg" }) {
  const c = cardLabel(v);
  return (
    <span
      className={cn(
        "inline-flex flex-col items-center justify-center rounded-xl border border-white/15 bg-white/[0.06] font-black tabular-nums",
        size === "lg" ? "size-24 text-[26px]" : "size-14 text-[17px]",
        c.red ? "text-[#ff9d94]" : "text-white",
      )}
    >
      {c.rank}
      <span className={cn(size === "lg" ? "text-[22px]" : "text-[13px]", "leading-none")}>{c.suit}</span>
    </span>
  );
}

// Live stopwatch for the timer duel — ticks client-side, the server's stored
// t0 is authoritative for the error measurement.
function TimerStage({ t0, targetMs, pending, label, stopLabel, onStop }: {
  t0: number;
  targetMs: number;
  pending: boolean;
  label: string;
  stopLabel: string;
  onStop: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 41);
    return () => clearInterval(id);
  }, []);
  const elapsed = Math.max(0, now - t0);
  const remaining = targetMs - elapsed;
  return (
    <div className="flex w-full max-w-xs flex-col items-center gap-4">
      <div className="num text-[52px] font-black tabular-nums leading-none">
        {(elapsed / 1000).toFixed(2)}
        <span className="ml-1 text-[16px] font-semibold text-white/40">s</span>
      </div>
      <div className="text-[12px] font-semibold uppercase tracking-widest text-white/45">{label}</div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className={cn("h-full rounded-full transition-[width] duration-75", remaining > 0 ? "bg-[#9fd4b4]" : "bg-[#ff9d94]")}
          style={{ width: `${Math.min(100, (elapsed / targetMs) * 100)}%` }}
        />
      </div>
      <Button size="lg" variant="yes" className="w-full h-14 text-[17px]" disabled={pending} onClick={onStop}>
        <OctagonX className="size-4" /> {stopLabel}
      </Button>
    </div>
  );
}
