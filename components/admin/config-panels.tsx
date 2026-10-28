"use client";

// Phase 6 admin panels — /admin/settings + /admin/economy additions:
//   AdminSettingsPanel   — registration switch, maintenance mode, announcement
//   AdminConfigVersionsPanel — knob snapshots with audited rollback
//   AdminReconPanel      — Σ ledger vs Σ balances (display only)
//   AdminGainAlerts      — abnormal weekly earnings (display only)
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge, Button, Input, Select, Textarea } from "@/components/ui/primitives";
import { adminSetSettings, adminRollbackConfig } from "@/lib/actions-admin";
import { fmtMonos, fmtDateTime } from "@/lib/money";
import { serverErr, getT, type Lang } from "@/lib/i18n";
import { Ban, RotateCcw, Megaphone, DoorOpen, Wrench } from "lucide-react";

function usePanelAction(lang: Lang) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; }>, okMsg: string, after?: () => void) =>
    start(async () => {
      try {
        const res = await fn();
        if (!res.ok) throw new Error(res.error ?? "Error");
        toast.success(okMsg);
        after?.();
        router.refresh();
      } catch (e) {
        toast.error(serverErr(lang, e instanceof Error ? e.message : null) ?? "Error");
      }
    });
  return { pending, run };
}

export type PlatformSettings = {
  registrationOpen: boolean;
  maintenance: boolean;
  annTitle: string;
  annBody: string;
  annLevel: string;
  annUntilMs: number | null;
  updatedBy: string;
  updatedAtMs: number | null;
};

// Settings desk (Phase 6, admin+): gate sign-ups, close the books for
// maintenance, publish an announcement banner. One reason guards all three.
export function AdminSettingsPanel({ lang, settings }: { lang: Lang; settings: PlatformSettings }) {
  const t = getT(lang);
  const { pending, run } = usePanelAction(lang);
  const [reg, setReg] = useState(settings.registrationOpen ? "open" : "closed");
  const [maint, setMaint] = useState(settings.maintenance ? "on" : "off");
  const [annTitle, setAnnTitle] = useState(settings.annTitle);
  const [annBody, setAnnBody] = useState(settings.annBody);
  const [annLevel, setAnnLevel] = useState(settings.annLevel || "info");
  const [annUntil, setAnnUntil] = useState(
    settings.annUntilMs ? new Date(settings.annUntilMs).toISOString().slice(0, 16) : ""
  );
  const [reason, setReason] = useState("");
  const ready = reason.trim().length >= 5;

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        run(
          () =>
            adminSetSettings({
              registrationOpen: reg === "open",
              maintenance: maint === "on",
              annTitle,
              annBody,
              annLevel,
              annUntilDate: annUntil ? new Date(annUntil).toISOString() : "",
              reason,
            }),
          t.admSetSaved,
          () => setReason("")
        );
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-line bg-surface-2 p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-[12px] font-bold text-ink">
            <DoorOpen className="size-3.5" /> {t.admSetReg}
          </div>
          <Select value={reg} onChange={(e) => setReg(e.target.value)}>
            <option value="open">{t.admSetRegOpen}</option>
            <option value="closed">{t.admSetRegClosed}</option>
          </Select>
          <p className="text-[11px] text-faint">{t.admSetRegNote}</p>
        </div>

        <div className="rounded-xl border border-line bg-surface-2 p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-[12px] font-bold text-ink">
            <Wrench className="size-3.5" /> {t.admSetMaint}
          </div>
          <Select value={maint} onChange={(e) => setMaint(e.target.value)}>
            <option value="off">{t.admSetMaintOff}</option>
            <option value="on">{t.admSetMaintOn}</option>
          </Select>
          <p className="text-[11px] text-faint">{t.admSetMaintNote}</p>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-surface-2 p-3 space-y-2">
        <div className="flex items-center gap-1.5 text-[12px] font-bold text-ink">
          <Megaphone className="size-3.5" /> {t.admSetAnn}
        </div>
        <Input value={annTitle} onChange={(e) => setAnnTitle(e.target.value)} maxLength={120} placeholder={t.admSetAnnTitlePh} />
        <Textarea value={annBody} onChange={(e) => setAnnBody(e.target.value)} maxLength={500} placeholder={t.admSetAnnBodyPh} className="min-h-16 text-[12.5px]" />
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="text-[11px] font-medium text-mute">{t.admSetAnnLevel}</span>
            <Select value={annLevel} onChange={(e) => setAnnLevel(e.target.value)}>
              <option value="info">{t.admSetAnnInfo}</option>
              <option value="warn">{t.admSetAnnWarn}</option>
            </Select>
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-medium text-mute">{t.admSetAnnUntil}</span>
            <Input type="datetime-local" value={annUntil} onChange={(e) => setAnnUntil(e.target.value)} />
          </label>
        </div>
        <p className="text-[11px] text-faint">{t.admSetAnnNote}</p>
      </div>

      <div className="flex items-end gap-2 flex-wrap">
        <label className="space-y-1 flex-1 min-w-[240px]">
          <span className="text-[11px] font-medium text-mute">{t.admSetChangeNote}</span>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t.admReasonPh}
            className="h-8 text-[12.5px]"
          />
        </label>
        <Button size="sm" disabled={pending || !ready}>
          {pending ? "…" : t.admSetSave}
        </Button>
      </div>
      {settings.updatedAtMs && (
        <p className="text-[11px] text-faint">
          {t.admSetLastChanged(settings.updatedBy || "?", fmtDateTime(new Date(settings.updatedAtMs), lang))}
        </p>
      )}
    </form>
  );
}

export type ConfigVersionRow = {
  id: string;
  changedByName: string;
  note: string;
  createdAtMs: number;
  knobs: Record<string, number>;
};

// Config versions (Phase 6, admin+): the knob map written by every audited
// house-config save; rollback re-applies a snapshot through the same save path.
export function AdminConfigVersionsPanel({ lang, versions }: { lang: Lang; versions: ConfigVersionRow[] }) {
  const t = getT(lang);
  const { pending, run } = usePanelAction(lang);
  const [openId, setOpenId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  if (versions.length === 0) return <p className="text-[12.5px] text-mute py-6 text-center">{t.econVersionsEmpty}</p>;

  return (
    <div className="divide-y divide-line-2">
      {versions.map((v) => {
        const open = openId === v.id;
        const knobs = Object.entries(v.knobs)
          .map(([k, n]) => `${k} ${n / 100}`)
          .join(" · ");
        return (
          <div key={v.id} className="px-1 py-2.5 flex items-center gap-2 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] truncate">
                {v.note || <span className="text-faint">—</span>}
              </div>
              <div className="text-[11px] text-faint mt-0.5">
                @{v.changedByName} · {fmtDateTime(new Date(v.createdAtMs), lang)} · <span className="num">{knobs}</span>
              </div>
            </div>
            <Button size="xs" variant="outline" disabled={pending} className="shrink-0" onClick={() => { setOpenId(open ? null : v.id); setReason(""); }}>
              <RotateCcw className="size-3" /> {t.econRollback}
            </Button>
          </div>
        );
      })}
      {openId && (
        <form
          className="py-2.5 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim().length < 5) return;
            run(() => adminRollbackConfig({ versionId: openId, reason: reason.trim() }), t.econRollbackDone, () => {
              setOpenId(null);
              setReason("");
            });
          }}
        >
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t.admReasonPh}
            className="h-8 text-[12.5px]"
          />
          <div className="flex gap-1.5">
            <Button size="sm" variant="no" disabled={pending || reason.trim().length < 5}>
              <Ban className="size-3.5" /> {t.econRollback}
            </Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => { setOpenId(null); setReason(""); }}>
              {t.cancelEdit}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

export type ReconRow = { username: string; diffCents: number };

// Reconciliation card (Phase 6): pure numbers, printed live.
export function AdminReconPanel({ lang, ledgerSum, balanceSum, broken }: { lang: Lang; ledgerSum: number; balanceSum: number; broken: ReconRow[] }) {
  const t = getT(lang);
  const ok = ledgerSum === balanceSum;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        {ok ? (
          <Badge tone="yes">{t.econReconOk}</Badge>
        ) : (
          <Badge tone="warn">{t.econReconOff(fmtMonos(Math.abs(ledgerSum - balanceSum), { lang }))}</Badge>
        )}
        <span className="text-[12px] num text-mute">
          {t.econReconLedger} {fmtMonos(ledgerSum, { lang })} · {t.econReconBalances} {fmtMonos(balanceSum, { lang })}
        </span>
      </div>
      {broken.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[11px] text-faint">
                <th className="py-1.5 pr-3 font-medium">{t.econReconUser}</th>
                <th className="py-1.5 text-right font-medium">{t.econReconDriftAcc}</th>
              </tr>
            </thead>
            <tbody>
              {broken.slice(0, 12).map((b) => (
                <tr key={b.username} className="border-t border-line/60">
                  <td className="py-1.5 pr-3 font-medium">@{b.username}</td>
                  <td className={`py-1.5 text-right num ${b.diffCents > 0 ? "text-yes-strong" : "text-no-strong"}`}>
                    {b.diffCents > 0 ? "+" : "−"}
                    {fmtMonos(Math.abs(b.diffCents), { lang })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {broken.length > 12 && <p className="mt-1 text-[11px] text-faint">…{broken.length - 12}</p>}
        </div>
      )}
    </div>
  );
}

export type GainAlertRow = { username: string; gainCents: number };

// Abnormal earning alerts (Phase 6): median-relative weekly gains, the same
// scorer the moderation desk uses — money flows worth a second look, shown
// right above the knobs that could have caused them.
export function AdminGainAlerts({ lang, alerts }: { lang: Lang; alerts: GainAlertRow[] }) {
  const t = getT(lang);
  if (alerts.length === 0) return <p className="text-[12.5px] text-mute py-6 text-center">{t.econAlertsQuiet}</p>;
  return (
    <div className="divide-y divide-line-2">
      {alerts.map((a) => (
        <div key={a.username} className="px-1 py-2.5 flex items-center gap-2">
          <Badge tone="warn">{fmtMonos(a.gainCents, { lang })}</Badge>
          <span className="text-[12.5px] font-medium">@{a.username}</span>
          <span className="text-[11px] text-faint">{t.econAlertsItem}</span>
        </div>
      ))}
    </div>
  );
}
