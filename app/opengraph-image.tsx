import { ImageResponse } from "next/og";

export const alt = "MonoPredict — play-money prediction markets";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-static";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#141a16",
          padding: 72,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <svg width="84" height="84" viewBox="0 0 256 256">
            <rect width="256" height="256" rx="56" fill="#0f120e" />
            <path
              d="M58 196 L98 92 L134 166 L182 74"
              fill="none"
              stroke="#ffffff"
              strokeWidth="24"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="198" cy="60" r="22" fill="#0f9d58" />
          </svg>
          <div style={{ fontSize: 40, fontWeight: 700, color: "#ffffff" }}>MonoPredict</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ fontSize: 74, fontWeight: 700, color: "#ffffff", lineHeight: 1.08 }}>
            Play-money prediction markets.
          </div>
          <div style={{ fontSize: 34, color: "#8fa899" }}>
            Bet virtual Monos on anything. No real money, ever.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 64, height: 6, background: "#0f9d58", borderRadius: 3 }} />
          <div style={{ fontSize: 26, color: "#ab9c90" }}>monopredict</div>
        </div>
      </div>
    ),
    size
  );
}
