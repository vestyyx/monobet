import { redirect } from "next/navigation";
import { requireRole } from "@/lib/admin/rbac";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { db, schema } from "@/lib/db";
import { desc, sql } from "drizzle-orm";
import { AdminPhotoPanel, type PhotoAdminRow } from "@/components/admin/fun-panels";

export const dynamic = "force-dynamic";

// Photo-guess admin — publish compressed macro shots and reveal (or let the
// first solver settle) them. Guess counts via a grouped side-query (correlated
// subqueries render drizzle columns unqualified — see /admin/guess note).
export default async function AdminPhotoGuessPage() {
  const admin = await requireRole("moderator");
  if (!admin) redirect("/login");
  if (admin.parsedRole === "user") redirect("/");
  const lang = await getLang();
  const t = getT(lang);

  const [rows, tries, winnerNames] = await Promise.all([
    db
      .select({
        id: schema.photoRound.id,
        imageData: schema.photoRound.imageData,
        answerCs: schema.photoRound.answerCs,
        hintAt: schema.photoRound.hintAt,
        closeAt: schema.photoRound.closeAt,
        status: schema.photoRound.status,
        winnerUserId: schema.photoRound.winnerUserId,
        rewardCents: schema.photoRound.rewardCents,
      })
      .from(schema.photoRound)
      .orderBy(desc(schema.photoRound.createdAt))
      .limit(40),
    db
      .select({ roundId: schema.photoAttempt.roundId, n: sql<number>`count(*)::int` })
      .from(schema.photoAttempt)
      .groupBy(schema.photoAttempt.roundId),
    db.select({ id: schema.user.id, username: schema.user.username }).from(schema.user),
  ]);

  const triesByRound = new Map(tries.map((c) => [c.roundId, Number(c.n)]));
  const nameByUser = new Map(winnerNames.map((u) => [u.id, u.username ?? "?"]));

  const rounds: PhotoAdminRow[] = rows.map((r) => ({
    id: r.id,
    imageData: r.imageData,
    answerCs: r.answerCs,
    hintAt: r.hintAt,
    closeAt: r.closeAt,
    status: (r.status as "open" | "settled") ?? "open",
    winner: r.winnerUserId ? nameByUser.get(r.winnerUserId) ?? null : null,
    tries: triesByRound.get(r.id) ?? 0,
    rewardCents: r.rewardCents,
  }));

  return (
    <div className="py-2">
      <h1 className="text-[20px] font-bold tracking-tight">{t.admPhotoTitle}</h1>
      <p className="text-[12.5px] text-mute mt-0.5 mb-5">{t.admPhotoSub}</p>
      <AdminPhotoPanel lang={lang} rounds={rounds} />
    </div>
  );
}
