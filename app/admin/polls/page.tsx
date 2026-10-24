import { redirect } from "next/navigation";
import { requireRole } from "@/lib/admin/rbac";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { db, schema } from "@/lib/db";
import { desc, sql } from "drizzle-orm";
import { AdminPollPanel, type PollAdminRow } from "@/components/admin/fun-panels";

export const dynamic = "force-dynamic";

// Family-polls admin — open two-option questions; closing one pays the
// minority side in full and stamps the winner, with an audit row in the same
// transaction. Vote counts come from a grouped side-query (correlated
// subqueries render drizzle columns unqualified — see /admin/guess note).
export default async function AdminPollsPage() {
  const admin = await requireRole("moderator");
  if (!admin) redirect("/login");
  if (admin.parsedRole === "user") redirect("/");
  const lang = await getLang();
  const t = getT(lang);

  const [rows, counts] = await Promise.all([
    db
      .select({
        id: schema.pollRound.id,
        qCs: schema.pollRound.qCs,
        qEn: schema.pollRound.qEn,
        aCs: schema.pollRound.aCs,
        closeAt: schema.pollRound.closeAt,
        status: schema.pollRound.status,
        winningSide: schema.pollRound.winningSide,
        rewardCents: schema.pollRound.rewardCents,
        consolationCents: schema.pollRound.consolationCents,
      })
      .from(schema.pollRound)
      .orderBy(desc(schema.pollRound.createdAt))
      .limit(40),
    db
      .select({ pollId: schema.pollVote.pollId, side: schema.pollVote.side, n: sql<number>`count(*)::int` })
      .from(schema.pollVote)
      .groupBy(schema.pollVote.pollId, schema.pollVote.side),
  ]);

  const sideCount = new Map<string, number>();
  for (const c of counts) {
    const key = `${c.pollId}:${c.side}`;
    sideCount.set(key, Number(c.n));
  }

  const polls: PollAdminRow[] = rows.map((r) => ({
    id: r.id,
    qCs: r.qCs,
    qEn: r.qEn,
    aCs: r.aCs,
    closeAt: r.closeAt,
    status: (r.status as "open" | "settled") ?? "open",
    winningSide: r.winningSide,
    countA: sideCount.get(`${r.id}:a`) ?? 0,
    countB: sideCount.get(`${r.id}:b`) ?? 0,
    rewardCents: r.rewardCents,
    consolationCents: r.consolationCents,
  }));

  return (
    <div className="py-2">
      <h1 className="text-[20px] font-bold tracking-tight">{t.admPollTitle}</h1>
      <p className="text-[12.5px] text-mute mt-0.5 mb-5">{t.admPollSub}</p>
      <AdminPollPanel lang={lang} polls={polls} />
    </div>
  );
}
