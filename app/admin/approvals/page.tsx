import { redirect } from "next/navigation";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { requireRole } from "@/lib/admin/rbac";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { db, schema } from "@/lib/db";
import { AdminApprovalsPanel, type AdminPendingMarketRow } from "@/components/admin/user-panels";

export const dynamic = "force-dynamic";

// Approvals desk (Phase 3) — player-created markets waiting for a moderator
// decision. Approve makes them live with a starting price point; reject is
// refused without a reason. (The new-members queue lands with the
// registration switch in Phase 6 settings.)
export default async function AdminApprovalsPage() {
  const admin = await requireRole("moderator");
  if (!admin) redirect("/login");
  const lang = await getLang();
  const t = getT(lang);

  const rows = await db
    .select({
      id: schema.market.id,
      slug: schema.market.slug,
      question: schema.market.question,
      kind: schema.market.kind,
      createdAt: schema.market.createdAt,
      creator: schema.user.username,
    })
    .from(schema.market)
    .leftJoin(schema.user, eq(schema.user.id, schema.market.creatorId))
    .where(and(eq(schema.market.status, "pending"), isNotNull(schema.market.creatorId)))
    .orderBy(desc(schema.market.createdAt))
    .limit(100);

  const markets: AdminPendingMarketRow[] = rows.map((m) => ({
    id: m.id,
    slug: m.slug,
    question: m.question,
    kind: m.kind,
    creator: m.creator ?? null,
    createdAtMs: new Date(m.createdAt).getTime(),
  }));

  return (
    <div className="py-2">
      <h1 className="text-[20px] font-bold tracking-tight">{t.admApprovalsTitle}</h1>
      <p className="text-[12.5px] text-mute mt-0.5 mb-5">{t.admApprovalsSub}</p>
      <AdminApprovalsPanel lang={lang} markets={markets} />
    </div>
  );
}
