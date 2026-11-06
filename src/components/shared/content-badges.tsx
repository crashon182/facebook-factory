import { Badge } from "@/components/ui/badge";
import { POST_STATUS_LABELS } from "@/lib/constants";
import { cn } from "@/lib/utils";

const styles: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  GENERATING: "bg-primary/10 text-primary border-primary/30",
  READY: "bg-chart-2/15 text-chart-2 border-chart-2/30",
  SCHEDULED: "bg-warning/15 text-warning border-warning/30",
  PUBLISHING: "bg-primary/10 text-primary border-primary/30",
  PUBLISHED: "bg-success/15 text-success border-success/30",
  FAILED: "bg-destructive/10 text-destructive border-destructive/30",
  CANCELLED: "bg-muted text-muted-foreground line-through",
};

export function PostStatusBadge({ status }: { status: string }) {
  return <Badge variant="outline" className={cn(styles[status])}>{POST_STATUS_LABELS[status] ?? status}</Badge>;
}
