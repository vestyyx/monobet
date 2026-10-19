import type { Metadata } from "next";
import { Scale } from "lucide-react";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { Card } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Podmínky" };

export default async function TermsPage() {
  const lang = await getLang();
  const t = getT(lang);

  const sections = [
    [t.termsS1T, t.termsS1B],
    [t.termsS2T, t.termsS2B],
    [t.termsS3T, t.termsS3B],
    [t.termsS4T, t.termsS4B],
    [t.termsS5T, t.termsS5B],
    [t.termsS6T, t.termsS6B],
  ];

  return (
    <div className="mx-auto max-w-2xl px-4 pt-8">
      <h1 className="text-[22px] font-bold tracking-tight flex items-center gap-2">
        <Scale className="size-5" /> {t.termsTitle}
      </h1>
      <p className="text-[13px] text-mute mt-1">{t.termsSub}</p>

      <Card className="mt-6 p-6 space-y-6">
        {sections.map(([title, body]) => (
          <section key={title}>
            <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
            <p className="mt-1.5 text-[13.5px] text-mute leading-relaxed">{body}</p>
          </section>
        ))}
      </Card>
    </div>
  );
}
