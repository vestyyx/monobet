import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getAchievements, getPublicProfile, getSquadInvites, getStatsSince, getUserLedger, getUserTrades } from "@/lib/queries";
import { getCurrentUser, isAdmin } from "@/lib/session";
import { getLang } from "@/lib/lang-server";
import { getT, type Lang } from "@/lib/i18n";
import { Avatar, Badge, Card } from "@/components/ui/primitives";
import { ProfileSettings } from "@/components/profile-settings";
import { AvatarUpload } from "@/components/avatar-upload";
import { BalanceChart } from "@/components/balance-chart";
import { fmtMonos, fmtDate, fmtShares, timeAgo } from "@/lib/money";
import { marketYesPrice } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { ChartLine, CheckCircle2, ListOrdered, Lock, ShieldCheck, TrendingDown, TrendingUp, Trophy } from "lucide-react";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }): Promise<Metadata> {
  const { username } = await params;
  return { title: `@${decodeURIComponent(username)}` };
}

export default async function ProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const [profile, viewer, lang] = await Promise.all([
    getPublicProfile(decodeURIComponent(username)),
    getCurrentUser(),
    getLang(),
  ]);
  if (!profile) notFound();
  const t = getT(lang);
  const { user: u, stats, positions, created, netWorthCents, rank, playPnlCents, games, squadName } = profile;
  const isSelf = viewer?.id === u.id;
  const [achievements, invites, selfTrades, selfLedger, statsSince] = await Promise.all([
    getAchievements(u.id),
    isSelf ? getSquadInvites(u.id) : Promise.resolve([] as Awaited<ReturnType<typeof getSquadInvites>>),
    // Private sections — fetched only for the owner, never for the public.
    isSelf ? getUserTrades(u.id) : Promise.resolve([] as Awaited<ReturnType<typeof getUserTrades>>),
    isSelf ? getUserLedger(u.id, 300) : Promise.resolve([] as Awaited<ReturnType<typeof getUserLedger>>),
    isSelf ? getStatsSince() : Promise.resolve(null),
  ]);

  // Balance history — ledger rows arrive newest-first; the chart wants time
  // ascending. Rows before the stats epoch stay in the ledger for audit but
  // off the chart — the line opens at the epoch with the reconstructed
  // pre-row balance so it starts at the reset, not mid-air.
  const postEpoch = selfLedger.filter((l) => !statsSince || l.createdAt >= statsSince);
  const balanceSeries = postEpoch
    .slice()
    .reverse()
    .map((l) => ({ t: l.createdAt, balanceCents: l.balanceAfterCents }));
  if (statsSince) {
    const last = postEpoch[postEpoch.length - 1];
    balanceSeries.unshift({ t: statsSince, balanceCents: last ? last.balanceAfterCents - last.amountCents : u.balanceCents });
  }
  if (balanceSeries.length === 0 || balanceSeries[balanceSeries.length - 1].balanceCents !== u.balanceCents)
    balanceSeries.push({ t: new Date(), balanceCents: u.balanceCents });

  // (No win-rate stat: positions are deleted at settlement, so there's
  // nothing left to compute it from — duel count is the honest substitute.)

  const achMeta: Record<string, { title: string; desc: string }> = {
    portfolio: { title: t.bonusPortfolio, desc: t.bonusPortfolioDesc },
    instagram: { title: t.bonusInstagram, desc: t.bonusInstagramDesc },
    github: { title: t.bonusGithub, desc: t.bonusGithubDesc },
    first_bet: { title: t.bonusFirstBet, desc: t.bonusFirstBetDesc },
    first_market: { title: t.bonusFirstMarket, desc: t.bonusFirstMarketDesc },
    first_comment: { title: t.bonusFirstComment, desc: t.bonusFirstCommentDesc },
    first_game: { title: t.bonusFirstGame, desc: t.bonusFirstGameDesc },
    first_win: { title: t.bonusFirstWin, desc: t.bonusFirstWinDesc },
    avatar: { title: t.bonusAvatar, desc: t.bonusAvatarDesc },
    watchlist: { title: t.bonusWatchlist, desc: t.bonusWatchlistDesc },
    heart: { title: t.bonusHeart, desc: t.bonusHeartDesc },
    duel: { title: t.bonusDuel, desc: t.bonusDuelDesc },
    squad: { title: t.bonusSquad, desc: t.bonusSquadDesc },
    ten_trades: { title: t.bonusTenTrades, desc: t.bonusTenTradesDesc },
    streak7: { title: t.bonusStreak7, desc: t.bonusStreak7Desc },
    first_sell: { title: t.bonusFirstSell, desc: t.bonusFirstSellDesc },
    note: { title: t.bonusNote, desc: t.bonusNoteDesc },
    vote: { title: t.bonusVote, desc: t.bonusVoteDesc },
    duel_win: { title: t.bonusDuelWin, desc: t.bonusDuelWinDesc },
    squad_owner: { title: t.bonusSquadOwner, desc: t.bonusSquadOwnerDesc },
    referrer: { title: t.bonusReferrer, desc: t.bonusReferrerDesc },
    fifty_trades: { title: t.bonusFiftyTrades, desc: t.bonusFiftyTradesDesc },
    active7: { title: t.bonusActive7, desc: t.bonusActive7Desc },
    streak_7: { title: t.achStreak7, desc: t.achStreak7Desc },
    trades_10: { title: t.achTrades10, desc: t.achTrades10Desc },
    trades_50: { title: t.achTrades50, desc: t.achTrades50Desc },
    markets_5: { title: t.achMarkets5, desc: t.achMarkets5Desc },
    comments_10: { title: t.achComments10, desc: t.achComments10Desc },
    season_podium: { title: t.achPodium, desc: t.achPodiumDesc },
    whale: { title: t.achWhale, desc: t.achWhaleDesc },
  };

  return (
    <div className="mx-auto max-w-4xl px-4 pt-8 pb-10">
      {/* Identity card */}
      <Card className="p-5 sm:p-6 flex items-center gap-4 sm:gap-5 flex-wrap border-t-2 border-t-brand/50">
        {isSelf ? (
          <AvatarUpload name={u.username ?? u.name} image={u.image} lang={lang} />
        ) : (
          <Avatar name={u.username ?? u.name} image={u.image} className="size-16 sm:size-20 text-2xl" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-[20px] font-bold tracking-tight">@{u.username ?? u.name}</h1>
            {isAdmin(u) && <Badge tone="yes"><ShieldCheck className="size-3" /> {t.umAdmin}</Badge>}
            {u.bannedAt && <Badge tone="no">{t.umBanned}</Badge>}
            {squadName && <Badge tone="warn">{squadName}</Badge>}
            {isSelf && <Badge tone="ink">{t.umYou}</Badge>}
            {rank > 0 && <Badge tone="warn"><Trophy className="size-3" /> #{rank}</Badge>}
          </div>
          <div className="text-[12.5px] text-mute mt-0.5">
            {t.joined} {fmtDate(u.createdAt, lang)}
          </div>
        </div>
        <div className="w-full sm:w-auto text-left sm:text-right">
          <div className="num text-[24px] font-bold leading-none">{fmtMonos(netWorthCents, { lang })}</div>
          <div className="text-[11px] text-mute mt-1">{t.lbNetWorth}</div>
          <div
            className={`num mt-2 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12.5px] font-bold ${
              playPnlCents >= 0 ? "bg-yes/10 text-yes-strong" : "bg-no/10 text-no-strong"
            }`}
            title={t.playPnl}
          >
            {playPnlCents >= 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
            {playPnlCents >= 0 ? "+" : ""}
            {fmtMonos(playPnlCents, { lang })}
            <span className="font-medium opacity-70">{t.playPnl}</span>
          </div>
        </div>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-4">
        <Stat label={t.lbBalance} value={fmtMonos(u.balanceCents, { lang })} />
        <Stat label={t.lbPositions} value={fmtMonos(positions.reduce((s, p) => s + p.valueCents, 0), { lang })} />
        <Stat label={t.duelsTitle} value={String(stats.duels)} />
        <Stat label={t.trades} value={String(stats.trades)} />
        <Stat label={t.markets} value={String(stats.markets)} />
      </div>

      {isSelf && balanceSeries.length > 1 && (
        <Card className="mt-4 p-4">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-mute mb-1">
            <ChartLine className="size-4" />
            {t.pfBalanceHistory}
          </div>
          <BalanceChart points={balanceSeries} lang={lang} />
        </Card>
      )}

      {isSelf && (
        <div className="mt-4">
          <ProfileSettings
            squadName={squadName}
            invites={invites}
            notifResolve={u.notifResolve}
            notifClosing={u.notifClosing}
            lang={lang}
          />
        </div>
      )}

      {/* Achievements */}
      <section className="mt-8">
        <h2 className="text-[15px] font-semibold mb-3">{t.achievements}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {achievements.map((a) => {
            const meta = achMeta[a.key] ?? { title: a.key, desc: "" };
            return (
              <Card key={a.key} className={`p-3.5 ${a.unlocked ? "border-yes/40" : "opacity-60"}`}>
                <div className="flex items-center gap-2">
                  {a.unlocked ? (
                    <CheckCircle2 className="size-4 text-yes shrink-0" />
                  ) : (
                    <Lock className="size-4 text-faint shrink-0" />
                  )}
                  <span className={`text-[13px] font-semibold truncate ${a.unlocked ? "" : "text-mute"}`}>{meta.title}</span>
                </div>
                <div className="text-[11.5px] text-mute mt-1 line-clamp-2">{meta.desc}</div>
                {!a.unlocked && a.progress > 0 && (
                  <div className="mt-2 h-1 rounded-full bg-surface-3 overflow-hidden">
                    <div className="h-full bg-brand" style={{ width: `${Math.round(a.progress * 100)}%` }} />
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 mt-8">
        {/* Open positions */}
        <section>
          <h2 className="text-[15px] font-semibold mb-3">{t.openPositions}</h2>
          <Card className="p-1.5">
            {positions.length === 0 && <p className="p-4 text-sm text-mute">{t.noPositions}</p>}
            {positions.map((p) => {
              return (
                <Link
                  key={p.market.id}
                  href={`/market/${p.market.slug}`}
                  className="block px-3 py-2.5 rounded-lg hover:bg-surface-2"
                >
                  <div className="text-[13px] font-medium line-clamp-1">{p.market.question}</div>
                  <div className="text-[11.5px] text-mute mt-0.5 flex items-center gap-2">
                    {p.yesShares > 0.001 && (
                      <Badge tone="yes" className="text-[10px] px-1.5 py-0">YES ×{fmtShares(p.yesShares, lang)}</Badge>
                    )}
                    {p.noShares > 0.001 && (
                      <Badge tone="no" className="text-[10px] px-1.5 py-0">NO ×{fmtShares(p.noShares, lang)}</Badge>
                    )}
                    <span className="num ml-auto font-semibold text-ink">{fmtMonos(p.valueCents, { lang })}</span>
                  </div>
                </Link>
              );
            })}
          </Card>
        </section>

        {/* Markets created */}
        <section>
          <h2 className="text-[15px] font-semibold mb-3">{t.marketsCreated}</h2>
          <Card className="p-1.5">
            {created.length === 0 && <p className="p-4 text-sm text-mute">{t.noCreated}</p>}
            {created.map((m) => (
              <Link
                key={m.id}
                href={`/market/${m.slug}`}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium line-clamp-1">{m.question}</div>
                  <div className="text-[11.5px] text-mute mt-0.5">
                    {fmtMonos(m.volumeCents, { lang })} {t.vol.toLowerCase()}
                  </div>
                </div>
                <Badge
                  tone={m.status === "live" ? "yes" : m.status === "resolved" ? "ink" : m.status === "pending" ? "warn" : "mute"}
                >
                  {m.status === "live"
                    ? `${Math.round(marketYesPrice(m) * 100)}%`
                    : m.status === "resolved"
                      ? (m.outcome ?? "—").toUpperCase()
                      : m.status}
                </Badge>
              </Link>
            ))}
          </Card>
        </section>

        {/* Recent games */}
        <section className="lg:col-span-2">
          <h2 className="text-[15px] font-semibold mb-3">{t.recentGames}</h2>
          <Card className="p-1.5">
            {games.length === 0 && <p className="p-4 text-sm text-mute">{t.noGames}</p>}
            {games.map((g) => (
              <div key={g.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                <span className="truncate text-mute flex-1 min-w-0">{g.memo || "game"}</span>
                <span className={`num font-semibold whitespace-nowrap ${g.amountCents > 0 ? "text-yes-strong" : "text-ink"}`}>
                  {g.amountCents > 0 ? "+" : ""}
                  {fmtMonos(g.amountCents, { lang })}
                </span>
                <span className="text-faint text-[11px] w-20 shrink-0 text-right whitespace-nowrap">{timeAgo(g.createdAt, lang)}</span>
              </div>
            ))}
          </Card>
        </section>
      </div>

      {/* Private: trade log + cash flow. Owner only — the public page stops at
          positions, created markets, and game history. */}
      {isSelf && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 mt-8">
          <section>
            <h2 className="text-[15px] font-semibold mb-3 flex items-center gap-2">
              <ListOrdered className="size-4" /> {t.recentTrades}
            </h2>
            <Card className="p-1.5">
              {selfTrades.length === 0 && <p className="p-4 text-sm text-mute">{t.noTrades}</p>}
              {selfTrades.map(({ trade: tr, question, slug }) => (
                <Link
                  key={tr.id}
                  href={`/market/${slug}`}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-surface-2 text-[13px]"
                >
                  <Badge tone={tr.outcome === "yes" ? "yes" : "no"}>
                    {(tr.outcome === "yes" ? t.yes : t.no).toUpperCase()}
                  </Badge>
                  <span className={cn("font-medium", tr.side === "buy" ? "text-ink" : "text-mute")}>
                    {tr.side === "buy" ? t.buy.toLowerCase() : t.sell.toLowerCase()}
                  </span>
                  <span className="num text-mute">{fmtShares(Number(tr.shares), lang)}</span>
                  <span className="truncate text-mute flex-1">{question}</span>
                  <span className="num font-semibold">{fmtMonos(tr.amountCents, { lang })}</span>
                  <span className="text-faint text-[11px] w-14 text-right">{timeAgo(tr.createdAt, lang)}</span>
                </Link>
              ))}
            </Card>
          </section>

          <section>
            <h2 className="text-[15px] font-semibold mb-3">{t.cashFlow}</h2>
            <Card className="p-1.5">
              {selfLedger.slice(0, 30).map((l) => (
                <div key={l.id} className="flex items-center gap-3 px-3 py-2.5 text-[13px]">
                  <KindBadge kind={l.kind} lang={lang} />
                  <span className="truncate text-mute flex-1">{l.memo || l.kind}</span>
                  <span className={cn("num font-semibold", l.amountCents > 0 ? "text-yes-strong" : "text-ink")}>
                    {l.amountCents > 0 ? "+" : ""}
                    {fmtMonos(l.amountCents, { lang })}
                  </span>
                  <span className="num text-faint text-[11.5px] w-20 text-right">
                    → {fmtMonos(l.balanceAfterCents, { lang })}
                  </span>
                </div>
              ))}
            </Card>
          </section>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <Card className="p-4 min-w-0 overflow-hidden">
      <div className="text-[11.5px] font-medium text-mute truncate">{label}</div>
      <div
        title={value}
        className={`num mt-1 text-[19px] font-bold truncate ${tone === "up" ? "text-yes-strong" : tone === "down" ? "text-no-strong" : ""}`}
      >
        {value}
      </div>
    </Card>
  );
}

function KindBadge({ kind, lang }: { kind: string; lang?: Lang }) {
  const t = getT(lang ?? "cs");
  const map: Record<string, { label: string; tone: "yes" | "no" | "ink" | "mute" | "warn" }> = {
    signup: { label: t.kindBonus, tone: "ink" },
    claim: { label: t.kindClaim, tone: "ink" },
    activity: { label: t.kindActivity, tone: "ink" },
    grant: { label: t.kindGrant, tone: "ink" },
    buy: { label: t.kindBuy, tone: "mute" },
    sell: { label: t.kindSell, tone: "mute" },
    payout: { label: t.kindPayout, tone: "yes" },
    refund: { label: t.kindRefund, tone: "warn" },
    weekly: { label: t.kindClaim, tone: "ink" },
    ad: { label: t.kindBonus, tone: "ink" },
    bonus: { label: t.kindBonus, tone: "ink" },
    game: { label: t.kindGame, tone: "ink" },
    fee: { label: t.kindFee, tone: "mute" },
    jackpot: { label: t.kindJackpot, tone: "yes" },
    liq: { label: t.kindLiq, tone: "no" },
    duel: { label: t.kindDuel, tone: "warn" },
    loan: { label: t.kindLoan, tone: "warn" },
    repay: { label: t.kindRepay, tone: "yes" },
    burn: { label: t.kindBurn, tone: "mute" },
    debt: { label: t.kindDebt, tone: "no" },
    transfer: { label: t.kindTransfer, tone: "ink" },
  };
  const { label, tone } = map[kind] ?? { label: kind, tone: "mute" as const };
  return <Badge tone={tone}>{label}</Badge>;
}
