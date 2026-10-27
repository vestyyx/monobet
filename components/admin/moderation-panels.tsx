"use client";

// Phase 4 admin panels — /admin/moderation:
//   AdminReportsPanel   — player reports queue: assign, resolve, dismiss
//   AdminCommentDesk    — recent comments with hide/show, warn (timeout), mute
//   AdminBlocklistPanel — the loose word filter the comment desk maintains
// Style follows user-panels.tsx (useState + useTransition + sonner).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button, Input, Badge, Card, Textarea } from "@/components/ui/primitives";
import {
  modAssignReport,
  modResolveReport,
  modDismissReport,
  modHideComment,
  modWarnPlayer,
  modMutePlayer,
  modAddBlockPattern,
  modRemoveBlockPattern,
  adminSettleDispute,
} from "@/lib/actions-admin";
import { fmtDateTime, fmtMonos } from "@/lib/money";
import { getT, serverErr, type Lang } from "@/lib/i18n";
import { Eye, EyeOff, Flag, ShieldCheck, TimerOff, Trash2, X, UserX } from "lucide-react";

// ---------- shared row shapes (serialized server-side) ----------
export type AdminReportRow = {
  id: string;
  kind: string;
  targetId: string;
  reason: string;
  status: string;
  assigneeName: string | null;
  reporterName: string | null;
  mine: boolean; // assignee is the current admin?
  createdAtMs: number;
};

export type AdminCommentRow = {
  id: string;
  userId: string;
  body: string;
  hidden: boolean;
  authorName: string;
  marketSlug: string | null;
  muted: boolean;
  mutedActive: boolean; // server-computed: commentBanUntil is in the future
  createdAtMs: number;
};

export type AdminBlocklistRow = {
  id: string;
  pattern: string;
  addedBy: string;
  createdAtMs: number;
};

// ============================================================
// reports queue
// ============================================================
export function AdminReportsPanel({ lang, reports }: { lang: Lang; reports: AdminReportRow[] }) {
  const t = getT(lang);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg?: string) =>
    start(async () => {
      try {
        const res = await fn();
        if (!res.ok) throw new Error(res.error ?? "Error");
        if (okMsg) toast.success(okMsg);
        router.refresh();
      } catch (e) {
        toast.error(serverErr(lang, e instanceof Error ? e.message : null) ?? "Error");
      }
    });

  if (reports.length === 0) return <p className="text-[12.5px] text-mute py-8 text-center">{t.admModNoReports}</p>;

  return (
    <div className="flex flex-col gap-2">
      {/* one shared closing note — family scale: type it once, click per case */}
      <Card className="p-3">
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t.admModNotePh} rows={2} className="text-[12.5px]" />
      </Card>
      {reports.map((r) => (
        <Card key={r.id} className="p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge tone={r.status === "open" ? "warn" : "mute"}>
              <Flag className="size-3" /> {r.kind}
            </Badge>
            <span className="text-[13px] line-clamp-2 max-w-[400px]">{r.reason}</span>
            <span className="text-[11.5px] text-mute">
              {r.reporterName ? `@${r.reporterName}` : "—"} · {fmtDateTime(new Date(r.createdAtMs), lang)}
              {r.assigneeName ? ` · ${t.admModCase} @${r.assigneeName}${r.mine ? ` (${t.admModYours})` : ""}` : ""}
            </span>
            <span className="ml-auto flex items-center gap-2">
              {r.status === "open" ? (
                <>
                  {!r.assigneeName && (
                    <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => modAssignReport({ reportId: r.id }), t.admPlayersDone)}>
                      <UserX className="size-3.5" /> {t.admModAssignMe}
                    </Button>
                  )}
                  <Button size="sm" disabled={pending || note.trim().length < 5} onClick={() => run(() => modResolveReport({ reportId: r.id, note }), t.admPlayersDone)}>
                    <ShieldCheck className="size-3.5" /> {t.admModResolve}
                  </Button>
                  <Button variant="outline" size="sm" disabled={pending || note.trim().length < 5} onClick={() => run(() => modDismissReport({ reportId: r.id, note }), t.admPlayersDone)}>
                    <X className="size-3.5" /> {t.admModDismiss}
                  </Button>
                </>
              ) : (
                <Badge tone="mute">{r.status === "resolved" ? t.admModResolved : t.admModDismissed}</Badge>
              )}
            </span>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ============================================================
// recent comments desk
// ============================================================
export function AdminCommentDesk({ lang, comments }: { lang: Lang; comments: AdminCommentRow[] }) {
  const t = getT(lang);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [reason, setReason] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg?: string) =>
    start(async () => {
      try {
        const res = await fn();
        if (!res.ok) throw new Error(res.error ?? "Error");
        if (okMsg) toast.success(okMsg);
        router.refresh();
      } catch (e) {
        toast.error(serverErr(lang, e instanceof Error ? e.message : null) ?? "Error");
      }
    });

  return (
    <div className="flex flex-col gap-2">
      <Card className="p-3">
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t.admModReasonPh} rows={2} className="text-[12.5px]" />
      </Card>
      {comments.map((c) => (
        <Card key={c.id} className="p-3">
          <div className="flex items-start gap-2 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap text-[12px] text-mute">
                @{c.authorName}
                {c.marketSlug && (
                  <a href={`/market/${c.marketSlug}`} className="hover:underline text-faint">
                    /{c.marketSlug}
                  </a>
                )}
                <span>{fmtDateTime(new Date(c.createdAtMs), lang)}</span>
                {c.hidden && <Badge tone="warn">{t.admModHidden}</Badge>}
                {(c.muted || c.mutedActive) && <Badge tone="no">{t.admModMuted}</Badge>}
              </div>
              <p className={`text-[13px] mt-1 break-words ${c.hidden ? "italic text-faint" : ""}`}>
                {c.hidden ? t.hiddenByMod : c.body.length > 220 ? `${c.body.slice(0, 220)}…` : c.body}
              </p>
            </div>
            <span className="flex items-center gap-2 shrink-0">
              {c.hidden ? (
                <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => modHideComment({ commentId: c.id, hidden: false, reason: "" }), t.admPlayersDone)}>
                  <Eye className="size-3.5" /> {t.admModShow}
                </Button>
              ) : (
                <Button variant="ghost" size="sm" disabled={pending || reason.trim().length < 5} onClick={() => run(() => modHideComment({ commentId: c.id, hidden: true, reason }), t.admPlayersDone)}>
                  <EyeOff className="size-3.5" /> {t.admModHide}
                </Button>
              )}
              {!c.muted && (
                <Button variant="ghost" size="sm" disabled={pending || reason.trim().length < 5} onClick={() => run(() => modWarnPlayer({ userId: c.userId, hours: 24, reason }), t.admPlayersDone)} title={t.admModWarnLong}>
                  <TimerOff className="size-3.5" /> {t.admModWarn}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                disabled={pending || (c.muted ? false : reason.trim().length < 5)}
                onClick={() =>
                  c.muted
                    ? run(() => modMutePlayer({ userId: c.userId, muted: false, reason: "" }), t.admPlayersDone)
                    : run(() => modMutePlayer({ userId: c.userId, muted: true, reason }), t.admPlayersDone)
                }
              >
                {c.muted ? <><Eye className="size-3.5" /> {t.admModUnmute}</> : <><EyeOff className="size-3.5" /> {t.admModMute}</>}
              </Button>
            </span>
          </div>
        </Card>
      ))}
      {comments.length === 0 && <p className="text-[12.5px] text-mute py-8 text-center">{t.noComments}</p>}
    </div>
  );
}

// ============================================================
// blocklist editor
// ============================================================
export function AdminBlocklistPanel({ lang, patterns }: { lang: Lang; patterns: AdminBlocklistRow[] }) {
  const t = getT(lang);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pattern, setPattern] = useState("");
  const [reason, setReason] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg?: string) =>
    start(async () => {
      try {
        const res = await fn();
        if (!res.ok) throw new Error(res.error ?? "Error");
        if (okMsg) toast.success(okMsg);
        router.refresh();
      } catch (e) {
        toast.error(serverErr(lang, e instanceof Error ? e.message : null) ?? "Error");
      }
    });

  return (
    <div className="flex flex-col gap-2">
      <Card className="p-3 flex items-center gap-2 flex-wrap">
        <Input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder={t.admModPatternPh} maxLength={40} className="h-8 w-[220px] text-[12.5px]" />
        <Button size="sm" disabled={pending || pattern.trim().length < 2} onClick={() => run(() => modAddBlockPattern({ pattern }), t.admPlayersDone)}>
          {t.admModAddPattern}
        </Button>
      </Card>
      {patterns.map((p) => (
        <Card key={p.id} className="p-3 flex items-center gap-2 flex-wrap">
          <Badge tone="mute">{p.pattern}</Badge>
          <span className="text-[11.5px] text-mute">
            {t.admModByPat} @{p.addedBy} · {fmtDateTime(new Date(p.createdAtMs), lang)}
          </span>
          <span className="ml-auto flex items-center gap-2">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t.admModReasonPh} className="h-8 w-[160px] text-[12.5px]" />
            <Button variant="ghost" size="sm" disabled={pending || reason.trim().length < 5} onClick={() => run(() => modRemoveBlockPattern({ id: p.id, reason }), t.admPlayersDone)}>
              <Trash2 className="size-3.5" /> {t.admModUnblockWord}
            </Button>
          </span>
        </Card>
      ))}
      {patterns.length === 0 && <p className="text-[12.5px] text-mute py-4 text-center">{t.admModNoPatterns}</p>}
    </div>
  );
}

// ============================================================
// disputed duels (moved from the legacy overview in Phase 5)
// ============================================================
export type AdminDuelRow = {
  id: string;
  kind: string;
  claim: string;
  stakeCents: number;
  creatorName: string | null;
  opponentName: string | null;
  status: string; // disputed | accepted (stale)
  pendingWinnerId: string | null;
  creatorId: string;
  opponentId: string;
};

// Dispute tiebreak: pick the winner for the full pot, or refund both stakes.
// Settling goes through the audited adminSettleDispute with a mandatory
// reason — duels are player-to-player money, so they go on the record.
export function AdminDuelDesk({ lang, duels }: { lang: Lang; duels: AdminDuelRow[] }) {
  const t = getT(lang);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [openId, setOpenId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg?: string) =>
    start(async () => {
      try {
        const res = await fn();
        if (!res.ok) throw new Error(res.error ?? "Error");
        if (okMsg) toast.success(okMsg);
        setReason("");
        setOpenId(null);
        router.refresh();
      } catch (e) {
        toast.error(serverErr(lang, e instanceof Error ? e.message : null) ?? "Error");
      }
    });

  if (duels.length === 0) return <p className="text-[12.5px] text-mute py-6 text-center">{t.duelNoDisputes}</p>;

  const decide = (d: AdminDuelRow, pick: "creator" | "opponent" | "both") => {
    const winnerId = pick === "creator" ? d.creatorId : pick === "opponent" ? d.opponentId : null;
    run(() => adminSettleDispute({ duelId: d.id, winnerId, reason }), t.duelSettledToast);
  };

  return (
    <div className="divide-y divide-line">
      {duels.map((d) => {
        const open = openId === d.id;
        const name = (n: string | null) => (n ? `@${n}` : "?");
        return (
          <div key={d.id} className="px-1 py-3">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium leading-snug">{d.claim}</div>
                <div className="text-[11.5px] text-faint mt-0.5">
                  {name(d.creatorName)} vs {name(d.opponentName)} · {fmtMonos(d.stakeCents * 2, { lang })} ·{" "}
                  {d.status === "disputed" ? t.admModStatusDisputed : t.admModStatusStale}
                </div>
              </div>
              <Button
                size="xs"
                variant="yes"
                disabled={pending}
                className="shrink-0"
                onClick={() => {
                  setOpenId(open ? null : d.id);
                  setReason("");
                }}
              >
                {t.duelSettle}
              </Button>
            </div>
            {open && (
              <div className="mt-3 pt-3 border-t border-line flex flex-col gap-2">
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t.admReasonPh}
                  className="h-8 text-[12.5px]"
                />
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="yes" disabled={pending || reason.trim().length < 5} onClick={() => decide(d, "creator")}>
                    {name(d.creatorName)}
                  </Button>
                  <Button size="sm" variant="yes" disabled={pending || reason.trim().length < 5} onClick={() => decide(d, "opponent")}>
                    {name(d.opponentName)}
                  </Button>
                  <Button size="sm" variant="outline" disabled={pending || reason.trim().length < 5} onClick={() => decide(d, "both")}>
                    {t.duelRefundBoth}
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
