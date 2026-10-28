import { redirect } from "next/navigation";
import { requireRole } from "@/lib/admin/rbac";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { getSettings } from "@/lib/queries";
import { AdminSettingsPanel, type PlatformSettings } from "@/components/admin/config-panels";
import { Card } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

// Platform settings (Phase 6, admin+): registration switch, maintenance mode
// and the global announcement banner — one audited form, one reason. The
// house-economy snapshots/rollback live on /admin/economy, not here.
export default async function AdminSettingsPage() {
  const admin = await requireRole("admin");
  if (!admin) redirect("/login");
  const lang = await getLang();
  const t = getT(lang);
  const cur = await getSettings();

  const settings: PlatformSettings = {
    registrationOpen: cur?.registrationOpen ?? true,
    maintenance: cur?.maintenance ?? false,
    annTitle: cur?.annTitle ?? "",
    annBody: cur?.annBody ?? "",
    annLevel: cur?.annLevel ?? "info",
    annUntilMs: cur?.annUntil ? new Date(cur.annUntil).getTime() : null,
    updatedBy: cur?.updatedBy ?? "",
    updatedAtMs: cur?.updatedAt ? new Date(cur.updatedAt).getTime() : null,
  };

  return (
    <div className="py-2">
      <h1 className="text-[20px] font-bold tracking-tight">{t.admSetTitle}</h1>
      <p className="text-[12.5px] text-mute mt-0.5 mb-4">{t.admSetSub}</p>

      <Card className="max-w-2xl overflow-hidden p-4">
        <AdminSettingsPanel lang={lang} settings={settings} />
      </Card>

      <p className="text-[11.5px] text-faint mt-3">{t.admSetVersionsNote}</p>
    </div>
  );
}
