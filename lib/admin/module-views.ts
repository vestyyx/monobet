// JSON-safe copy of a registry module for client/sidebar consumption.
// The full registry (with Lucide icons) stays server-side; this view is what
// layout pages drop into the sidebar and reuse for quick links.
import { ADMIN_MODULES, ADMIN_GROUPS } from "@/lib/admin/modules";
import type { LucideIcon } from "lucide-react";
import type { Role } from "@/lib/admin/rbac";

export type AdminModuleView = {
  id: string;
  label: { en: string; cs: string };
  desc: { en: string; cs: string };
  Icon: LucideIcon;
  built: boolean;
  minRole: Role;
  deliveryPhase: string;
  group: string;
};

// Sorted by group order, then registry order — mirrors modulesForRole.
export function moduleViewsFor(lang: "en" | "cs", role: Role): AdminModuleView[] {
  const rank = { user: 0, moderator: 1, admin: 2, owner: 3 };
  return ADMIN_MODULES.filter((m) => rank[role] >= rank[m.minRole])
    .sort((a, b) => {
      const ga = ADMIN_GROUPS.findIndex((g) => g.id === a.group);
      const gb = ADMIN_GROUPS.findIndex((g) => g.id === b.group);
      return ga - gb;
    })
    .map((m) => ({
      id: m.id,
      label: { en: m.labelEn, cs: m.labelCs },
      desc: { en: m.descEn, cs: m.descCs },
      Icon: m.icon,
      built: m.built,
      minRole: m.minRole,
      deliveryPhase: m.deliveryPhase,
      group: m.group,
    }));
}

export { ADMIN_GROUPS };
