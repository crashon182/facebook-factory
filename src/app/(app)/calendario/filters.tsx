"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, WandSparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FORMAT_LABELS } from "@/lib/constants";
import { autoScheduleAction } from "./actions";

const STATUSES: [string, string][] = [["SCHEDULED", "Programados"], ["PUBLISHED", "Publicados"], ["FAILED", "Con error"], ["PUBLISHING", "Publicando"]];

export function CalendarFilters({ pages, pageId }: { pages: { id: string; name: string }[]; pageId?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (!value || value === "all") next.delete(key); else next.set(key, value);
    router.replace(`${pathname}?${next.toString()}`);
  }
  const sel = (key: string, label: string, options: [string, string][], width: string) => (
    <Select value={params.get(key) ?? "all"} onValueChange={(v) => update(key, v)}>
      <SelectTrigger className={`w-full ${width}`}><SelectValue placeholder={label} /></SelectTrigger>
      <SelectContent><SelectItem value="all">{label}</SelectItem>{options.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
    </Select>
  );

  function auto() {
    if (!pageId) return;
    setBusy(true);
    start(async () => {
      const r = await autoScheduleAction(pageId);
      setBusy(false);
      if (!r.ok) toast.error(r.error);
      else if (r.data.scheduled === 0 && r.data.skipped.length === 0) toast.info("No hay contenidos listos y aprobados sin programar en esta página.");
      else toast.success(`Programados: ${r.data.scheduled}${r.data.skipped.length ? ` · omitidos: ${r.data.skipped.join(" / ")}` : ""}`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
      {sel("pageId", "Todas las páginas", pages.map((p) => [p.id, p.name]), "lg:w-56")}
      {sel("format", "Todos los tipos", Object.entries(FORMAT_LABELS), "lg:w-48")}
      {sel("status", "Todos los estados", STATUSES, "lg:w-44")}
      <Button variant="outline" disabled={!pageId || pending || busy} onClick={auto} title={pageId ? "Asigna horarios según la estrategia y las reglas de la página" : "Elegí una página para programar automáticamente"} className="lg:ml-auto">
        {pending || busy ? <Loader2 className="animate-spin" /> : <WandSparkles />} Programar automáticamente
      </Button>
    </div>
  );
}
