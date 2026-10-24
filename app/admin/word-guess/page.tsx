import { redirect } from "next/navigation";
import { requireRole } from "@/lib/admin/rbac";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { db, schema } from "@/lib/db";
import { desc, sql } from "drizzle-orm";
import { AdminEmojiPanel, type EmojiAdminRow } from "@/components/admin/fun-panels";

export const dynamic = "force-dynamic";

// Word & emoji riddles admin — post picture-riddles and reveal (or let the
// first solver settle) them. Guess counts via a grouped side-query.
export default async function AdminWordGuessPage() {
  const admin = await requireRole("moderator");
  if (!admin) redirect("/login");
  if (admin.parsedRole === "user") redirect("/");
  const lang = await getLang();
  const t = getT(lang);

  const [rows, tries, winnerNames] = await Promise.all([
    db
      .select({
        id: schema.emojiRound.id,
        emoji: schema.emojiRound.emoji,
        answerCs: schema.emojiRound.answerCs,
        hintCs: schema.emojiRound.hintCs,
        hintAt: schema.emojiRound.hintAt,
        closeAt: schema.emojiRound.closeAt,
        status: schema.emojiRound.status,
        winnerUserId: schema.emojiRound.winnerUserId,
        rewardCents: schema.emojiRound.rewardCents,
      })
      .from(schema.emojiRound)
      .orderBy(desc(schema.emojiRound.createdAt))
      .limit(40),
    db
      .select({ roundId: schema.emojiAttempt.roundId, n: sql<number>`count(*)::int` })
      .from(schema.emojiAttempt)
      .groupBy(schema.emojiAttempt.roundId),
    db.select({ id: schema.user.id, username: schema.user.username }).from(schema.user),
  ]);

  const triesByRound = new Map(tries.map((c) => [c.roundId, Number(c.n)]));
  const nameByUser = new Map(winnerNames.map((u) => [u.id, u.username ?? "?"]));

  const rounds: EmojiAdminRow[] = rows.map((r) => ({
    id: r.id,
    emoji: r.emoji,
    answerCs: r.answerCs,
    hintCs: r.hintCs,
    hintAt: r.hintAt,
    closeAt: r.closeAt,
    status: (r.status as "open" | "settled") ?? "open",
    winner: r.winnerUserId ? nameByUser.get(r.winnerUserId) ?? null : null,
    tries: triesByRound.get(r.id) ?? 0,
    rewardCents: r.rewardCents,
  }));

  return (
    <div className="py-2">
      <h1 className="text-[20px] font-bold tracking-tight">{t.admEmojiTitle}</h1>
      <p className="text-[12.5px] text-mute mt-0.5 mb-5">{t.admEmojiSub}</p>
      <AdminEmojiPanel lang={lang} rounds={rounds} />
    </div>
  );
}
