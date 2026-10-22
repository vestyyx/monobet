import { cn } from "@/lib/utils";

// MonoPredict glyph: a friendly rising sun — half-disc peeking over a horizon
// line, apricot brand color, rounded corners to match the soft card look.
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 256 256" className={cn("size-7 shrink-0", className)} aria-hidden>
      <rect width="256" height="256" rx="64" fill="#f08a1d" />
      <g fill="none" stroke="#fff" strokeWidth="22" strokeLinecap="round">
        {/* rising sun — half disc + rays */}
        <path d="M78 150 A50 50 0 0 1 178 150" />
        <path d="M48 166 L58 166" />
        <path d="M198 166 L208 166" />
        <path d="M128 56 L128 73" />
        <path d="M76 78 L89 91" />
        <path d="M180 78 L167 91" />
      </g>
      {/* horizon */}
      <path d="M64 204 H192" stroke="#fff" strokeWidth="22" strokeLinecap="round" />
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
