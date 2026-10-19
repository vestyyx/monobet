import type { Metadata } from "next";
import Link from "next/link";
import { ensureSeason, getLeaderboard, getSeasonHistory, getSquads } from "@/lib/queries";
import { getCurrentUser } from "@/lib/session";
import { fmtMonos, fmtDate, fmtCountdown } from "@/lib/money";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { Avatar, Card } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { Medal, Trophy, Users } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Žebříček" };

const MEDALS = ["text-amber-500", "text-slate-400", "text-amber-700"];
const PODIUM_BARS = ["bg-amber-500/80", "bg-slate-400/80", "bg-amber-700/80"];
// Rank titles — the ladder reads like the pit sees it.
function rankTitle(rank: number, t: ReturnType<typeof getT>) {
  if (rank === 1) return t.lbWhale;
  if (rank <= 3) return t.lbShark;
  if (rank <= 10) return t.lbRegular;
  return t.lbMinnow;
}

export default async function LeaderboardPage() {
  const [season, rows, user, lang, history, squads] = await Promise.all([
    ensureSeason(),
    getLeaderboard(),
    getCurrentUser(),
    getLang(),
    getSeasonHistory(4),
    getSquads(),
  ]);
  const t = getT(lang);

  const podium = [rows[1], rows[0], rows[2]].filter((r): r is (typeof rows)[number] => r != null);

  return (
    <div className="mx-auto max-w-3xl px-4 pt-8 pb-10">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[24px] font-black tracking-tight flex items-center gap-2">
            <Trophy className="size-5.5 text-amber-500" /> {t.lbTitle}
          </h1>
          <p className="text-[13px] text-mute mt-1">{t.lbSub}</p>
        </div>
        <div className="rounded-xl border border-line bg-surface px-3.5 py-2 text-right shadow-sm">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-faint">{t.seasonLive(season.index)}</div>
          <div className="num text-[13px] font-bold text-ink">
            {t.seasonEndsIn(fmtCountdown(season.endsAt))}
          </div>
          <div className="text-[11px] text-mute">{t.seasonPrize}</div>
        </div>
      </div>

      {rows.length > 0 && (
        <div className="mt-6 grid grid-cols-3 items-end gap-2.5">
          {podium.map((r) => {
            const rank = rows.indexOf(r) + 1;
            const barH = rank === 1 ? "h-24" : rank === 2 ? "h-14" : "h-10";
            return (
              <Link
                key={r.id}
                href={`/u/${r.username ?? r.name}`}
                className="group flex flex-col items-center gap-1.5 min-w-0"
              >
                <div className="relative">
                  <Avatar
                    name={r.username ?? r.name}
                    image={r.image}
                    className={cn(rank === 1 ? "size-14" : "size-10", "ring-2 ring-surface shadow")}
                  />
                  <span
                    className={cn(
                      "absolute -bottom-1 -right-1 grid size-5 place-items-center rounded-full text-[10px] font-black text-white shadow",
                      rank === 1 ? "bg-amber-500" : rank === 2 ? "bg-slate-400" : "bg-amber-700"
                    )}
                  >
                    {rank}
                  </span>
                </div>
                <span className="max-w-full truncate text-[12.5px] font-semibold group-hover:underline underline-offset-2">
                  @{r.username ?? r.name}
                </span>
                <span className="text-[10.5px] font-semibold uppercase tracking-wide text-faint">{rankTitle(rank, t)}</span>
                <span className="num text-[14px] font-bold">{fmtMonos(r.netWorthCents, { lang })}</span>
                <div className={cn("w-full rounded-t-lg grid place-items-center", barH, PODIUM_BARS[rank - 1])}>
                  <span className="text-[15px] font-black text-white/90">{rank}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <Card className="mt-4 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[480px]">
          <thead>
            <tr className="border-b border-line text-left text-[11.5px] uppercase tracking-wide text-mute">
              <th className="px-4 py-2.5 w-12">#</th>
              <th className="px-4 py-2.5">{t.lbTrader}</th>
              <th className="px-4 py-2.5 text-right hidden sm:table-cell">{t.lbPositions}</th>
              <th className="px-4 py-2.5 text-right hidden sm:table-cell">{t.lbBalance}</th>
              <th className="px-4 py-2.5 text-right">{t.lbNetWorth}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-2">
            {rows.map((r, i) => (
              <tr key={r.id} className={cn(user?.id === r.id ? "bg-yes-soft/40" : i < 3 && "bg-surface-2/40")}>
                <td className="num px-4 py-3 font-bold">
                  <span className={cn(i === 0 && "text-amber-500", i === 1 && "text-slate-400", i === 2 && "text-amber-700", i > 2 && "text-mute")}>
                    {i + 1}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/u/${r.username ?? r.name}`} className="flex items-center gap-2.5 hover:underline underline-offset-2">
                    <Avatar name={r.username ?? r.name} image={r.image} className="size-7" />
                    <span className="font-medium">
                      @{r.username ?? r.name}
                      {user?.id === r.id && <span className="text-yes-strong text-[11px] font-semibold ml-1.5">{t.lbYou}</span>}
                      <span className="block text-[10.5px] font-semibold uppercase tracking-wide text-faint">{rankTitle(i + 1, t)}</span>
                    </span>
                  </Link>
                </td>
                <td className="num px-4 py-3 text-right text-mute hidden sm:table-cell">{fmtMonos(r.portfolioCents, { lang })}</td>
                <td className="num px-4 py-3 text-right text-mute hidden sm:table-cell">{fmtMonos(r.balanceCents, { lang })}</td>
                <td className="num px-4 py-3 text-right font-bold">{fmtMonos(r.netWorthCents, { lang })}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-mute">
                  {t.lbEmpty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </Card>

      {squads.length > 0 && (
        <section className="mt-6">
          <h2 className="text-[15px] font-semibold mb-3 flex items-center gap-1.5">
            <Users className="size-4" /> {t.squadsTitle}
          </h2>
          <Card className="divide-y divide-line-2 overflow-hidden">
            {squads.map((s, i) => (
              <div key={s.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <span className={cn("num w-6 text-[13px] font-bold", i === 0 ? "text-amber-500" : "text-mute")}>{i + 1}</span>
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
        </section>
      )}

      {history.length > 0 && (
        <section className="mt-8">
          <h2 className="text-[15px] font-semibold mb-3">{t.seasonPast}</h2>
          <div className="space-y-3">
            {history.map(({ season: s, podium }) => (
              <Card key={s.id} className="px-4 py-3">
                <div className="text-[12px] font-semibold text-mute mb-2">
                  {t.seasonLive(s.index)} · {fmtDate(s.startsAt, lang)} – {fmtDate(s.endsAt, lang)}
                </div>
                <div className="flex flex-wrap gap-2">
                  {podium.map((r) => (
                    <Link
                      key={r.rank}
                      href={`/u/${r.username ?? r.name}`}
                      className="flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5 hover:bg-surface-3"
                    >
                      <Medal className={cn("size-4", MEDALS[r.rank - 1] ?? "text-mute")} />
                      <Avatar name={r.username ?? r.name} image={r.image} className="size-5" />
                      <span className="text-[12.5px] font-medium">@{r.username ?? r.name}</span>
                      <span className="num text-[12px] font-bold text-yes">+{fmtMonos(r.rewardCents, { lang, decimals: false })}</span>
                    </Link>
                  ))}
                  {podium.length === 0 && <span className="text-[12px] text-faint">{t.lbEmpty}</span>}
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
