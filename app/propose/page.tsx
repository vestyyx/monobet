import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser, isAdmin } from "@/lib/session";
import { listCategories } from "@/lib/queries";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { MarketForm } from "@/components/market-form";

export const metadata: Metadata = { title: "Nový trh" };

export default async function ProposePage() {
  const [user, lang, categories] = await Promise.all([getCurrentUser(), getLang(), listCategories()]);
  if (!user) redirect("/login");
  const t = getT(lang);

  return (
    <div className="mx-auto max-w-xl px-4 pt-10">
      <h1 className="text-[22px] font-bold tracking-tight">{t.proposeTitle}</h1>
      <p className="text-[13px] text-mute mt-1 mb-6">{t.proposeSub}</p>
      <MarketForm isAdmin={isAdmin(user)} categories={categories} lang={lang} />
    </div>
  );
}
