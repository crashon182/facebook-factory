import { Badge } from "@/components/ui/badge";
import { CONNECTION_LABELS } from "@/lib/constants";
import { cn } from "@/lib/utils";

const connectionStyles: Record<string, string> = {
  CONNECTED: "bg-success/15 text-success border-success/30",
  NOT_CONNECTED: "bg-muted text-muted-foreground",
  EXPIRED: "bg-warning/15 text-warning border-warning/30",
  ERROR: "bg-destructive/10 text-destructive border-destructive/30",
};

export function ConnectionBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn("gap-1.5", connectionStyles[status])}>
      <span className="size-1.5 rounded-full bg-current" />
      {CONNECTION_LABELS[status] ?? status}
    </Badge>
  );
}

export function ActiveBadge({ active }: { active: boolean }) {
  return (
    <Badge variant="outline" className={cn(active ? "bg-primary/10 text-primary border-primary/30" : "bg-muted text-muted-foreground")}>
      {active ? "Activa" : "Inactiva"}
    </Badge>
  );
}

export function AutomationBadge({ enabled, paused }: { enabled: boolean; paused: boolean }) {
  if (paused) return <Badge variant="outline" className="bg-warning/15 text-warning border-warning/30">Pausa global</Badge>;
  return (
    <Badge variant="outline" className={cn(enabled ? "bg-success/15 text-success border-success/30" : "bg-muted text-muted-foreground")}>
      {enabled ? "Automática" : "Manual"}
    </Badge>
  );
}
