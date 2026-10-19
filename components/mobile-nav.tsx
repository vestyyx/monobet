"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getT, type Lang } from "@/lib/i18n";
import { fmtMonosShort } from "@/lib/money";
import { ThemeToggle } from "@/components/theme-toggle";
import { LangToggle } from "@/components/lang-toggle";

// Phone navigation — the desktop nav bar and the theme/lang toggles are
// `hidden` below md, so without this a phone (or a signed-out one) can't
// reach most of the app. One burger, every page, both auth states.
export function MobileNav({
  lang,
  signedIn,
  username,
  isAdminUser,
  claimableCents = 0,
}: {
  lang?: Lang;
  signedIn: boolean;
  username?: string | null;
  isAdminUser?: boolean;
  claimableCents?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const t = getT(lang ?? "cs");

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const item = "block px-3.5 py-2 text-[13.5px] font-medium text-ink hover:bg-surface-2 rounded-md cursor-pointer";
  const go = (href: string) => () => {
    setOpen(false);
    router.push(href);
  };

  return (
    <div ref={ref} className="relative md:hidden shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="size-8 inline-flex items-center justify-center rounded-lg text-mute hover:text-ink hover:bg-surface-2 active:scale-95 transition-all cursor-pointer"
        aria-label="Menu"
        aria-expanded={open}
      >
        {open ? <X className="size-[19px]" /> : <Menu className="size-[19px]" />}
      </button>
      {open && (
        <div className="absolute left-0 top-11 w-60 rounded-xl border border-line bg-surface shadow-lg p-1.5 z-50 anim-rise">
          <Link href="/" className={item} onClick={() => setOpen(false)}>
            {t.markets}
          </Link>
          <Link href="/markets" className={item} onClick={() => setOpen(false)}>
            {t.allMarkets}
          </Link>
          <Link href="/leaderboard" className={item} onClick={() => setOpen(false)}>
            {t.leaderboard}
          </Link>
          {/* <Link href="/games" className={item} onClick={() => setOpen(false)}>
            {t.games}
          </Link> */}
          {/* <Link href="/duels" className={item} onClick={() => setOpen(false)}>
            {t.duelsTitle}
          </Link> */}
          <Link href="/squads" className={item} onClick={() => setOpen(false)}>
            {t.squadsTitle}
          </Link>
          <Link href="/rewards" className={`${item} flex items-center justify-between`} onClick={() => setOpen(false)}>
            {t.rewards}
            {claimableCents > 0 && (
              <span className="num text-[12px] font-bold text-yes-strong">+{fmtMonosShort(claimableCents)}</span>
            )}
          </Link>
          <Link href="/propose" className={item} onClick={() => setOpen(false)}>
            {t.newMarket}
          </Link>
          <div className="border-t border-line-2 my-1" />
          {signedIn ? (
            <>
              <Link href={`/u/${username ?? ""}`} className={item} onClick={() => setOpen(false)}>
                {t.myProfile}
              </Link>
              {isAdminUser && (
                <Link href="/admin" className={item} onClick={() => setOpen(false)}>
                  {t.adminPanel}
                </Link>
              )}
            </>
          ) : (
            <div className="flex gap-1.5 px-1 py-1">
              <button type="button" onClick={go("/login")} className="flex-1 h-8 rounded-md bg-surface-2 text-[12.5px] font-semibold text-ink hover:bg-surface-3 cursor-pointer">
                {t.logIn}
              </button>
              <button type="button" onClick={go("/login?mode=signup")} className="flex-1 h-8 rounded-md bg-brand text-[12.5px] font-semibold text-brand-on hover:bg-brand-strong cursor-pointer">
                {t.signUp}
              </button>
            </div>
          )}
          <div className="border-t border-line-2 my-1" />
          <div className="flex items-center gap-1 px-2 py-1">
            <LangToggle />
            <ThemeToggle lang={lang} />
          </div>
        </div>
      )}
    </div>
  );
}
