"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { getT, type Lang } from "@/lib/i18n";

// Subscribe to the <html> class — the external source of truth — plus a
// local rerender trigger so toggling re-reads the DOM.
function subscribe(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => mo.disconnect();
}
const isDark = () => document.documentElement.classList.contains("dark");

export function ThemeToggle({ lang }: { lang?: Lang }) {
  const dark = useSyncExternalStore(subscribe, isDark, () => false);
  const t = getT(lang ?? "cs");

  return (
    <button
      type="button"
      onClick={() => {
        const next = !dark;
        document.documentElement.classList.toggle("dark", next);
        try {
          localStorage.setItem("mm-theme", next ? "dark" : "light");
        } catch {}
      }}
      title={dark ? t.themeToLight : t.themeToDark}
      aria-label={dark ? t.themeLight : t.themeDark}
      className="size-9 inline-flex items-center justify-center rounded-lg text-mute hover:text-ink hover:bg-surface-2 active:scale-95 transition-all cursor-pointer"
    >
      {dark ? <Sun className="size-[17px]" /> : <Moon className="size-[17px]" />}
    </button>
  );
}
