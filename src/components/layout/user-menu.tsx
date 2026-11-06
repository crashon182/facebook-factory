import { LogOut } from "lucide-react";
import { signOut } from "@/lib/auth/auth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

export function UserMenu({ name, email }: { name?: string | null; email?: string | null }) {
  const initials = (name ?? email ?? "A").slice(0, 2).toUpperCase();
  return (
    <div className="flex items-center gap-2">
      <div className="hidden text-right leading-tight sm:block">
        <div className="text-sm font-medium">{name}</div>
        <div className="text-xs text-muted-foreground">{email}</div>
      </div>
      <Avatar className="size-8">
        <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">{initials}</AvatarFallback>
      </Avatar>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/login" });
        }}
      >
        <Button variant="ghost" size="icon" type="submit" aria-label="Cerrar sesión">
          <LogOut className="size-4" />
        </Button>
      </form>
    </div>
  );
}
