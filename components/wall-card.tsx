"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Flame, Landmark } from "lucide-react";
import { Button, Segmented } from "@/components/ui/primitives";
import { wallPray, setVow as vowAction } from "@/lib/actions";
import {
  WALL_COOLDOWN_MS,
  WALL_FEE_MIN_CENTS,
  WALL_FEE_DEBT_PCT,
  WALL_CLEAR_MIN_PCT,
  WALL_CLEAR_MAX_PCT,
  VOW_CHOICES_BPS,
} from "@/lib/games";
import { fmtMonos, timeAgo } from "@/lib/money";
import { getT, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type WallPrayerRow = {
  id: string;
  note: string;
  feeCents: number;
  clearedCents: number;
  miracle: boolean;
  createdAt: Date;
  username: string | null;
  name: string;
};

export function WallCard({
  debtCents,
  wallPrayerAt,
  vowBps,
  prayers,
  lang,
  now: nowProp,
  balanceCents,
}: {
  debtCents: number;
  wallPrayerAt: Date | null;
  vowBps: number;
  prayers: WallPrayerRow[];
  lang?: Lang;
  now: number;
  balanceCents: number;
}) {
  const t = getT(lang ?? "cs");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const [vow, setVow] = useState(String(vowBps));
  const [last, setLast] = useState<{ cleared: number; silent: boolean; miracle: boolean; backfire: boolean; blessed: boolean } | null>(null);
  // The server-rendered timestamp goes stale — tick locally so the candle
  // re-enables itself the moment the cooldown expires.
  const [now, setNow] = useState(nowProp);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const inDebt = debtCents > 0;
  const fee = Math.max(WALL_FEE_MIN_CENTS, Math.round(debtCents * WALL_FEE_DEBT_PCT));
  const nextAt = wallPrayerAt ? wallPrayerAt.getTime() + WALL_COOLDOWN_MS : null;
  const cooling = !!nextAt && nextAt > now;
  const afford = balanceCents >= fee;
  const remain = cooling ? fmtRemain(nextAt! - now) : null;

  const pray = () =>
    start(async () => {
      const r = await wallPray({ note });
      if (!r.ok) {
        toast.error(r.nextAt ? t.wallCooldownWait(fmtRemain(r.nextAt - Date.now())) : r.error === "Insufficient balance" || r.error?.startsWith("The candle costs") ? t.wallCantAfford(fmtMonos(fee, { lang })) : t.serverErr(r.error));
        return;
      }
      playWallSfx();
      setLast({ cleared: r.clearedCents ?? 0, silent: !!r.silent, miracle: !!r.miracle, backfire: !!r.backfire, blessed: !!r.blessed });
      setNote("");
      router.refresh();
    });

  const changeVow = (v: string) => {
    setVow(v);
    start(async () => {
      const r = await vowAction({ bps: Number(v) });
      if (!r.ok) toast.error(t.serverErr(r.error));
      else toast.success(Number(v) === 0 ? t.wallVowOff : t.wallVowSet(Number(v) / 100));
    });
  };

  // The paper slips peeking out of the wall — latest public notes.
  const slips = prayers.filter((p) => p.note).slice(0, 4);
  // One votive candle per recent prayer — lit if the wall answered, a burnt
  // stub trailing smoke if it stayed silent.
  const candles = prayers.slice(0, 12);

  return (
    <div className="rounded-xl border border-line bg-surface overflow-hidden">
      {/* the wall itself — night sky, old stone, candles on the ledge */}
      <div className="wall-scene relative h-44 px-4 pt-3 overflow-hidden select-none">
        <div className="relative z-10 flex items-center gap-2">
          <Landmark className="size-4 text-amber-100/80" />
          <span className="text-[13px] font-bold text-amber-50/90 tracking-wide drop-shadow-[0_1px_2px_rgba(0,0,0,.6)]">{t.wallTitle}</span>
        </div>
        {/* slips folded into the cracks between bricks */}
        <div className="absolute inset-x-4 top-24 flex gap-6">
          {slips.map((p, i) => (
            <div
              key={p.id}
              className="wall-slip bg-[#e8e0cb]/85 text-[#4a4033] text-[9px] leading-tight px-1.5 py-1 rounded-[2px] shadow max-w-24 truncate"
              style={{ transform: `rotate(${(i % 2 === 0 ? -1 : 1) * (2 + (i % 3))}deg)`, marginTop: `${(i % 3) * 10}px` }}
              title={`@${p.username ?? p.name}: ${p.note}`}
            >
              {p.note}
            </div>
          ))}
        </div>
        {/* the ledge + votive candles */}
        <div className="wall-ledge absolute inset-x-0 bottom-0 h-7">
          <div className="absolute inset-x-4 bottom-1 flex items-end justify-between">
            {candles.map((p, i) => {
              const lit = p.miracle || p.clearedCents > 0;
              return (
                <div
                  key={p.id}
                  className="relative"
                  title={`@${p.username ?? p.name}${p.note ? `: ${p.note}` : ""} — ${lit ? (p.miracle ? t.wallMiracle(fmtMonos(p.clearedCents, { lang })) : t.wallCleared(fmtMonos(p.clearedCents, { lang }))) : t.wallSilentShort}`}
                >
                  {lit && <span className="wall-candle-glow" />}
                  <div
                    className={cn("wall-candle", !lit && "wall-candle--burnt")}
                    style={{ width: 8, height: 9 + ((i * 7) % 8) }}
                  />
                  {lit ? (
                    <span className={cn("wall-flame", p.miracle && "wall-flame--miracle")} style={{ animationDelay: `${(i * 0.37) % 1.9}s` }} />
                  ) : (
                    <span className="wall-smoke" style={{ animationDelay: `${(i * 0.6) % 3.4}s` }} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <p className="text-[12.5px] text-mute leading-relaxed max-w-md">
            {inDebt ? t.wallSub : t.wallNoDebt}
          </p>
          {inDebt && (
            <div className="text-right">
              <div className="num text-sm font-bold text-no-strong">{t.loanOwed(fmtMonos(debtCents, { lang }))}</div>
            </div>
          )}
        </div>

        {inDebt && (
          <>
            <div className="mt-3 flex gap-2">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={140}
                placeholder={t.wallNotePh}
                className="h-9 flex-1 rounded-lg border border-line bg-surface px-3 text-[13px] text-ink placeholder:text-faint focus:outline-2 focus:outline-brand"
              />
              <Button onClick={pray} disabled={pending || cooling || !afford || !note.trim()} className="gap-1.5">
                <Flame className="size-4" />
                {cooling
                  ? t.wallCooldownWait(remain!)
                  : !afford
                    ? t.wallCantAfford(fmtMonos(fee, { lang }))
                    : `${t.wallPray} · ${fmtMonos(fee, { lang })}`}
              </Button>
            </div>
            <p className="mt-1.5 text-[11.5px] text-faint">
              {t.wallRules(fmtMonos(WALL_FEE_MIN_CENTS, { lang }), Math.round(WALL_CLEAR_MIN_PCT * 100), Math.round(WALL_CLEAR_MAX_PCT * 100))}
            </p>

            {last && (
              <div className={cn("mt-3 rounded-lg border px-3 py-2 text-[12.5px] font-semibold anim-rise",
                last.backfire
                  ? "border-no/40 bg-no-soft text-no-strong"
                  : last.miracle
                    ? "border-amber-400/50 bg-amber-50 text-amber-800 shadow-[0_0_24px_rgba(251,191,36,0.25)]"
                    : last.silent || last.cleared === 0
                      ? "border-line bg-surface-2 text-mute"
                      : "border-yes/30 bg-yes-soft text-yes-strong")}>
                {last.backfire
                  ? t.wallOffended(fmtMonos(-last.cleared, { lang }))
                  : last.miracle
                    ? t.wallMiracle(fmtMonos(last.cleared, { lang }))
                    : last.silent
                      ? last.blessed
                        ? t.wallSilentBlessed
                        : t.wallSilent
                      : t.wallCleared(fmtMonos(last.cleared, { lang }))}
              </div>
            )}

            {/* the vow — a lasting sacrifice, not a one-off candle */}
            <div className="mt-4">
              <div className="text-[12px] font-semibold text-mute mb-1.5">{t.wallVow}</div>
              <Segmented
                options={VOW_CHOICES_BPS.map((b) => ({ value: String(b), label: b === 0 ? t.wallVowNone : `${b / 100}%` }))}
                value={vow}
                onChange={changeVow}
              />
            </div>
          </>
        )}

        {prayers.length > 0 && (
          <div className="mt-4 pt-3 border-t border-line-2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-faint mb-2">{t.wallPrayers}</div>
            <div className="divide-y divide-line-2">
              {prayers.map((p) => (
                <div key={p.id} className="py-1.5 flex items-center gap-2 text-[12.5px]">
                  <span className="font-medium w-24 truncate">@{p.username ?? p.name}</span>
                  {/* long slips clamp to one line and unfold on hover/focus —
                      grows the row downward so nothing clips at the card edge */}
                  <span
                    className="text-mute flex-1 min-w-0 truncate hover:whitespace-normal hover:overflow-visible hover:break-words focus:whitespace-normal focus:overflow-visible focus:break-words outline-none"
                    tabIndex={p.note ? 0 : undefined}
                  >
                    {p.note || "…"}
                  </span>
                  <span className="num text-faint">−{fmtMonos(p.feeCents, { lang })}</span>
                  {p.miracle ? (
                    <span className="num font-bold text-amber-600">+{fmtMonos(p.clearedCents, { lang })} {t.wallAbsolved}</span>
                  ) : p.clearedCents > 0 ? (
                    <span className="num font-bold text-yes-strong">+{fmtMonos(p.clearedCents, { lang })} {t.wallForgiven}</span>
                  ) : p.clearedCents < 0 ? (
                    <span className="num font-bold text-no-strong">+{fmtMonos(-p.clearedCents, { lang })} {t.wallOffendedShort}</span>
                  ) : (
                    <span className="text-[11px] font-medium text-faint">{t.wallSilentShort}</span>
                  )}
                  <span className="text-[11px] text-faint w-14 text-right">{timeAgo(p.createdAt, lang)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function fmtRemain(ms: number) {
  const m = Math.ceil(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

function playWallSfx() {
  // candle flicker — reuse the soft claim cue
  import("@/lib/sfx").then((m) => m.playSfx("claim", 0.35));
}
