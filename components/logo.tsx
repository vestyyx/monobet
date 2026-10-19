import { cn } from "@/lib/utils";

// MonoPredict glyph: a market price line zigzag terminating in the green quote dot.
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 256 256" className={cn("size-7 shrink-0", className)} aria-hidden>
      <rect width="256" height="256" rx="56" fill="#141a16" />
      <path
        d="M58 196 L98 92 L134 166 L182 74"
        fill="none"
        stroke="#fff"
        strokeWidth="24"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="198" cy="60" r="22" fill="var(--color-yes)" />
    </svg>
  );
}

export function LogoLockup({ className, wordmark = true }: { className?: string; wordmark?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark />
      {wordmark && <span className="font-bold text-[17px] tracking-tight hidden sm:block">MonoPredict</span>}
    </span>
  );
}
