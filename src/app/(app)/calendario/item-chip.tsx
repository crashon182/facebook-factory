"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { PostDialog } from "./post-dialog";

export type CalItem = { id: string; title: string; pageName: string; format: string; status: string; timeLabel: string; dayKey: string; sortKey: number };

const TONE: Record<string, string> = {
  SCHEDULED: "border-warning/40 bg-warning/10 text-foreground",
  PUBLISHING: "border-primary/40 bg-primary/10",
  PUBLISHED: "border-success/40 bg-success/10",
  FAILED: "border-destructive/40 bg-destructive/10",
  CANCELLED: "border-border bg-muted text-muted-foreground line-through",
  READY: "border-chart-2/40 bg-chart-2/10",
  DRAFT: "border-border bg-muted",
};

export function ItemChip({ item, wide = false }: { item: CalItem; wide?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title={`${item.pageName} — ${item.title}`}
        className={cn("flex w-full items-center gap-1.5 truncate rounded-md border px-1.5 py-0.5 text-left text-xs transition-colors hover:brightness-95", TONE[item.status] ?? TONE.DRAFT, wide && "py-1.5 text-sm")}>
        <span className="shrink-0 font-mono text-[10px] opacity-80">{item.timeLabel}</span>
        <span className="truncate">{item.title}</span>
        {wide && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{item.pageName}</span>}
      </button>
      {open && <PostDialog postId={item.id} open={open} onOpenChange={setOpen} />}
    </>
  );
}
