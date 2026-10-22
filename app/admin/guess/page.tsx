import { redirect } from "next/navigation";
import { requireRole } from "@/lib/admin/rbac";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { db, schema } from "@/lib/db";
import { desc, sql } from "drizzle-orm";
import { AdminGuessPanel, type GuessAdminRow } from "@/components/admin/fun-panels";
import { guessRoundOpen } from "@/lib/fun";

export const dynamic = "force-dynamic";

// Closest-guess admin — open rounds and settle (reveal) the ones whose clock
// ran out. Settling pays the closest tip and consoles the near misses through
// the ledger, and writes an audit row in the same transaction.
export default async function AdminGuessPage() {
  const admin = await requireRole("moderator");
  if (!admin) redirect("/login");
  if (admin.parsedRole === "user") redirect("/");
  const lang = await getLang();
  const t = getT(lang);

  // Rounds newest-first with an entrant count (single grouped query).
  const rows = await db
    .select({
      id: schema.guessRound.id,
      promptCs: schema.guessRound.promptCs,
      promptEn: schema.guessRound.promptEn,
      unitCs: schema.guessRound.unitCs,
      closeAt: schema.guessRound.closeAt,
      status: schema.guessRound.status,
      answerValue: schema.guessRound.answerValue,
      rewardCents: schema.guessRound.rewardCents,
      consolationCents: schema.guessRound.consolationCents,
      entrants: sql<number>`(select count(*)::int from ${schema.guessEntry} ge where ge.round_id = ${schema.guessRound.id})`,
    })
    .from(schema.guessRound)
    .orderBy(desc(schema.guessRound.createdAt))
    .limit(40);

  const rounds: GuessAdminRow[] = rows.map((r) => ({
    id: r.id,
    promptCs: r.promptCs,
    promptEn: r.promptEn,
    unitCs: r.unitCs,
    closeAt: r.closeAt,
    status: (r.status as "open" | "settled") ?? "open",
    canSettle:
      r.status === "open" && r.closeAt != null && !guessRoundOpen(r.status, r.closeAt),
    entrants: Number(r.entrants ?? 0),
    answerValue: r.answerValue != null ? Number(r.answerValue) : null,
    rewardCents: r.rewardCents,
    consolationCents: r.consolationCents,
  }));

  return (
    <div className="py-2">
      <h1 className="text-[20px] font-bold tracking-tight">{t.admGuessTitle}</h1>
      <p className="text-[12.5px] text-mute mt-0.5 mb-5">{t.admGuessSub}</p>
      <AdminGuessPanel lang={lang} rounds={rounds} />
    </div>
  );
}
