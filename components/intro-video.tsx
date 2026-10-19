"use client";

import { useEffect, useState } from "react";
import { X, Play } from "lucide-react";
import { getT, type Lang } from "@/lib/i18n";

const SEEN_KEY = "mb_intro_seen";

// Welcome trailer — auto-opens on a visitor's first page load, closable, and
// reopenable from the footer link (which fires the "mb:intro" event). Signed-in
// users never get the auto-popup — they already know the site.
export function IntroVideo({ lang, autoplay = true }: { lang?: Lang; autoplay?: boolean }) {
  const t = getT(lang ?? "cs");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        if (autoplay && !localStorage.getItem(SEEN_KEY)) setOpen(true);
      } catch {}
    }, 400);
    const onOpen = () => setOpen(true);
    window.addEventListener("mb:intro", onOpen);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mb:intro", onOpen);
    };
  }, [autoplay]);

  const close = () => {
    setOpen(false);
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {}
  };

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-ink/60 backdrop-blur-sm p-4"
      onClick={close}
    >
      <div
        className="w-full max-w-3xl rounded-2xl overflow-hidden border border-line bg-surface shadow-2xl anim-rise"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-line-2">
          <div>
            <p className="text-[15px] font-bold">{t.welcomeTitle}</p>
            <p className="text-[12px] text-mute">{t.welcomeSub}</p>
          </div>
          <button
            onClick={close}
            aria-label="Close"
            className="size-8 grid place-items-center rounded-lg text-mute hover:bg-surface-2 hover:text-ink cursor-pointer"
          >
            <X className="size-4" />
          </button>
        </div>
        <video
          src="/trailer.mp4"
          className="w-full aspect-video bg-black"
          autoPlay
          muted
          loop
          playsInline
          controls
        />
      </div>
    </div>
  );
}

// Footer trigger — reopens the trailer without a page reload.
export function TrailerLink({ lang }: { lang?: Lang }) {
  const t = getT(lang ?? "cs");
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("mb:intro"))}
      className="inline-flex items-center gap-1.5 text-mute hover:text-ink transition-colors text-left cursor-pointer"
    >
      <Play className="size-3" /> {t.watchTrailer}
    </button>
  );
}
