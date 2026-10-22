import { redirect, notFound } from "next/navigation";
import { requireRole } from "@/lib/admin/rbac";
import { moduleById } from "@/lib/admin/modules";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { Card } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

// Registry-driven section router. Any /admin/<section> not handled by a
// dedicated page lands here: the module must exist in the registry and the
// current role must satisfy its minimum. Built modules get real pages (which
// win over this file via Next route specificity); unplanned ids 404.
export default async function AdminSection({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const mod = moduleById(section);
  if (!mod) notFound();

  const user = await requireRole(mod.minRole);
  if (!user) redirect("/login");
  if (user!.parsedRole === "user") redirect("/");
  const lang = await getLang();
  const t = getT(lang);

  const label = lang === "cs" ? mod.labelCs : mod.labelEn;
  const desc = lang === "cs" ? mod.descCs : mod.descEn;

  if (mod.built) {
    // Built modules must ship their own page — this catch-all never renders a
    // real module. Reaching here means a registry entry was flipped `built`
    // without its page landing; fail loudly instead of faking a screen.
    // notFound() (not throw) so the mistake is visible but the app stays up.
    notFound();
  }

  const Icon = mod.icon;
  return (
    <div className="py-2">
      <h1 className="text-[20px] font-bold tracking-tight flex items-center gap-2">
        <Icon className="size-5 text-brand" /> {label}
      </h1>
      <Card className="mt-5 px-5 py-6 max-w-xl">
        <p className="text-[13.5px] text-mute leading-relaxed">{desc}</p>
        <div className="mt-3 inline-flex items-center gap-2 rounded-lg bg-brand-soft px-2.5 py-1 text-[11.5px] font-semibold text-ink">
          {t.admPlannedChip} {mod.deliveryPhase}
        </div>
        <p className="mt-4 text-[12px] text-faint">{t.admPlannedNote}</p>
      </Card>
    </div>
  );
}
