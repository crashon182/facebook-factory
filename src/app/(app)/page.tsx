import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Layers, Plug, CalendarClock, CheckCircle2, AlertTriangle, Film, Hourglass, CalendarCheck, Activity, Bot, PauseCircle, Coins, BarChart3 } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatCard } from "@/components/dashboard/stat-card";
import { CostChart, FormatChart, PostsPerPageChart } from "@/components/dashboard/charts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getDashboardData } from "@/lib/services/dashboard";

export const metadata: Metadata = { title: "Dashboard" };

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
      <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-80" /><Skeleton className="h-80" /></div>
    </div>
  );
}

async function DashboardContent() {
  const d = await getDashboardData();
  const c = d.counts;
  const noPages = c.pagesTotal === 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Páginas administradas" value={c.pagesTotal} icon={Layers} />
        <StatCard label="Conectadas a Facebook" value={`${c.pagesConnected} / ${c.pagesTotal}`} icon={Plug} tone={c.pagesConnected ? "success" : "muted"} />
        <StatCard label="Publicaciones del día" value={c.todayPosts} icon={CalendarCheck} />
        <StatCard label="Programadas" value={c.scheduled} icon={CalendarClock} tone="warning" />
        <StatCard label="Publicadas" value={c.published} icon={CheckCircle2} tone="success" />
        <StatCard label="Fallidas" value={c.failed} icon={AlertTriangle} tone={c.failed ? "destructive" : "muted"} />
        <StatCard label="Reels generados" value={c.reelsGenerated} icon={Film} />
        <StatCard label="Reels pendientes" value={c.reelsPending} icon={Hourglass} tone="muted" />
      </div>

      {noPages ? (
        <EmptyState
          icon={Layers}
          title="Aún no hay datos para mostrar"
          description="Creá tu primera página para comenzar. Las estadísticas y gráficos se completarán a medida que generes y publiques contenido."
          action={<Button asChild><Link href="/paginas/nueva">Crear primera página</Link></Button>}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Contenidos por página</CardTitle>
              <CardDescription>Distribución por estado</CardDescription>
            </CardHeader>
            <CardContent>
              {d.postsPerPage.length ? <PostsPerPageChart data={d.postsPerPage} /> : <p className="py-16 text-center text-sm text-muted-foreground">Todavía no hay contenidos.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Contenidos por formato</CardTitle>
              <CardDescription>Las métricas de rendimiento llegan con la Fase 6</CardDescription>
            </CardHeader>
            <CardContent>
              {d.postsByFormat.length ? <FormatChart data={d.postsByFormat} /> : <p className="py-16 text-center text-sm text-muted-foreground">Todavía no hay contenidos.</p>}
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Coins className="size-4" /> Consumo de OpenAI</CardTitle>
            <CardDescription>
              Mes actual: {d.openai.calls} llamadas · {d.openai.tokens.toLocaleString("es-AR")} tokens · costo estimado ${d.openai.costUsd.toFixed(4)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {d.openai.calls === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Sin consumo registrado. La integración con OpenAI llega en la Fase 2.</p>
            ) : (
              <CostChart data={d.costByDay} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Bot className="size-4" /> Automatizaciones</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Estado global</span>
              {d.automation.paused ? <Badge variant="outline" className="gap-1 border-warning/30 bg-warning/15 text-warning"><PauseCircle className="size-3" /> Pausadas</Badge> : <Badge variant="outline" className="border-success/30 bg-success/15 text-success">Habilitadas</Badge>}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Páginas con automatización activa</span>
              <span className="font-medium tabular-nums">{d.automation.rulesEnabled}</span>
            </div>
            <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">Los workers de ejecución se activan en la Fase 5.</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Activity className="size-4" /> Actividad reciente</CardTitle>
        </CardHeader>
        <CardContent>
          {d.recent.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Sin actividad registrada.</p>
          ) : (
            <ul className="divide-y">
              {d.recent.map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <span className={`size-2 shrink-0 rounded-full ${a.level === "ERROR" ? "bg-destructive" : a.level === "WARN" ? "bg-warning" : "bg-success"}`} />
                  <span className="min-w-0 flex-1 truncate">{a.message}</span>
                  <time className="shrink-0 text-xs text-muted-foreground" dateTime={a.createdAt.toISOString()}>
                    {a.createdAt.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <>
      <PageHeader title="Dashboard" description="Visión general de todas tus páginas y automatizaciones." actions={<BarChart3 className="hidden size-5 text-muted-foreground" />} />
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent />
      </Suspense>
    </>
  );
}
