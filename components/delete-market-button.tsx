"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { deleteMarket } from "@/lib/actions";
import { getT, type Lang } from "@/lib/i18n";

export function DeleteMarketButton({
  marketId,
  question,
  admin,
  lang,
}: {
  marketId: string;
  question: string;
  admin: boolean;
  lang?: Lang;
}) {
  const t = getT(lang ?? "cs");
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      title={t.deleteMarket}
      className="grid place-items-center size-8 rounded-lg border border-line text-faint hover:text-no-strong hover:bg-no-soft hover:border-no/30 transition-colors cursor-pointer disabled:opacity-40 mt-1.5"
      onClick={() => {
        if (!confirm(admin ? t.deleteMarketConfirm(question) : t.deleteOwnConfirm(question))) return;
        start(async () => {
          const r = await deleteMarket(marketId);
          if (r.ok) {
            toast.success(t.marketDeleted);
            router.push("/");
            router.refresh();
          } else toast.error(t.serverErr(r.error));
        });
      }}
    >
      <Trash2 className="size-4" />
    </button>
  );
}
