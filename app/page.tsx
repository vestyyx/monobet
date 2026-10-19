import { Suspense } from "react";
import { after } from "next/server";
import { CategoryTabs } from "@/components/category-tabs";
import { LiveRefresher } from "@/components/live-refresher";
import { TradeTicker } from "@/components/trade-ticker";
import { MarketCard } from "@/components/market-card";
import { Sk, MarketCardSkeleton } from "@/components/skeletons";
import { listMarkets, getSparklines, getCommentCount, getGlobalTrades, getSiteStats, getGroupOptionsFor, getGroupTraderCounts, listCategories, getWatchlistIds, getLikedIds, getLikeCounts, getExpiredLive, maybeNotifyClosing } from "@/lib/queries";
import { fmtMonos } from "@/lib/money";
import { getCurrentUser, isAdmin } from "@/lib/session";
import { getLang } from "@/lib/lang-server";
import { getT, LOCALES, type Lang } from "@/lib/i18n";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: { absolute: "MonoPredict — Platforma pro kolektivní prognózování" } };

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const cat = sp.cat ?? "all";
  const q = sp.q;
  const lang = await getLang();
  const [user, categories] = await Promise.all([getCurrentUser(), listCategories()]);
  // Watchlist/likes start resolving now — only the "watching" tab blocks the
  // market query on them; everything else streams in alongside the results.
  const watchIdsP = user ? getWatchlistIds(user.id) : Promise.resolve<string[]>([]);
  const likedIdsP = user ? getLikedIds(user.id) : Promise.resolve<string[]>([]);
  // Closing-in-24h reminders land in the bell — written after the response
  // streams so the fan-out never blocks the render.
  if (user) after(() => maybeNotifyClosing(user.id));

  return (
    <div className="mx-auto max-w-6xl px-4">
      <LiveRefresher intervalMs={15000} />
      <Suspense>
        <CategoryTabs categories={categories} lang={lang} showWatching={!!user} />
      </Suspense>
      <Suspense fallback={<ResultsSkeleton />}>
        <MarketResults cat={cat} q={q} lang={lang} user={user} watchIdsP={watchIdsP} likedIdsP={likedIdsP} />
      </Suspense>
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div aria-busy>
      <Sk className="my-5 h-7 w-44" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <MarketCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

async function MarketResults({
  cat,
  q,
  lang,
  user,
  watchIdsP,
  likedIdsP,
}: {
  cat: string;
  q?: string;
  lang: Lang;
  user: Awaited<ReturnType<typeof getCurrentUser>>;
  watchIdsP: Promise<string[]>;
  likedIdsP: Promise<string[]>;
}) {
  const t = getT(lang);
  const [watchIds, likedIds, markets, expired] = await Promise.all([
    watchIdsP,
    likedIdsP,
    (cat === "watching" ? watchIdsP : Promise.resolve<string[]>([])).then((ids) =>
      listMarkets({
        category: cat,
        q,
        sort: cat === "new" ? "new" : cat === "closing" || cat === "watching" ? "closing" : "trending",
        ids: cat === "watching" ? ids : undefined,
        includePendingForUser: isAdmin(user) ? user!.id : undefined,
      })
    ),
    cat === "all" && !q ? getExpiredLive() : Promise.resolve([]),
  ]);
  const watchSet = new Set(watchIds);
  const likedSet = new Set(likedIds);
  const ids = markets.map((m) => m.id);
  const groupIds = markets.filter((m) => m.kind === "group").map((m) => m.id);
  const [sparks, comments, ticker, stats, groupOptions, likeCounts, groupTraders] = await Promise.all([
    getSparklines(ids),
    getCommentCount(ids),
    getGlobalTrades(),
    getSiteStats(),
    getGroupOptionsFor(groupIds),
    getLikeCounts(ids),
    getGroupTraderCounts(groupIds),
  ]);
  // Flame badge for the three busiest live markets on the page.
  const trendingIds = new Set(
    [...markets].filter((m) => m.status === "live").sort((a, b) => b.volumeCents - a.volumeCents).slice(0, 3).map((m) => m.id)
  );

  return (
    <>
      <TradeTicker trades={ticker} lang={lang} />

      {expired.length > 0 && (
        <div className="mt-4 rounded-xl border border-warn-soft bg-warn-soft/40 px-4 py-3 flex items-center gap-3 flex-wrap">
          <div className="text-[13.5px] font-semibold text-warn-strong shrink-0">
            {t.resolveQueue(expired.length)}
          </div>
          <div className="flex gap-2 flex-wrap min-w-0">
            {expired.map((m) => (
              <a
                key={m.id}
                href={`/market/${m.slug}`}
                className="text-[12.5px] font-medium text-ink bg-surface rounded-lg border border-line px-2.5 py-1 hover:border-faint/60 truncate max-w-64"
              >
                {m.question}
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="py-5 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-[22px] font-bold tracking-tight">
          {q ? t.resultsFor(q) : cat === "all" ? t.allMarkets : cat === "closing" ? t.tabClosing : cat === "watching" ? t.tabWatching : t.headingCat(cat)}
        </h1>
        <span className="num text-[12.5px] text-mute font-medium">
          {fmtMonos(stats.volumeCents, { lang })} {t.traded} · {stats.trades.toLocaleString(LOCALES[lang])} {stats.trades === 1 ? t.bet : t.bets} · {stats.users} {stats.users === 1 ? t.traderSingular : t.traders} · {markets.length} {t.marketsN}
        </span>
      </div>

      {markets.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-line py-20 text-center">
          <p className="text-mute font-medium">{t.emptyMarkets}</p>
          <p className="text-[13px] text-faint mt-1">
            {t.beFirst} <a href="/propose" className="underline underline-offset-2 text-ink">{t.createOne}</a>.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {markets.map((m, i) => (
            <MarketCard key={m.id} market={m} spark={sparks.get(m.id) ?? []} comments={comments.get(m.id) ?? 0} index={i} options={groupOptions.get(m.id)} lang={lang} watching={user ? watchSet.has(m.id) : undefined} liked={user ? likedSet.has(m.id) : undefined} likes={likeCounts.get(m.id) ?? 0} trending={trendingIds.has(m.id)} groupTraders={groupTraders.get(m.id)} />
          ))}
        </div>
      )}
    </>
  );
}
