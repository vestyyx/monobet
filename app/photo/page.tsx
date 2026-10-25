import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { ImageIcon, Gamepad2 } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { PhotoPanel, type PhotoVM } from "@/components/photo-panel";
import { photoList } from "@/lib/actions-fun";
import { funRoundOpen } from "@/lib/fun";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Hádání fotek" };

// Photo guess — the admin publishes a macro shot and the family races to
// name it. Same race mechanics as emoji riddles, fewer words, more squinting.
export default async function PhotoPage() {
  const [user, lang] = await Promise.all([getCurrentUser(), getLang()]);
  if (!user) redirect("/login");
  const t = getT(lang);
  const rounds = await photoList();

  const vms: PhotoVM[] = rounds.map((r) => {
    const isOpen = funRoundOpen(r.status, r.closeAt);
    return {
      ...r,
      closeAt: new Date(r.closeAt),
      isOpen,
      closeLabel: fmtShort(new Date(r.closeAt), lang),
    };
  });

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="flex items-end justify-between gap-4 flex-wrap mb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ImageIcon className="size-6 text-brand" /> {t.photoTitle}
          </h1>
          <p className="text-[13.5px] text-mute mt-1">{t.photoSub}</p>
        </div>
        <Link href="/games" className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-mute hover:text-ink transition-colors">
          <Gamepad2 className="size-4" /> {t.photoBack}
        </Link>
      </div>

      <PhotoPanel lang={lang} rounds={vms} />
    </div>
  );
}

function fmtShort(d: Date, lang: "cs" | "en"): string {
  return new Intl.DateTimeFormat(lang === "cs" ? "cs-CZ" : "en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}
