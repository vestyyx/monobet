import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/session";
import { getUserLedger, getJackpot, getDisabledGames } from "@/lib/queries";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { Card } from "@/components/ui/primitives";
import { SessionChip } from "@/components/session-chip";
import { fmtMonos, fmtCountdown, timeAgo } from "@/lib/money";
import { Gamepad2, Coins, Dices, Timer, Rocket, Disc3, Cherry, Spade, CircleDot, ChevronRight, Sparkles, ArrowUpDown, Contrast } from "lucide-react";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Hry" };

export default async function GamesPage() {
  const [user, lang] = await Promise.all([getCurrentUser(), getLang()]);
  if (!user) redirect("/login");
  const t = getT(lang);
  const [ledger, jackpot, disabled] = await Promise.all([
    getUserLedger(user.id, 60).then((l) => l.filter((x) => x.kind === "game").slice(0, 12)),
    getJackpot(user.id),
    getDisabledGames(),
  ]);

  // Per-game accent tints — only tokens the theme actually ships.
  const TINTS = {
    brand: "bg-brand-soft text-brand-strong",
    yes: "bg-yes/10 text-yes-strong",
    no: "bg-no/10 text-no-strong",
    warn: "bg-warn-soft text-warn-strong",
  } as const;
  const games = [
    { slug: "coinflip", icon: Coins, title: t.gCoinFlip, sub: t.gCoinFlipSub, tint: TINTS.warn },
    { slug: "dice", icon: Dices, title: t.gDice, sub: t.gDiceSub, tint: TINTS.brand },
    { slug: "timer", icon: Timer, title: t.gTimer, sub: t.gTimerSub, tint: TINTS.yes },
    { slug: "limbo", icon: Rocket, title: t.gLimbo, sub: t.gLimboSub, tint: TINTS.no },
    { slug: "wheel", icon: Disc3, title: t.gWheel, sub: t.gWheelSub, tint: TINTS.yes },
    { slug: "slots", icon: Cherry, title: t.gSlots, sub: t.gSlotsSub, tint: TINTS.no },
    { slug: "blackjack", icon: Spade, title: t.gBlackjack, sub: t.gBlackjackSub, tint: TINTS.brand },
    { slug: "plinko", icon: CircleDot, title: t.gPlinko, sub: t.gPlinkoSub, tint: TINTS.warn },
    { slug: "hilo", icon: ArrowUpDown, title: t.gHilo, sub: t.gHiloSub, tint: TINTS.brand },
    { slug: "redblack", icon: Contrast, title: t.gRedBlack, sub: t.gRedBlackSub, tint: TINTS.no },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 pt-8 pb-10">
      <h1 className="text-[22px] font-bold tracking-tight flex items-center gap-2">
        <Gamepad2 className="size-5" /> {t.games}
      </h1>
      <div className="mt-1 flex items-center gap-2.5 flex-wrap">
        <p className="text-[13px] text-mute">{t.gamesSub}</p>
        <SessionChip
          windowStart={user.gameSessionStart?.getTime() ?? null}
          lastPlayAt={user.gameLastPlayAt?.getTime() ?? null}
          playedMs={user.gamePlayedMs}
          lang={lang}
        />
      </div>

      {jackpot && (
        <Card className="mt-5 p-4 flex items-center gap-4 flex-wrap">
          <span className="size-11 rounded-xl bg-warn-soft text-warn-strong grid place-items-center shrink-0">
            <Sparkles className="size-5" />
          </span>
          <div className="flex-1 min-w-48">
            <div className="text-[15px] font-bold tracking-tight">
              {t.jpTitle} · <span className="num text-warn-strong">{fmtMonos(jackpot.poolCents, { lang })}</span>
            </div>
            <div className="text-[12px] text-mute leading-snug mt-0.5">{t.jpSub}</div>
            {jackpot.last && (
              <div className="text-[11.5px] text-faint mt-1">
                {jackpot.last.winner
                  ? t.jpLast(jackpot.last.winner.username ?? jackpot.last.winner.name, fmtMonos(jackpot.last.poolCents, { lang }))
                  : t.jpNoWinner}
              </div>
            )}
          </div>
          <div className="text-right shrink-0">
            <div className="num text-[14px] font-bold">{t.jpDrawIn} {fmtCountdown(jackpot.drawAt)}</div>
            <div className="num text-[11.5px] text-faint">{t.jpYourTickets} {jackpot.yourTickets}</div>
          </div>
        </Card>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {games.map((g) => {
          const off = disabled.includes(g.slug);
          return (
            <Link
              key={g.slug}
              href={`/games/${g.slug}`}
              className={cn("group", off && "pointer-events-none")}
              aria-disabled={off}
            >
              <Card className={cn(
                "p-5 h-full flex items-center gap-3.5 transition-all duration-150",
                off ? "opacity-50" : "hover:border-brand/40 hover:shadow-sm group-hover:-translate-y-0.5"
              )}>
                <span className={cn("size-11 rounded-xl grid place-items-center shrink-0", g.tint)}>
                  <g.icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-[15px] font-bold tracking-tight">
                    {g.title}
                    {off && (
                      <span className="rounded-md bg-no/10 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-no-strong">
                        {t.gDisabled}
                      </span>
                    )}
                  </span>
                  <span className="block text-[12px] text-faint leading-snug mt-0.5">{g.sub}</span>
                </span>
                {!off && <ChevronRight className="size-4 text-faint group-hover:text-ink transition-colors shrink-0" />}
              </Card>
            </Link>
          );
        })}
      </div>

      <section className="mt-10">
        <h2 className="text-[15px] font-semibold mb-3">{t.recentGames}</h2>
        <Card className="p-1.5">
          {ledger.length === 0 && <p className="p-4 text-sm text-mute">{t.noGames}</p>}
          {ledger.map((l) => (
            <div key={l.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
              <span className="truncate text-mute flex-1">{l.memo || "game"}</span>
              <span className={cn("num font-semibold", l.amountCents > 0 ? "text-yes-strong" : "text-ink")}>
                {l.amountCents > 0 ? "+" : ""}
                {fmtMonos(l.amountCents, { lang })}
              </span>
              <span className="text-faint text-[11px] w-20 shrink-0 text-right whitespace-nowrap">{timeAgo(l.createdAt, lang)}</span>
            </div>
          ))}
        </Card>
      </section>

      <p className="mt-8 text-[12px] text-faint leading-relaxed max-w-2xl">{t.fairNote}</p>
    </div>
  );
}
