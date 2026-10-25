import { redirect } from "next/navigation";
import { requireRole } from "@/lib/admin/rbac";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { AdminQuestPanel } from "@/components/admin/fun-panels";
import { questClaimsForAdmin } from "@/lib/actions-fun";

export const dynamic = "force-dynamic";

// Family-quests admin — the review desk: pending claims (with optional proof
// photos) to approve or reject, plus recent quest creation.
export default async function AdminQuestsPage() {
  const admin = await requireRole("moderator");
  if (!admin) redirect("/login");
  if (admin.parsedRole === "user") redirect("/");
  const lang = await getLang();
  const t = getT(lang);

  const claims = await questClaimsForAdmin();

  return (
    <div className="py-2">
      <h1 className="text-[20px] font-bold tracking-tight">{t.admQuestTitle}</h1>
      <p className="text-[12.5px] text-mute mt-0.5 mb-5">{t.admQuestSub}</p>
      <AdminQuestPanel lang={lang} claims={claims} />
    </div>
  );
}
