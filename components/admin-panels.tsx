"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button, Input, Select, Badge } from "@/components/ui/primitives";
import { approveMarket, rejectMarket, resolveMarket, cancelMarket, grantBalance, createCategory, renameCategory, deleteCategory, reorderCategories, deleteMarket, adminCreateUser, adminSetUserBanned, adminSetCommentsBanned, adminSetUserRole, adminRenameUser, adminResetUserPassword, adminSettleDuel, adminDeleteUser, setLeverageConfig, setHouseRules, adminResetEconomy } from "@/lib/actions";
import { fmtMonos, fmtDate } from "@/lib/money";
import { cn } from "@/lib/utils";
import { getT, type Lang } from "@/lib/i18n";
import { Check, X, CircleCheck, Ban, Pencil, Trash2, KeyRound, MessageSquareOff, MessageSquare, ShieldPlus, ShieldMinus, GripVertical, StickyNote, Scale } from "lucide-react";

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

// House P&L + economy tuning — admin "inside info": fees banked by the house
// and the knobs for trade fees, loan APR, referral royalties and min trades.
type HouseStats = {
  feesCents: { total: number; game: number; trade: number; levGame: number; levTrade: number };
  lev: {
    tradeMaxLev: number;
    levFeeBps: number;
    tradeMaxSpendCents: number;
  };
  rules: {
    tradeFeeCents: number;
    debtRateBps: number;
    referralRoyaltyBps: number;
    referralRoyaltyCapCents: number;
    minTradeCents: number;
  };
  loans: { count: number; disbursedCents: number; repaidCents: number; outstandingCents: number; positionCents: number };
};

export function HousePanel({
  stats,
  lang,
}: {
  stats: HouseStats;
  lang?: Lang;
}) {
  const t = getT(lang ?? "cs");
  const { pending, run } = useAction(lang);
  // Leverage + spend knobs for market orders — trade-only now that the
  // casino minigames (and their per-game overrides) are gone.
  const [levTrade, setLevTrade] = useState(String(stats.lev.tradeMaxLev));
  const [levFee, setLevFee] = useState((stats.lev.levFeeBps / 100).toFixed(0));
  // Stake ceiling — Ɱ units in the input.
  const [betTrade, setBetTrade] = useState(String(stats.lev.tradeMaxSpendCents / 100));
  // House rules — the former hardcodes, now admin-tunable.
  const [ruleTradeFee, setRuleTradeFee] = useState((stats.rules.tradeFeeCents / 100).toString());
  const [ruleApr, setRuleApr] = useState((stats.rules.debtRateBps / 100).toString());
  const [ruleRoyPct, setRuleRoyPct] = useState((stats.rules.referralRoyaltyBps / 100).toString());
  const [ruleRoyCap, setRuleRoyCap] = useState((stats.rules.referralRoyaltyCapCents / 100).toString());
  const [ruleMinTrade, setRuleMinTrade] = useState((stats.rules.minTradeCents / 100).toString());

  return (
    <div className="p-4 space-y-5">
      <div className="rounded-xl border border-line bg-surface-2 px-3 py-2.5">
        <div className="text-[11px] font-semibold text-faint">{t.houseFees}</div>
        <div className="num text-[17px] font-bold text-yes-strong">+{fmtMonos(stats.feesCents.total, { lang })}</div>
        <div className="num text-[10.5px] text-faint">{t.houseFeesNote(fmtMonos(stats.feesCents.game, { lang }), fmtMonos(stats.feesCents.trade, { lang }))}</div>
        <div className="num text-[10.5px] text-faint">{t.houseFeesLevNote(fmtMonos(stats.feesCents.levGame, { lang }), fmtMonos(stats.feesCents.levTrade, { lang }))}</div>
      </div>

      {stats.loans.count > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <tbody>
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
            </tbody>
          </table>
          <p className="mt-1.5 text-[11px] text-faint">{t.houseLoansNote(fmtMonos(stats.loans.outstandingCents, { lang }))}</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <form
          noValidate
          className="rounded-xl border border-line bg-surface-2 p-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                setLeverageConfig({
                  tradeMaxLev: Math.round(parseFloat(levTrade || "1")),
                  levFeeBps: Math.round(parseFloat(levFee || "0") * 100),
                  tradeMaxSpendCents: Math.round(parseFloat(betTrade || "5000") * 100),
                }),
              t.savedToast
            );
          }}
        >
          <div className="text-[12px] font-bold text-ink">{t.levCfgTitle}</div>
          <div className="grid grid-cols-3 gap-2">
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-mute">{t.levCfgMarkets}</span>
              <Input type="number" min={1} max={100} step="1" value={levTrade} onChange={(e) => setLevTrade(e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-mute">{t.levCfgFee}</span>
              <Input type="number" min={0} max={50} step="0.5" value={levFee} onChange={(e) => setLevFee(e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-mute">{t.betCfgMarkets}</span>
              <Input type="number" min={10} step="any" value={betTrade} onChange={(e) => setBetTrade(e.target.value)} />
            </label>
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-faint">{t.levCfgNote}</p>
            <Button size="sm" disabled={pending}>{t.save}</Button>
          </div>
        </form>

        <form
          noValidate
          className="rounded-xl border border-line bg-surface-2 p-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                setHouseRules({
                  tradeFeeCents: Math.round(parseFloat(ruleTradeFee || "0") * 100),
                  debtRateBps: Math.round(parseFloat(ruleApr || "0") * 100),
                  referralRoyaltyBps: Math.round(parseFloat(ruleRoyPct || "0") * 100),
                  referralRoyaltyCapCents: Math.round(parseFloat(ruleRoyCap || "0") * 100),
                  minTradeCents: Math.round(parseFloat(ruleMinTrade || "0") * 100),
                }),
              t.savedToast
            );
          }}
        >
          <div className="text-[12px] font-bold text-ink">{t.rulesTitle}</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
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


