"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2, Play, RotateCcw, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { MonitorSnapshot } from "@/lib/services/monitoring";
import { FREQUENCIES } from "@/lib/automation/plan";
import { getMonitorAction, removeFailedJobAction, retryFailedJobAction, runPageNowAction } from "./actions";

const WORKER_LABEL: Record<string, string> = { generate: "Generación", render: "Renderizado de Reels", publish: "Publicación", scheduler: "Planificador" };
const QUEUE_LABEL: Record<string, string> = { automation: "Automatización", render: "Renderizado", publish: "Publicación" };

function Dot({ ok, warn }: { ok: boolean; warn?: boolean }) {
  return <span className={cn("inline-block size-2.5 rounded-full", ok ? "bg-success" : warn ? "bg-warning" : "bg-destructive")} />;
}

export function MonitorPanel({ initial }: { initial: MonitorSnapshot }) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [pending, start] = useTransition();
  const [running, setRunning] = useState<string | null>(null);

  const refresh = useCallback(async () => setS(await getMonitorAction()), []);
  useEffect(() => {
    const t = setInterval(() => void refresh().catch(() => {}), 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const { health } = s;
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) { toast.success(ok); await refresh(); router.refresh(); } else toast.error(r.error ?? "Error");
    });

  return (
    <div className="space-y-6">
      {health.paused && (
        <div className="flex items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <AlertTriangle className="size-4 text-warning" /> Pausa global activa: la generación, la programación y la publicación automáticas están detenidas.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ["Base de datos", health.db, health.db ? "Responde" : "Sin respuesta"],
          ["Redis (colas)", health.redis, health.redis ? "Responde" : "Sin respuesta"],
          ["FFmpeg", health.ffmpeg, health.ffmpeg ? "Instalado" : "No encontrado"],
          ["Disco (almacenamiento)", (health.disk?.freePct ?? 0) > 10, health.disk ? `${health.disk.freeGb.toFixed(1)} GB libres (${health.disk.freePct.toFixed(0)}%)` : "Sin datos"],
          ["Pausa global", !health.paused, health.paused ? "Activa" : "No"],
        ].map(([label, ok, text]) => (
          <Card key={String(label)} className="py-0"><CardContent className="flex items-center gap-3 p-4"><Dot ok={ok as boolean} warn={label === "Pausa global"} /><div><div className="text-sm font-medium">{label as string}</div><div className="text-xs text-muted-foreground">{text as string}</div></div></CardContent></Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Procesos (workers)</CardTitle><CardDescription>Cada proceso informa un latido cada 10 s.</CardDescription></CardHeader>
          <CardContent>
            <ul className="divide-y">
              {health.workers.map((w) => (
                <li key={w.name} className="flex items-center gap-3 py-2 text-sm">
                  <Dot ok={w.alive} />
                  <span className="flex-1">{WORKER_LABEL[w.name]}</span>
                  <span className="text-xs text-muted-foreground">{w.alive ? `PID ${w.pid} · ${w.host}` : "detenido"}</span>
                </li>
              ))}
            </ul>
            {health.workers.some((w) => !w.alive) && <p className="mt-3 text-xs text-muted-foreground">Un proceso detenido deja su trabajo en cola. Iniciá los procesos con PM2 (<code>docs/DEPLOY.md</code>) o <code>npm run worker:…</code> / <code>npm run scheduler</code>.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Colas</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Cola</TableHead><TableHead className="text-right">Espera</TableHead><TableHead className="text-right">Activos</TableHead><TableHead className="text-right">Diferidos</TableHead><TableHead className="text-right">Fallidos</TableHead></TableRow></TableHeader>
              <TableBody>
                {s.queues.map((q) => (
                  <TableRow key={q.name}>
                    <TableCell className="font-medium">{QUEUE_LABEL[q.name] ?? q.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{q.waiting}</TableCell>
                    <TableCell className="text-right tabular-nums">{q.active}</TableCell>
                    <TableCell className="text-right tabular-nums">{q.delayed}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", q.failed > 0 && "font-medium text-destructive")}>{q.failed}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Automatización por página</CardTitle><CardDescription>«Ejecutar ahora» ignora la frecuencia, pero respeta la pausa, el presupuesto diario y los límites de publicación.</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto">
          {s.pages.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">Todavía no hay páginas.</p> : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Página</TableHead><TableHead>Estado</TableHead><TableHead>Modo</TableHead><TableHead>Última corrida</TableHead>
                <TableHead className="text-right">Listos</TableHead><TableHead className="text-right">Programados</TableHead><TableHead className="text-right">Publ. 24 h</TableHead><TableHead className="text-right">Gasto IA hoy</TableHead><TableHead />
              </TableRow></TableHeader>
              <TableBody>
                {s.pages.map((p) => (
                  <TableRow key={p.pageId}>
                    <TableCell className="min-w-44 whitespace-normal"><Link href={`/paginas/${p.pageId}?tab=automatizacion`} className="font-medium hover:underline">{p.name}</Link>{!p.active && <Badge variant="outline" className="ml-2">Inactiva</Badge>}</TableCell>
                    <TableCell>{p.running ? <Badge className="gap-1"><Loader2 className="size-3 animate-spin" /> Corriendo</Badge> : p.enabled ? <Badge variant="outline" className="border-success/30 text-success">Activa</Badge> : <Badge variant="outline">Desactivada</Badge>}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{p.requireApproval ? "Con aprobación" : "Auto-aprobada"}{p.autoPublish ? " · publica sola" : " · programás vos"}<br />{FREQUENCIES[p.frequency as keyof typeof FREQUENCIES]?.label ?? p.frequency}</TableCell>
                    <TableCell className="max-w-56 text-xs">
                      {p.lastRunAt ? <>{new Date(p.lastRunAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}<br /><span className="text-muted-foreground">{p.lastSummary?.skipped ?? `${p.lastSummary?.generated ?? 0} generados · ${p.lastSummary?.scheduled ?? 0} programados`}{p.lastSummary?.notes?.[0] ? ` — ${p.lastSummary.notes[0]}` : ""}</span></> : <span className="text-muted-foreground">Nunca</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{p.ready}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.scheduled}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.published24h}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">${p.spentToday.toFixed(2)} / ${p.budget.toFixed(2)}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" disabled={!p.enabled || pending || running === p.pageId} onClick={async () => {
                        setRunning(p.pageId);
                        const r = await runPageNowAction(p.pageId);
                        setRunning(null);
                        if (r.ok) { toast.success("Ejecución encolada"); await refresh(); } else toast.error(r.error);
                      }}>
                        <Play /> Ejecutar ahora
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base">{s.failed.length ? <XCircle className="size-4 text-destructive" /> : <CheckCircle2 className="size-4 text-success" />} Trabajos fallidos</CardTitle></CardHeader>
        <CardContent>
          {s.failed.length === 0 ? <p className="text-sm text-muted-foreground">No hay trabajos fallidos.</p> : (
            <ul className="divide-y">
              {s.failed.map((j) => (
                <li key={`${j.queue}-${j.id}`} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                  <Badge variant="outline">{QUEUE_LABEL[j.queue] ?? j.queue}</Badge>
                  <span className="font-mono text-xs">{j.name}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-destructive" title={j.reason}>{j.reason || "sin detalle"}</span>
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => retryFailedJobAction(j.queue, j.id), "Reintentando")}><RotateCcw /> Reintentar</Button>
                  <Button size="sm" variant="ghost" className="text-destructive" disabled={pending} onClick={() => run(() => removeFailedJobAction(j.queue, j.id), "Eliminado")}><Trash2 /></Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <p className="text-right text-xs text-muted-foreground">Actualizado {new Date(s.at).toLocaleTimeString("es-AR")} · se refresca cada 5 s</p>
    </div>
  );
}
