import { redirect } from "next/navigation";
import { requireRole } from "@/lib/admin/rbac";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { getHouseStats } from "@/lib/queries";
import { HousePanel } from "@/components/admin-panels";
import { Card } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

// House & economy (Phase 5, admin+) — the former overview's house panel with
// its leverage/spend/stake knobs and house rules. Phase 6 layers versioned
// config snapshots, CSV exports and a ledger reconciliation check on top.
// setLeverageConfig/setHouseRules stay unaudited until versioning lands.
export default async function AdminEconomyPage() {
  const admin = await requireRole("admin");
  if (!admin) redirect("/login");
  const lang = await getLang();
  const t = getT(lang);
  const stats = await getHouseStats();

  return (
    <div className="py-2">
      <h1 className="text-[20px] font-bold tracking-tight">{t.econTitle}</h1>
      <p className="text-[12.5px] text-mute mt-0.5 mb-4">{t.econSub}</p>

      <h2 className="text-[15px] font-semibold mb-2">{t.houseTitle}</h2>
      <Card className="max-w-3xl overflow-hidden">
        <HousePanel stats={stats} lang={lang} />
      </Card>
    </div>
  );
}
