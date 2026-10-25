"use client";

// Phase 2.2 admin money panels:
//   AdminMoneyPanel   — /admin/money: adjust ops + bulk grants (preview→confirm) +
//                       batch undo bar + recent admin rows with reverse buttons
//   PlayerAdjustPanel — /admin/players/[id]: per-player adjust + freeze island
// Style follows fun-panels.tsx (useState + useTransition + sonner toasts).
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button, Input, Select, Badge, Card, Textarea } from "@/components/ui/primitives";
import {
  moneyAdjust,
  bulkGrant,
  bulkUndo,
  freezePlayer,
  type BulkResult,
} from "@/lib/actions-admin";
import { fmtMonos } from "@/lib/money";
import { getT, type Lang } from "@/lib/i18n";
import { Loader2, Coins, Users, ScrollText } from "lucide-react";

// ---------- shared row shapes (serialized server-side) ----------
export type AdminPlayerRow = {
  id: string;
  username: string;
  name: string;
  role: string;
  balanceCents: number;
  frozenAt: string | null;
  squadId: string | null;
  squadName: string | null;
};

export type AdminMoneyRow = {
  id: string;
  userId: string;
  username: string | null;
  amountCents: number;
  kind: string;
  memo: string;
  createdAtMs: number;
};

export type AdminBatchRow = {
  batchId: string;
  createdAtMs: number;
  reason: string;
  affectedCount: number;
  totalCents: number;
  undone: boolean;
};

export type AdminSquadRow = { id: string; name: string; memberCount: number };

const KIND_TONE: Record<string, "yes" | "no" | "ink" | "warn" | "mute"> = {
  grant: "yes",
  refund: "yes",
  deduct: "no",
  adjust: "warn",
  reverse: "warn",
  transfer: "ink",
};

function kindLabel(t: ReturnType<typeof getT>, kind: string): string {
  switch (kind) {
    case "grant":
      return t.admMoneyOpGrant;
    case "deduct":
      return t.kindDeduct;
    case "adjust":
      return t.kindAdjust;
    case "reverse":
      return t.kindReverse;
    case "refund":
      return t.kindRefund;
    case "transfer":
      return t.kindTransfer;
    default:
      return kind;
  }
}

// parse "120" / "120,5" → cents (client-side only, server re-validates)
function parseMonosUi(raw: string): number | null {
  const n = Number(raw.replace(",", ".").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

// ============================================================
// /admin/money — the desk
// ============================================================
export function AdminMoneyPanel({
  lang,
  players,
  squads,
  recent,
  batches,
  isOwnerOrAdmin,
}: {
  lang: Lang;
  players: AdminPlayerRow[];
  squads: AdminSquadRow[];
  recent: AdminMoneyRow[];
  batches: AdminBatchRow[];
  isOwnerOrAdmin: boolean;
}) {
  const t = getT(lang);
  const router = useRouter();
  const [pending, start] = useTransition();

  // single-op form state
  const [targetId, setTargetId] = useState(players[0]?.id ?? "");
  const [op, setOp] = useState("grant");
  const [toId, setToId] = useState(players[1]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [allowNegative, setAllowNegative] = useState(false);

  // bulk state
  const [scope, setScope] = useState<"selected" | "squad" | "all">("selected");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [squadId, setSquadId] = useState(squads[0]?.id ?? "");
  const [bulkAmount, setBulkAmount] = useState("");
  const [bulkReason, setBulkReason] = useState("");
  // preview step for selected/squad; "all" flows straight to the server confirm
  const [preview, setPreview] = useState<{ ids: string[]; total: number } | null>(null);

  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return players;
    return players.filter(
      (p) => (p.username ?? "").toLowerCase().includes(q) || (p.name ?? "").toLowerCase().includes(q)
    );
  }, [players, query]);

  const toggleSel = (id: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const apply = () => {
    if (pending) return;
    start(async () => {
      const res = await moneyAdjust({
        userId: targetId,
        op: op as "grant",
        amountMonos: amount,
        targetMonos: amount,
        toUserId: toId,
        reason,
        allowNegative,
      });
      if (!res.ok) toast.error(res.error ?? "Error");
      else {
        toast.success(t.savedToast);
        setAmount("");
        router.refresh();
      }
    });
  };

  const reverseRow = (row: AdminMoneyRow) => {
    const reason = window.prompt(t.admMoneyReasonPh) ?? "";
    if (reason.trim().length < 5) return; // server also enforces this
    start(async () => {
      const res = await moneyAdjust({ userId: row.userId, op: "reverse", refLedgerId: row.id, reason });
      if (!res.ok) toast.error(res.error ?? "Error");
      else {
        toast.success(t.savedToast);
        router.refresh();
      }
    });
  };

  const undo = (batchId: string) => {
    const reason = window.prompt(t.admMoneyReasonPh) ?? "";
    if (reason.trim().length < 5) return;
    start(async () => {
      const res = await bulkUndo({ batchId, reason });
      if (!res.ok) toast.error(res.error ?? "Error");
      else {
        toast.success(`${t.savedToast}${res.count != null ? ` (${res.count})` : ""}`);
        router.refresh();
      }
    });
  };

  const previewBulk = () => {
    const per = parseMonosUi(bulkAmount);
    if (per === null) {
      toast.error(t.admMoneyAmount);
      return;
    }
    let ids: string[] = [];
    if (scope === "selected") ids = [...selected];
    else if (scope === "squad") ids = players.filter((p) => p.squadId === squadId).map((p) => p.id);
    else ids = players.map((p) => p.id);
    if (ids.length === 0) {
      toast.error(scope === "selected" ? t.admMoneyNoPlayer : t.admMoneySquad);
      return;
    }
    setPreview({ ids, total: ids.length * per });
  };

  const confirmBulk = () => {
    if (pending) return;
    start(async () => {
      let res: BulkResult;
      if (scope === "selected") {
        if (!preview) return;
        res = await bulkGrant({ scope: "selected", userIds: preview.ids, amountMonos: bulkAmount, reason: bulkReason });
      } else if (scope === "squad") {
        res = await bulkGrant({ scope: "squad", squadId, amountMonos: bulkAmount, reason: bulkReason });
      } else {
        res = await bulkGrant({ scope: "all", amountMonos: bulkAmount, reason: bulkReason });
      }
      if (!res.ok) toast.error(res.error ?? "Error");
      else {
        toast.success(
          `${t.savedToast} · ${t.admMoneyPreview.replace("{n}", String(res.count ?? 0)).replace("{sum}", fmtMonos(res.totalCents ?? 0))}`
        );
        setPreview(null);
        setBulkAmount("");
        setBulkReason("");
        setSelected(new Set());
        router.refresh();
      }
    });
  };

  const canConfirm = !pending && (scope === "all" || preview) && bulkAmount !== "" && bulkReason.trim().length >= 5;

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {/* ---- single ops ---- */}
      <Card className="p-5">
        <h2 className="font-semibold text-[15px] mb-1 flex items-center gap-2">
          <Coins className="size-4 text-brand" /> {t.admMoneyTitle}
        </h2>
        <p className="text-[12px] text-mute mb-4">{t.admMoneySub}</p>
        <div className="grid gap-3">
          <div>
            <label className="text-[11.5px] font-semibold text-mute">{t.admMoneyOp}</label>
            <Select value={op} onChange={(e) => setOp(e.target.value)} className="mt-1">
              <option value="grant">{t.admMoneyOpGrant}</option>
              <option value="deduct">{t.admMoneyOpDeduct}</option>
              <option value="set">{t.admMoneyOpSet}</option>
              <option value="refund">{t.admMoneyOpRefund}</option>
              <option value="transfer">{t.admMoneyOpTransfer}</option>
            </Select>
          </div>
          <div>
            <label className="text-[11.5px] font-semibold text-mute">{t.admMoneyPlayers}</label>
            <Select value={targetId} onChange={(e) => setTargetId(e.target.value)} className="mt-1">
              {players.map((p) => (
                <option key={p.id} value={p.id}>
                  @{p.username} — {fmtMonos(p.balanceCents)}
                  {p.frozenAt ? ` · ${t.admMoneyFrozenBadge}` : ""}
                </option>
              ))}
            </Select>
          </div>
          {op === "transfer" && (
            <div>
              <label className="text-[11.5px] font-semibold text-mute">{t.admMoneyRecipient}</label>
              <Select value={toId} onChange={(e) => setToId(e.target.value)} className="mt-1">
                {players
                  .filter((p) => p.id !== targetId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      @{p.username} — {fmtMonos(p.balanceCents)}
                    </option>
                  ))}
              </Select>
            </div>
          )}
          <div>
            <label className="text-[11.5px] font-semibold text-mute">
              {op === "set" ? t.admMoneyTarget : t.admMoneyAmount}
            </label>
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              className="mt-1"
              placeholder={op === "set" ? "0" : "120"}
            />
          </div>
          <div>
            <label className="text-[11.5px] font-semibold text-mute">{t.admMoneyReason}</label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1"
              rows={2}
              placeholder={t.admMoneyReasonPh}
            />
          </div>
          {isOwnerOrAdmin && (
            <label className="flex items-center gap-2 text-[12px]">
              <input type="checkbox" checked={allowNegative} onChange={(e) => setAllowNegative(e.target.checked)} />
              {t.admMoneyAllowNegative}
            </label>
          )}
          <div>
            <Button onClick={apply} disabled={pending || !reason.trim() || amount === ""}>
              {pending && <Loader2 className="size-4 animate-spin" />} {t.admMoneyApply}
            </Button>
          </div>
        </div>
      </Card>

      {/* ---- player picker + checkboxes (shared by bulk "selected") ---- */}
      <Card className="p-5 overflow-hidden">
        <h2 className="font-semibold text-[15px] mb-3 flex items-center gap-2">
          <Users className="size-4 text-brand" /> {t.admMoneyPlayers}
        </h2>
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.admMoneySearch} className="mb-3" />
        {filtered.length === 0 ? (
          <p className="text-[13px] text-mute">{t.admMoneyNoPlayer}</p>
        ) : (
          <div className="divide-y divide-line-2 max-h-[360px] overflow-y-auto">
            {filtered.map((p) => (
              <label key={p.id} className="py-2 flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.has(p.id)}
                  onChange={(e) => toggleSel(p.id, e.target.checked)}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium truncate">
                    {p.name} <span className="text-mute">@{p.username}</span>
                    {p.frozenAt && <Badge tone="warn">{t.admMoneyFrozenBadge}</Badge>}
                  </div>
                  <div className="text-[11px] text-mute">
                    {fmtMonos(p.balanceCents)} · {p.role}
                  </div>
                </div>
                <a href={`/admin/players/${p.id}`} className="text-[11.5px] text-mute hover:underline shrink-0">
                  {t.admPlayerTitle} →
                </a>
              </label>
            ))}
          </div>
        )}
      </Card>

      {/* ---- bulk grants ---- */}
      <Card className="p-5">
        <h2 className="font-semibold text-[15px] mb-3 flex items-center gap-2">
          <Users className="size-4 text-brand" /> {t.admMoneyBulk}
        </h2>
        <div className="grid gap-3">
          <div>
            <label className="text-[11.5px] font-semibold text-mute">{t.admMoneyScope}</label>
            <Select
              value={scope}
              onChange={(e) => {
                setScope(e.target.value as "selected");
                setPreview(null);
              }}
              className="mt-1"
            >
              <option value="selected">{t.admMoneyScopeSelected}</option>
              {squads.length > 0 && <option value="squad">{t.admMoneyScopeSquad}</option>}
              {isOwnerOrAdmin && <option value="all">{t.admMoneyScopeAll}</option>}
            </Select>
          </div>
          {scope === "squad" && (
            <div>
              <label className="text-[11.5px] font-semibold text-mute">{t.admMoneySquad}</label>
              <Select
                value={squadId}
                onChange={(e) => {
                  setSquadId(e.target.value);
                  setPreview(null);
                }}
                className="mt-1"
              >
                {squads.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.memberCount})
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-[11.5px] font-semibold text-mute">{t.admMoneyAmount}</label>
              <Input
                value={bulkAmount}
                onChange={(e) => setBulkAmount(e.target.value)}
                inputMode="decimal"
                className="mt-1"
                placeholder="100"
              />
            </div>
          </div>
          <div>
            <label className="text-[11.5px] font-semibold text-mute">{t.admMoneyReason}</label>
            <Textarea
              value={bulkReason}
              onChange={(e) => setBulkReason(e.target.value)}
              className="mt-1"
              rows={2}
              placeholder={t.admMoneyReasonPh}
            />
          </div>
          {scope === "selected" && selected.size > 0 && (
            <p className="text-[11.5px] text-mute">{t.admMoneyScopeSelected}: {selected.size}</p>
          )}
          {preview && (
            <p className="text-[12.5px] font-medium text-brand">
              {t.admMoneyPreview.replace("{n}", String(preview.ids.length)).replace("{sum}", fmtMonos(preview.total))}
            </p>
          )}
          <div className="flex gap-2">
            <Button onClick={previewBulk} disabled={pending}>
              {t.admMoneyPreviewBtn}
            </Button>
            <Button onClick={confirmBulk} disabled={!canConfirm}>
              {pending && <Loader2 className="size-4 animate-spin" />} {t.admMoneyConfirmBulk}
            </Button>
          </div>
        </div>

        {batches.length > 0 && (
          <div className="mt-4 border-t border-line-2 pt-3">
            <div className="text-[11.5px] font-semibold text-mute mb-2">{t.admMoneyBatch}</div>
            <div className="divide-y divide-line-2 max-h-40 overflow-y-auto">
              {batches.map((b) => (
                <div key={b.batchId} className="py-2 flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] truncate">{b.reason}</div>
                    <div className="text-[11px] text-mute">
                      {b.affectedCount} · {fmtMonos(b.totalCents)}
                    </div>
                  </div>
                  {!b.undone && (
                    <button
                      onClick={() => undo(b.batchId)}
                      className="text-[11.5px] text-amber-600 hover:underline shrink-0"
                    >
                      {t.admMoneyUndo}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* ---- recent admin rows ---- */}
      <Card className="p-5 lg:col-span-2 overflow-hidden">
        <h2 className="font-semibold text-[15px] mb-3 flex items-center gap-2">
          <ScrollText className="size-4 text-brand" /> {t.admMoneyRecent}
        </h2>
        {recent.length === 0 ? (
          <p className="text-[13px] text-mute">{t.admMoneyNothing}</p>
        ) : (
          <div className="divide-y divide-line-2 max-h-[420px] overflow-y-auto">
            {recent.map((r) => (
              <div key={r.id} className="py-2.5 flex items-center gap-3">
                <Badge tone={KIND_TONE[r.kind] ?? "mute"}>{kindLabel(t, r.kind)}</Badge>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] truncate">
                    <a href={`/admin/players/${r.userId}`} className="font-medium hover:underline">
                      @{r.username ?? "?"}
                    </a>
                    <span className={r.amountCents >= 0 ? "text-green-600" : "text-red-500"}> {fmtMonos(r.amountCents)}</span>
                  </div>
                  <div className="text-[11px] text-mute truncate">{r.memo}</div>
                </div>
                <button onClick={() => reverseRow(r)} className="text-[11.5px] text-amber-600 hover:underline shrink-0">
                  {t.admMoneyReverse}
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ============================================================
// /admin/players/[id] — player island: adjust + freeze toggle
// ============================================================
export function PlayerAdjustPanel({ lang, player }: { lang: Lang; player: AdminPlayerRow }) {
  const t = getT(lang);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [op, setOp] = useState("grant");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [freezeReason, setFreezeReason] = useState("");

  const opApply = () => {
    if (pending) return;
    start(async () => {
      const res = await moneyAdjust({
        userId: player.id,
        op: op as "grant",
        amountMonos: amount,
        targetMonos: amount,
        reason,
      });
      if (!res.ok) toast.error(res.error ?? "Error");
      else {
        toast.success(t.savedToast);
        setAmount("");
        router.refresh();
      }
    });
  };

  const toggleFreeze = (freeze: boolean) => {
    if (pending) return;
    start(async () => {
      const res = await freezePlayer({ userId: player.id, freeze, reason: freezeReason });
      if (!res.ok) toast.error(res.error ?? "Error");
      else {
        toast.success(t.savedToast);
        setFreezeReason("");
        router.refresh();
      }
    });
  };

  return (
    <Card className="p-5">
      <h2 className="font-semibold text-[15px] mb-3">{t.admMoneyTitle}</h2>
      <div className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-[11.5px] font-semibold text-mute">{t.admMoneyOp}</label>
            <Select value={op} onChange={(e) => setOp(e.target.value)} className="mt-1">
              <option value="grant">{t.admMoneyOpGrant}</option>
              <option value="deduct">{t.admMoneyOpDeduct}</option>
              <option value="set">{t.admMoneyOpSet}</option>
              <option value="refund">{t.admMoneyOpRefund}</option>
            </Select>
          </div>
          <div>
            <label className="text-[11.5px] font-semibold text-mute">
              {op === "set" ? t.admMoneyTarget : t.admMoneyAmount}
            </label>
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              className="mt-1"
              placeholder={op === "set" ? "0" : "120"}
            />
          </div>
        </div>
        <div>
          <label className="text-[11.5px] font-semibold text-mute">{t.admMoneyReason}</label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-1"
            rows={2}
            placeholder={t.admMoneyReasonPh}
          />
        </div>
        <div>
          <Button onClick={opApply} disabled={pending || !reason.trim() || amount === ""}>
            {pending && <Loader2 className="size-4 animate-spin" />} {t.admMoneyApply}
          </Button>
        </div>
        <div className="border-t border-line-2 pt-3 grid gap-2">
          <label className="text-[11.5px] font-semibold text-mute">{t.admPlayerFreezeReason}</label>
          <Input value={freezeReason} onChange={(e) => setFreezeReason(e.target.value)} />
          {player.frozenAt ? (
            <Button onClick={() => toggleFreeze(false)} disabled={pending || !freezeReason.trim()}>
              {t.admPlayerUnfreeze}
            </Button>
          ) : (
            <Button onClick={() => toggleFreeze(true)} disabled={pending || !freezeReason.trim()}>
              {t.admPlayerFreeze}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
