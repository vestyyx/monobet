"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth-client";
import { Avatar } from "@/components/ui/primitives";
import { useEffect, useRef, useState } from "react";
import { getT, type Lang } from "@/lib/i18n";

export function UserMenu({
  name,
  username,
  role,
  image,
  lang,
}: {
  name: string;
  username: string | null;
  role: string;
  image?: string | null;
  lang?: Lang;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const t = getT(lang ?? "cs");

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const item = "block px-3.5 py-2 text-[13px] font-medium text-ink hover:bg-surface-2 rounded-md cursor-pointer";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-full ring-2 ring-transparent hover:ring-line transition cursor-pointer"
        aria-label={t.accountMenu}
      >
        <Avatar name={username ?? name} image={image} />
      </button>
      {open && (
        <div className="absolute right-0 top-11 w-52 rounded-xl border border-line bg-surface shadow-lg p-1.5 z-50 anim-rise">
          <div className="px-3.5 py-2 border-b border-line-2 mb-1">
            <div className="text-sm font-semibold truncate">@{username ?? name}</div>
            <div className="text-xs text-mute">{role === "admin" ? t.admin : t.trader}</div>
          </div>
          <Link href={`/u/${username ?? name}`} className={item} onClick={() => setOpen(false)}>
            {t.myProfile}
          </Link>
          {/* <Link href="/duels" className={item} onClick={() => setOpen(false)}>
            {t.duelsTitle}
          </Link> */}
          <Link href="/squads" className={item} onClick={() => setOpen(false)}>
            {t.squadsTitle}
          </Link>
          <Link href="/propose" className={item} onClick={() => setOpen(false)}>
            {t.newMarket}
          </Link>
          {role === "admin" && (
            <Link href="/admin" className={item} onClick={() => setOpen(false)}>
              {t.adminPanel}
            </Link>
          )}
          <button
            className={`${item} w-full text-left text-no-strong`}
            onClick={async () => {
              await signOut();
              setOpen(false);
              router.refresh();
              router.push("/");
            }}
          >
            {t.logOut}
          </button>
        </div>
      )}
    </div>
  );
}
