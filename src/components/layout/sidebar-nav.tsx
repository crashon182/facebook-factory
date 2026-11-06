"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "./nav";

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1">
      {NAV_ITEMS.map(({ href, label, icon: Icon, phase }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-sidebar-accent text-white" : "text-sidebar-muted hover:bg-sidebar-accent/60 hover:text-white",
            )}
          >
            <Icon className={cn("size-4", active && "text-indigo-400")} />
            <span className="flex-1">{label}</span>
            {phase > 1 && <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-sidebar-muted">F{phase}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
