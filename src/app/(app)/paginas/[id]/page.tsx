import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Globe } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { ActiveBadge, AutomationBadge, ConnectionBadge } from "@/components/shared/status-badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getPage } from "@/lib/services/pages";
import { getActiveStrategy, listStrategyVersions } from "@/lib/services/strategies";
import { isOpenAIConfigured } from "@/lib/integrations/openai/client";
import { getAutomationsPaused } from "@/lib/services/settings";
import { LANGUAGES } from "@/lib/constants";
import { AutomationPanel } from "./automation-panel";
import { GenerateStrategyButton, StrategyPanel } from "./strategy-panel";

export const metadata: Metadata = { title: "Detalle de página" };

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="grid gap-1 py-2.5 sm:grid-cols-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm sm:col-span-2">{value || <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

export default async function PageDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab } = await searchParams;
  const [page, paused, active, versions] = await Promise.all([getPage(id), getAutomationsPaused(), getActiveStrategy(id), listStrategyVersions(id)]);
  const configured = isOpenAIConfigured();
  if (!page) notFound();
  const a = page.automation;
  const lang = LANGUAGES.find((l) => l.value === page.language)?.label ?? page.language;

  return (
    <>
      <PageHeader
        title={page.name}
        description={page.topic}
        actions={
          <>
            <GenerateStrategyButton pageId={page.id} configured={configured} hasStrategy={!!active} />
            <Button asChild><Link href={`/paginas/${page.id}/editar`}><Pencil /> Editar</Link></Button>
          </>
        }
      />
      <div className="mb-6 flex flex-wrap gap-2">
        <ActiveBadge active={page.isActive} />
        <ConnectionBadge status={page.connectionStatus} />
        <AutomationBadge enabled={!!a?.enabled} paused={paused} />
      </div>

      <Tabs defaultValue={["estrategia", "automatizacion"].includes(tab ?? "") ? tab : "resumen"}>
        <TabsList>
          <TabsTrigger value="resumen">Resumen</TabsTrigger>
          <TabsTrigger value="estrategia">Estrategia</TabsTrigger>
          <TabsTrigger value="automatizacion">Automatización</TabsTrigger>
        </TabsList>

        <TabsContent value="resumen" className="mt-4 grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>Identidad editorial</CardTitle></CardHeader>
            <CardContent>
              <dl className="divide-y">
                <Row label="Descripción" value={page.description} />
                <Row label="Público objetivo" value={page.targetAudience} />
                <Row label="Tono" value={page.tone} />
                <Row label="Objetivos de crecimiento" value={page.growthGoals} />
                <Row label="Identidad visual" value={page.visualIdentity} />
                <Row label="Idioma" value={lang} />
                <Row label="País objetivo" value={page.targetCountry} />
                <Row label="Zona horaria" value={page.timezone} />
                <Row label="Creada" value={page.createdAt.toLocaleDateString("es-AR", { dateStyle: "long" })} />
              </dl>
            </CardContent>
          </Card>
          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle>Colores</CardTitle></CardHeader>
              <CardContent className="flex gap-3">
                {[page.primaryColor, page.secondaryColor].map((c, i) => c ? (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className="size-8 rounded-lg border" style={{ background: c }} /> <span className="font-mono text-xs">{c}</span>
                  </div>
                ) : null)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Globe className="size-4" /> Facebook</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Page ID</span><span className="font-mono text-xs">{page.facebookPageId ?? "—"}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Estado</span><ConnectionBadge status={page.connectionStatus} /></div>
                <p className="pt-2 text-xs text-muted-foreground">La conexión OAuth con Meta llega en la Fase 4.</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Contenido</CardTitle></CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {page._count.posts} {page._count.posts === 1 ? "contenido" : "contenidos"} · {page._count.strategies} {page._count.strategies === 1 ? "versión" : "versiones"} de estrategia
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="estrategia" className="mt-4">
          <StrategyPanel
            pageId={page.id}
            configured={configured}
            strategy={active?.strategy ?? null}
            activeVersion={active?.version ?? null}
            versions={versions.map((v) => ({ ...v, createdAt: v.createdAt.toISOString() }))}
          />
        </TabsContent>

        <TabsContent value="automatizacion" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Reglas de automatización</CardTitle></CardHeader>
            <CardContent>
              <AutomationPanel
                pageId={page.id}
                paused={paused}
                defaults={{
                  enabled: a?.enabled ?? false,
                  maxPostsPerDay: a?.maxPostsPerDay ?? 1,
                  requireApproval: a?.requireApproval ?? true,
                  autoPublish: a?.autoPublish ?? false,
                  autoOptimizeTimes: a?.autoOptimizeTimes ?? false,
                  daysAhead: a?.daysAhead ?? 3,
                  dailyBudgetUsd: Number(a?.dailyBudgetUsd ?? 1),
                  windowStart: a?.windowStart ?? "09:00",
                  windowEnd: a?.windowEnd ?? "21:00",
                  editorialRestrictions: a?.editorialRestrictions ?? "",
                }}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
