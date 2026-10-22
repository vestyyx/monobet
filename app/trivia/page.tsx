import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Brain, Gamepad2 } from "lucide-react";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { Card } from "@/components/ui/primitives";
import { TriviaPanel } from "@/components/trivia-panel";
import { triviaToday } from "@/lib/actions-fun";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Denní kvíz" };

// Daily trivia — the one-question-a-day party game. Guests get bounced to
// login like every other earning page.
export default async function TriviaPage() {
  const [user, lang] = await Promise.all([getCurrentUser(), getLang()]);
  if (!user) redirect("/login");
  const t = getT(lang);
  const state = await triviaToday(user);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="flex items-end justify-between gap-4 flex-wrap mb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Brain className="size-6 text-brand" /> {t.triviaTitle}
          </h1>
          <p className="text-[13.5px] text-mute mt-1">{t.triviaSub}</p>
        </div>
        <Link href="/games" className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-mute hover:text-ink transition-colors">
          <Gamepad2 className="size-4" /> {t.triviaBack}
        </Link>
      </div>

      <Card className="p-5">
        {!state.exists ? (
          <p className="text-[13.5px] text-mute">{t.triviaWait}</p>
        ) : (
          <TriviaPanel
            lang={lang}
            q={state.q ?? ""}
            options={state.options ?? []}
            difficulty={state.difficulty ?? 1}
            potCents={state.pot ?? 0}
            streak={state.streak ?? 0}
            answered={
              state.answeredChosen != null
                ? { chosen: state.answeredChosen, correctIdx: state.answeredCorrectIdx ?? -1, correct: !!state.answeredCorrect, rewardCents: state.rewardCents ?? 0 }
                : null
            }
            answeredCount={state.answeredCount ?? 0}
            correctCount={state.correctCount ?? 0}
          />
        )}
      </Card>
    </div>
  );
}
