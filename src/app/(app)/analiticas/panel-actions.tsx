"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { collectNowAction, experimentAction, generateReportAction, type ExperimentOp } from "./actions";

export function PanelActions({ pageId, canReport }: { pageId: string; canReport: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) { toast.success(ok); router.refresh(); } else toast.error(r.error ?? "Error");
    });
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => collectNowAction(pageId), "Recopilación en cola. Actualizá en unos segundos.")}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Recopilar ahora
      </Button>
      <Button variant="outline" size="sm" disabled={pending || !canReport} title={canReport ? undefined : "Configurá OPENAI_API_KEY"} onClick={() => run(() => generateReportAction(pageId), "Informe en cola. Aparecerá en unos minutos.")}>
        <Sparkles className="size-4" /> Generar informe
      </Button>
    </div>
  );
}

export function ExperimentButtons({ id, status, applicable }: { id: string; status: string; applicable: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const go = (op: ExperimentOp, ok: string) =>
    start(async () => {
      const r = await experimentAction(id, op);
      if (r.ok) { toast.success(ok); router.refresh(); } else toast.error(r.error);
    });
  if (status === "PROPOSED") {
    return (
      <div className="flex gap-2">
        {applicable ? <Button size="sm" disabled={pending} onClick={() => go("approve", "Experimento aplicado.")}>Aprobar y aplicar</Button> : <Button size="sm" variant="outline" disabled={pending} onClick={() => go("done", "Marcado como hecho.")}>Marcar como hecho</Button>}
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => go("reject", "Descartado.")}>Descartar</Button>
      </div>
    );
  }
  if (status === "RUNNING" && applicable) return <Button size="sm" variant="outline" disabled={pending} onClick={() => go("revert", "Cambio revertido.")}>Revertir ahora</Button>;
  return null;
}
