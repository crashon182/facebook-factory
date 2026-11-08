import type { Metadata } from "next";
import Link from "next/link";
import { Activity, BarChart3, Eye, FlaskConical, Heart, Radar, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatCard } from "@/components/dashboard/stat-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { prisma } from "@/lib/db";
import { FORMAT_LABELS } from "@/lib/constants";
import { isOpenAIConfigured } from "@/lib/integrations/openai/client";
import { getConsolidated, getPageOverview, parseRange, RANGES } from "@/lib/services/analytics";
import { WINDOW_VARIABLE, type WindowResult } from "@/lib/services/optimization";
import type { WeeklyReport } from "@/lib/prompts/report";
import { cn } from "@/lib/utils";
import { DailyChart, IndexBars } from "./analytics-charts";
import { ExperimentButtons, PanelActions } from "./panel-actions";

export const metadata: Metadata = { title: "Analíticas" };

const nf = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("es-AR"));
const pctTxt = (r: number | null) => (r == null ? "—" : `${(r * 100).toFixed(1)}%`);
const delta = (c: number | null) => (c == null ? undefined : `${c >= 0 ? "▲" : "▼"} ${Math.abs(c).toFixed(0)}% vs. período anterior`);
const fmt = (k: string) => FORMAT_LABELS[k] ?? k;

const EXP_STATUS: Record<string, { label: string; cls: string }> = {
  PROPOSED: { label: "Propuesto", cls: "bg-primary/10 text-primary border-primary/30" },
  RUNNING: { label: "En curso", cls: "bg-warning/15 text-warning border-warning/30" },
  COMPLETED: { label: "Completado", cls: "bg-success/15 text-success border-success/30" },
  REVERTED: { label: "Revertido", cls: "bg-muted text-muted-foreground" },
  REJECTED: { label: "Descartado", cls: "bg-muted text-muted-foreground" },
};

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const days = parseRange(sp.range);
  const pages = await prisma.socialPage.findMany({ where: { isActive: true }, select: { id: true, name: true, connectionStatus: true }, orderBy: { name: "asc" } });
  const selected = pages.find((p) => p.id === sp.pageId);
  const href = (pageId: string | undefined, range: number) => `/analiticas?${new URLSearchParams({ ...(pageId ? { pageId } : {}), range: String(range) })}`;

  const header = (
    <PageHeader title="Analíticas" description="Métricas de Meta, informes semanales con IA y optimización gradual del calendario." />
  );
  if (pages.length === 0) {
    return <>{header}<EmptyState icon={BarChart3} title="Todavía no hay páginas" description="Creá y conectá una página para empezar a medir su rendimiento." /></>;
  }

  const chip = (active: boolean) => cn("rounded-full border px-3 py-1 text-sm transition-colors", active ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted");
  const filters = (
    <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-3">
      <div className="flex flex-wrap gap-2">
        <Link href={href(undefined, days)} className={chip(!selected)}>Todas (consolidado)</Link>
        {pages.map((p) => <Link key={p.id} href={href(p.id, days)} className={chip(selected?.id === p.id)}>{p.name}</Link>)}
      </div>
      <div className="flex gap-2">
        {RANGES.map((r) => <Link key={r} href={href(selected?.id, r)} className={chip(r === days)}>{r} días</Link>)}
      </div>
    </div>
  );

  // ───────────── Consolidado ─────────────
  if (!selected) {
    const c = await getConsolidated(days);
    return (
      <>
        {header}
        {filters}
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Seguidores (suma)" value={nf(c.followers)} icon={Users} />
          <StatCard label="Vistas de publicaciones" value={nf(c.total.views)} icon={Eye} tone="success" hint={`${c.total.posts} publicaciones medidas`} />
          <StatCard label="Interacciones" value={nf(c.total.engagements)} icon={Heart} tone="warning" />
          <StatCard label="Interacción promedio" value={pctTxt(c.total.avgRate)} icon={Activity} tone="muted" hint="sobre el alcance" />
        </div>
        <Card className="py-0">
          <CardHeader className="pt-5"><CardTitle className="text-base">Por página · últimos {days} días</CardTitle></CardHeader>
          <CardContent className="px-0 pb-2">
            <Table>
              <TableHeader><TableRow><TableHead className="pl-6">Página</TableHead><TableHead className="text-right">Seguidores</TableHead><TableHead className="text-right">Publicaciones</TableHead><TableHead className="text-right">Vistas</TableHead><TableHead className="text-right">Interacciones</TableHead><TableHead className="pr-6 text-right">Interacción</TableHead></TableRow></TableHeader>
              <TableBody>
                {c.rows.map((r) => (
                  <TableRow key={r.pageId}>
                    <TableCell className="pl-6"><Link className="font-medium hover:underline" href={href(r.pageId, days)}>{r.name}</Link>{!r.connected && <Badge variant="outline" className="ml-2 text-xs">Sin conexión</Badge>}</TableCell>
                    <TableCell className="text-right tabular-nums">{nf(r.followers)}{r.followersDelta != null && <span className={cn("ml-1 text-xs", r.followersDelta >= 0 ? "text-success" : "text-destructive")}>{r.followersDelta >= 0 ? "+" : ""}{r.followersDelta}</span>}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.current.posts}</TableCell>
                    <TableCell className="text-right tabular-nums">{nf(r.current.views)}</TableCell>
                    <TableCell className="text-right tabular-nums">{nf(r.current.engagements)}</TableCell>
                    <TableCell className="pr-6 text-right tabular-nums">{pctTxt(r.current.avgRate)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </>
    );
  }

  // ───────────── Una página ─────────────
  const [o, reports, experiments, rule] = await Promise.all([
    getPageOverview(selected.id, days),
    prisma.aIAnalysisReport.findFirst({ where: { pageId: selected.id, type: "WEEKLY" }, orderBy: { createdAt: "desc" } }),
    prisma.optimizationExperiment.findMany({ where: { pageId: selected.id }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.automationRule.findUnique({ where: { pageId: selected.id }, select: { autoOptimizeTimes: true, windowStart: true, windowEnd: true } }),
  ]);
  if (!o) return <>{header}{filters}</>;
  const report = reports?.data as unknown as (WeeklyReport & { facts?: unknown }) | null;
  const connected = selected.connectionStatus === "CONNECTED";
  const noData = o.current.posts === 0 && o.daily.length === 0;

  return (
    <>
      {header}
      {filters}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {o.lastCollectedAt ? `Última recopilación: ${o.lastCollectedAt.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}` : "Todavía no se recopilaron métricas."}
          {" · "}Horarios en {o.timezone}
        </p>
        <PanelActions pageId={selected.id} canReport={isOpenAIConfigured()} />
      </div>
      {!connected && (
        <div className="mb-6 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          La página no está conectada a Facebook, por eso no se actualizan las métricas. <Link className="underline" href={`/paginas/${selected.id}`}>Ir a la página</Link>
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Seguidores" value={nf(o.followers)} icon={Users} hint={o.followersDelta != null ? `${o.followersDelta >= 0 ? "+" : ""}${o.followersDelta} en el período` : undefined} />
        <StatCard label="Vistas de publicaciones" value={nf(o.current.views)} icon={Eye} tone="success" hint={delta(o.changes.views)} />
        <StatCard label="Interacciones" value={nf(o.current.engagements)} icon={Heart} tone="warning" hint={delta(o.changes.engagements)} />
        <StatCard label="Interacción promedio" value={pctTxt(o.current.avgRate)} icon={Activity} tone="muted" hint={delta(o.changes.avgRate) ?? `${o.current.posts} publicaciones medidas`} />
      </div>

      {noData ? (
        <EmptyState icon={Radar} title="Sin datos todavía" description="Cuando la página publique y se recopilen métricas (cada 6 horas, o con «Recopilar ahora»), acá vas a ver su rendimiento." />
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card className="xl:col-span-2">
            <CardHeader><CardTitle className="text-base">Evolución de la Página</CardTitle><CardDescription>Último valor diario informado por Meta.</CardDescription></CardHeader>
            <CardContent>
              {o.daily.length < 2 ? <p className="py-8 text-center text-sm text-muted-foreground">Se necesitan al menos 2 días de datos para el gráfico.</p> : <DailyChart data={o.daily.map((d) => ({ day: d.day, Vistas: d.views, Alcance: d.reach }))} />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Rendimiento por hora</CardTitle><CardDescription>Índice normalizado: 1 = la mediana de la página, 2 = el doble.</CardDescription></CardHeader>
            <CardContent>
              {o.hours.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">Sin muestras suficientes.</p> : (
                <>
                  <IndexBars data={[...o.hours].sort((a, b) => Number(a.key) - Number(b.key)).map((h) => ({ name: `${h.key}h`, Índice: Math.round(h.avgIndex * 100) / 100, Publicaciones: h.n }))} />
                  <p className="mt-2 text-xs text-muted-foreground">
                    {o.bestHour != null ? `Mejor franja estimada: alrededor de las ${Math.floor(o.bestHour)}:${String(Math.round((o.bestHour % 1) * 60)).padStart(2, "0")} h.` : "Aún no hay datos suficientes para recomendar un horario (hacen falta ≥ 8 publicaciones medidas)."}
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Rendimiento por formato</CardTitle><CardDescription>Mismo índice normalizado.</CardDescription></CardHeader>
            <CardContent>
              {o.formats.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">Sin muestras suficientes.</p> : (
                <IndexBars data={o.formats.map((f) => ({ name: `${fmt(f.key)} (${f.n})`, Índice: Math.round(f.avgIndex * 100) / 100, Publicaciones: f.n }))} />
              )}
            </CardContent>
          </Card>

          <Card className="py-0 xl:col-span-2">
            <CardHeader className="pt-5"><CardTitle className="text-base">Publicaciones del período</CardTitle></CardHeader>
            <CardContent className="px-0 pb-2">
              <Table>
                <TableHeader><TableRow><TableHead className="pl-6">Publicación</TableHead><TableHead>Formato</TableHead><TableHead className="text-right">Vistas</TableHead><TableHead className="text-right">Alcance</TableHead><TableHead className="text-right">Interacciones</TableHead><TableHead className="pr-6 text-right">Índice</TableHead></TableRow></TableHeader>
                <TableBody>
                  {[...o.posts].sort((a, b) => (b.index ?? -1) - (a.index ?? -1)).slice(0, 15).map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="max-w-[320px] truncate pl-6"><Link href={`/contenidos/${p.id}`} className="hover:underline">{p.title}</Link></TableCell>
                      <TableCell>{fmt(p.format)}</TableCell>
                      <TableCell className="text-right tabular-nums">{nf(p.views)}</TableCell>
                      <TableCell className="text-right tabular-nums">{nf(p.reach)}</TableCell>
                      <TableCell className="text-right tabular-nums">{nf(p.engagements)}</TableCell>
                      <TableCell className="pr-6 text-right tabular-nums">{p.index == null ? "—" : p.index.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Último informe semanal con IA</CardTitle>
            {reports && <CardDescription>{reports.createdAt.toLocaleString("es-AR", { dateStyle: "medium", timeStyle: "short" })}</CardDescription>}
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {!report || !reports ? <p className="text-muted-foreground">Todavía no hay informes. Se generan los lunes a las 08:00 (UTC), o con «Generar informe».</p> : (
              <>
                <p>{reports.summary}</p>
                {([["Lo que funcionó", report.highlights], ["Para vigilar", report.concerns], ["Recomendaciones", report.recommendations]] as const).map(([title, items]) =>
                  items?.length ? (<div key={title}><h4 className="mb-1 font-medium">{title}</h4><ul className="list-disc space-y-1 pl-5 text-muted-foreground">{items.map((t, i) => <li key={i}>{t}</li>)}</ul></div>) : null,
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><FlaskConical className="size-4" /> Experimentos y optimización</CardTitle>
            <CardDescription>
              Ajustes pequeños y reversibles. {rule?.autoOptimizeTimes ? "La optimización automática de horarios está activada: mueve la franja como máximo 1 h por semana y se revierte sola si la interacción cae." : "Los cambios de horario requieren tu aprobación (podés activar la optimización automática en la configuración de la página)."}
              {rule && ` Franja actual: ${rule.windowStart}–${rule.windowEnd}.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {experiments.length === 0 ? <p className="text-sm text-muted-foreground">Todavía no hay experimentos. Se proponen cuando hay datos suficientes.</p> : (
              <ul className="divide-y">
                {experiments.map((e) => {
                  const st = EXP_STATUS[e.status];
                  const r = e.result as unknown as WindowResult | null;
                  const applicable = e.variable === WINDOW_VARIABLE;
                  return (
                    <li key={e.id} className="space-y-2 py-3 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <p>{e.hypothesis}</p>
                        <Badge variant="outline" className={cn("shrink-0", st.cls)}>{st.label}</Badge>
                      </div>
                      {r?.note && <p className="text-xs text-muted-foreground">{r.note}{r.changePct != null ? ` (${r.changePct >= 0 ? "+" : ""}${r.changePct.toFixed(0)}% de interacción)` : ""}</p>}
                      {e.status === "RUNNING" && e.endsAt && <p className="text-xs text-muted-foreground">Se evalúa el {e.endsAt.toLocaleDateString("es-AR")}.</p>}
                      <ExperimentButtons id={e.id} status={e.status} applicable={applicable} />
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
