import Link from "next/link";
import type { Metadata } from "next";
import { MarketCard } from "@/components/market-card";
import {
  listMarkets,
  getSparklines,
  getCommentCount,
  getGroupOptionsFor,
  getGroupTraderCounts,
  listCategories,
  getWatchlistIds,
  getLikedIds,
  getLikeCounts,
} from "@/lib/queries";
import { getCurrentUser, isAdmin } from "@/lib/session";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Všechny trhy" };

// Full browse view — every market, filterable by category, sort, and status.
export default async function MarketsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const cat = sp.cat ?? "all";
  const sort = sp.sort === "new" || sp.sort === "closing" ? sp.sort : "trending";
  const status = sp.status === "resolved" ? "resolved" : "live";
  const lang = await getLang();
  const t = getT(lang);

  const [user, categories] = await Promise.all([getCurrentUser(), listCategories()]);
  const watchIdsP = user ? getWatchlistIds(user.id) : Promise.resolve<string[]>([]);
  const likedIdsP = user ? getLikedIds(user.id) : Promise.resolve<string[]>([]);
  const [watchIds, likedIds, markets] = await Promise.all([
    watchIdsP,
    likedIdsP,
    listMarkets({
      category: cat,
      sort: sort === "trending" ? undefined : sort,
      status,
      includePendingForUser: isAdmin(user) ? user!.id : undefined,
    }),
  ]);

  const watchSet = new Set(watchIds);
  const likedSet = new Set(likedIds);
  const ids = markets.map((m) => m.id);
  const groupIds = markets.filter((m) => m.kind === "group").map((m) => m.id);
  const [sparks, comments, groupOptions, likeCounts, groupTraders] = await Promise.all([
    getSparklines(ids),
    getCommentCount(ids),
    getGroupOptionsFor(groupIds),
    getLikeCounts(ids),
    getGroupTraderCounts(groupIds),
  ]);
  const trendingIds = new Set(
    [...markets].filter((m) => m.status === "live").sort((a, b) => b.volumeCents - a.volumeCents).slice(0, 3).map((m) => m.id)
  );

  const chipHref = (over: Record<string, string>) => {
    const p = new URLSearchParams();
    const merged = { cat, sort, status, ...over };
    if (merged.cat !== "all") p.set("cat", merged.cat);
    if (merged.sort !== "trending") p.set("sort", merged.sort);
    if (merged.status !== "live") p.set("status", merged.status);
    const s = p.toString();
    return `/markets${s ? `?${s}` : ""}`;
  };
  const chip = (key: string, active: boolean) =>
    cn(
      "rounded-full border px-3 py-1.5 text-[12.5px] font-semibold whitespace-nowrap transition-colors",
      active
        ? "border-brand bg-brand-soft text-brand-strong"
        : "border-line bg-surface text-mute hover:text-ink hover:border-faint/60"
    );

  return (
    <div className="mx-auto max-w-6xl px-4 pb-10">
      <h1 className="pt-6 text-[22px] font-bold tracking-tight">{t.allMarkets}</h1>

      {/* filters */}
      <div className="mt-4 space-y-3">
        <div className="scrollbar-none -mx-4 px-4 flex gap-1.5 overflow-x-auto">
          <Link href={chipHref({ cat: "all" })} className={chip("all", cat === "all")}>
            {t.tabAll}
          </Link>
          {categories.map((c) => (
            <Link key={c} href={chipHref({ cat: c })} className={chip(c, cat === c)}>
              {c}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {(["trending", "new", "closing"] as const).map((s) => (
            <Link key={s} href={chipHref({ sort: s })} className={chip(s, sort === s)}>
              {s === "trending" ? t.tabTrending : s === "new" ? t.tabNew : t.tabClosing}
            </Link>
          ))}
          <span className="mx-1 h-4 w-px bg-line-2" aria-hidden />
          {(["live", "resolved"] as const).map((s) => (
            <Link key={s} href={chipHref({ status: s })} className={chip(s, status === s)}>
              {s === "live" ? t.live : t.resolved}
            </Link>
          ))}
          <span className="ml-auto num text-[12px] text-faint font-medium">
            {markets.length} {t.marketsN}
          </span>
        </div>
      </div>

      {markets.length === 0 ? (
        <div className="mt-8 rounded-[14px] border border-dashed border-line py-20 text-center">
          <p className="text-mute font-medium">{t.emptyMarkets}</p>
          <p className="text-[13px] text-faint mt-1">
            {t.beFirst} <Link href="/propose" className="underline underline-offset-2 text-ink">{t.createOne}</Link>.
          </p>
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {markets.map((m, i) => (
            <MarketCard
              key={m.id}
              market={m}
              spark={sparks.get(m.id) ?? []}
              comments={comments.get(m.id) ?? 0}
              index={i}
              options={groupOptions.get(m.id)}
              lang={lang}
              watching={user ? watchSet.has(m.id) : undefined}
              liked={user ? likedSet.has(m.id) : undefined}
              likes={likeCounts.get(m.id) ?? 0}
              trending={trendingIds.has(m.id)}
              groupTraders={groupTraders.get(m.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
