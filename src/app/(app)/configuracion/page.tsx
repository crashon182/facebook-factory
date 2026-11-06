import type { Metadata } from "next";
import { CheckCircle2, CircleDashed } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getIntegrationStatus } from "@/lib/integrations/status";

export const metadata: Metadata = { title: "Configuración" };

export default function SettingsPage() {
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
