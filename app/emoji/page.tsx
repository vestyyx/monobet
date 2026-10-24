import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { MessageCircleQuestion, Gamepad2 } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { EmojiPanel, type EmojiVM } from "@/components/emoji-panel";
import { emojiList } from "@/lib/actions-fun";
import { funRoundOpen } from "@/lib/fun";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Emoji hádanky" };

// Word & emoji riddles — type-what-you-see race. Three guesses per player,
// first solver takes the fixed prize; answers never ship to the client.
export default async function EmojiPage() {
  const [user, lang] = await Promise.all([getCurrentUser(), getLang()]);
  if (!user) redirect("/login");
  const t = getT(lang);
  const rounds = await emojiList();

  const vms: EmojiVM[] = rounds.map((r) => {
    const isOpen = funRoundOpen(r.status, r.closeAt);
    return {
      id: r.id,
      emoji: r.emoji,
      closeAt: new Date(r.closeAt).toISOString(),
      closeLabel: fmtShort(new Date(r.closeAt), lang),
      isOpen,
      status: r.status,
      hint: r.hint,
      hintUnlocked: r.hintUnlocked,
      myAttempts: r.myAttempts,
      attemptsLeft: r.attemptsLeft,
      myGuesses: r.myGuesses,
      solved: r.solved,
      solvedByMe: r.solvedByMe,
      winnerUsername: r.winnerUsername,
      answer: r.answer,
      rewardCents: r.rewardCents,
    };
  });

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="flex items-end justify-between gap-4 flex-wrap mb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <MessageCircleQuestion className="size-6 text-brand" /> {t.emojiTitle}
          </h1>
          <p className="text-[13.5px] text-mute mt-1">{t.emojiSub}</p>
        </div>
        <Link href="/games" className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-mute hover:text-ink transition-colors">
          <Gamepad2 className="size-4" /> {t.emojiBack}
        </Link>
      </div>

      <EmojiPanel lang={lang} rounds={vms} />
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
