import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/session";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { getSquadHub, getSquads } from "@/lib/queries";
import { fmtMonos } from "@/lib/money";
import { Card } from "@/components/ui/primitives";
import { SquadHub, SquadJoinCard } from "@/components/squad-hub";
import { Users } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Týmy" };

export default async function SquadsPage() {
  const [user, lang] = await Promise.all([getCurrentUser(), getLang()]);
  if (!user) redirect("/login");
  const t = getT(lang);
  const [hub, all] = await Promise.all([
    user.squadId ? getSquadHub(user.squadId, user.id) : null,
    getSquads(),
  ]);
  const myRank = user.squadId ? all.findIndex((s) => s.id === user.squadId) : -1;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Users className="size-6 text-brand-strong" /> {t.squadsTitle}
          </h1>
          {hub && myRank >= 0 && (
            <p className="text-[13.5px] text-mute mt-1">
              #{myRank + 1} · {t.squadCombinedWorth}: <span className="num font-semibold text-ink">{fmtMonos(all[myRank].netWorthCents, { lang })}</span>
            </p>
          )}
        </div>
      </div>

      {hub ? (
        <SquadHub
          lang={lang}
          squadName={hub.squad.name}
          treasuryCents={hub.squad.treasuryCents}
          myBalanceCents={user.balanceCents}
          myDebtCents={user.squadDebtCents}
          members={hub.members}
          activity={hub.activity.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() }))}
          // eslint-disable-next-line react-hooks/purity -- server component renders once per request
          now={Date.now()}
        />
      ) : (
        <div className="mt-6 space-y-6">
          <SquadJoinCard lang={lang} />
          <Card className="divide-y divide-line-2 overflow-hidden">
            <div className="px-3.5 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-faint">{t.squadAllSquads}</div>
            {all.length === 0 && <div className="px-3.5 py-4 text-[13px] text-mute">{t.squadNoSquad}</div>}
            {all.map((s, i) => (
              <div key={s.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <span className="num w-6 text-[13px] font-bold text-mute">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[13.5px] font-semibold">{s.name}</div>
                  <div className="text-[11.5px] text-faint truncate">
                    {s.memberCount} · {s.members.slice(0, 6).map((m) => `@${m}`).join(", ")}
                    {s.memberCount > 6 ? "…" : ""}
                  </div>
                </div>
                <span className="num text-[13px] font-bold">{fmtMonos(s.netWorthCents, { lang })}</span>
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}
