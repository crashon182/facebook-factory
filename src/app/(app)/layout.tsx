import { requireAdmin } from "@/lib/auth/session";
import { Logo } from "@/components/shared/logo";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { MobileNav } from "@/components/layout/mobile-nav";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { GlobalPauseButton } from "@/components/layout/global-pause-button";
import { getAutomationsPaused } from "@/lib/services/settings";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  const paused = await getAutomationsPaused();
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="sticky top-0 hidden h-screen flex-col gap-6 border-r border-sidebar-border bg-sidebar p-4 text-sidebar-foreground lg:flex">
        <Logo className="px-2 pt-1" />
        <SidebarNav />
        <div className="mt-auto rounded-lg border border-sidebar-border bg-sidebar-accent/40 p-3 text-xs text-sidebar-muted">
          Uso privado. Las claves y tokens se guardan cifrados.
        </div>
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur sm:px-6">
          <MobileNav />
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <GlobalPauseButton paused={paused} />
            <ThemeToggle />
            <UserMenu name={user.name} email={user.email} />
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
