import { fmtMonos, fmtShares, timeAgo } from "@/lib/money";
import { getT, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type TradeRow = {
  id: string;
  side: string;
  outcome: string;
  shares: string;
  amountCents: number;
  createdAt: Date;
  username: string | null;
  name: string;
  label?: string | null; // option label for multi-outcome group feeds
};

export function ActivityFeed({ trades, lang }: { trades: TradeRow[]; lang?: Lang }) {
  const tt = getT(lang ?? "cs");
  if (trades.length === 0) {
    return <p className="text-[13px] text-faint py-4">{tt.noTradesYet}</p>;
  }
  return (
    <div className="divide-y divide-line-2">
      {trades.map((t) => {
        const buy = t.side === "buy";
        const yes = t.outcome === "yes";
        return (
          <div key={t.id} className="py-2.5 flex items-center gap-3 text-[13px] anim-rise">
            <span className="font-medium w-28 truncate">@{t.username ?? t.name}</span>
            <span className="text-mute">{buy ? tt.bought : tt.sold}</span>
            <span
              className={cn(
                "font-bold px-1.5 rounded",
                yes ? "text-yes-strong bg-yes-soft" : "text-no-strong bg-no-soft"
              )}
            >
              {(yes ? tt.yes : tt.no).toUpperCase()}
            </span>
            {t.label && <span className="text-[11.5px] font-medium text-mute bg-surface-2 border border-line-2 rounded px-1.5 py-px truncate max-w-40">{t.label}</span>}
            <span className="num text-mute">{fmtShares(Number(t.shares), lang)} {tt.shares}</span>
            <span className="num ml-auto font-semibold">{fmtMonos(t.amountCents, { lang })}</span>
            <span className="text-faint text-[11.5px] w-16 text-right">{timeAgo(t.createdAt, lang)}</span>
          </div>
        );
      })}
    </div>
  );
}
