import { redirect } from "next/navigation";
import { requireRole } from "@/lib/admin/rbac";
import { moduleViewsFor } from "@/lib/admin/module-views";
import { ADMIN_GROUPS } from "@/lib/admin/modules";
import { AdminNavItem } from "@/components/admin/admin-nav-item";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { LogoMark } from "@/components/logo";
import { Badge } from "@/components/ui/primitives";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

// Admin shell — sidebar generated from the module registry (lib/admin/modules).
// Add or flip a module there and every screen updates; no nav is hardcoded.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Shell floor: moderator. Each section enforces its own stricter role again.
  const user = await requireRole("moderator");
  if (!user) redirect("/login");
  if (user.parsedRole === "user") redirect("/");
  const lang = await getLang();
  const t = getT(lang);
  const modules = moduleViewsFor(lang === "cs" ? "cs" : "en", user.parsedRole);

  return (
    <div className="mx-auto max-w-6xl px-4 pt-6 lg:flex lg:gap-7">
      <aside className="lg:w-56 lg:shrink-0 lg:pt-1 pb-4 lg:pb-0 lg:sticky lg:top-4 lg:self-start">
        <div className="hidden lg:flex items-center gap-2 px-2.5 mb-4">
          <LogoMark className="size-[22px]" />
          <span className="font-bold text-[14.5px] tracking-tight">{t.adminPanel}</span>
          <Badge tone="ink" className="ml-auto">
            {user.parsedRole === "owner" ? t.admRoleOwner : user.parsedRole === "admin" ? t.admRoleAdmin : t.admRoleModerator}
          </Badge>
        </div>

        {/* Desktop: grouped vertical nav. Tablet/phone: one scrollable row. */}
        <nav className="lg:space-y-4 flex gap-1.5 overflow-x-auto pb-1 lg:pb-0 lg:flex-col lg:overflow-visible">
          {ADMIN_GROUPS.map((g) => {
            const items = modules.filter((m) => m.group === g.id);
            if (items.length === 0) return null;
            return (
              <div key={g.id} className="lg:space-y-0.5 flex gap-1.5 lg:flex-col lg:gap-0 shrink-0 lg:shrink">
                <div className="hidden lg:block px-2.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">
                  {lang === "cs" ? g.labelCs : g.labelEn}
                </div>
                {items.map((m) => (
                  <AdminNavItem
                    key={m.id}
                    href={`/admin/${m.id}`}
                    className={cnItem(m.built)}
                  >
                    <m.Icon className="size-4 shrink-0" />
                    <span className="whitespace-nowrap">{lang === "cs" ? m.label.cs : m.label.en}</span>
                    {!m.built && <span className="hidden lg:inline ml-auto text-[9.5px] font-semibold uppercase text-faint/80">{shortPhase(m.deliveryPhase, lang)}</span>}
                  </AdminNavItem>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="hidden lg:block mt-6 px-2.5">
          <Link href="/" className="inline-flex items-center gap-1.5 text-[12px] text-mute hover:text-ink transition-colors">
            <ArrowLeft className="size-3.5" /> {t.backToApp}
          </Link>
        </div>
      </aside>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}

// Unbuilt modules look muted but remain clickable (stub page explains).
function cnItem(built: boolean): string {
  return built ? "" : "opacity-70";
}

function shortPhase(phase: string, lang: "cs" | "en"): string {
  if (!phase.toLowerCase().startsWith("phase")) return lang === "cs" ? "později" : "later";
  return phase.replace(/^Phase /i, lang === "cs" ? "F" : "P");
}
