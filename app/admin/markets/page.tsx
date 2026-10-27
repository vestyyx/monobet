import { redirect } from "next/navigation";
import { and, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { requireRole } from "@/lib/admin/rbac";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { db, schema } from "@/lib/db";
import { AdminMarketsPanel, type AdminMarketRow } from "@/components/admin/market-panels";
import { MarketForm } from "@/components/market-form";
import { CategoriesPanel } from "@/components/admin-panels";
import { Button, Select, Card } from "@/components/ui/primitives";
import { listCategoryRows } from "@/lib/queries";

export const dynamic = "force-dynamic";

// Markets desk (Phase 5, admin+). MarketForm publishes instantly (an admin's
// proposeMarket runs the live fast-path) and the category manager stays;
// settlement, cancellation and deletion below each write an audit row.
// Editing intentionally stays on the market detail page — a form builder here
// would duplicate it.
export default async function AdminMarketsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const admin = await requireRole("admin");
  if (!admin) redirect("/login");
  const lang = await getLang();
  const t = getT(lang);
  const sp = await searchParams;
  const status = ["live", "pending", "resolved", "cancelled", "all"].includes(sp.status ?? "") ? sp.status! : "live";

  // Server-side filtering via plain GET params (same pattern as the audit log).
  const conds: SQL[] = [];
  if (sp.q) conds.push(or(ilike(schema.market.question, `%${sp.q}%`), ilike(schema.market.slug, `%${sp.q}%`))!);
  if (status !== "all") conds.push(eq(schema.market.status, status));

  const rows = await db
    .select({
      id: schema.market.id,
      slug: schema.market.slug,
      question: schema.market.question,
      status: schema.market.status,
      kind: schema.market.kind,
      label: schema.market.label,
      parentId: schema.market.parentId,
      category: schema.market.category,
      creator: schema.user.username,
      volumeCents: schema.market.volumeCents,
      traderCount: schema.market.traderCount,
      closesAt: schema.market.closesAt,
      outcome: schema.market.outcome,
      createdAt: schema.market.createdAt,
    })
    .from(schema.market)
    .leftJoin(schema.user, eq(schema.market.creatorId, schema.user.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.market.createdAt))
    .limit(200);

  const markets: AdminMarketRow[] = rows.map((m) => ({
    id: m.id,
    slug: m.slug,
    question: m.question,
    status: m.status,
    kind: m.kind,
    label: m.label,
    parentId: m.parentId,
    category: m.category,
    creator: m.creator,
    volumeCents: m.volumeCents,
    traderCount: m.traderCount,
    closesAt: m.closesAt,
    outcome: m.outcome,
  }));

  const categoryRows = await listCategoryRows();

  return (
    <div className="py-2">
      <h1 className="text-[20px] font-bold tracking-tight">{t.admMktsTitle}</h1>
      <p className="text-[12.5px] text-mute mt-0.5 mb-4">{t.admMktsSub}</p>

      {/* GET filters — work without JS, shared across the players desk pattern */}
      <form method="GET" className="flex items-center gap-2 flex-wrap mb-3">
        <input
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder={t.admPlayersQ}
          className="h-8 w-[200px] text-[12.5px] rounded-lg border border-line bg-surface px-2.5"
        />
        <Select name="status" defaultValue={status} className="h-8 w-[150px] text-[12.5px]">
          <option value="live">{t.admMktsStatusLive}</option>
          <option value="pending">{t.admMktsStatusPending}</option>
          <option value="resolved">{t.admMktsStatusResolved}</option>
          <option value="cancelled">{t.admMktsStatusCancelled}</option>
          <option value="all">{t.admModAll}</option>
        </Select>
        <Button size="sm" type="submit" variant="outline">
          OK
        </Button>
      </form>

      <Card className="mb-8 overflow-hidden">
        <AdminMarketsPanel lang={lang} markets={markets} />
      </Card>

      {/* publish + categories — MarketForm/CategoriesPanel, reused as is */}
      <h2 className="text-[15px] font-semibold mb-2">{t.createMarketTitle}</h2>
      <div className="max-w-3xl mb-8">
        <MarketForm isAdmin categories={categoryRows.map((c) => c.name)} lang={lang} />
      </div>

      <h2 className="text-[15px] font-semibold mb-2">{t.categoriesTitle}</h2>
      <Card className="max-w-2xl">
        <CategoriesPanel categories={categoryRows} lang={lang} />
      </Card>
    </div>
  );
}
