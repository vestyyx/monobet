"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Link2, Send, Share2, X as XIcon } from "lucide-react";
import { toast } from "sonner";
import { getT, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// Share menu on market pages — copy link, download the generated card
// (same render as the OG image), post to X, or hand off to the OS sheet.
export function ShareButton({
  path,
  title,
  lang,
  className,
}: {
  path: string;
  title: string;
  lang?: Lang;
  className?: string;
}) {
  const t = getT(lang ?? "cs");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // ?opt= deep-links break the OG route — share the bare market path.
  const cleanPath = path.split("?")[0];
  const url = () => `${location.origin}${cleanPath}`;

  const copy = async () => {
    await navigator.clipboard.writeText(url());
    setOpen(false);
    toast.success(t.copied);
  };

  const download = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${cleanPath}/opengraph-image`);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `monobet-${cleanPath.split("/").pop()}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
      setOpen(false);
    } catch {
      toast.error(t.somethingWrong);
    } finally {
      setBusy(false);
    }
  };

  const shareX = () => {
    window.open(
      `https://x.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url())}`,
      "_blank",
      "noopener,width=550,height=460"
    );
    setOpen(false);
  };

  const nativeShare = async () => {
    try {
      await navigator.share({ title, url: url() });
      setOpen(false);
    } catch {
      /* user dismissed the sheet */
    }
  };

  const item =
    "flex w-full items-center gap-2.5 px-3.5 py-2 text-[13px] font-medium text-ink hover:bg-surface-2 rounded-md cursor-pointer text-left disabled:opacity-50";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title={t.share}
        aria-label={t.share}
        onClick={() => setOpen((v) => !v)}
        className={cn("inline-flex items-center gap-1.5 text-mute hover:text-ink transition-colors cursor-pointer", className)}
      >
        <Share2 className="size-3.5" />
        {t.share}
      </button>
      {open && (
        <div className="absolute left-0 top-7 w-52 rounded-xl border border-line bg-surface shadow-lg p-1.5 z-50 anim-rise">
          <button type="button" className={item} onClick={copy}>
            <Link2 className="size-4 text-mute" /> {t.copyLink}
          </button>
          <button type="button" className={item} onClick={download} disabled={busy}>
            <Download className="size-4 text-mute" /> {busy ? t.generating : t.shareImage}
          </button>
          <button type="button" className={item} onClick={shareX}>
            <XIcon className="size-4 text-mute" /> {t.shareX}
          </button>
          {"share" in navigator && (
            <button type="button" className={item} onClick={nativeShare}>
              <Send className="size-4 text-mute" /> {t.shareMore}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
