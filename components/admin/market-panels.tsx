"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Badge, Button, Input } from "@/components/ui/primitives";
import { adminResolveMarket, adminCancelMarket, adminDeleteMarket } from "@/lib/actions-admin";
import { fmtMonos, fmtDateTime } from "@/lib/money";
import { serverErr } from "@/lib/i18n";
import { getT, type Lang } from "@/lib/i18n";
import { CircleCheck, Ban, Trash2, Scale } from "lucide-react";

export type AdminMarketRow = {
  id: string;
  slug: string;
  question: string;
  status: string; // pending | live | resolved | rejected | cancelled
  kind: string; // binary | group | option
  label: string | null;
  parentId: string | null;
  category: string;
  creator: string | null;
  volumeCents: number;
  traderCount: number;
  closesAt: Date | null;
  outcome: string | null; // resolved outcome
};

// Markets desk (Phase 5, admin+). Server-side GET filters choose the queue;
// every settle/cancel/delete here demands a reason and writes an audit row.
// The player-side op runs first (its money leg is already transactional), the
// audit row lands right after — see the section comment in actions-admin.ts.
export function AdminMarketsPanel({ lang, markets }: { lang: Lang; markets: AdminMarketRow[] }) {
  const t = getT(lang);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const shown = markets.filter((m) => {
    const hay = `${m.question} ${m.slug} ${m.creator ? `@${m.creator}` : ""}`.toLowerCase();
    return !q || hay.includes(q.toLowerCase());
  });

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) =>
    start(async () => {
      try {
        const res = await fn();
        if (!res.ok) throw new Error(res.error ?? "Error");
        toast.success(okMsg);
        setReason("");
        setOpenId(null);
        router.refresh();
      } catch (e) {
        toast.error(serverErr(lang, e instanceof Error ? e.message : null) ?? "Error");
      }
    });

  const reasonReady = reason.trim().length >= 5;

  const badge = (status: string, outcome: string | null) => {
    switch (status) {
      case "live":
        return <Badge tone="yes">{t.admMktsStatusLive}</Badge>;
      case "resolved":
        return (
          <Badge tone="ink">
            <Scale className="size-3" /> {t.admMktsStatusResolved} · {outcome === "yes" ? t.yes : outcome === "no" ? t.no : outcome ?? "?"}
          </Badge>
        );
      case "cancelled":
        return <Badge tone="warn">{t.admMktsStatusCancelled}</Badge>;
      case "rejected":
        return <Badge tone="no">{t.admMktsStatusRejected}</Badge>;
      case "deleted":
        return <Badge tone="mute">{t.admMktsStatusDeleted}</Badge>;
      default:
        return <Badge tone="mute">{t.admMktsStatusPending}</Badge>;
    }
  };

  const row = (m: AdminMarketRow, isOption: boolean) => {
    const open = openId === m.id;
    const canSettle = m.status === "live";
    return (
      <div key={m.id} className={`py-3 ${isOption ? "ml-4 border-l-2 border-line-2 pl-3" : ""}`}>
        <div className="flex items-start gap-2 flex-wrap">
          <div className="flex-1 min-w-0">
            {isOption && m.label && <Badge tone="mute">{m.label}</Badge>}
            <Link href={`/market/${m.slug}`} className="text-[13px] font-medium hover:underline underline-offset-2 line-clamp-1 ml-0">
              {m.question}
            </Link>
            <div className="text-[11.5px] text-faint mt-0.5">
              {m.category}
              {m.creator ? ` · @${m.creator}` : ""}
              {` · ${fmtMonos(m.volumeCents, { lang })} ${t.vol.toLowerCase()} · ${m.traderCount} ${t.tradersW}`}
              {m.closesAt ? ` · ${t.closes.toLowerCase()} ${fmtDateTime(new Date(m.closesAt), lang)}` : ""}
            </div>
          </div>
          {badge(m.status, m.outcome)}
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={() => {
              setOpenId(open ? null : m.id);
              setReason("");
            }}
          >
            {t.admPlayersActions}
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
              {canSettle && m.kind !== "group" && (
                <>
                  <Button
                    size="sm"
                    variant="yes"
                    disabled={pending || !reasonReady}
                    onClick={() => run(() => adminResolveMarket({ marketId: m.id, outcome: "yes", reason }), t.admMktsResolved)}
                  >
                    <CircleCheck className="size-3.5" /> {t.resolveYes}
                  </Button>
                  <Button
                    size="sm"
                    variant="no"
                    disabled={pending || !reasonReady}
                    onClick={() => run(() => adminResolveMarket({ marketId: m.id, outcome: "no", reason }), t.admMktsResolved)}
                  >
                    <CircleCheck className="size-3.5" /> {t.resolveNo}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending || !reasonReady}
                    onClick={() => run(() => adminCancelMarket({ marketId: m.id, reason }), t.admMktsCancelled)}
                  >
                    <Ban className="size-3.5" /> {t.cancelRefund}
                  </Button>
                </>
              )}
              <Button
                size="sm"
                variant="no"
                disabled={pending || !reasonReady}
                title={t.deleteMarket}
                onClick={() => {
                  if (confirm(t.admMktsDeleteConfirm(m.question)))
                    run(() => adminDeleteMarket({ marketId: m.id, reason }), t.marketDeleted);
                }}
              >
                <Trash2 className="size-3.5" /> {t.delete}
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  };

  // Group options nest under their parent, mirroring the market page.
  const own = shown.filter((m) => !m.parentId);
  const kids = new Map<string, AdminMarketRow[]>();
  for (const m of shown) {
    if (!m.parentId) continue;
    const arr = kids.get(m.parentId) ?? [];
    arr.push(m);
    kids.set(m.parentId, arr);
  }

  return (
    <div>
      {/* local search on top of the server-side filters (same as the players desk) */}
      <div className="flex items-center gap-2 mb-3">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t.admPlayersQ}
          className="h-8 w-[220px] text-[12.5px]"
        />
        <span className="text-[11.5px] text-mute">{shown.length}</span>
      </div>
      {shown.length === 0 ? (
        <p className="text-[12.5px] text-mute py-8 text-center">{t.admMktsEmpty}</p>
      ) : (
        <div className="divide-y divide-line-2">
          {own.map((m) => (
            <div key={m.id}>
              {row(m, false)}
              {(kids.get(m.id)?.length ?? 0) > 0 && (
                <div className="pb-1">
                  {kids.get(m.id)!.map((k) => row(k, true))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
