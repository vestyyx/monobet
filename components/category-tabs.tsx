"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronRight, LayoutGrid } from "lucide-react";
import { getT, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// Built-in filters on the left, a divider, then user-created categories.
// A chevron at the right edge scrolls the row; "All markets" links to the
// /markets overview page.
export function CategoryTabs({ categories, lang, showWatching }: { categories: string[]; lang?: Lang; showWatching?: boolean }) {
  const t = getT(lang ?? "cs");
  const params = useSearchParams();
  const active = params.get("cat") ?? "all";
  const q = params.get("q");
  const scroller = useRef<HTMLDivElement>(null);
  const [canScroll, setCanScroll] = useState(true);

  const builtins: { key: string; label: string }[] = [
    { key: "all", label: t.tabAll },
    { key: "trending", label: t.tabTrending },
    { key: "new", label: t.tabNew },
    { key: "closing", label: t.tabClosing },
    ...(showWatching ? [{ key: "watching", label: t.tabWatching }] : []),
  ];

  const link = (key: string) => {
    const sp = new URLSearchParams();
    if (key !== "all") sp.set("cat", key);
    if (q) sp.set("q", q);
    return `/?${sp.toString()}`;
  };
  const tabCls = (key: string) =>
    cn(
      "px-3.5 py-2.5 text-[13.5px] font-medium whitespace-nowrap border-b-2 -mb-px transition-colors",
      active.toLowerCase() === key.toLowerCase() || (key === "all" && active === "all")
        ? "border-brand text-brand-strong"
        : "border-transparent text-mute hover:text-ink"
    );

  const updateCanScroll = () => {
    const el = scroller.current;
    if (el) setCanScroll(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };

  // Hide the chevron when nothing is scrollable or the end is reached.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const f = () => updateCanScroll();
    const id = requestAnimationFrame(f);
    window.addEventListener("resize", f);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("resize", f);
    };
  }, []);

  return (
    <div className="relative -mx-4 border-b border-line">
      <div
        ref={scroller}
        onScroll={updateCanScroll}
        className="scrollbar-none px-4 overflow-x-auto"
      >
        <div className="flex gap-1 min-w-max items-stretch">
          {builtins.map((tab) => (
            <Link key={tab.key} href={link(tab.key)} className={tabCls(tab.key)}>
              {tab.label}
            </Link>
          ))}
          {categories.length > 0 && (
            <span className="mx-1.5 my-2 w-px shrink-0 bg-line-2" aria-hidden />
          )}
          {categories.map((c) => (
            <Link key={c} href={link(c)} className={tabCls(c)}>
              {c}
            </Link>
          ))}
        </div>
      </div>

      <div className="absolute right-0 top-0 bottom-0 flex items-stretch pl-6 bg-gradient-to-r from-transparent via-surface/80 to-surface">
        {canScroll && (
          <button
            type="button"
            aria-label={t.scrollMore}
            onClick={() => {
              scroller.current?.scrollBy({ left: 260, behavior: "smooth" });
            }}
            className="grid place-items-center px-1 text-faint hover:text-ink cursor-pointer"
          >
            <ChevronRight className="size-4" />
          </button>
        )}
        <Link
          href="/markets"
          className="inline-flex items-center gap-1 px-2.5 text-[12.5px] font-semibold text-brand-strong hover:text-brand whitespace-nowrap"
        >
          <LayoutGrid className="size-3.5" />
          {t.browseAll}
        </Link>
      </div>
    </div>
  );
}
