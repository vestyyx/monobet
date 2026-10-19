"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button, Input, Select, Badge } from "@/components/ui/primitives";
import { approveMarket, rejectMarket, resolveMarket, cancelMarket, grantBalance, createCategory, renameCategory, deleteCategory, reorderCategories, deleteMarket, adminCreateUser, adminSetUserBanned, adminSetCommentsBanned, adminSetUserRole, adminRenameUser, adminResetUserPassword, adminSettleDuel, adminDeleteUser, adminUpsertDealer, adminDeleteDealer, adminToggleDealer, setCasinoRig, setUserLuck, setGameEnabled, setLeverageConfig, setGameRules, resetJackpot, adminResetEconomy } from "@/lib/actions";
import { GAME_KEYS } from "@/lib/games";
import { fmtMonos, fmtDate } from "@/lib/money";
import { cn } from "@/lib/utils";
import { getT, type Lang } from "@/lib/i18n";
import { Check, X, CircleCheck, Ban, Pencil, Trash2, KeyRound, MessageSquareOff, MessageSquare, ShieldPlus, ShieldMinus, GripVertical, StickyNote, Scale } from "lucide-react";
import { ImageCell, IconPicker } from "@/components/image-cell";
import { DealerAvatar } from "@/components/dealer-avatar";

function useAction(lang?: Lang) {
  const t = getT(lang ?? "cs");
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; paidOut?: number }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(r.paidOut ? `${ok} — ${fmtMonos(r.paidOut, { lang })}` : ok);
        router.refresh();
      } else toast.error(t.serverErr(r.error));
    });
  return { pending, run };
}

export function PendingList({
  items,
  lang,
}: {
  items: { id: string; slug: string; question: string; category: string; createdAt: Date; username: string | null }[];
  lang?: Lang;
}) {
  const { pending, run } = useAction(lang);
  const t = getT(lang ?? "cs");
  if (items.length === 0) return <p className="p-4 text-sm text-mute">{t.noPending}</p>;
  return (
    <div className="divide-y divide-line-2">
      {items.map((m) => (
        <div key={m.id} className="px-4 py-3.5 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-3">
          <div className="flex-1 min-w-0 w-full">
            <Link href={`/market/${m.slug}`} className="text-sm font-medium hover:underline underline-offset-2 line-clamp-1">
              {m.question}
            </Link>
            <div className="text-[11.5px] text-faint mt-0.5">
              {m.category} · {t.pendingBy} @{m.username ?? "?"} · {fmtDate(m.createdAt, lang)}
            </div>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            <Button size="sm" variant="yes" disabled={pending} onClick={() => run(() => approveMarket(m.id), t.approvedToast)}>
              <Check className="size-3.5" /> {t.approve}
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => rejectMarket(m.id), t.rejectedToast)}>
              <X className="size-3.5" /> {t.reject}
            </Button>
            <Button
              size="sm"
              variant="no"
              disabled={pending}
              title={t.deleteMarket}
              onClick={() => {
                if (confirm(t.deleteMarketConfirm(m.question))) run(() => deleteMarket(m.id), t.marketDeleted);
              }}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function LiveMarketList({
  items,
  lang,
}: {
  items: { id: string; slug: string; question: string; label?: string | null; parentId?: string | null; category: string; volumeCents: number; traderCount: number; closesAt: Date | null; kind?: string; noteCount?: number; proposedOutcome?: string | null; status?: string }[];
  lang?: Lang;
}) {
  const { pending, run } = useAction(lang);
  const t = getT(lang ?? "cs");
  // Group options nest under their parent — one row per market, children
  // resolve individually inside an expandable block.
  const tops = items.filter((m) => !m.parentId);
  const children = new Map<string, typeof items>();
  for (const m of items) {
    if (!m.parentId) continue;
    const arr = children.get(m.parentId) ?? [];
    arr.push(m);
    children.set(m.parentId, arr);
  }
  const btns = (m: (typeof items)[number]) => (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {m.kind !== "group" && (
        <>
          <Button size="xs" variant="yes" disabled={pending} onClick={() => run(() => resolveMarket({ marketId: m.id, outcome: "yes" }), t.resolvedYesToast)}>
            <CircleCheck className="size-3" /> {t.resolveYes}
          </Button>
          <Button size="xs" variant="no" disabled={pending} onClick={() => run(() => resolveMarket({ marketId: m.id, outcome: "no" }), t.resolvedNoToast)}>
            <CircleCheck className="size-3" /> {t.resolveNo}
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={pending}
            onClick={() => {
              if (confirm(t.cancelConfirm)) run(() => cancelMarket(m.id), t.cancelledToast);
            }}
          >
            <Ban className="size-3" /> {t.cancelRefund}
          </Button>
        </>
      )}
      <Button
        size="xs"
        variant="outline"
        disabled={pending}
        className="text-no-strong hover:bg-no-soft border-no/30"
        onClick={() => {
          if (confirm(t.deleteMarketConfirm(m.question))) run(() => deleteMarket(m.id), t.marketDeleted);
        }}
      >
        <Trash2 className="size-3" /> {t.delete}
      </Button>
    </div>
  );
  if (tops.length === 0) return <p className="p-4 text-sm text-mute">{t.noLive}</p>;
  return (
    <div className="divide-y divide-line-2">
      {tops.map((m) => {
        const kids = children.get(m.id) ?? [];
        return (
          <div key={m.id} className="px-4 py-3.5">
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <Link href={`/market/${m.slug}`} className="text-sm font-medium hover:underline underline-offset-2 line-clamp-1">
                  {m.question}
                </Link>
                <div className="text-[11.5px] text-faint mt-0.5">
                  {fmtMonos(m.volumeCents, { lang })} {t.vol.toLowerCase()} · {m.traderCount} {t.tradersW} · {t.closes.toLowerCase()} {fmtDate(m.closesAt, lang)}
                  {kids.length > 0 && ` · ${kids.length} ${t.options}`}
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {(m.noteCount ?? 0) > 0 && (
                    <Badge tone={(m.noteCount ?? 0) > 5 ? "warn" : "mute"}>
                      <StickyNote className="size-3" /> {t.notesCount(m.noteCount ?? 0)}
                    </Badge>
                  )}
                  {m.proposedOutcome && (
                    <Badge tone="ink">
                      <Scale className="size-3" /> {t.proposalHeading((m.proposedOutcome === "yes" ? t.yes : t.no).toUpperCase())}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            {btns(m)}
            {kids.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer list-none text-[12px] font-semibold text-mute hover:text-ink select-none">
                  {t.options} ({kids.length})
                </summary>
                <div className="mt-1.5 ml-3 border-l-2 border-line-2 pl-3 space-y-2">
                  {kids.map((o) => (
                    <div key={o.id}>
                      <div className="text-[13px] font-medium">{o.label ?? o.question}</div>
                      <div className="text-[11.5px] text-faint">
                        {fmtMonos(o.volumeCents, { lang })} {t.vol.toLowerCase()} · {o.traderCount} {t.tradersW}
                      </div>
                      {btns(o)}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function GrantPanel({ users, lang }: { users: { id: string; username: string | null; balanceCents: number }[]; lang?: Lang }) {
  const [userId, setUserId] = useState(users[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const { pending, run } = useAction(lang);
  const t = getT(lang ?? "cs");

  return (
    <form
      className="p-4 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const cents = Math.round(parseFloat(amount || "0") * 100);
        run(
          () => grantBalance({ userId, amountCents: cents, memo }),
          t.grantedToast(fmtMonos(cents, { lang }))
        );
        setAmount("");
        setMemo("");
      }}
    >
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-3">
        <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              @{u.username ?? u.id.slice(0, 8)} ({fmtMonos(u.balanceCents, { lang })})
            </option>
          ))}
        </Select>
        <Input type="number" step="0.01" placeholder="Ɱ" value={amount} onChange={(e) => setAmount(e.target.value)} required />
      </div>
      <Input placeholder={t.memoPh} value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={100} />
      <Button size="sm" disabled={pending || !userId}>
        {pending ? "…" : t.grant}
      </Button>
      <p className="text-[11.5px] text-faint">{t.grantNote}</p>
    </form>
  );
}

// House P&L + casino tuning — admin "inside info": what the bank wins, and
// knobs for global riggedness and per-user luck on the random games.
type HouseStats = {
  games: { game: string; rounds: number; wageredCents: number; paidCents: number; profitCents: number }[];
  wageredCents: number;
  paidCents: number;
  profitCents: number;
  profit24hCents: number;
  profit7dCents: number;
  feesCents: { total: number; game: number; trade: number; levGame: number; levTrade: number };
  rigBps: number;
  disabledGames: string[];
  lev: {
    gameMaxLev: number;
    tradeMaxLev: number;
    levFeeBps: number;
    gameLevCaps: Record<string, number>;
    gameMaxBetCents: number;
    tradeMaxSpendCents: number;
    gameBetCaps: Record<string, number>;
  };
  rules: {
    autobetEnabled: boolean;
    gameDailyLimitMs: number;
    gameIdleMs: number;
    gameFeeCents: number;
    tradeFeeCents: number;
    debtRateBps: number;
    referralRoyaltyBps: number;
    referralRoyaltyCapCents: number;
    dicePayBps: number;
    limboPayBps: number;
    limboMinX100: number;
    minTradeCents: number;
  };
  loans: { count: number; disbursedCents: number; repaidCents: number; outstandingCents: number; positionCents: number };
};

export function HousePanel({
  stats,
  users,
  lang,
}: {
  stats: HouseStats;
  users: { id: string; username: string | null; luckBps: number }[];
  lang?: Lang;
}) {
  const t = getT(lang ?? "cs");
  const { pending, run } = useAction(lang);
  const [rigPct, setRigPct] = useState((stats.rigBps / 100).toFixed(0));
  const [luckUser, setLuckUser] = useState(users[0]?.id ?? "");
  const [luckPct, setLuckPct] = useState("");
  // Leverage knobs — per-game fields stay blank unless an override exists;
  // blank means "follow the global game cap".
  const [levGame, setLevGame] = useState(String(stats.lev.gameMaxLev));
  const [levTrade, setLevTrade] = useState(String(stats.lev.tradeMaxLev));
  const [levFee, setLevFee] = useState((stats.lev.levFeeBps / 100).toFixed(0));
  const [levPer, setLevPer] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(stats.lev.gameLevCaps).map(([k, v]) => [k, String(v)]))
  );
  // Stake ceilings — Ɱ units in the inputs; per-game blank follows global.
  const [betGame, setBetGame] = useState(String(stats.lev.gameMaxBetCents / 100));
  const [betTrade, setBetTrade] = useState(String(stats.lev.tradeMaxSpendCents / 100));
  const [betPer, setBetPer] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(stats.lev.gameBetCaps).map(([k, v]) => [k, String(v / 100)]))
  );
  // House rules — the former hardcodes, now admin-tunable.
  const [ruleAutobet, setRuleAutobet] = useState(stats.rules.autobetEnabled);
  const [ruleDaily, setRuleDaily] = useState((stats.rules.gameDailyLimitMs / 3_600_000).toString());
  const [ruleIdle, setRuleIdle] = useState((stats.rules.gameIdleMs / 60_000).toString());
  const [ruleGameFee, setRuleGameFee] = useState((stats.rules.gameFeeCents / 100).toString());
  const [ruleTradeFee, setRuleTradeFee] = useState((stats.rules.tradeFeeCents / 100).toString());
  const [ruleApr, setRuleApr] = useState((stats.rules.debtRateBps / 100).toString());
  const [ruleRoyPct, setRuleRoyPct] = useState((stats.rules.referralRoyaltyBps / 100).toString());
  const [ruleRoyCap, setRuleRoyCap] = useState((stats.rules.referralRoyaltyCapCents / 100).toString());
  const [ruleDicePay, setRuleDicePay] = useState((stats.rules.dicePayBps / 100).toString());
  const [ruleLimboPay, setRuleLimboPay] = useState((stats.rules.limboPayBps / 100).toString());
  const [ruleLimboMin, setRuleLimboMin] = useState((stats.rules.limboMinX100 / 100).toString());
  const [ruleMinTrade, setRuleMinTrade] = useState((stats.rules.minTradeCents / 100).toString());
  const houseGameName = (key: string) =>
    (({ Coin: t.gCoinFlip, Dice: t.gDice, Timer: t.gTimer, Limbo: t.gLimbo, Wheel: t.gWheel, Slots: t.gSlots, Plinko: t.gPlinko, Blackjack: t.gBlackjack, "Hi-Lo": t.gHilo, "Red/Black": t.gRedBlack, coinflip: t.gCoinFlip, dice: t.gDice, timer: t.gTimer, limbo: t.gLimbo, wheel: t.gWheel, slots: t.gSlots, plinko: t.gPlinko, blackjack: t.gBlackjack, hilo: t.gHilo, redblack: t.gRedBlack } as Record<string, string>)[key] ?? key);
  const luckyUsers = users.filter((u) => u.luckBps !== 0);
  const hold = stats.wageredCents > 0 ? (stats.profitCents / stats.wageredCents) * 100 : 0;

  return (
    <div className="p-4 space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: t.house24h, v: stats.profit24hCents },
          { label: t.house7d, v: stats.profit7dCents },
          { label: t.houseAll, v: stats.profitCents },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-line bg-surface-2 px-3 py-2.5">
            <div className="text-[11px] font-semibold text-faint">{s.label}</div>
            <div className={cn("num text-[17px] font-bold", s.v >= 0 ? "text-yes-strong" : "text-no-strong")}>
              {s.v >= 0 ? "+" : "−"}{fmtMonos(Math.abs(s.v), { lang })}
            </div>
          </div>
        ))}
        <div className="rounded-xl border border-line bg-surface-2 px-3 py-2.5">
          <div className="text-[11px] font-semibold text-faint">{t.houseHold}</div>
          <div className="num text-[17px] font-bold text-ink">{hold.toFixed(1)}%</div>
        </div>
        <div className="rounded-xl border border-line bg-surface-2 px-3 py-2.5">
          <div className="text-[11px] font-semibold text-faint">{t.houseFees}</div>
          <div className="num text-[17px] font-bold text-yes-strong">+{fmtMonos(stats.feesCents.total, { lang })}</div>
          <div className="num text-[10.5px] text-faint">{t.houseFeesNote(fmtMonos(stats.feesCents.game, { lang }), fmtMonos(stats.feesCents.trade, { lang }))}</div>
          <div className="num text-[10.5px] text-faint">{t.houseFeesLevNote(fmtMonos(stats.feesCents.levGame, { lang }), fmtMonos(stats.feesCents.levTrade, { lang }))}</div>
        </div>
      </div>

      {(stats.games.length > 0 || stats.loans.count > 0) && (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[11px] font-semibold text-faint border-b border-line">
                <th className="pb-1.5 pr-3">{t.houseGame}</th>
                <th className="pb-1.5 pr-3 text-right">{t.houseRounds}</th>
                <th className="pb-1.5 pr-3 text-right">{t.houseWagered}</th>
                <th className="pb-1.5 pr-3 text-right">{t.housePaid}</th>
                <th className="pb-1.5 pr-3 text-right">{t.houseProfit}</th>
                <th className="pb-1.5 text-right">{t.houseHold}</th>
              </tr>
            </thead>
            <tbody>
              {[...stats.games]
                .sort((a, b) => b.profitCents - a.profitCents)
                .map((g) => (
                  <tr key={g.game} className="border-b border-line/60 last:border-0">
                    <td className="py-1.5 pr-3 font-semibold text-ink">{houseGameName(g.game)}</td>
                    <td className="py-1.5 pr-3 text-right num text-mute">{g.rounds.toLocaleString()}</td>
                    <td className="py-1.5 pr-3 text-right num text-mute">{fmtMonos(g.wageredCents, { lang })}</td>
                    <td className="py-1.5 pr-3 text-right num text-mute">{fmtMonos(g.paidCents, { lang })}</td>
                    <td className={cn("py-1.5 pr-3 text-right num font-bold", g.profitCents >= 0 ? "text-yes-strong" : "text-no-strong")}>
                      {g.profitCents >= 0 ? "+" : "−"}{fmtMonos(Math.abs(g.profitCents), { lang })}
                    </td>
                    <td className="py-1.5 text-right num text-mute">
                      {g.wageredCents > 0 ? `${((g.profitCents / g.wageredCents) * 100).toFixed(1)}%` : "—"}
                    </td>
                  </tr>
                ))}
              {stats.loans.count > 0 && (
                <tr className="border-b border-line/60 last:border-0">
                  <td className="py-1.5 pr-3 font-semibold text-ink">{t.houseLoans}</td>
                  <td className="py-1.5 pr-3 text-right num text-mute">{stats.loans.count}</td>
                  <td className="py-1.5 pr-3 text-right num text-mute">{fmtMonos(stats.loans.disbursedCents, { lang })}</td>
                  <td className="py-1.5 pr-3 text-right num text-mute">{fmtMonos(stats.loans.repaidCents, { lang })}</td>
                  <td className={cn("py-1.5 pr-3 text-right num font-bold", stats.loans.positionCents >= 0 ? "text-yes-strong" : "text-no-strong")}>
                    {stats.loans.positionCents >= 0 ? "+" : "−"}{fmtMonos(Math.abs(stats.loans.positionCents), { lang })}
                  </td>
                  <td className="py-1.5 text-right num text-mute">
                    {stats.loans.disbursedCents > 0 ? `${((stats.loans.positionCents / stats.loans.disbursedCents) * 100).toFixed(1)}%` : "—"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {stats.loans.count > 0 && (
            <p className="mt-1.5 text-[11px] text-faint">{t.houseLoansNote(fmtMonos(stats.loans.outstandingCents, { lang }))}</p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <form
          noValidate
          className="rounded-xl border border-line bg-surface-2 p-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => setCasinoRig({ rigBps: Math.round(parseFloat(rigPct || "0") * 100) }), t.savedToast);
          }}
        >
          <div className="text-[12px] font-bold text-ink">{t.houseRigTitle}</div>
          <div className="flex gap-2">
            <Input type="number" min={0} max={100} step="1" value={rigPct} onChange={(e) => setRigPct(e.target.value)} />
            <Button size="sm" disabled={pending}>{t.save}</Button>
          </div>
          <p className="text-[11px] text-faint">{t.houseRigNote}</p>
        </form>

        <form
          noValidate
          className="rounded-xl border border-line bg-surface-2 p-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => setUserLuck({ userId: luckUser, luckBps: Math.round(parseFloat(luckPct || "0") * 100) }), t.savedToast);
          }}
        >
          <div className="text-[12px] font-bold text-ink">{t.userLuckTitle}</div>
          <div className="flex gap-2">
            <Select value={luckUser} onChange={(e) => setLuckUser(e.target.value)}>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  @{u.username ?? u.id.slice(0, 8)}{u.luckBps !== 0 ? ` (${(u.luckBps / 100).toFixed(0)}%)` : ""}
                </option>
              ))}
            </Select>
            <Input type="number" min={-50} max={50} step="1" placeholder="%" value={luckPct} onChange={(e) => setLuckPct(e.target.value)} className="w-20 shrink-0" />
            <Button size="sm" disabled={pending || !luckUser}>{t.save}</Button>
          </div>
          <p className="text-[11px] text-faint">{t.userLuckNote}</p>
          {luckyUsers.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {luckyUsers.map((u) => (
                <Badge key={u.id} tone={u.luckBps > 0 ? "yes" : "no"}>
                  @{u.username ?? u.id.slice(0, 8)} {(u.luckBps / 100).toFixed(0)}%
                </Badge>
              ))}
            </div>
          )}
        </form>

        <div className="rounded-xl border border-line bg-surface-2 p-3 space-y-2">
          <div className="text-[12px] font-bold text-ink">{t.houseGamesTitle}</div>
          <div className="flex flex-wrap gap-1.5">
            {GAME_KEYS.map((g) => {
              const off = stats.disabledGames.includes(g);
              return (
                <button
                  key={g}
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => setGameEnabled({ game: g, enabled: off }), t.savedToast)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors",
                    off
                      ? "border-no/50 bg-no/10 text-no-strong line-through"
                      : "border-yes/50 bg-yes/10 text-yes-strong"
                  )}
                >
                  {houseGameName(g)}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-faint">{t.houseGamesNote}</p>
        </div>

        <form
          noValidate
          className="rounded-xl border border-line bg-surface-2 p-3 space-y-2 sm:col-span-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                setLeverageConfig({
                  gameMaxLev: Math.round(parseFloat(levGame || "1")),
                  tradeMaxLev: Math.round(parseFloat(levTrade || "1")),
                  levFeeBps: Math.round(parseFloat(levFee || "0") * 100),
                  gameLevCaps: Object.fromEntries(
                    GAME_KEYS.map((g) => [g, levPer[g] === "" || levPer[g] == null ? null : Math.round(parseFloat(levPer[g]))])
                  ),
                  gameMaxBetCents: Math.round(parseFloat(betGame || "1000") * 100),
                  tradeMaxSpendCents: Math.round(parseFloat(betTrade || "5000") * 100),
                  gameBetCaps: Object.fromEntries(
                    GAME_KEYS.map((g) => [g, betPer[g] === "" || betPer[g] == null ? null : Math.round(parseFloat(betPer[g]) * 100)])
                  ),
                }),
              t.savedToast
            );
          }}
        >
          <div className="text-[12px] font-bold text-ink">{t.levCfgTitle}</div>
          <div className="grid grid-cols-3 gap-2">
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-mute">{t.levCfgGames}</span>
              <Input type="number" min={1} max={100} step="1" value={levGame} onChange={(e) => setLevGame(e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-mute">{t.levCfgMarkets}</span>
              <Input type="number" min={1} max={100} step="1" value={levTrade} onChange={(e) => setLevTrade(e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-mute">{t.levCfgFee}</span>
              <Input type="number" min={0} max={50} step="0.5" value={levFee} onChange={(e) => setLevFee(e.target.value)} />
            </label>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {GAME_KEYS.map((g) => (
              <label key={g} className="space-y-0.5">
                <span className="block truncate text-[10.5px] font-medium text-mute">{houseGameName(g)}</span>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  step="1"
                  placeholder={levGame}
                  title={t.levCfgPerGameTitle}
                  value={levPer[g] ?? ""}
                  onChange={(e) => setLevPer((p) => ({ ...p, [g]: e.target.value }))}
                />
              </label>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-mute">{t.betCfgGames}</span>
              <Input type="number" min={1} step="any" value={betGame} onChange={(e) => setBetGame(e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-mute">{t.betCfgMarkets}</span>
              <Input type="number" min={10} step="any" value={betTrade} onChange={(e) => setBetTrade(e.target.value)} />
            </label>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {GAME_KEYS.map((g) => (
              <label key={g} className="space-y-0.5">
                <span className="block truncate text-[10.5px] font-medium text-mute">{houseGameName(g)} Ɱ</span>
                <Input
                  type="number"
                  min={1}
                  step="any"
                  placeholder={betGame}
                  title={t.betCfgPerGameTitle}
                  value={betPer[g] ?? ""}
                  onChange={(e) => setBetPer((p) => ({ ...p, [g]: e.target.value }))}
                />
              </label>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-faint">{t.levCfgNote}</p>
            <Button size="sm" disabled={pending}>{t.save}</Button>
          </div>
        </form>

        <form
          noValidate
          className="rounded-xl border border-line bg-surface-2 p-3 space-y-2 sm:col-span-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                setGameRules({
                  autobetEnabled: ruleAutobet,
                  gameDailyLimitMs: Math.round(parseFloat(ruleDaily || "2") * 3_600_000),
                  gameIdleMs: Math.round(parseFloat(ruleIdle || "30") * 60_000),
                  gameFeeCents: Math.round(parseFloat(ruleGameFee || "0") * 100),
                  tradeFeeCents: Math.round(parseFloat(ruleTradeFee || "0") * 100),
                  debtRateBps: Math.round(parseFloat(ruleApr || "0") * 100),
                  referralRoyaltyBps: Math.round(parseFloat(ruleRoyPct || "0") * 100),
                  referralRoyaltyCapCents: Math.round(parseFloat(ruleRoyCap || "0") * 100),
                  dicePayBps: Math.round(parseFloat(ruleDicePay || "92") * 100),
                  limboPayBps: Math.round(parseFloat(ruleLimboPay || "96") * 100),
                  limboMinX100: Math.round(parseFloat(ruleLimboMin || "1.1") * 100),
                  minTradeCents: Math.round(parseFloat(ruleMinTrade || "0") * 100),
                }),
              t.savedToast
            );
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="text-[12px] font-bold text-ink">{t.rulesTitle}</div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <span className="text-[11px] font-medium text-mute" title={t.rulesAutobetDesc}>{t.rulesAutobet}</span>
              <button
                type="button"
                role="switch"
                aria-checked={ruleAutobet}
                onClick={() => setRuleAutobet((v) => !v)}
                className={cn("relative h-5 w-9 rounded-full transition-colors cursor-pointer", ruleAutobet ? "bg-brand" : "bg-surface-3")}
              >
                <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform", ruleAutobet ? "translate-x-[18px]" : "translate-x-0.5")} />
              </button>
            </label>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-mute">{t.rulesDaily}</span>
              <Input type="number" min={0.5} max={24} step={0.5} value={ruleDaily} onChange={(e) => setRuleDaily(e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-mute">{t.rulesIdle}</span>
              <Input type="number" min={1} max={1440} step="1" value={ruleIdle} onChange={(e) => setRuleIdle(e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-mute">{t.rulesGameFee}</span>
              <Input type="number" min={0} max={1000} step="0.5" value={ruleGameFee} onChange={(e) => setRuleGameFee(e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-mute">{t.rulesTradeFee}</span>
              <Input type="number" min={0} max={1000} step="0.5" value={ruleTradeFee} onChange={(e) => setRuleTradeFee(e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-mute">{t.rulesApr}</span>
              <Input type="number" min={0} max={1000} step="1" value={ruleApr} onChange={(e) => setRuleApr(e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-mute">{t.rulesRoyPct}</span>
              <Input type="number" min={0} max={100} step="0.5" value={ruleRoyPct} onChange={(e) => setRuleRoyPct(e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-mute">{t.rulesRoyCap}</span>
              <Input type="number" min={0} step="100" value={ruleRoyCap} onChange={(e) => setRuleRoyCap(e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-mute">{t.rulesMinTrade}</span>
              <Input type="number" min={0} step="1" value={ruleMinTrade} onChange={(e) => setRuleMinTrade(e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-mute">{t.rulesDicePay}</span>
              <Input type="number" min={10} max={100} step="0.5" value={ruleDicePay} onChange={(e) => setRuleDicePay(e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-mute">{t.rulesLimboPay}</span>
              <Input type="number" min={10} max={100} step="0.5" value={ruleLimboPay} onChange={(e) => setRuleLimboPay(e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-mute">{t.rulesLimboMin}</span>
              <Input type="number" min={1.01} max={100} step="0.01" value={ruleLimboMin} onChange={(e) => setRuleLimboMin(e.target.value)} />
            </label>
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-faint">{t.rulesNote}</p>
            <Button size="sm" disabled={pending}>{t.save}</Button>
          </div>
        </form>

        <div className="rounded-xl border border-line bg-surface-2 p-3 space-y-2">
          <div className="text-[12px] font-bold text-ink">{t.houseDangerTitle}</div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => run(() => resetJackpot(), t.savedToast)}
            >
              {t.houseJackpotReset}
            </Button>
            <Button
              size="sm"
              variant="no"
              disabled={pending}
              onClick={() => {
                if (!window.confirm(t.houseEconomyConfirm)) return;
                run(() => adminResetEconomy(), t.savedToast);
              }}
            >
              {t.houseEconomyReset}
            </Button>
          </div>
          <p className="text-[11px] text-faint">{t.houseDangerNote}</p>
        </div>
      </div>
    </div>
  );
}

// Admin user creation — username + password, optional admin role.
export function UsersPanel({ lang }: { lang?: Lang }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [admin, setAdmin] = useState(false);
  const { pending, run } = useAction(lang);
  const t = getT(lang ?? "cs");

  return (
    <form
      className="p-4 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => adminCreateUser({ username, password, role: admin ? "admin" : "user" }),
          t.userCreated(username.trim().toLowerCase())
        );
        setUsername("");
        setPassword("");
        setAdmin(false);
      }}
    >
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-3">
        <Input placeholder={t.createUserPh} value={username} onChange={(e) => setUsername(e.target.value)} required />
        <Input type="password" placeholder={t.password} value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      <div className="flex items-center justify-between gap-3">
        <label className="inline-flex items-center gap-2 text-[13px] text-mute cursor-pointer select-none">
          <input
            type="checkbox"
            checked={admin}
            onChange={(e) => setAdmin(e.target.checked)}
            className="size-4 accent-brand"
          />
          {t.makeAdmin}
        </label>
        <Button size="sm" disabled={pending || !username.trim() || password.length < 6}>
          {pending ? "…" : t.createUserBtn}
        </Button>
      </div>
    </form>
  );
}

// Admin user manager — every account with moderation controls: password
// reset, comment mute, full ban (drops sessions + blocks sign-in), role toggle.
// The acting admin and the owner account are protected server-side; the UI
// also hides controls on your own row.
export function UserManager({
  users,
  selfId,
  lang,
}: {
  users: {
    id: string;
    username: string | null;
    email: string | null;
    role: string;
    balanceCents: number;
    createdAt: Date;
    bannedAt: Date | null;
    commentsBanned: boolean;
  }[];
  selfId: string;
  lang?: Lang;
}) {
  const { pending, run } = useAction(lang);
  const t = getT(lang ?? "cs");
  if (users.length === 0) return <p className="p-4 text-sm text-mute">{t.umNoUsers}</p>;
  return (
    <div className="divide-y divide-line-2">
      {users.map((u) => (
        <div key={u.id} className="px-4 py-3 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-3">
          <div className="flex-1 min-w-0 w-full">
            <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
              <span className="truncate">@{u.username ?? u.id.slice(0, 8)}</span>
              {u.id === selfId && <Badge tone="ink">{t.umYou}</Badge>}
              {u.role === "admin" && <Badge tone="yes">{t.umAdmin}</Badge>}
              {u.bannedAt ? <Badge tone="no">{t.umBanned}</Badge> : u.commentsBanned && <Badge tone="warn">{t.umMuted}</Badge>}
            </div>
            <div className="text-[11.5px] text-faint mt-0.5 truncate">
              {u.email} · {fmtMonos(u.balanceCents, { lang })} · {fmtDate(u.createdAt, lang)}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 sm:justify-end shrink-0">
            <Button
              size="xs"
              variant="outline"
              disabled={pending}
              onClick={() => {
                const name = prompt(t.umRenamePrompt(u.username ?? "?"), u.username ?? "");
                if (name === null || name.trim() === "") return;
                run(() => adminRenameUser({ userId: u.id, username: name }), t.savedToast);
              }}
            >
              <Pencil className="size-3" /> {t.umRename}
            </Button>
            {u.id !== selfId && (
              <>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    const pw = prompt(t.umNewPasswordFor(u.username ?? "?"));
                  if (pw === null) return;
                  if (pw.length < 6) return toast.error(t.authPassShort);
                  run(() => adminResetUserPassword({ userId: u.id, password: pw }), t.savedToast);
                }}
              >
                <KeyRound className="size-3" /> {t.umResetPw}
              </Button>
              <Button
                size="xs"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  run(() => adminSetUserRole({ userId: u.id, role: u.role === "admin" ? "user" : "admin" }), t.savedToast)
                }
              >
                {u.role === "admin" ? <ShieldMinus className="size-3" /> : <ShieldPlus className="size-3" />}
                {u.role === "admin" ? t.umRemoveAdmin : t.umMakeAdmin}
              </Button>
              <Button
                size="xs"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  run(() => adminSetCommentsBanned({ userId: u.id, banned: !u.commentsBanned }), t.savedToast)
                }
              >
                {u.commentsBanned ? <MessageSquare className="size-3" /> : <MessageSquareOff className="size-3" />}
                {u.commentsBanned ? t.umUnmute : t.umMute}
              </Button>
              <Button
                size="xs"
                variant={u.bannedAt ? "outline" : "no"}
                disabled={pending}
                onClick={() => {
                  if (u.bannedAt) return run(() => adminSetUserBanned({ userId: u.id, banned: false }), t.savedToast);
                  const reason = prompt(t.umBanReasonFor(u.username ?? "?"));
                  if (reason === null) return;
                  run(() => adminSetUserBanned({ userId: u.id, banned: true, reason }), t.savedToast);
                }}
              >
                <Ban className="size-3" /> {u.bannedAt ? t.umUnban : t.umBan}
              </Button>
                <Button
                  size="xs"
                  variant="no"
                  disabled={pending}
                  onClick={() => {
                    if (confirm(t.umDeleteConfirm(u.username ?? "?"))) run(() => adminDeleteUser({ userId: u.id }), t.umDeleted);
                  }}
                >
                  <Trash2 className="size-3" /> {t.umDelete}
                </Button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// Admin category manager — rename carries markets over; delete only allowed on
// empty categories (the server enforces both).
export function CategoriesPanel({
  categories,
  lang,
}: {
  categories: { name: string; markets: number }[];
  lang?: Lang;
}) {
  const t = getT(lang ?? "cs");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  // Local order mirrors the server list; adjusted live during a drag and
  // persisted on drop. Render-time resync keeps it honest after refresh.
  const [order, setOrder] = useState<string[]>(() => categories.map((c) => c.name));
  const [prevCats, setPrevCats] = useState(categories);
  if (categories !== prevCats) {
    setPrevCats(categories);
    setOrder(categories.map((c) => c.name));
  }
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  // Insertion index into `order` — reordering happens once, on drop. Moving
  // rows during dragover makes them jump under the cursor and oscillate.
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const byName = new Map(categories.map((c) => [c.name, c]));
  // Indicator position; the two spots adjacent to the dragged row are no-ops.
  const lineAt =
    dragIdx === null || overIdx === null || overIdx === dragIdx || overIdx === dragIdx + 1 ? null : overIdx;

  const finishDrag = () => {
    setDragIdx(null);
    setOverIdx(null);
  };

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(ok);
        after?.();
        router.refresh();
      } else toast.error(t.serverErr(r.error));
    });

  const dropAt = () => {
    if (dragIdx === null || overIdx === null) return;
    const next = [...order];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(overIdx > dragIdx ? overIdx - 1 : overIdx, 0, moved);
    if (next.join() === order.join()) return;
    setOrder(next);
    act(() => reorderCategories({ names: next }), t.catReorder);
  };

  return (
    <div className="p-4 space-y-2">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!newName.trim()) return;
          act(() => createCategory({ name: newName }), t.catCreated(newName.trim()), () => setNewName(""));
        }}
      >
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={t.addCategoryPh}
          maxLength={24}
          className="h-9 text-[13px]"
        />
        <Button size="sm" className="h-9 shrink-0" disabled={pending || !newName.trim()}>
          {t.addCategory}
        </Button>
      </form>

      <div
        className="divide-y divide-line-2"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          dropAt();
          finishDrag();
        }}
      >
        {order.map((name, i) => {
          const c = byName.get(name);
          if (!c) return null;
          return (
          <div
            key={c.name}
            draggable={editing !== c.name}
            onDragStart={(e) => {
              setDragIdx(i);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => {
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              setOverIdx(e.clientY < r.top + r.height / 2 ? i : i + 1);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              dropAt();
              finishDrag();
            }}
            onDragEnd={finishDrag}
            className={`relative flex items-center gap-2 py-2 ${dragIdx === i ? "opacity-40" : ""} ${
              lineAt === i ? "shadow-[inset_0_2px_0_0_var(--color-brand)]" : ""
            } ${lineAt === order.length && i === order.length - 1 ? "shadow-[inset_0_-2px_0_0_var(--color-brand)]" : ""}`}
          >
            <GripVertical className="size-4 shrink-0 cursor-grab text-faint active:cursor-grabbing" />
            {editing === c.name ? (
              <form
                className="flex flex-1 items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!editValue.trim() || editValue.trim() === c.name) return setEditing(null);
                  act(
                    () => renameCategory({ from: c.name, to: editValue }),
                    t.catRenamed,
                    () => setEditing(null)
                  );
                }}
              >
                <Input value={editValue} onChange={(e) => setEditValue(e.target.value)} maxLength={24} className="h-8 text-[13px]" autoFocus />
                <Button size="xs" className="h-8" disabled={pending}>{t.rename}</Button>
                <Button size="xs" variant="outline" className="h-8" type="button" onClick={() => setEditing(null)}>✕</Button>
              </form>
            ) : (
              <>
                <span className="flex-1 text-[13.5px] font-medium">{c.name}</span>
                <span className="text-[11px] text-faint num">{c.markets} {t.marketsN}</span>
                <button
                  type="button"
                  className="size-7 grid place-items-center rounded-md text-faint hover:text-ink hover:bg-surface-2 cursor-pointer"
                  title={t.rename}
                  onClick={() => {
                    setEditing(c.name);
                    setEditValue(c.name);
                  }}
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  type="button"
                  className="size-7 grid place-items-center rounded-md text-faint hover:text-no-strong hover:bg-no-soft cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                  title={c.markets > 0 ? `${c.markets} ${t.categoryInUse}` : t.delete}
                  disabled={pending || c.markets > 0}
                  onClick={() => {
                    if (confirm(t.deleteCatConfirm(c.name)))
                      act(() => deleteCategory({ name: c.name }), t.catDeleted);
                  }}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </>
            )}
          </div>
          );
        })}
      </div>
    </div>
  );
}

// Disputed duels land here for an admin tiebreak — pick a winner for the full
// pot or refund both stakes.
export function DuelAdminPanel({
  items,
  lang,
}: {
  items: {
    id: string;
    claim: string;
    stakeCents: number;
    creatorId: string;
    opponentId: string;
    creatorName: string | null;
    opponentName: string | null;
  }[];
  lang?: Lang;
}) {
  const t = getT(lang ?? "cs");
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(ok);
        router.refresh();
      } else toast.error(t.serverErr(r.error));
    });

  if (items.length === 0) return <p className="px-4 py-6 text-sm text-mute text-center">{t.duelNoDisputes}</p>;
  return (
    <div className="divide-y divide-line">
      {items.map((d) => (
        <div key={d.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium leading-snug">{d.claim}</div>
            <div className="text-[11.5px] text-faint mt-0.5">
              @{d.creatorName} vs @{d.opponentName} · {fmtMonos(d.stakeCents * 2, { lang })}
            </div>
          </div>
          <div className="flex gap-1.5 shrink-0 flex-wrap">
            <Button size="xs" variant="yes" disabled={pending} onClick={() => run(() => adminSettleDuel({ id: d.id, winnerId: d.creatorId }), t.duelSettledToast)}>
              @{d.creatorName}
            </Button>
            <Button size="xs" variant="yes" disabled={pending} onClick={() => run(() => adminSettleDuel({ id: d.id, winnerId: d.opponentId }), t.duelSettledToast)}>
              @{d.opponentName}
            </Button>
            <Button size="xs" variant="outline" disabled={pending} onClick={() => run(() => adminSettleDuel({ id: d.id, winnerId: null }), t.duelSettledToast)}>
              {t.duelRefundBoth}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

// Blackjack dealer personas — name + emoji + outcome quips; a random active
// one fronts each hand. Edited inline; inactive dealers stop dealing.
export function DealersPanel({
  dealers,
  lang,
}: {
  dealers: { id: string; name: string; avatar: string; quipWin: string; quipLose: string; active: boolean }[];
  lang?: Lang;
}) {
  const t = getT(lang ?? "cs");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState("");
  const [quipWin, setQuipWin] = useState("");
  const [quipLose, setQuipLose] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(ok);
        after?.();
        router.refresh();
      } else toast.error(t.serverErr(r.error));
    });

  return (
    <div className="p-4 space-y-3">
      <p className="text-[11.5px] text-faint">{t.dealersHint}</p>
      <div className="divide-y divide-line-2">
        {dealers.map((d) => (
          <div key={d.id} className="py-2.5 first:pt-0">
            {editing === d.id ? (
              <DealerForm
                initial={d}
                pending={pending}
                lang={lang}
                onSave={(v) => run(() => adminUpsertDealer({ id: d.id, ...v }), t.savedToast, () => setEditing(null))}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <div className="flex items-center gap-2.5 flex-wrap">
                <DealerAvatar avatar={d.avatar} className="size-8 rounded-lg text-[13px]" />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold flex items-center gap-1.5">
                    {d.name}
                    {!d.active && <Badge tone="mute">{t.dealerInactive}</Badge>}
                  </div>
                  <div className="text-[11px] text-faint truncate">
                    {d.quipWin && `W: “${d.quipWin}”`} {d.quipLose && `· L: “${d.quipLose}”`}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    type="button"
                    title={t.rename}
                    onClick={() => setEditing(d.id)}
                    className="size-7 grid place-items-center rounded-md text-faint hover:text-ink hover:bg-surface-2 cursor-pointer"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    title={d.active ? t.dealerInactive : t.approve}
                    disabled={pending}
                    onClick={() => run(() => adminToggleDealer({ id: d.id, active: !d.active }), t.savedToast)}
                    className="size-7 grid place-items-center rounded-md text-faint hover:text-ink hover:bg-surface-2 cursor-pointer disabled:opacity-40"
                  >
                    {d.active ? <Ban className="size-3.5" /> : <Check className="size-3.5" />}
                  </button>
                  <button
                    type="button"
                    title={t.delete}
                    disabled={pending}
                    onClick={() => {
                      if (confirm(t.deleteCatConfirm(d.name))) run(() => adminDeleteDealer({ id: d.id }), t.catDeleted);
                    }}
                    className="size-7 grid place-items-center rounded-md text-faint hover:text-no-strong hover:bg-no-soft cursor-pointer disabled:opacity-40"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        {dealers.length === 0 && <p className="text-[12.5px] text-faint py-1">{t.notesEmpty}</p>}
      </div>
      <DealerForm
        pending={pending}
        lang={lang}
        onSave={(v) =>
          run(() => adminUpsertDealer(v), t.dealerAdd, () => {
            setName("");
            setAvatar("");
            setQuipWin("");
            setQuipLose("");
          })
        }
        onCancel={null}
        values={{ name, avatar, quipWin, quipLose }}
        onChange={{ setName, setAvatar, setQuipWin, setQuipLose }}
      />
    </div>
  );
}

function DealerForm({
  initial,
  values,
  onChange,
  pending,
  lang,
  onSave,
  onCancel,
}: {
  initial?: { name: string; avatar: string; quipWin: string; quipLose: string };
  values?: { name: string; avatar: string; quipWin: string; quipLose: string };
  onChange?: { setName: (v: string) => void; setAvatar: (v: string) => void; setQuipWin: (v: string) => void; setQuipLose: (v: string) => void };
  pending: boolean;
  lang?: Lang;
  onSave: (v: { name: string; avatar: string; quipWin: string; quipLose: string }) => void;
  onCancel: (() => void) | null;
}) {
  const t = getT(lang ?? "cs");
  // Inline-edit rows manage their own state; the add form lifts it to the parent.
  const [n, setN] = useState(initial?.name ?? "");
  const [a, setA] = useState(initial?.avatar ?? "");
  const [qw, setQw] = useState(initial?.quipWin ?? "");
  const [ql, setQl] = useState(initial?.quipLose ?? "");
  const name = values?.name ?? n;
  const avatar = values?.avatar ?? a;
  const quipWin = values?.quipWin ?? qw;
  const quipLose = values?.quipLose ?? ql;
  const setters = onChange ?? { setName: setN, setAvatar: setA, setQuipWin: setQw, setQuipLose: setQl };
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onSave({ name, avatar, quipWin, quipLose });
        if (!onChange) {
          setN("");
          setA("");
          setQw("");
          setQl("");
        }
      }}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <ImageCell
          image={/^(data:image\/|https?:\/\/|\/)\S+/.test(avatar) ? avatar : ""}
          onImage={setters.setAvatar}
          imageHint={t.optionImageHint}
          onBadImage={() => toast.error(t.imageBad)}
          className="size-9"
        />
        <IconPicker onPick={setters.setAvatar} hint={t.iconPickerHint} />
        <Input
          value={/^(data:image\/|https?:\/\/|\/)\S+/.test(avatar) ? "" : avatar}
          onChange={(e) => setters.setAvatar(e.target.value)}
          placeholder="DD"
          title={t.dealerAvatarPh}
          maxLength={4}
          className="h-9 w-16 text-center"
        />
        <Input value={name} onChange={(e) => setters.setName(e.target.value)} placeholder={t.dealerNamePh} maxLength={40} required className="h-9 flex-1 min-w-0" />
      </div>
      <Input value={quipWin} onChange={(e) => setters.setQuipWin(e.target.value)} placeholder={t.dealerQuipWinPh} maxLength={140} className="h-9" />
      <Input value={quipLose} onChange={(e) => setters.setQuipLose(e.target.value)} placeholder={t.dealerQuipLosePh} maxLength={140} className="h-9" />
      <div className="flex gap-2">
        <Button size="sm" disabled={pending || !name.trim()}>
          {initial ? t.rename : t.dealerAdd}
        </Button>
        {onCancel && (
          <Button size="sm" variant="outline" type="button" onClick={onCancel}>
            ✕
          </Button>
        )}
      </div>
    </form>
  );
}
