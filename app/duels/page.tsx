import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getDuels, listDuelOpponents } from "@/lib/queries";
import { hideDuelMoves } from "@/lib/games";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { DuelsPanel } from "@/components/duels-panel";
import { Swords } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function DuelsPage() {
  const [user, lang] = await Promise.all([getCurrentUser(), getLang()]);
  if (!user) redirect("/login");
  const t = getT(lang);
  const [duels, opponents] = await Promise.all([getDuels(user.id), listDuelOpponents(user.id)]);
  for (const r of duels) r.duel.state = hideDuelMoves(r.duel.state, user.id, r.duel.status === "settled");

  return (
    <div className="mx-auto max-w-3xl px-4 pt-8 pb-10">
      <h1 className="text-[22px] font-bold tracking-tight flex items-center gap-2">
        <Swords className="size-5" /> {t.duelsTitle}
      </h1>
      <p className="text-[13px] text-mute mt-1">{t.duelsSub}</p>
      <DuelsPanel duels={duels} me={user.id} opponents={opponents} balanceCents={user.balanceCents} lang={lang} />
    </div>
  );
}
