import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, Info } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { ConnectionBadge } from "@/components/shared/status-badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getMetaConfig } from "@/lib/integrations/meta/config";
import { listPendingPages } from "@/lib/services/meta-connection";
import { getPage } from "@/lib/services/pages";
import { ChoosePages, ConnectionActions } from "./connect-panel";

export const metadata: Metadata = { title: "Conectar con Facebook" };

const ERRORS: Record<string, string> = {
  not_configured: "Meta no está configurado en el servidor (faltan META_APP_ID / META_APP_SECRET).",
  denied: "Cancelaste la autorización en Facebook o no concediste los permisos solicitados.",
  no_code: "Facebook no devolvió un código de autorización.",
  exchange: "No se pudo completar la conexión con Facebook. Revisá los datos de la app en Meta e intentá de nuevo.",
};

export default async function ConnectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ step?: string; error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const page = await getPage(id);
  if (!page) notFound();
  const cfg = getMetaConfig();
  const pending = sp.step === "choose" ? await listPendingPages(id) : [];
  const connected = page.connectionStatus !== "NOT_CONNECTED" && !!page.facebookPageId && !!page.accessTokenEnc;

  return (
    <div className="mx-auto max-w-3xl">
      <Link href={`/paginas/${id}`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> {page.name}</Link>
      <PageHeader title="Conexión con Facebook" description="Autorizá la app para publicar en una Página de Facebook que administrás." />

      {sp.error && <p role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{ERRORS[sp.error] ?? "Ocurrió un error al conectar."}</p>}

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2 text-base">Estado <ConnectionBadge status={page.connectionStatus} /></CardTitle>
          {connected && <CardDescription>Página: <span className="font-medium text-foreground">{page.facebookPageName ?? "—"}</span> · ID <span className="font-mono text-xs">{page.facebookPageId}</span>{page.lastCheckedAt ? ` · verificada ${page.lastCheckedAt.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}` : ""}</CardDescription>}
        </CardHeader>
        <CardContent className="space-y-4">
          {connected && <ConnectionActions pageId={id} />}
          {page.connectionStatus === "EXPIRED" && <p className="text-sm text-warning">El token venció o fue revocado. Volvé a conectar para reanudar las publicaciones.</p>}
          {cfg ? (
            <Button asChild variant={connected ? "outline" : "default"}><a href={`/api/meta/oauth/start?pageId=${id}`}>{connected ? "Reconectar con Facebook" : "Conectar con Facebook"}</a></Button>
          ) : (
            <div className="flex gap-3 rounded-lg bg-muted p-3 text-sm">
              <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="font-medium">Meta no está configurado</p>
                <p className="text-muted-foreground">Creá una app en developers.facebook.com y definí <code>META_APP_ID</code> y <code>META_APP_SECRET</code> en el entorno. Los pasos, permisos y limitaciones están en <code>docs/META.md</code>.</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {sp.step === "choose" && (
        <Card>
          <CardHeader><CardTitle className="text-base">Elegí la Página a conectar</CardTitle><CardDescription>Se listan las Páginas que administrás con tu cuenta. El token se guarda cifrado.</CardDescription></CardHeader>
          <CardContent>
            {pending.length === 0
              ? <p className="text-sm text-muted-foreground">No hay Páginas disponibles o la sesión venció (15 min). Volvé a iniciar la conexión. Tu cuenta debe tener un rol con la tarea CREATE_CONTENT en la Página.</p>
              : <ChoosePages pageId={id} pages={pending} />}
          </CardContent>
        </Card>
      )}

      {cfg && (
        <Card className="mt-4">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="size-4" /> Datos para configurar tu app de Meta</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div><span className="text-muted-foreground">URI de redirección OAuth válida:</span> <code className="break-all text-xs">{cfg.redirectUri}</code></div>
            <div><span className="text-muted-foreground">Versión de Graph API:</span> <code className="text-xs">{cfg.version}</code></div>
            <div><span className="text-muted-foreground">Permisos solicitados:</span> <code className="text-xs">{cfg.scopes.join(", ")}</code></div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
