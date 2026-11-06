"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, Search, PlayCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/shared/empty-state";
import type { MediaCandidate, MediaSearchResult } from "@/lib/integrations/media/types";
import { importMediaAction, searchMediaAction } from "./actions";

export type ProviderInfo = { id: string; name: string; configured: boolean; attribution?: { text: string; url: string } };

export function SearchTab({ providers }: { providers: ProviderInfo[] }) {
  const router = useRouter();
  const firstConfigured = providers.find((p) => p.configured) ?? providers[0];
  const [providerId, setProviderId] = useState(firstConfigured.id);
  const [language, setLanguage] = useState("es");
  const provider = providers.find((p) => p.id === providerId) ?? firstConfigured;
  const providerName = provider.name;
  const configured = provider.configured;
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("video");
  const [orientation, setOrientation] = useState("portrait");
  const [quality, setQuality] = useState("medium");
  const [result, setResult] = useState<MediaSearchResult | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function search(page = 1) {
    start(async () => {
      const res = await searchMediaAction({ provider: providerId, language: providerId === "pixabay" ? language : undefined, query, kind, orientation: orientation === "any" ? undefined : orientation, quality, page });
      if (res.ok) setResult(res.data);
      else toast.error(res.error);
    });
  }
  async function save(c: MediaCandidate) {
    setSaving(c.externalId);
    const res = await importMediaAction(c);
    setSaving(null);
    if (res.ok) {
      toast.success(res.data.duplicate ? "Ya estaba en la biblioteca" : "Guardado en la biblioteca");
      router.refresh();
    } else toast.error(res.error);
  }

  return (
    <div className="space-y-4">
      {providers.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Proveedor:</span>
          {providers.map((p) => (
            <Button key={p.id} type="button" size="sm" variant={p.id === providerId ? "default" : "outline"} onClick={() => { setProviderId(p.id); setResult(null); }}>
              {p.name}{!p.configured && " (sin configurar)"}
            </Button>
          ))}
        </div>
      )}
      {!configured && (
        <EmptyState icon={Search} title={`${providerName} no está configurado`} description={`Definí la API key de ${providerName} en el entorno (${providerId === "pixabay" ? "PIXABAY_API_KEY" : "PEXELS_API_KEY"}) para buscar fotos y videos. Mientras tanto podés subir tus propios archivos con licencia.`} />
      )}
      {configured && <form onSubmit={(e) => { e.preventDefault(); search(); }} className="flex flex-col gap-3 lg:flex-row">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ej.: amanecer, oración, montañas…" maxLength={100} aria-label="Buscar" className="flex-1" />
        <Select value={kind} onValueChange={setKind}><SelectTrigger className="w-full lg:w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="video">Videos</SelectItem><SelectItem value="photo">Fotos</SelectItem></SelectContent></Select>
        <Select value={orientation} onValueChange={setOrientation}><SelectTrigger className="w-full lg:w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="portrait">Vertical</SelectItem><SelectItem value="landscape">Horizontal</SelectItem><SelectItem value="square">Cuadrado</SelectItem><SelectItem value="any">Cualquiera</SelectItem></SelectContent></Select>
        <Select value={quality} onValueChange={setQuality}><SelectTrigger className="w-full lg:w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="small">HD (720)</SelectItem><SelectItem value="medium">Full HD</SelectItem><SelectItem value="large">Máxima</SelectItem></SelectContent></Select>
        {providerId === "pixabay" && (
          <Select value={language} onValueChange={setLanguage}><SelectTrigger className="w-full lg:w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="es">Español</SelectItem><SelectItem value="en">Inglés</SelectItem><SelectItem value="pt">Portugués</SelectItem></SelectContent></Select>
        )}
        <Button type="submit" disabled={pending || query.trim().length < 2}>{pending ? <Loader2 className="animate-spin" /> : <Search />} Buscar en {providerName}</Button>
      </form>}

      {result && result.items.length === 0 && <EmptyState icon={Search} title="Sin resultados" description="Probá con otras palabras clave (en inglés suele haber más resultados)." />}
      {result && result.items.length > 0 && (
        <>
          <p className="text-xs text-muted-foreground">
            {provider.attribution && <><a href={provider.attribution.url} target="_blank" rel="noreferrer noopener" className="font-medium hover:underline">{provider.attribution.text}</a> · </>}
            {result.total.toLocaleString("es-AR")} resultados{result.rateLimitRemaining !== null ? ` · ${result.rateLimitRemaining} solicitudes restantes en la ventana de ${providerName}` : ""}</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {result.items.map((c) => (
              <div key={c.externalId} className="group overflow-hidden rounded-xl border bg-card">
                <div className="relative aspect-[3/4] bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={c.previewUrl} alt={c.title ?? c.author ?? "Vista previa"} loading="lazy" className="size-full object-cover" referrerPolicy="no-referrer" />
                  {c.kind === "video" && <Badge className="absolute left-2 top-2 gap-1"><PlayCircle className="size-3" /> {Math.round(c.durationSec ?? 0)}s</Badge>}
                </div>
                <div className="space-y-2 p-3 text-xs">
                  <div className="flex items-center justify-between text-muted-foreground"><span>{c.width}×{c.height}</span><a href={c.sourceUrl} target="_blank" rel="noreferrer noopener" className="hover:underline">{c.author}</a></div>
                  <Button size="sm" className="w-full" disabled={saving === c.externalId} onClick={() => save(c)}>
                    {saving === c.externalId ? <Loader2 className="animate-spin" /> : <Download />} Guardar
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-center gap-2">
            <Button variant="outline" size="sm" disabled={pending || result.page <= 1} onClick={() => search(result.page - 1)}>Anterior</Button>
            <Button variant="outline" size="sm" disabled={pending || result.page * result.perPage >= result.total} onClick={() => search(result.page + 1)}>Siguiente</Button>
          </div>
        </>
      )}
    </div>
  );
}
