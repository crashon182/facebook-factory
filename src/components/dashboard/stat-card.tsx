import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatCard({ label, value, hint, icon: Icon, tone = "primary" }: { label: string; value: string | number; hint?: string; icon: LucideIcon; tone?: "primary" | "success" | "warning" | "destructive" | "muted" }) {
  const tones = {
    primary: "bg-primary/10 text-primary",
    success: "bg-success/15 text-success",
    warning: "bg-warning/15 text-warning",
    destructive: "bg-destructive/10 text-destructive",
    muted: "bg-muted text-muted-foreground",
  };
  return (
    <Card className="py-0">
      <CardContent className="flex items-center gap-4 p-5">
        <div className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", tones[tone])}>
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <div className="text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
          <div className="text-sm text-muted-foreground">{label}</div>
          {hint && <div className="truncate text-xs text-muted-foreground/80">{hint}</div>}
        </div>
      </CardContent>
    </Card>
  );
}
