"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { getT, type Lang } from "@/lib/i18n";

type TabKey = "activity" | "comments" | "holders";

export function MarketTabs({
  activity,
  comments,
  holders,
  commentCount,
  tradeCount,
  holderCount,
  lang,
}: {
  activity: React.ReactNode;
  comments: React.ReactNode;
  holders?: React.ReactNode;
  commentCount: number;
  tradeCount: number;
  holderCount?: number;
  lang?: Lang;
}) {
  const t = getT(lang ?? "cs");
  const [tab, setTab] = useState<TabKey>("comments");
  const btn = (key: TabKey, label: string, n?: number) => (
    <button
      key={key}
      onClick={() => setTab(key)}
      className={cn(
        "px-3.5 py-2.5 text-[13.5px] font-medium border-b-2 -mb-px transition-colors cursor-pointer",
        tab === key ? "border-brand text-brand-strong" : "border-transparent text-mute hover:text-ink"
      )}
    >
      {label} {n !== undefined && <span className="num text-faint">{n}</span>}
    </button>
  );
  return (
    <div>
      <div className="flex border-b border-line overflow-x-auto scrollbar-none">
        {btn("comments", t.comments, commentCount)}
        {btn("activity", t.activity, tradeCount)}
        {holders !== undefined && btn("holders", t.holders, holderCount)}
      </div>
      <div className="pt-5">
        {tab === "comments" ? comments : tab === "activity" ? activity : holders}
      </div>
    </div>
  );
}
