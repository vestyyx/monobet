import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { Compass, Gamepad2 } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { QuestPanel } from "@/components/quest-panel";
import { questList } from "@/lib/actions-fun";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Rodinné úkoly" };

// Family quests — claim real-life tasks, attach proof, get the parent's
// review. Fixed Mony payouts on approval only; nothing is staked.
export default async function QuestsPage() {
  const [user, lang] = await Promise.all([getCurrentUser(), getLang()]);
  if (!user) redirect("/login");
  const t = getT(lang);
  const quests = await questList();

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="flex items-end justify-between gap-4 flex-wrap mb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Compass className="size-6 text-brand" /> {t.questTitle}
          </h1>
          <p className="text-[13.5px] text-mute mt-1">{t.questSub}</p>
        </div>
        <Link href="/games" className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-mute hover:text-ink transition-colors">
          <Gamepad2 className="size-4" /> {t.questBack}
        </Link>
      </div>

      <QuestPanel lang={lang} quests={quests} />
    </div>
  );
}
