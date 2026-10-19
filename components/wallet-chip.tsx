"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { AnimatedMoney } from "@/components/animated-number";
import { fmtMonos, fmtMonosShort } from "@/lib/money";
import { getT, type Lang } from "@/lib/i18n";
import { repayLoan, setAutoRepay } from "@/lib/actions";

// Live budget chips — the header is server-rendered once per navigation, so
// this polls /api/me to keep balance and debt current (loans, game wins,
// stop-loss fills, admin grants all land here without a page change).
const POLL_MS = 8000;

export function WalletChip({
  balanceCents: ssrBalance,
  debtCents: ssrDebt,
  lang,
}: {
  balanceCents: number;
  debtCents: number;
  lang?: Lang;
}) {
  const t = getT(lang ?? "cs");
  const router = useRouter();
  const [balance, setBalance] = useState(ssrBalance);
  const [debt, setDebt] = useState(ssrDebt);
  const [autoRepay, setAutoRepayOn] = useState<boolean | null>(null);
  const [pending, startTransition] = useTransition();
  const ssrRef = useRef({ balanceCents: ssrBalance, debtCents: ssrDebt });

  // Server re-render (navigation/revalidation) reseeds the chips.
  useEffect(() => {
    const prev = ssrRef.current;
    if (prev.balanceCents !== ssrBalance || prev.debtCents !== ssrDebt) {
      ssrRef.current = { balanceCents: ssrBalance, debtCents: ssrDebt };
      setBalance(ssrBalance);
      setDebt(ssrDebt);
    }
  }, [ssrBalance, ssrDebt]);

  const tick = useCallback(async () => {
    try {
      const r = await fetch("/api/me", { cache: "no-store" });
      if (!r.ok) return;
      const d = await r.json();
      if (typeof d.balanceCents === "number") setBalance(d.balanceCents);
      if (typeof d.debtCents === "number") setDebt(d.debtCents);
      if (typeof d.autoRepay === "boolean") setAutoRepayOn(d.autoRepay);
    } catch {
      // transient network/db blip — keep last values
    }
  }, []);

  useEffect(() => {
    const id = setInterval(tick, POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", tick);
    };
  }, [tick]);

  const repay = () =>
    startTransition(async () => {
      const r = await repayLoan({});
      if (r.ok) {
        toast.success(
          r.leftCents && r.leftCents > 0
            ? t.loanRepaidPart(fmtMonos(r.paidCents ?? 0, { lang }), fmtMonos(r.leftCents, { lang }))
            : t.loanRepaid
        );
        tick();
        router.refresh();
      } else toast.error(t.serverErr(r.error));
    });

  const toggleAuto = (on: boolean) =>
    startTransition(async () => {
      const r = await setAutoRepay({ enabled: on });
      if (r.ok) setAutoRepayOn(on);
      else toast.error(t.serverErr(r.error));
    });

  return (
    <>
      <Link
        href="/rewards"
        className="num inline-flex items-center h-8 sm:h-9 px-2 sm:px-3 rounded-lg bg-surface-2 text-[13px] sm:text-sm font-semibold hover:bg-surface-3"
        title={t.yourBalance}
      >
        <AnimatedMoney cents={balance} lang={lang} short />
      </Link>
      {debt > 0 && (
        <div className="relative group">
          <Link
            href="/rewards"
            className="num inline-flex items-center h-8 sm:h-9 px-2 sm:px-2.5 rounded-lg bg-no-soft text-no-strong text-[12px] sm:text-[13px] font-bold border border-no/30"
            title={`${t.owedChip} — repay on Rewards`}
          >
            −{fmtMonosShort(Math.round(debt / 100) * 100)}
          </Link>
          {/* Hover card: quick repay + auto-repay toggle without leaving the page.
              pointer-events stay on the card so the gap under the chip doesn't
              flicker the popover shut. */}
          <div className="absolute right-0 top-full z-50 hidden pt-2 group-hover:block group-focus-within:block">
            <div className="w-52 rounded-xl border border-edge bg-surface-1 p-3 shadow-xl shadow-black/30">
              <div className="text-[11px] uppercase tracking-wide text-faint">{t.owedChip}</div>
              <div className="num text-[15px] font-bold text-no-strong">{fmtMonos(debt, { lang })}</div>
              <button
                onClick={repay}
                disabled={pending || balance <= 0}
                className="mt-2 w-full h-8 rounded-lg bg-brand text-brand-on text-[12.5px] font-semibold hover:bg-brand-strong transition-all active:scale-[0.97] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {balance >= debt ? t.loanRepayAll : t.loanRepayAvail(fmtMonos(balance, { lang }))}
              </button>
              <div className="mt-2.5 flex items-center justify-between gap-2 select-none">
                <span>
                  <span className="block text-[12px] font-semibold">{t.autoRepay}</span>
                  <span className="block text-[10.5px] text-faint leading-tight">{t.autoRepayDesc}</span>
                </span>
                <button
                  role="switch"
                  aria-checked={autoRepay === true}
                  aria-label={t.autoRepay}
                  onClick={() => toggleAuto(!(autoRepay === true))}
                  disabled={pending}
                  className={`relative h-5 w-9 shrink-0 rounded-full transition-colors cursor-pointer disabled:opacity-50 ${autoRepay === true ? "bg-brand" : "bg-surface-3"}`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${autoRepay === true ? "translate-x-[18px]" : "translate-x-0.5"}`}
                  />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
