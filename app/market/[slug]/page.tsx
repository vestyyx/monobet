import { notFound, permanentRedirect } from "next/navigation";
import Link from "next/link";
import { Clock, Users, Scale, CheckCircle2, XCircle, Hourglass, StickyNote, Repeat, ChevronDown } from "lucide-react";
import type { Metadata } from "next";
import {
  getMarketBySlug,
  getMarketById,
  getPriceHistory,
  getRecentTrades,
  getGroupTrades,
  getGroupOptions,
  getComments,
  getUserPosition,
  getMyPositions,
  getPositionBadges,
  getRelatedMarkets,
  getSparklines,
  getGroupHistories,
  getMarketBetCount,
  listCategories,
  isLiked,
  getLikeCounts,
  marketYesPrice,
  getResolutionState,
  getResolutionStates,
  getTopHolders,
  getGroupHolders,
  getGroupTraderCount,
  getUserPublic,
  listMarkets,
  getCommunityNotes,
  getNotesFor,
  getLevConfig,
} from "@/lib/queries";
import { getCurrentUser, isAdmin } from "@/lib/session";
import { multiCoords, multiPrices } from "@/lib/lmsr";
import { getLang } from "@/lib/lang-server";
import { getT, type Dict } from "@/lib/i18n";
import { fmtMonos, fmtDate, fmtShares } from "@/lib/money";
import { PriceChart } from "@/components/price-chart";
import { LocalTime } from "@/components/local-time";
import { LikeButton } from "@/components/like-button";
import { CopyLink } from "@/components/copy-link";
import { ShareButton } from "@/components/share-button";
import { LiveRefresher } from "@/components/live-refresher";
import { TradeTicket } from "@/components/trade-ticket";
import { MarketTabs } from "@/components/market-tabs";
import { Comments } from "@/components/comments";
import { ActivityFeed } from "@/components/activity-feed";
import { Badge, Card, Avatar } from "@/components/ui/primitives";
import { MarketIcon } from "@/components/market-icon";
import { GroupTrade } from "@/components/group-trade";
import { DeleteMarketButton } from "@/components/delete-market-button";
import { MarketManagePanel } from "@/components/market-manage";
import { ResolutionPanel } from "@/components/resolution-panel";
import { NoteStanceBar } from "@/components/note-stance-bar";
import { optionColor } from "@/lib/option-style";
import { cn, openPct } from "@/lib/utils";

export const dynamic = "force-dynamic";

const recurLabel = (t: Dict, d: number | null) =>
  d === 1 ? t.recurDaily : d === 7 ? t.recurWeekly : d === 14 ? t.recurBiweekly : d === 30 ? t.recurMonthly : null;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const m = await getMarketBySlug(slug);
  // Options price off the group's shared book; a group parent has no single %.
  let pct = 0;
  if (m?.parentId) {
    const sibs = (await getGroupOptions(m.parentId)).filter((o) => o.status === "live");
    const i = sibs.findIndex((s) => s.id === m.id);
    if (i >= 0) {
      const price = multiPrices(multiCoords(sibs.map((s) => ({ qYes: Number(s.qYes), qNo: Number(s.qNo) }))), m.b)[i];
      pct = m.status === "live" ? openPct(price) : Math.round(price * 100);
    }
  } else if (m && m.kind !== "group") {
    const price = marketYesPrice(m);
    pct = m.status === "live" ? openPct(price) : Math.round(price * 100);
  }
  // Group parents hold seed volume only — the real number is the sum of
  // option volumes, same as the page header and OG image.
  const groupVolume = m?.kind === "group" ? (await getGroupOptions(m.id)).reduce((s, o) => s + o.volumeCents, 0) : 0;
  const shownVolume = m?.kind === "group" ? groupVolume : (m?.volumeCents ?? 0);
  return {
    title: m?.question ?? "Trh",
    description: m
      ? m.kind === "group"
        ? `${fmtMonos(shownVolume)} zobchodováno na MonoPredict`
        : `${pct}% ANO · ${fmtMonos(shownVolume)} zobchodováno na MonoPredict`
      : "Trh na MonoPredict",
    openGraph: m ? { title: m.question } : undefined,
  };
}

export default async function MarketPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ opt?: string; side?: string }> }) {
  const { slug } = await params;
  const { opt: selOpt, side: selSide } = await searchParams;
  const market = await getMarketBySlug(slug);
  if (!market) notFound();
  // Old/alias URL — send to the canonical slug, keeping ?opt=&side=.
  if (market.slug !== slug) {
    const qs = [selOpt && `opt=${selOpt}`, selSide && `side=${selSide}`].filter(Boolean).join("&");
    permanentRedirect(`/market/${market.slug}${qs ? `?${qs}` : ""}`);
  }

  const [user, lang, levCfg] = await Promise.all([getCurrentUser(), getLang(), getLevConfig()]);
  const t = getT(lang);
  // Global market cap intersects the per-market cap — admin can tighten every
  // ticket at once; a market's own ceiling still applies.
  const tradeLevCap = (m: { maxLeverage: number }) => Math.min(m.maxLeverage, levCfg.tradeMaxLev);
  // Pending markets are only visible to admin and their proposer.
  if (market.status === "pending" || market.status === "rejected") {
    const canSee = user && (isAdmin(user) || user.id === market.creatorId);
    if (!canSee) notFound();
  }

  if (market.kind === "group") {
    const [options, trades, comments, sameCat, liked, likes] = await Promise.all([
      getGroupOptions(market.id),
      getGroupTrades(market.id),
      getComments(market.id, user?.id, !!user && isAdmin(user)),
      getRelatedMarkets(market.id, market.category),
      user ? isLiked(user.id, market.id) : false,
      getLikeCounts([market.id]),
    ]);
    // No same-category markets? Fall back to the busiest live markets so the
    // rail never renders empty.
    const related = sameCat.length > 0
      ? sameCat
      : (await listMarkets({ status: "live", limit: 8 })).filter((m) => m.id !== market.id).slice(0, 6);
    return <GroupMarketView market={market} options={options} trades={trades} comments={comments} related={related} user={user} lang={lang} liked={liked} likes={likes.get(market.id) ?? 0} selOpt={selOpt} selSide={selSide} tradeLevCap={levCfg.tradeMaxLev} levFeeBps={levCfg.levFeeBps} levCfgSpend={levCfg.tradeMaxSpendCents} />;
  }

  const canManage = !!user && (isAdmin(user) || market.creatorId === user.id);

  const [parent, optionSibs, history, trades, comments, position, related, betCount, categories, res, liked, likes, holders, creator, posBadges, notes] = await Promise.all([
    market.parentId ? getMarketById(market.parentId) : null,
    // Options price off the group's shared book — softmax over live siblings.
    market.parentId ? getGroupOptions(market.parentId).then((o) => o.filter((s) => s.status === "live")) : null,
    getPriceHistory(market.id),
    getRecentTrades(market.id),
    getComments(market.id, user?.id, !!user && isAdmin(user)),
    user ? getUserPosition(market.id, user.id) : null,
    getRelatedMarkets(market.id, market.category),
    getMarketBetCount(market.id),
    listCategories(),
    getResolutionState(market.id, user?.id),
    user ? isLiked(user.id, market.id) : false,
    getLikeCounts([market.id]),
    getTopHolders(market.id),
    getUserPublic(market.creatorId),
    getPositionBadges([market.id]),
    // Resolvers need every note for review; everyone else only sees the
    // published ones (they land in the card above the rules).
    canManage ? getCommunityNotes(market.id) : getCommunityNotes(market.id, { publishedOnly: true }),
  ]);
  const optIdx = optionSibs?.findIndex((s) => s.id === market.id) ?? -1;
  const sharedQ =
    optionSibs && optIdx >= 0
      ? multiCoords(optionSibs.map((s) => ({ qYes: Number(s.qYes), qNo: Number(s.qNo) })))
      : undefined;
  const canDelete = !!user && (isAdmin(user) || (market.creatorId === user.id && betCount === 0));
  const publishedNotes = notes.filter((n) => n.published);

  // Comment badges: each commenter's dominant side on this market.
  const badges: Record<string, { label: string; shares: number; tone: "yes" | "no" }> = {};
  for (const p of posBadges) {
    const yes = Number(p.yesShares);
    const no = Number(p.noShares);
    if (Math.max(yes, no) < 0.01) continue;
    badges[p.userId] = yes >= no
      ? { label: t.yes.toUpperCase(), shares: yes, tone: "yes" }
      : { label: t.no.toUpperCase(), shares: no, tone: "no" };
  }

  const py = sharedQ ? multiPrices(sharedQ, market.b)[optIdx] : marketYesPrice(market);
  const heldYes = Number(position?.yesShares ?? 0);
  const heldNo = Number(position?.noShares ?? 0);
  const stops = position
    ? {
        tpYes: position.tpYes == null ? null : Number(position.tpYes),
        slYes: position.slYes == null ? null : Number(position.slYes),
        tpNo: position.tpNo == null ? null : Number(position.tpNo),
        slNo: position.slNo == null ? null : Number(position.slNo),
        yesPct: position.yesSellPct ?? null,
        noPct: position.noSellPct ?? null,
      }
    : null;
  const posValue = Math.round((heldYes * py + heldNo * (1 - py)) * 100);
  // A live market past its close is closed for trading — status stays "live"
  // in the DB until a resolver settles it, so expiry is derived here.
  const expired = market.status === "live" && !!market.closesAt && market.closesAt <= new Date();
  const tradable = market.status === "live" && !expired;

  return (
    <div className="mx-auto max-w-6xl px-4 pt-5">
      {market.status === "live" && <LiveRefresher intervalMs={8000} />}
      <div className="text-[12.5px] text-mute font-medium">
        <Link href="/" className="hover:text-ink">{t.markets}</Link>
        <span className="mx-1.5">/</span>
        <Link href={`/?cat=${market.category}`} className="hover:text-ink">{market.category}</Link>
        {parent ? (
          <>
            <span className="mx-1.5">/</span>
            <Link href={`/market/${parent.slug}`} className="hover:text-ink truncate max-w-56 inline-block align-bottom">{parent.question}</Link>
            {market.label && (
              <>
                <span className="mx-1.5">/</span>
                <span className="text-ink-2">{market.label}</span>
              </>
            )}
          </>
        ) : (
          <>
            <span className="mx-1.5">/</span>
            <span className="text-ink-2 truncate max-w-72 inline-block align-bottom">{market.question}</span>
          </>
        )}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* left column */}
        <div className="min-w-0">
          <div className="flex items-start gap-4">
            <MarketIcon market={market} size="size-12" />
            <div className="min-w-0 flex-1">
              <h1 className="text-[24px] sm:text-[28px] font-bold tracking-tight leading-tight">
                {market.question}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-4 text-[12.5px] text-mute font-medium">
                <span className="num">{fmtMonos(market.volumeCents, { lang })} {t.volume}</span>
                <span className="inline-flex items-center gap-1.5">
                  <Users className="size-3.5" /> {market.traderCount} {t.tradersW}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="size-3.5" />
                  {market.closesAt ? <>{expired ? t.closedOn : t.closes} <LocalTime d={market.closesAt} lang={lang} /></> : t.noCloseDate}
                </span>
                {recurLabel(t, market.recurDays) && (
                  <span className="inline-flex items-center gap-1.5" title={t.repeatsHint}>
                    <Repeat className="size-3.5" /> {recurLabel(t, market.recurDays)}
                  </span>
                )}
                {tradable && (
                  <Badge tone="yes" className="uppercase">
                    <span className="live-dot" /> {t.live}
                  </Badge>
                )}
              </div>
            </div>
            {user && (
              <span className="mt-1.5 inline-flex items-center gap-1 shrink-0">
                <LikeButton marketId={market.id} liked={liked} count={likes.get(market.id) ?? 0} lang={lang} />
              </span>
            )}
            {market.status === "resolved" && (
              <Badge tone={market.outcome === "yes" ? "yes" : "no"} className="mt-1.5">
                {t.resolved} {(market.outcome === "yes" ? t.yes : t.no).toUpperCase()}
              </Badge>
            )}
            {expired && <Badge tone="warn" className="mt-1.5">{t.closedAwaiting}</Badge>}
            {market.status === "cancelled" && <Badge tone="mute" className="mt-1.5">{t.cancelled}</Badge>}
            {market.status === "pending" && <Badge tone="warn" className="mt-1.5">{t.pendingApproval}</Badge>}
            {market.status === "rejected" && <Badge tone="no" className="mt-1.5">{t.rejected}</Badge>}
            {market.status === "deleted" && <Badge tone="no" className="mt-1.5">{t.deleted}</Badge>}
            {canDelete && (
              <DeleteMarketButton marketId={market.id} question={market.question} admin={isAdmin(user)} lang={lang} />
            )}
          </div>

          {market.status === "resolved" && (
            <div className="mt-5 rounded-[14px] border border-line bg-surface-2 p-4 flex items-center gap-3">
              {market.outcome === "yes" ? (
                <CheckCircle2 className="size-5 text-yes shrink-0" />
              ) : (
                <XCircle className="size-5 text-no shrink-0" />
              )}
              <p className="text-sm">
                {t.resolvedBanner((market.outcome === "yes" ? t.yes : t.no).toUpperCase(), fmtDate(market.resolvedAt, lang))}
                {market.resolutionReason && (
                  <span className="block text-[12px] text-mute mt-0.5">{market.resolutionReason}</span>
                )}
              </p>
            </div>
          )}
          {market.status === "pending" && (
            <div className="mt-5 rounded-[14px] border border-dashed border-line p-4 flex items-center gap-3">
              <Hourglass className="size-5 text-amber-600 shrink-0" />
              <p className="text-sm text-mute">{t.pendingBanner}</p>
            </div>
          )}

          {/* chart + the Polymarket-style stats strip underneath */}
          <div className="mt-5 rounded-[14px] border border-line bg-surface p-4">
            <PriceChart
              points={history.map((h) => ({ t: h.t.toISOString(), p: Number(h.p) }))}
              trades={trades.map((tr) => ({
                t: tr.createdAt.toISOString(),
                p: Number(tr.yesPriceAfter),
                side: tr.side,
                outcome: tr.outcome,
                username: tr.username,
                amountCents: tr.amountCents,
                image: tr.image,
              }))}
              // eslint-disable-next-line react-hooks/purity -- server component renders once per request
              now={Date.now()}
              live={tradable}
              lang={lang}
            />
            <div className="mt-3 pt-3 border-t border-line-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-mute font-medium">
              <span className="num font-semibold text-ink-2">{fmtMonos(market.volumeCents, { lang })} {t.volume}</span>
              <span className="inline-flex items-center gap-1.5">
                <Users className="size-3.5" /> {market.traderCount} {t.tradersW}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock className="size-3.5" />
                {market.closesAt ? <>{expired ? t.closedOn : t.closes} <LocalTime d={market.closesAt} lang={lang} /></> : t.noCloseDate}
              </span>
              <span className="inline-flex items-center gap-1.5">
                {t.openedAt} {fmtDate(market.createdAt, lang)}
              </span>
              {market.opensAt && market.opensAt > new Date() && (
                <span className="inline-flex items-center gap-1.5 text-amber-600">
                  <Clock className="size-3.5" /> {t.opensLabel} <LocalTime d={market.opensAt} lang={lang} />
                </span>
              )}
              {recurLabel(t, market.recurDays) && (
                <span className="inline-flex items-center gap-1.5" title={t.repeatsHint}>
                  <Repeat className="size-3.5" /> {recurLabel(t, market.recurDays)}
                </span>
              )}
              <CopyLink path={`/market/${market.slug}`} lang={lang} />
              <ShareButton path={`/market/${market.slug}`} title={market.question} lang={lang} />
            </div>
          </div>

          {/* Mobile ticket — sits right under the chart; the sticky rail copy
              takes over on desktop. */}
          <div className="mt-4 lg:hidden">
            <TradeTicket
              marketId={market.id}
              qYes={Number(market.qYes)}
              qNo={Number(market.qNo)}
              b={market.b}
              live={tradable}
              signedIn={!!user}
              userBalanceCents={user?.balanceCents ?? null}
              heldYes={heldYes}
              heldNo={heldNo}
              stops={stops}
              maxLeverage={tradeLevCap(market)}
              levFeeBps={levCfg.levFeeBps}
              maxSpendCents={market.maxBetCents ?? levCfg.tradeMaxSpendCents}
              lang={lang}
              opensAt={market.opensAt}
              sharedQ={sharedQ}
              sharedIndex={optIdx}
            />
          </div>

          {market.status === "live" && (
            <div className="mt-5">
              <ResolutionPanel
                marketId={market.id}
                proposedOutcome={market.proposedOutcome}
                reason={market.resolutionReason}
                proposer={res.proposer}
                proposedById={market.proposedById}
                viewerId={user?.id}
                confirms={res.confirms}
                disputes={res.disputes}
                myVote={res.myVote}
                closed={!!market.closesAt && market.closesAt <= new Date()}
                isResolver={!!user && (isAdmin(user) || market.creatorId === user.id)}
                notes={canManage ? notes : []}
                noteGate={canManage && !isAdmin(user) && notes.length > 5}
                lang={lang}
              />
            </div>
          )}

          {publishedNotes.length > 0 && (
            <div className="mt-8">
              <h2 className="text-[15px] font-semibold mb-2 inline-flex items-center gap-2">
                <StickyNote className="size-4" /> {t.notesTitle}
              </h2>
              <NoteStanceBar notes={publishedNotes} lang={lang} />
              <Card className="p-1.5">
                {publishedNotes.map((n) => (
                  <div key={n.id} className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <Avatar name={n.username ?? "?"} image={n.userImage} className="size-5" />
                      <span className="text-[11.5px] font-semibold text-mute">@{n.username ?? "?"}</span>
                      {n.stance && (
                        <Badge tone={n.stance === "yes" ? "yes" : "no"}>
                          {(n.stance === "yes" ? t.yes : t.no).toUpperCase()}
                        </Badge>
                      )}
                    </div>
                    <p className="text-[13px] text-ink-2 mt-1 leading-snug whitespace-pre-wrap">{n.body}</p>
                  </div>
                ))}
              </Card>
            </div>
          )}

          {/* rules, then market context — same section structure as group markets */}
          {market.description && (
            <div className="mt-8">
              <h2 className="text-[15px] font-semibold mb-2 inline-flex items-center gap-2">
                <Scale className="size-4" /> {t.rules}
              </h2>
              <p className="text-sm text-ink-2 whitespace-pre-wrap leading-relaxed">{market.description}</p>
            </div>
          )}

          <div className="mt-8">
            <h2 className="text-[15px] font-semibold mb-2">{t.marketContext}</h2>
            <Card className="p-4">
              {market.context && (
                <p className="mb-3 pb-3 border-b border-line-2 text-sm text-ink-2 whitespace-pre-wrap leading-relaxed">
                  {market.context}
                </p>
              )}
              <dl className="grid grid-cols-1 gap-2.5 text-[13px] sm:grid-cols-2">
                <div className="flex items-center gap-2.5">
                  {creator && <Avatar name={creator.name} image={creator.image} className="size-7" />}
                  <div className="min-w-0">
                    <dt className="text-[11px] uppercase tracking-wide text-faint font-semibold">{t.creator}</dt>
                    <dd className="font-medium truncate">
                      {creator ? (
                        <Link href={`/u/${creator.username ?? ""}`} className="hover:text-brand-strong">
                          @{creator.username ?? creator.name}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </dd>
                  </div>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-faint font-semibold">{t.resolver}</dt>
                  <dd className="font-medium truncate">
                    {res.proposer ? `@${res.proposer}` : creator ? `@${creator.username ?? creator.name}` : "—"}
                    <span className="block text-[11px] font-normal text-faint">{t.resolverNote}</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-faint font-semibold">{t.openedAt}</dt>
                  <dd className="font-medium num">{fmtDate(market.createdAt, lang)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-faint font-semibold">{t.closes}</dt>
                  <dd className="font-medium num">
                    {market.closesAt ? <LocalTime d={market.closesAt} lang={lang} /> : t.noCloseDate}
                  </dd>
                </div>
              </dl>
            </Card>
          </div>

          <div className="mt-8">
            <MarketTabs
              lang={lang}
              activity={<ActivityFeed trades={trades} lang={lang} />}
              holders={
                holders.length > 0 ? (
                  <Card className="p-1.5">
                    {holders.slice(0, 8).map((h) => {
                      const yes = Number(h.yesShares);
                      const no = Number(h.noShares);
                      const side = yes >= no;
                      return (
                        <div key={h.username ?? h.name} className="flex items-center gap-3 px-3 py-2">
                          <Avatar name={h.name} image={h.image} className="size-7" />
                          <Link href={`/u/${h.username ?? ""}`} className="text-[13px] font-medium truncate flex-1 hover:text-brand-strong">
                            @{h.username ?? h.name}
                          </Link>
                          <span className={cn("num text-[12.5px] font-semibold", side ? "text-yes-strong" : "text-no-strong")}>
                            {fmtShares(side ? yes : no, lang)} {side ? t.yes : t.no}
                          </span>
                        </div>
                      );
                    })}
                  </Card>
                ) : (
                  <p className="text-sm text-faint">{t.noTradesYet}</p>
                )
              }
              holderCount={holders.length}
              comments={
                <Comments
                  marketId={market.id}
                  comments={comments}
                  signedIn={!!user}
                  currentUserId={user?.id}
                  viewerName={user?.username ?? user?.name}
                  viewerImage={user?.image}
                  isAdmin={isAdmin(user)}
                  lang={lang}
                  badges={badges}
                />
              }
              commentCount={comments.length}
              tradeCount={trades.length}
            />
          </div>
        </div>

        {/* right column */}
        <div className="space-y-4 lg:sticky lg:top-20 self-start">
          <div className="hidden lg:block">
            <TradeTicket
              marketId={market.id}
              qYes={Number(market.qYes)}
              qNo={Number(market.qNo)}
              b={market.b}
              live={tradable}
              signedIn={!!user}
              userBalanceCents={user?.balanceCents ?? null}
              heldYes={heldYes}
              heldNo={heldNo}
              stops={stops}
              maxLeverage={tradeLevCap(market)}
              levFeeBps={levCfg.levFeeBps}
              maxSpendCents={market.maxBetCents ?? levCfg.tradeMaxSpendCents}
              lang={lang}
              opensAt={market.opensAt}
              sharedQ={sharedQ}
              sharedIndex={optIdx}
            />
          </div>

          {(heldYes > 0.001 || heldNo > 0.001) && (
            <Card className="p-4 anim-rise">
              <h3 className="text-[13px] font-semibold text-mute uppercase tracking-wide">{t.yourPosition}</h3>
              <div className="mt-2.5 space-y-1.5 text-sm">
                {heldYes > 0.001 && (
                  <div className="flex justify-between">
                    <span className="text-yes-strong font-semibold">{t.yes}</span>
                    <span className="num">{fmtShares(heldYes, lang)} {t.sharesUnit}</span>
                  </div>
                )}
                {heldNo > 0.001 && (
                  <div className="flex justify-between">
                    <span className="text-no-strong font-semibold">{t.no}</span>
                    <span className="num">{fmtShares(heldNo, lang)} {t.sharesUnit}</span>
                  </div>
                )}
                <div className="flex justify-between pt-1.5 border-t border-line-2">
                  <span className="text-mute">{t.currentValue}</span>
                  <span className="num font-bold">{fmtMonos(posValue, { lang })}</span>
                </div>
              </div>
            </Card>
          )}

          {canManage && market.status !== "resolved" && (
            <MarketManagePanel market={market} categories={categories} betCount={betCount} isAdmin={isAdmin(user)} lang={lang} />
          )}

          {related.length > 0 && (
            <Card className="p-1.5">
              <h3 className="px-2.5 pt-2 pb-1 text-[12px] font-semibold uppercase tracking-wide text-faint">
                {t.relatedMarkets}
              </h3>
              <div className="divide-y divide-line-2">
                {related.slice(0, 6).map((m) => (
                  <Link
                    key={m.id}
                    href={`/market/${m.slug}`}
                    className="flex items-center gap-2.5 px-2.5 py-2.5 hover:bg-surface-2 rounded-lg transition-colors"
                  >
                    <MarketIcon market={m} size="size-8" />
                    <span className="min-w-0 flex-1 text-[13px] font-medium leading-snug line-clamp-2">{m.question}</span>
                    <span className="num text-[13px] font-bold text-ink-2 shrink-0">
                      {m.status === "live" ? openPct(marketYesPrice(m)) : Math.round(marketYesPrice(m) * 100)}%
                    </span>
                  </Link>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- multi-outcome group page ----------

async function GroupMarketView({
  market,
  options,
  trades,
  comments,
  related,
  user,
  lang,
  liked,
  likes = 0,
  selOpt,
  selSide,
  tradeLevCap,
  levFeeBps,
  levCfgSpend,
}: {
  market: Awaited<ReturnType<typeof getMarketBySlug>> & object;
  tradeLevCap: number;
  levFeeBps: number;
  levCfgSpend: number;
  options: Awaited<ReturnType<typeof getGroupOptions>>;
  trades: Awaited<ReturnType<typeof getGroupTrades>>;
  comments: Awaited<ReturnType<typeof getComments>>;
  related: Awaited<ReturnType<typeof getRelatedMarkets>>;
  user: Awaited<ReturnType<typeof getCurrentUser>>;
  lang: "en" | "cs";
  liked: boolean;
  likes?: number;
  selOpt?: string;
  selSide?: string;
}) {
  const t: Dict = getT(lang);
  const optionIds = options.map((o) => o.id);
  const live = options.filter((o) => o.status === "live");
  const canManage = !!user && (isAdmin(user) || market.creatorId === user.id);
  const [optionSparks, histories, betCount, categories, posRows, myPositions, creator, res, holders, resStates, notesMap, groupTraders] = await Promise.all([
    getSparklines(optionIds),
    getGroupHistories(optionIds),
    getMarketBetCount(market.id),
    listCategories(),
    getPositionBadges(optionIds),
    user ? getMyPositions(user.id, optionIds) : {},
    getUserPublic(market.creatorId),
    getResolutionState(market.id, user?.id),
    getGroupHolders(optionIds),
    getResolutionStates(optionIds, user?.id),
    canManage ? getNotesFor(optionIds) : getNotesFor(optionIds, { publishedOnly: true }),
    getGroupTraderCount(optionIds),
  ]);
  // Comment badges: each commenter's dominant option position. YES-side holders
  // get the option color, NO-side holders a red "No <option>" tag.
  const badges: Record<string, { label: string; shares: number; tone: "yes" | "no"; color?: string }> = {};
  for (const p of posRows) {
    const yes = Number(p.yesShares);
    const no = Number(p.noShares);
    const dom = Math.max(yes, no);
    if (dom < 0.01) continue;
    const prev = badges[p.userId];
    if (prev && prev.shares >= dom) continue;
    const oi = options.findIndex((o) => o.id === p.marketId);
    if (oi < 0) continue;
    const label = options[oi].label ?? options[oi].question;
    badges[p.userId] =
      yes >= no
        ? { label, shares: yes, tone: "yes", color: optionColor(oi) }
        : { label: `${t.no} ${label}`, shares: no, tone: "no" };
  }
  const volume = options.reduce((s, o) => s + o.volumeCents, 0);
  const traders = groupTraders;
  // A live group past its close is done taking bets; it just awaits resolution.
  const expired = !!market.closesAt && market.closesAt <= new Date();
  const anyLive = live.length > 0 && !expired;
  const canDelete = !!user && (isAdmin(user) || (market.creatorId === user.id && betCount === 0));
  // Multi-line chart: every option with a price history, colored by sort order
  // — resolved options stay as flat lines pinned at 0%/100%.
  const series = options
    .map((o, i) => ({
      key: o.id,
      label: o.label ?? o.question,
      color: optionColor(i),
      points: histories.get(o.id) ?? [],
    }))
    .filter((s) => s.points.length > 0);

  return (
    <div className="mx-auto max-w-6xl px-4 pt-5">
      {market.status === "live" && <LiveRefresher intervalMs={8000} />}
      <div className="text-[12.5px] text-mute font-medium">
        <Link href="/" className="hover:text-ink">{t.markets}</Link>
        <span className="mx-1.5">/</span>
        <Link href={`/?cat=${market.category}`} className="hover:text-ink">{market.category}</Link>
        <span className="mx-1.5">/</span>
        <span className="text-ink-2 truncate max-w-72 inline-block align-bottom">{market.question}</span>
      </div>

      <div className="mt-6 flex items-start gap-4">
        <MarketIcon market={market} size="size-12" />
        <div className="min-w-0 flex-1">
          <h1 className="text-[24px] sm:text-[28px] font-bold tracking-tight leading-tight flex items-start gap-2">
            <span className="flex-1">{market.question}</span>
            {user && (
              <span className="mt-1.5 inline-flex items-center gap-1 shrink-0">
                <LikeButton marketId={market.id} liked={liked} count={likes} lang={lang} />
              </span>
            )}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-[12.5px] text-mute font-medium">
            <span className="num">{fmtMonos(volume, { lang })} {t.volume}</span>
            <span className="inline-flex items-center gap-1.5">
              <Users className="size-3.5" /> {traders} {t.tradersW}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-3.5" />
              {market.closesAt ? <>{expired ? t.closedOn : t.closes} <LocalTime d={market.closesAt} lang={lang} /></> : t.noCloseDate}
            </span>
            {recurLabel(t, market.recurDays) && (
              <span className="inline-flex items-center gap-1.5" title={t.repeatsHint}>
                <Repeat className="size-3.5" /> {recurLabel(t, market.recurDays)}
              </span>
            )}
            {anyLive ? (
              <Badge tone="yes" className="uppercase">
                <span className="live-dot" /> {t.live}
              </Badge>
            ) : expired && market.status === "live" ? (
              <Badge tone="warn">{t.closedAwaiting}</Badge>
            ) : null}
          </div>
        </div>
        {canDelete && (
          <DeleteMarketButton marketId={market.id} question={market.question} admin={isAdmin(user)} lang={lang} />
        )}
      </div>

      <GroupTrade
        slug={market.slug}
        options={options.map((o, i) => ({
          id: o.id,
          slug: o.slug,
          label: o.label ?? o.question,
          imageUrl: o.imageUrl,
          status: o.status,
          outcome: o.outcome,
          qYes: Number(o.qYes),
          qNo: Number(o.qNo),
          b: o.b,
          volumeCents: o.volumeCents,
          traderCount: o.traderCount,
          index: i,
          proposedOutcome: o.proposedOutcome,
          proposedById: o.proposedById,
          resolutionReason: o.resolutionReason,
          opensAt: o.opensAt,
        }))}
        sparks={Object.fromEntries(optionSparks)}
        positions={myPositions}
        balanceCents={user?.balanceCents ?? null}
        signedIn={!!user}
        maxLeverage={Math.min(market.maxLeverage, tradeLevCap)}
        levFeeBps={levFeeBps}
        maxSpendCents={market.maxBetCents ?? levCfgSpend}
        lang={lang}
        initialOpt={selOpt}
        initialSide={selSide}
        resStates={Object.fromEntries(resStates)}
        notesByOption={canManage ? Object.fromEntries(notesMap) : undefined}
        noteCounts={Object.fromEntries([...notesMap].map(([k, v]) => [k, v.length]))}
        viewerId={user?.id}
        isResolver={canManage}
        adminGate={!isAdmin(user)}
        parentClosed={!!market.closesAt && market.closesAt <= new Date()}
        chartSeries={series}
        chartTrades={trades.map((tr) => ({
          t: tr.createdAt.toISOString(),
          p: Number(tr.yesPriceAfter),
          key: tr.marketId,
          side: tr.side,
          outcome: tr.outcome,
          username: tr.username,
          amountCents: tr.amountCents,
          image: tr.image,
        }))}
        // eslint-disable-next-line react-hooks/purity -- server component renders once per request
        chartNow={Date.now()}
        chartLive={anyLive}
        chartFooter={
          <div className="mt-3 pt-3 border-t border-line-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-mute font-medium">
              <span className="num font-semibold text-ink-2">{fmtMonos(volume, { lang })} {t.volume}</span>
              <span className="inline-flex items-center gap-1.5">
                <Users className="size-3.5" /> {traders} {t.tradersW}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock className="size-3.5" />
                {market.closesAt ? <>{expired ? t.closedOn : t.closes} <LocalTime d={market.closesAt} lang={lang} /></> : t.noCloseDate}
              </span>
              <span className="inline-flex items-center gap-1.5">
                {t.openedAt} {fmtDate(market.createdAt, lang)}
              </span>
              {market.opensAt && market.opensAt > new Date() && (
                <span className="inline-flex items-center gap-1.5 text-amber-600">
                  <Clock className="size-3.5" /> {t.opensLabel} <LocalTime d={market.opensAt} lang={lang} />
                </span>
              )}
              {recurLabel(t, market.recurDays) && (
                <span className="inline-flex items-center gap-1.5" title={t.repeatsHint}>
                  <Repeat className="size-3.5" /> {recurLabel(t, market.recurDays)}
                </span>
              )}
              <CopyLink path={`/market/${market.slug}`} lang={lang} />
              <ShareButton path={`/market/${market.slug}`} title={market.question} lang={lang} />
          </div>
        }
        left={
          <>
            {options.some((o) => (notesMap.get(o.id) ?? []).some((n) => n.published)) && (
              <div className="mt-8">
                <h2 className="text-[15px] font-semibold mb-2 inline-flex items-center gap-2">
                  <StickyNote className="size-4" /> {t.notesTitle}
                </h2>
                <NoteStanceBar notes={options.flatMap((o) => notesMap.get(o.id) ?? []).filter((n) => n.published)} lang={lang} />
                <Card className="p-1.5">
                  {options.flatMap((o) =>
                    (notesMap.get(o.id) ?? [])
                      .filter((n) => n.published)
                      .map((n) => (
                        <div key={n.id} className="px-3 py-2.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Avatar name={n.username ?? "?"} image={n.userImage} className="size-5" />
                            <span className="text-[11.5px] font-semibold text-mute">@{n.username ?? "?"}</span>
                            <Badge tone="mute">{t.notesOnOption(o.label ?? o.question)}</Badge>
                            {n.stance && (
                              <Badge tone={n.stance === "yes" ? "yes" : "no"}>
                                {(n.stance === "yes" ? t.yes : t.no).toUpperCase()}
                              </Badge>
                            )}
                          </div>
                          <p className="text-[13px] text-ink-2 mt-1 leading-snug whitespace-pre-wrap">{n.body}</p>
                        </div>
                      ))
                  )}
                </Card>
              </div>
            )}

            {market.description && (
              <div className="mt-8">
                <h2 className="text-[15px] font-semibold mb-2 inline-flex items-center gap-2">
                  <Scale className="size-4" /> {t.rules}
                </h2>
                <p className="text-sm text-ink-2 whitespace-pre-wrap leading-relaxed">{market.description}</p>
              </div>
            )}

            {/* Market context — creator, resolver, dates, background */}
            <div className="mt-8">
              <h2 className="text-[15px] font-semibold mb-2">{t.marketContext}</h2>
              <Card className="p-4">
                {market.context && (
                  <p className="mb-3 pb-3 border-b border-line-2 text-sm text-ink-2 whitespace-pre-wrap leading-relaxed">
                    {market.context}
                  </p>
                )}
                <dl className="grid grid-cols-1 gap-2.5 text-[13px] sm:grid-cols-2">
                  <div className="flex items-center gap-2.5">
                    {creator && <Avatar name={creator.name} image={creator.image} className="size-7" />}
                    <div className="min-w-0">
                      <dt className="text-[11px] uppercase tracking-wide text-faint font-semibold">{t.creator}</dt>
                      <dd className="font-medium truncate">
                        {creator ? (
                          <Link href={`/u/${creator.username ?? ""}`} className="hover:text-brand-strong">
                            @{creator.username ?? creator.name}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </dd>
                    </div>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-faint font-semibold">{t.resolver}</dt>
                    <dd className="font-medium truncate">
                      {res.proposer ? `@${res.proposer}` : creator ? `@${creator.username ?? creator.name}` : "—"}
                      <span className="block text-[11px] font-normal text-faint">{t.resolverNote}</span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-faint font-semibold">{t.openedAt}</dt>
                    <dd className="font-medium num">{fmtDate(market.createdAt, lang)}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-faint font-semibold">{t.closes}</dt>
                    <dd className="font-medium num">
                      {market.closesAt ? <LocalTime d={market.closesAt} lang={lang} /> : t.noCloseDate}
                    </dd>
                  </div>
                </dl>
              </Card>
            </div>

            <div className="mt-8">
              <MarketTabs
                lang={lang}
                activity={<ActivityFeed trades={trades} lang={lang} />}
                comments={
                  <Comments
                    marketId={market.id}
                    comments={comments}
                    signedIn={!!user}
                    currentUserId={user?.id}
                    viewerName={user?.username ?? user?.name}
                    viewerImage={user?.image}
                    isAdmin={isAdmin(user)}
                    lang={lang}
                    badges={badges}
                  />
                }
                holders={
                  holders.length > 0 ? (
                    <Card className="p-1.5">
                      {holders.map((h) => {
                        const labelFor = (marketId: string) => {
                          const oi = options.findIndex((o) => o.id === marketId);
                          return { label: options[oi]?.label ?? options[oi]?.question ?? "", col: optionColor(Math.max(0, oi)) };
                        };
                        const top = labelFor(h.marketId);
                        const all = h.holdings ?? [{ marketId: h.marketId, side: h.side, shares: h.shares }];
                        const row = (
                          <>
                            <Avatar name={h.name} image={h.image} className="size-7" />
                            <Link href={`/u/${h.username ?? ""}`} className="text-[13px] font-medium truncate flex-1 hover:text-brand-strong">
                              @{h.username ?? h.name}
                            </Link>
                            <span className="num text-[12.5px] font-semibold" style={{ color: h.side === "yes" ? top.col : "var(--no-strong)" }}>
                              {fmtShares(h.shares, lang)} {h.side === "yes" ? top.label : `${t.no} ${top.label}`}
                            </span>
                          </>
                        );
                        // Multi-position holders expand to show every option they hold.
                        if (all.length < 2)
                          return (
                            <div key={h.username ?? h.name} className="flex items-center gap-3 px-3 py-2">
                              {row}
                            </div>
                          );
                        return (
                          <details key={h.username ?? h.name} className="group px-3 py-2">
                            <summary className="flex items-center gap-3 cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden">
                              {row}
                              <span className="num inline-flex items-center gap-0.5 text-[11px] font-semibold text-faint">
                                +{all.length - 1}
                                <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
                              </span>
                            </summary>
                            <div className="mt-1.5 pl-10 flex flex-col gap-1">
                              {all.map((p) => {
                                const { label, col } = labelFor(p.marketId);
                                return (
                                  <span key={`${p.marketId}-${p.side}`} className="num text-[12px] font-semibold" style={{ color: p.side === "yes" ? col : "var(--no-strong)" }}>
                                    {fmtShares(p.shares, lang)} {p.side === "yes" ? label : `${t.no} ${label}`}
                                  </span>
                                );
                              })}
                            </div>
                          </details>
                        );
                      })}
                    </Card>
                  ) : (
                    <p className="text-sm text-faint">{t.noTradesYet}</p>
                  )
                }
                commentCount={comments.length}
                tradeCount={trades.length}
                holderCount={holders.length}
              />
            </div>
          </>
        }
        rail={
          <>
            {related.length > 0 && (
              <Card className="p-1.5">
                <h3 className="px-2.5 pt-2 pb-1 text-[12px] font-semibold uppercase tracking-wide text-faint">
                  {t.relatedMarkets}
                </h3>
                <div className="divide-y divide-line-2">
                  {related.slice(0, 6).map((m) => (
                    <Link
                      key={m.id}
                      href={`/market/${m.slug}`}
                      className="flex items-center gap-2.5 px-2.5 py-2.5 hover:bg-surface-2 rounded-lg transition-colors"
                    >
                      <MarketIcon market={m} size="size-8" />
                      <span className="min-w-0 flex-1 text-[13px] font-medium leading-snug line-clamp-2">{m.question}</span>
                      <span className="num text-[13px] font-bold text-ink-2 shrink-0">
                        {m.status === "live" ? openPct(marketYesPrice(m)) : Math.round(marketYesPrice(m) * 100)}%
                      </span>
                    </Link>
                  ))}
                </div>
              </Card>
            )}

            {canManage && market.status !== "resolved" && (
              <MarketManagePanel
                market={market}
                options={options.map((o) => ({ id: o.id, label: o.label ?? o.question, imageUrl: o.imageUrl }))}
                categories={categories}
                betCount={betCount}
                isAdmin={isAdmin(user)}
                lang={lang}
              />
            )}
          </>
        }
      />
    </div>
  );
}
