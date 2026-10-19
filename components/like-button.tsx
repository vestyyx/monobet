"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Heart } from "lucide-react";
import { toast } from "sonner";
import { toggleLike } from "@/lib/actions";
import { getT, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// Heart + count on market cards/pages — a public signal, unlike the private
// bookmark. Swallows the event since it lives inside <Link> cards.
export function LikeButton({
  marketId,
  liked: initial,
  count: initialCount,
  lang,
  className,
}: {
  marketId: string;
  liked: boolean;
  count: number;
  lang?: Lang;
  className?: string;
}) {
  const t = getT(lang ?? "cs");
  const [liked, setLiked] = useState(initial);
  const [count, setCount] = useState(initialCount);
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <button
      type="button"
      disabled={pending}
      title={liked ? t.unlike : t.like}
      aria-label={liked ? t.unlike : t.like}
      aria-pressed={liked}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        start(async () => {
          const r = await toggleLike({ marketId });
          if (r.ok) {
            setLiked(r.liked ?? false);
            setCount((c) => c + (r.liked ? 1 : -1));
            router.refresh();
          } else {
            toast.error(t.serverErr(r.error));
          }
        });
      }}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1 -my-0.5 py-0.5 transition-colors cursor-pointer disabled:opacity-50",
        liked ? "text-rose-500 hover:text-rose-600" : "text-faint hover:text-rose-500",
        className
      )}
    >
      <Heart className={cn("size-3.5", liked && "fill-rose-500")} />
      {count > 0 && <span className="num text-[11.5px] font-semibold">{count}</span>}
    </button>
  );
}
