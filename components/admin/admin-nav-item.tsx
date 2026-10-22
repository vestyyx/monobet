"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

// Server-rendered sidebar items get their active state from this tiny client
// island — the icon nodes (Lucide JSX) stay server-passed, no serialization.
export function AdminNavItem({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  const pathname = usePathname();
  // Exact match for the dashboard root; prefix match for sub-sections.
  const active = href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(href + "/");
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors",
        active
          ? "bg-brand-soft text-ink font-semibold"
          : "text-mute hover:text-ink hover:bg-surface-2",
        className
      )}
    >
      {children}
    </Link>
  );
}
