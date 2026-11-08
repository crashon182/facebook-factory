"use client";

import { Copy, ExternalLink, ScrollText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LEGAL_DOCS, LEGAL_LABELS, legalPath } from "@/lib/legal";

/** URLs públicas que Meta pide al configurar la app (Política de privacidad, Condiciones, Eliminación de datos). */
export function LegalLinks({ slug, baseUrl }: { slug: string; baseUrl: string }) {
  const base = baseUrl.replace(/\/+$/, "");
  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("URL copiada");
    } catch {
      toast.error("No se pudo copiar; seleccionala a mano");
    }
  }
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><ScrollText className="size-4" /> Páginas legales para Meta</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">Pegá estas URLs en la configuración de tu app de Meta (Configuración › Básica).</p>
        {LEGAL_DOCS.map((doc) => {
          const url = `${base}${legalPath(slug, doc)}`;
          return (
            <div key={doc} className="space-y-1">
              <div className="font-medium">{LEGAL_LABELS[doc]}</div>
              <div className="flex items-center gap-1.5">
                <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs" title={url}>{url}</code>
                <Button type="button" variant="outline" size="icon" className="size-8 shrink-0" onClick={() => copy(url)} aria-label={`Copiar ${LEGAL_LABELS[doc]}`}><Copy /></Button>
                <Button asChild variant="outline" size="icon" className="size-8 shrink-0"><a href={url} target="_blank" rel="noreferrer" aria-label={`Abrir ${LEGAL_LABELS[doc]}`}><ExternalLink /></a></Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
