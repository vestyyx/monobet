"use client";

import { useState } from "react";
import { Check, Link2 } from "lucide-react";
import { toast } from "sonner";
import { getT, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function CopyLink({ path, lang, className }: { path: string; lang?: Lang; className?: string }) {
  const t = getT(lang ?? "cs");
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={t.copyLink}
      aria-label={t.copyLink}
      onClick={() => {
        navigator.clipboard.writeText(`${location.origin}${path}`);
        setCopied(true);
        toast.success(t.copied);
        setTimeout(() => setCopied(false), 1500);
      }}
      className={cn(
        "inline-flex items-center gap-1.5 text-mute hover:text-ink transition-colors cursor-pointer",
        className
      )}
    >
      {copied ? <Check className="size-3.5 text-yes" /> : <Link2 className="size-3.5" />}
      {copied ? t.copied : t.copyLink}
    </button>
  );
}
