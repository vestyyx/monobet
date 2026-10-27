"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge, Button, Card, Input } from "@/components/ui/primitives";
import { gigSetConfig, gigReverseShift } from "@/lib/actions-admin";
import { fmtMonos, fmtDateTime } from "@/lib/money";
import { serverErr, getT, type Lang } from "@/lib/i18n";
import { Undo2 } from "lucide-react";

export type GigConfigRow = {
  dishPayCents: number;
  mathPayCents: number;
  dailyCapCents: number;
  updatedBy: string;
  updatedAtMs: number | null;
};

// Gig rates editor (Phase 5, admin+): pay per dishes/math shift and the
// rolling 24 h earnings cap. Inputs are Ɱ, the server stores cents — jobRatesOk
// bounds every knob server-side so a typo can't mint money.
export function AdminGigConfigPanel({ lang, config }: { lang: Lang; config: GigConfigRow }) {
  const t = getT(lang);
  const { pending, run } = useAction(lang);
  const [dish, setDish] = useState((config.dishPayCents / 100).toFixed(2));
  const [math, setMath] = useState((config.mathPayCents / 100).toFixed(2));
  const [cap, setCap] = useState((config.dailyCapCents / 100).toFixed(0));
  const [reason, setReason] = useState("");

  return (
    <Card className="p-4">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (reason.trim().length < 5) return;
          run(
            () =>
              gigSetConfig({
                dishPayCents: Math.round(parseFloat(dish.replace(",", ".")) * 100),
                mathPayCents: Math.round(parseFloat(math.replace(",", ".")) * 100),
                dailyCapCents: Math.round(parseFloat(cap.replace(",", ".")) * 100),
                reason,
              }),
            t.admGigSaved
          );
        }}
      >
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-[12px] font-bold text-ink">{t.admGigRates}</div>
          <span className="text-[11px] text-faint">
            {config.updatedBy ? `@${config.updatedBy}` : "—"}
            {config.updatedAtMs ? ` · ${fmtDateTime(new Date(config.updatedAtMs), lang)}` : ""}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <label className="space-y-1">
            <span className="text-[11px] font-medium text-mute">{t.admGigDishPay}</span>
            <Input type="number" min={0} max={50} step="0.01" value={dish} onChange={(e) => setDish(e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-medium text-mute">{t.admGigMathPay}</span>
            <Input type="number" min={0} max={50} step="0.01" value={math} onChange={(e) => setMath(e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-medium text-mute">{t.admGigCap}</span>
            <Input type="number" min={0} max={10000} step="1" value={cap} onChange={(e) => setCap(e.target.value)} />
          </label>
        </div>
        <p className="text-[11px] text-faint">{t.admGigRatesNote}</p>
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t.admReasonPh}
          className="h-8 text-[12.5px]"
        />
        <Button size="sm" disabled={pending || reason.trim().length < 5}>
          {pending ? "…" : t.save}
        </Button>
      </form>
    </Card>
  );
}

export type GigShiftRow = {
  id: string;
  job: string; // dishes | math
  username: string | null;
  earnedCents: number;
  startedAtMs: number;
  settledAtMs: number | null;
  reversed: boolean;
};

// Shift desk (Phase 5, admin+): the last settled shifts. Reversal claws the
// payout back through the ledger via a stamped + counter-row (audited).
export function AdminShiftDesk({ lang, shifts }: { lang: Lang; shifts: GigShiftRow[] }) {
  const t = getT(lang);
  const { pending, run } = useAction(lang);
  const [openId, setOpenId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  if (shifts.length === 0) return <p className="text-[12.5px] text-mute py-8 text-center">{t.admGigNoShifts}</p>;

  const jobLabel = (job: string) => (job === "dishes" ? t.jobsDishesTitle : job === "math" ? t.jobsMathTitle : job);

  return (
    <div className="divide-y divide-line-2">
      {shifts.map((s) => {
        const open = openId === s.id;
        return (
          <div key={s.id} className="px-1 py-2.5 flex items-center gap-2 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[12.5px] font-semibold truncate">{jobLabel(s.job)}</span>
                {s.reversed ? (
                  <Badge tone="warn">{t.admGigReversed}</Badge>
                ) : (
                  <Badge tone={s.earnedCents > 0 ? "yes" : "mute"}>
                    {s.earnedCents > 0 ? `+${fmtMonos(s.earnedCents, { lang })}` : fmtMonos(0, { lang })}
                  </Badge>
                )}
              </div>
              <div className="text-[11.5px] text-faint mt-0.5">
                @{s.username ?? "?"} · {t.admGigStarted.toLowerCase()} {fmtDateTime(new Date(s.startedAtMs), lang)}
                {s.settledAtMs ? ` · ${t.admGigSettled.toLowerCase()} ${fmtDateTime(new Date(s.settledAtMs), lang)}` : ""}
              </div>
            </div>
            {!s.reversed && s.earnedCents > 0 && (
              <Button
                size="xs"
                variant="outline"
                disabled={pending}
                className="shrink-0"
                onClick={() => {
                  setOpenId(open ? null : s.id);
                  setReason("");
                }}
              >
                <Undo2 className="size-3" /> {t.admGigReverse}
              </Button>
            )}
            {open && (
              <div className="w-full flex items-center gap-2 flex-wrap pt-2">
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t.admReasonPh}
                  className="h-8 flex-1 min-w-[200px] text-[12.5px]"
                  autoFocus
                />
                <Button
                  size="xs"
                  variant="no"
                  disabled={pending || reason.trim().length < 5}
                  onClick={() => run(() => gigReverseShift({ shiftId: s.id, reason: reason.trim() }), t.admGigReversedDone)}
                >
                  <Undo2 className="size-3" /> {t.admGigReverseConfirm(s.username ?? "?", fmtMonos(s.earnedCents, { lang }))}
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function useAction(lang: Lang) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) =>
    start(async () => {
      try {
        const res = await fn();
        if (!res.ok) throw new Error(res.error ?? "Error");
        toast.success(okMsg);
        router.refresh();
      } catch (e) {
        toast.error(serverErr(lang, e instanceof Error ? e.message : null) ?? "Error");
      }
    });
  return { pending, run };
}
