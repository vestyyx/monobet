import { redirect } from "next/navigation";
import { requireRole } from "@/lib/admin/rbac";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { db, schema } from "@/lib/db";
import { desc } from "drizzle-orm";
import { AdminTriviaPanel, type TriviaBankRow } from "@/components/admin/fun-panels";
import { TRIVIA_REWARD_BY_DIFFICULTY } from "@/lib/fun";

export const dynamic = "force-dynamic";

// Trivia admin — curate the question bank. Every morning the pin logic in
// actions-fun claims the oldest unshown bank row for the day's question, so
// the bank's row order IS the schedule.
export default async function AdminTriviaPage() {
  const admin = await requireRole("moderator");
  if (!admin) redirect("/login");
  if (admin.parsedRole === "user") redirect("/");
  const lang = await getLang();
  const t = getT(lang);

  const rows = await db.select().from(schema.triviaQuestion).orderBy(desc(schema.triviaQuestion.createdAt)).limit(60);

  const bank: TriviaBankRow[] = rows.map((r) => {
    const opts = r.optionsCs ?? [];
    return {
      id: r.id,
      qCs: r.qCs,
      qEn: r.qEn,
      correctCs: opts[r.correctIdx] ?? `#${r.correctIdx + 1}`,
      difficulty: r.difficulty,
      rewardCents: r.rewardCents && r.rewardCents > 0 ? r.rewardCents : TRIVIA_REWARD_BY_DIFFICULTY[r.difficulty] ?? TRIVIA_REWARD_BY_DIFFICULTY[1],
      shownDay: r.shownDay,
    };
  });

  return (
    <div className="py-2">
      <h1 className="text-[20px] font-bold tracking-tight">{t.admTriviaTitle}</h1>
      <p className="text-[12.5px] text-mute mt-0.5 mb-5">{t.admTriviaSub}</p>
      <AdminTriviaPanel lang={lang} bank={bank} />
    </div>
  );
}
