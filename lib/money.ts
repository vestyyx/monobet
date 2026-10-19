// Currency: Marks (Ɱ). Balances stored as integer cents; share prices shown in ¢ like Polymarket.

import { getT, LOCALES, type Lang } from "@/lib/i18n";

export function fmtMonos(cents: number, opts?: { decimals?: boolean; lang?: Lang }): string {
  const marks = cents / 100;
  const sign = marks < 0 ? "-" : "";
  const abs = Math.abs(marks);
  const showDecimals = opts?.decimals ?? !Number.isInteger(abs);
  return (
    sign +
    "Ɱ " +
    abs.toLocaleString(LOCALES[opts?.lang ?? "cs"], {
      minimumFractionDigits: showDecimals ? 2 : 0,
      maximumFractionDigits: showDecimals ? 2 : 0,
    })
  );
}

// Ɱ 12.3k / Ɱ 4.2m — compact form for tight UI (header pill). Full value via title.
export function fmtMonosShort(cents: number): string {
  const marks = cents / 100;
  const sign = marks < 0 ? "-" : "";
  const abs = Math.abs(marks);
  const fmt = (v: number, suffix: string) => {
    const s = v >= 100 ? Math.round(v).toString() : v.toFixed(1).replace(/\.0$/, "");
    return `${sign}Ɱ ${s}${suffix}`;
  };
  if (abs >= 1_000_000) return fmt(abs / 1_000_000, "m");
  if (abs >= 10_000) return fmt(abs / 1_000, "k");
  return `${sign}Ɱ ${Number.isInteger(abs) ? abs : abs.toFixed(2)}`;
}

// 0.632 -> "63¢"
export function fmtCents(p: number): string {
  return `${Math.round(p * 100)}¢`;
}

// 0.632 -> "63%"
export function fmtPct(p: number): string {
  return `${(p * 100).toFixed(p < 0.1 && p > 0 ? 1 : 0)}%`;
}

export function fmtShares(n: number, lang?: Lang): string {
  return n.toLocaleString(LOCALES[lang ?? "cs"], { maximumFractionDigits: 2 });
}

export function timeAgo(d: Date | string, lang?: Lang): string {
  const t = getT(lang ?? "cs");
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return t.agoS(s);
  if (s < 3600) return t.agoM(Math.floor(s / 60));
  if (s < 86400) return t.agoH(Math.floor(s / 3600));
  return t.agoD(Math.floor(s / 86400));
}

export function fmtCountdown(until: Date | string): string {
  const ms = Math.max(0, new Date(until).getTime() - Date.now());
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}

export function fmtDate(d: Date | string | null | undefined, lang?: Lang): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(LOCALES[lang ?? "cs"], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Opens/closes need the clock — a bare date reads as "the whole day" and
// splits across midnight between UTC SSR and the viewer's timezone.
export function fmtDateTime(d: Date | string | null | undefined, lang?: Lang): string {
  if (!d) return "—";
  return new Date(d).toLocaleString(LOCALES[lang ?? "cs"], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
