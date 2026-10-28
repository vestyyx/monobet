import { redirect } from "next/navigation";
import { requireRole } from "@/lib/admin/rbac";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { db, schema } from "@/lib/db";
import { desc, sql } from "drizzle-orm";
import { AdminBracketPanel, type BracketAdminRow } from "@/components/admin/fun-panels";
import type { BracketMatch } from "@/lib/fun";

export const dynamic = "force-dynamic";

// Bracket-pools admin — open season-long prediction brackets, watch the
// entries pile up, then reveal the real winners (one per line, same order as
// the match list) and pay the sharpest brackets. Entry counts come from a
// grouped query (see /admin/guess note on correlated subqueries).
export default async function AdminBracketsPage() {
  const admin = await requireRole("moderator");
  if (!admin) redirect("/login");
  if (admin.parsedRole === "user") redirect("/");
  const lang = await getLang();
  const t = getT(lang);

  const [rows, counts] = await Promise.all([
    db
      .select({
        id: schema.bracketPool.id,
        titleCs: schema.bracketPool.titleCs,
        titleEn: schema.bracketPool.titleEn,
        closeAt: schema.bracketPool.closeAt,
        status: schema.bracketPool.status,
        matches: schema.bracketPool.matches,
        results: schema.bracketPool.results,
        rewardCents: schema.bracketPool.rewardCents,
        consolationCents: schema.bracketPool.consolationCents,
      })
      .from(schema.bracketPool)
      .orderBy(desc(schema.bracketPool.createdAt))
      .limit(40),
    db
      .select({ poolId: schema.bracketPick.poolId, n: sql<number>`count(*)::int` })
      .from(schema.bracketPick)
      .groupBy(schema.bracketPick.poolId),
  ]);

  const entryCount = new Map(counts.map((c) => [c.poolId, Number(c.n)]));

  const pools: BracketAdminRow[] = rows.map((r) => ({
    id: r.id,
    titleCs: r.titleCs,
    titleEn: r.titleEn,
    closeAt: r.closeAt,
    status: (r.status as "open" | "settled") ?? "open",
    matches: (r.matches as BracketMatch[]) ?? [],
    results: (r.results as string[] | null) ?? null,
    entryCount: entryCount.get(r.id) ?? 0,
    rewardCents: r.rewardCents,
    consolationCents: r.consolationCents,
  }));

  return (
    <div className="py-2">
      <h1 className="text-[20px] font-bold tracking-tight">{t.admBracketTitle}</h1>
      <p className="text-[12.5px] text-mute mt-0.5 mb-5">{t.admBracketSub}</p>
      <AdminBracketPanel lang={lang} pools={pools} />
    </div>
  );
}
