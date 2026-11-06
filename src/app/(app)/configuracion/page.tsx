import type { Metadata } from "next";
import { CheckCircle2, CircleDashed } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getIntegrationStatus } from "@/lib/integrations/status";
import { getModel, isOpenAIConfigured, spentTodayUsd } from "@/lib/integrations/openai/client";
import { getPricing } from "@/lib/integrations/openai/pricing";
import { prisma } from "@/lib/db";

export const metadata: Metadata = { title: "Configuración" };

export default async function SettingsPage() {
  const month = new Date(); month.setUTCDate(1); month.setUTCHours(0, 0, 0, 0);
  const [today, usage] = isOpenAIConfigured()
    ? await Promise.all([spentTodayUsd(), prisma.aPIUsageLog.aggregate({ where: { provider: "openai", createdAt: { gte: month } }, _sum: { costUsd: true, inputTokens: true, outputTokens: true }, _count: true })])
    : [0, null];
  const pricing = getPricing();
  const integrations = getIntegrationStatus();
  const encryptionOk = (() => {
    try {
      return Buffer.from(process.env.ENCRYPTION_KEY ?? "", "base64").length === 32;
    } catch {
      return false;
    }
  })();

  return (
    <>
      <PageHeader title="Configuración" description="Estado de las integraciones. Las claves se definen en variables de entorno, nunca en la base de datos." />
      <div className="grid gap-4 md:grid-cols-2">
        {integrations.map((i) => (
          <Card key={i.key}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2 text-base">
                {i.name}
                {i.configured ? (
                  <Badge variant="outline" className="gap-1 border-success/30 bg-success/15 text-success"><CheckCircle2 className="size-3" /> Credenciales presentes</Badge>
                ) : (
                  <Badge variant="outline" className="gap-1"><CircleDashed className="size-3" /> No configurada</Badge>
                )}
              </CardTitle>
              <CardDescription>{i.description} · se usa desde la Fase {i.phase}</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {i.configured ? "Variables detectadas. La conectividad se verificará al implementar la integración." : <>Falta definir: <span className="font-mono text-xs">{i.missing.join(", ")}</span></>}
            </CardContent>
          </Card>
        ))}
        {usage && (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Uso y costos de OpenAI</CardTitle>
              <CardDescription>Modelo: <span className="font-mono text-xs">{getModel()}</span> · {pricing ? "costos estimados con los precios configurados" : "sin precios configurados: el costo aparece en 0 (solo se cuentan tokens)"}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm sm:grid-cols-4">
              <div><div className="text-muted-foreground">Gasto de hoy (UTC)</div><div className="text-lg font-semibold tabular-nums">${today.toFixed(4)}</div></div>
              <div><div className="text-muted-foreground">Gasto del mes</div><div className="text-lg font-semibold tabular-nums">${Number(usage._sum.costUsd ?? 0).toFixed(4)}</div></div>
              <div><div className="text-muted-foreground">Llamadas del mes</div><div className="text-lg font-semibold tabular-nums">{usage._count}</div></div>
              <div><div className="text-muted-foreground">Tokens del mes</div><div className="text-lg font-semibold tabular-nums">{((usage._sum.inputTokens ?? 0) + (usage._sum.outputTokens ?? 0)).toLocaleString("es-AR")}</div></div>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2 text-base">
              Cifrado de tokens
              {encryptionOk ? <Badge variant="outline" className="border-success/30 bg-success/15 text-success">AES-256-GCM listo</Badge> : <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">ENCRYPTION_KEY inválida</Badge>}
            </CardTitle>
            <CardDescription>Los tokens de Meta se cifran antes de guardarse.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    </>
  );
}
