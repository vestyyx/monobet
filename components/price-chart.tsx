"use client";

import { useMemo, useRef, useState } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimatedPct } from "@/components/animated-number";
import { LOCALES, getT, type Lang } from "@/lib/i18n";
import { fmtMonos } from "@/lib/money";

type Pt = { t: string; p: number };

// A real trade pinned to the chart — dot sits at the post-trade price.
export type ChartMarker = {
  t: string;
  p: number;
  key?: string; // series key on multi-outcome charts
  side: string;
  outcome: string;
  username: string | null;
  amountCents: number;
  image?: string | null;
  label?: string;
};
const RANGES = [
  { key: "1M", ms: 60_000 },
  { key: "1H", ms: 3600_000 },
  { key: "1D", ms: 86400_000 },
  { key: "ALL", ms: Infinity },
] as const;

const RANGE_LABEL: Record<Lang, Record<(typeof RANGES)[number]["key"], string>> = {
  en: { "1M": "1m", "1H": "1h", "1D": "1d", ALL: "ALL" },
  cs: { "1M": "1m", "1H": "1h", "1D": "1d", ALL: "Vše" },
};

// True windowing: carry in the last price before the cutoff so the line starts
// at window edge, then extend the last price flat out to `now`.
function windowPoints(points: Pt[], cutoff: number, now: number): Pt[] {
  let anchor: Pt | null = null;
  const inside: Pt[] = [];
  for (const p of points) {
    if (new Date(p.t).getTime() < cutoff) anchor = p;
    else inside.push(p);
  }
  const pts = anchor ? [{ t: new Date(cutoff).toISOString(), p: anchor.p }, ...inside] : inside;
  if (pts.length && now - new Date(pts[pts.length - 1].t).getTime() > 1000) {
    pts.push({ t: new Date(now).toISOString(), p: pts[pts.length - 1].p });
  }
  return pts;
}

const W = 720;
const H = 300;
const PAD_L = 44;
const PAD_R = 12;
const PAD_T = 16;
const PAD_B = 26;

// Straight segments — a price holds between trades; smoothing would invent
// swings that never happened.
function smoothPath(coords: readonly (readonly [number, number])[]): string {
  if (coords.length < 2) return "";
  return `M${coords[0][0].toFixed(1)},${coords[0][1].toFixed(1)}` +
    coords.slice(1).map(([x, y]) => ` L${x.toFixed(1)},${y.toFixed(1)}`).join("");
}

function fmtTick(t: number, span: number, locale: string): string {
  const d = new Date(t);
  if (span <= 300_000) return d.toLocaleTimeString(locale, { minute: "2-digit", second: "2-digit" });
  if (span <= 6 * 3600_000) return d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  if (span <= 2 * 86400_000)
    return d.toLocaleString(locale, { month: "short", day: "numeric", hour: "numeric" });
  return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

export function PriceChart({ points, now, live, lang, trades }: { points: Pt[]; now: number; live?: boolean; lang?: Lang; trades?: ChartMarker[] }) {
  const locale = LOCALES[lang ?? "cs"];
  const t = getT(lang ?? "cs");
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("ALL");
  const [hover, setHover] = useState<number | null>(null);
  const [mark, setMark] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const r = RANGES.find((x) => x.key === range)!;
  const t1 = now;

  const data = useMemo(
    () => windowPoints(points, isFinite(r.ms) ? t1 - r.ms : -Infinity, t1),
    [points, r, t1]
  );

  // The x-axis IS the window — a 1H view spans exactly the last hour even when
  // trades are sparse, so picking a range always changes the picture. ALL
  // anchors at the first data point.
  const t0 = isFinite(r.ms) ? t1 - r.ms : data.length ? new Date(data[0].t).getTime() : t1 - 1;

  const markers = useMemo(
    () => (trades ?? []).filter((m) => { const ms = new Date(m.t).getTime(); return ms >= t0 && ms <= t1; }),
    [trades, t0, t1]
  );
  const markSize = (cents: number) => 2 + Math.min(2.4, Math.log10(Math.max(cents, 1) / 100 + 1) * 1.4);

  const { linePath, areaPath, last } = useMemo(() => {
    if (data.length === 0) return { linePath: "", areaPath: "", last: null as Pt | null };
    const span = Math.max(t1 - t0, 1);
    const x = (t: number) => PAD_L + ((t - t0) / span) * (W - PAD_L - PAD_R);
    const y = (p: number) => PAD_T + (1 - Math.min(1, Math.max(0, p))) * (H - PAD_T - PAD_B);
    const coords = data.map((d) => [x(new Date(d.t).getTime()), y(d.p)] as const);
    const line = smoothPath(coords);
    const area = `${line} L${coords[coords.length - 1][0].toFixed(1)},${y(0)} L${coords[0][0].toFixed(1)},${y(0)} Z`;
    return { linePath: line, areaPath: area, last: data[data.length - 1] };
  }, [data, t0, t1]);

  const x = (t: number) => PAD_L + ((t - t0) / Math.max(t1 - t0, 1)) * (W - PAD_L - PAD_R);
  const y = (p: number) => PAD_T + (1 - Math.min(1, Math.max(0, p))) * (H - PAD_T - PAD_B);

  const onMove = (e: React.PointerEvent) => {
    if (!svgRef.current || data.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bestD = Infinity;
    data.forEach((d, i) => {
      const dx = Math.abs(x(new Date(d.t).getTime()) - px);
      if (dx < bestD) {
        bestD = dx;
        best = i;
      }
    });
    setHover(best);
  };

  const hoverPt = hover !== null ? data[hover] : null;
  const delta = data.length > 1 ? data[data.length - 1].p - data[0].p : 0;
  const up = data.length <= 1 || delta >= 0;
  const stroke = data.length <= 1 ? "var(--color-mute)" : up ? "var(--color-yes)" : "var(--color-no)";
  const hoverX = hoverPt ? x(new Date(hoverPt.t).getTime()) : 0;
  const hoverY = hoverPt ? y(hoverPt.p) : 0;

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-x-3 gap-y-2 mb-2">
        <div className="num flex items-center gap-2.5">
          <AnimatedPct
            value={last?.p ?? 0}
            className="text-[34px] font-bold tracking-tight leading-none"
          />
          <span className="text-[13px] font-medium text-mute">{t.chance}</span>
          {data.length > 1 && Math.abs(delta) > 0.004 && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-bold num",
                up ? "bg-yes-soft text-yes-strong" : "bg-no-soft text-no-strong"
              )}
            >
              {up ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
              {delta > 0 ? "+" : ""}
              {Math.round(delta * 100)}%
            </span>
          )}
          {live && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-mute">
              <span className="live-dot" />
              Live
            </span>
          )}
        </div>
        <div className="flex gap-0.5 rounded-lg bg-surface-2 p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={cn(
                "px-2.5 h-7 rounded-md text-[11.5px] font-semibold cursor-pointer transition-colors",
                range === r.key ? "bg-surface shadow-sm text-ink" : "text-mute hover:text-ink"
              )}
            >
              {RANGE_LABEL[lang ?? "cs"][r.key]}
            </button>
          ))}
        </div>
      </div>

      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full select-none"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          onClick={() => setMark(null)}
        >
          <defs>
            <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.18" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {[0, 0.25, 0.5, 0.75, 1].map((g) => (
            <g key={g}>
              <line x1={PAD_L} x2={W - PAD_R} y1={y(g)} y2={y(g)} stroke="var(--color-line-2)" strokeDasharray={g === 0 ? "" : "3 4"} />
              <text x={PAD_L - 8} y={y(g) + 4} textAnchor="end" fontSize="11" fill="var(--color-faint)" className="num">
                {Math.round(g * 100)}%
              </text>
            </g>
          ))}

          {data.length > 1 && (
            <g key={`${range}-${data.length}`}>
              <path d={areaPath} fill="url(#chartFill)" className="anim-fade" />
              <path
                d={linePath}
                fill="none"
                stroke={stroke}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                pathLength={1}
                className="anim-draw"
              />
              {live && (
                <g>
                  <circle cx={x(t1)} cy={y(last!.p)} r="3.5" fill={stroke} />
                  <circle cx={x(t1)} cy={y(last!.p)} r="3.5" fill={stroke} className="anim-ping" />
                </g>
              )}
            </g>
          )}
          {data.length === 1 && <circle cx={x(t0)} cy={y(data[0].p)} r="4" fill={stroke} />}

          {markers.map((m, i) => {
            const mx = x(new Date(m.t).getTime());
            const my = y(m.p);
            const col = m.outcome === "yes" ? "var(--color-yes)" : "var(--color-no)";
            return (
              <g key={i}>
                <circle
                  cx={mx} cy={my} r={markSize(m.amountCents)}
                  fill="var(--color-surface)"
                  stroke={col} strokeWidth="1.6"
                  strokeDasharray={m.side === "buy" ? undefined : "2 2"}
                  opacity={mark === null || mark === i ? 0.95 : 0.45}
                  className={mark === i ? "drop-shadow" : undefined}
                />
                <circle
                  cx={mx} cy={my} r={9} fill="transparent" className="cursor-pointer"
                  onClick={(e) => { e.stopPropagation(); setMark(mark === i ? null : i); }}
                />
              </g>
            );
          })}

          {hoverPt && (
            <g>
              <line pointerEvents="none" x1={hoverX} x2={hoverX} y1={PAD_T} y2={H - PAD_B} stroke="var(--color-faint)" strokeDasharray="3 3" />
              <circle pointerEvents="none" cx={hoverX} cy={hoverY} r="4.5" fill={stroke} stroke="var(--color-surface)" strokeWidth="2" />
            </g>
          )}
        </svg>

        {mark !== null && markers[mark] && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-ink shadow-lg"
            style={{
              left: `${Math.min(88, Math.max(12, (x(new Date(markers[mark].t).getTime()) / W) * 100))}%`,
              top: `${(y(markers[mark].p) / H) * 100 - 2}%`,
            }}
          >
            <div className="flex items-center gap-1.5 text-[11.5px] whitespace-nowrap">
              <span className="font-semibold">@{markers[mark].username ?? "?"}</span>
              <span className="text-mute">{markers[mark].side === "buy" ? t.bought : t.sold}</span>
              <span className={cn("font-bold", markers[mark].outcome === "yes" ? "text-yes-strong" : "text-no-strong")}>
                {(markers[mark].outcome === "yes" ? t.yes : t.no).toUpperCase()}
              </span>
              <span className="num font-bold">{fmtMonos(markers[mark].amountCents, { lang })}</span>
            </div>
            <div className="num mt-0.5 text-[10px] font-medium text-mute whitespace-nowrap">
              {new Date(markers[mark].t).toLocaleString(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              {" · "}{Math.round(markers[mark].p * 100)}%
            </div>
          </div>
        )}

        {mark === null && hoverPt && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-[#2c352d] bg-[#141a16] px-2.5 py-1.5 text-[#f2f6f2] shadow-lg"
            style={{ left: `${(hoverX / W) * 100}%`, top: `${(hoverY / H) * 100 - 3}%` }}
          >
            <div className="num text-[12.5px] font-bold leading-none">
              {Math.round(hoverPt.p * 100)}%
            </div>
            <div className="num mt-0.5 text-[10px] font-medium text-[#9aa79b] whitespace-nowrap">
              {new Date(hoverPt.t).toLocaleString(locale, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-between text-[11px] text-faint num -mt-1 pl-11 pr-3">
        {data.length > 0 &&
          [0, 0.25, 0.5, 0.75, 1].map((k) => {
            const t = t0 + (t1 - t0) * k;
            return <span key={k}>{fmtTick(t, t1 - t0, locale)}</span>;
          })}
      </div>
    </div>
  );
}
