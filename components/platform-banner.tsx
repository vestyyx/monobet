// Global platform banner (Phase 6) — a thin strip above the header showing
// the maintenance note and/or the announcement from /admin/settings. The
// announcement auto-expires at its `until` timestamp; empty title = no banner.
import { getSettings } from "@/lib/queries";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { Wrench, Megaphone } from "lucide-react";

// Kept outside the component so the render stays free of clock reads.
function annIsActive(until: Date | null): boolean {
  return !until || until.getTime() > Date.now();
}

export async function PlatformBanner() {
  const [cfg, lang] = await Promise.all([getSettings(), getLang()]);
  if (!cfg) return null;
  const t = getT(lang);
  const maintenance = cfg.maintenance;
  const annActive = cfg.annTitle.trim().length > 0 && annIsActive(cfg.annUntil);
  if (!maintenance && !annActive) return null;

  const warn = (cfg.annLevel ?? "info") === "warn";
  return (
    <div role="status" className="space-y-0">
      {maintenance && (
        <div className="bg-no text-no-on px-4 py-1.5 text-center text-[12.5px] font-semibold flex items-center justify-center gap-1.5">
          <Wrench className="size-3.5 shrink-0" /> {t.bannerMaint}
        </div>
      )}
      {annActive && (
        <div
          className={`px-4 py-1.5 text-center text-[12.5px] flex flex-wrap items-center justify-center gap-1.5 ${
            warn ? "bg-warn-soft text-warn-strong" : "bg-brand text-brand-on"
          }`}
        >
          <Megaphone className="size-3.5 shrink-0" />
          <b className="font-bold">{cfg.annTitle}</b>
          {cfg.annBody.trim() && <span className="opacity-90">{cfg.annBody}</span>}
        </div>
      )}
    </div>
  );
}
