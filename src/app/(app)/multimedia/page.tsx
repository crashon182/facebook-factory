import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getDefaultProvider, listProviders } from "@/lib/integrations/media";
import { listAssets } from "@/lib/services/media";
import { LibraryTab } from "./library-tab";
import { SearchTab } from "./search-tab";
import { UploadTab } from "./upload-tab";

export const metadata: Metadata = { title: "Multimedia" };

const TYPES = ["all", "PHOTO", "VIDEO", "AUDIO", "RENDERED_IMAGE"] as const;
const LABELS: Record<string, string> = { all: "Todo", PHOTO: "Fotos", VIDEO: "Videos", AUDIO: "Audio", RENDERED_IMAGE: "Imágenes generadas" };

export default async function MediaPage({ searchParams }: { searchParams: Promise<{ tab?: string; type?: string; page?: string; q?: string }> }) {
  const sp = await searchParams;
  const type = (TYPES as readonly string[]).includes(sp.type ?? "") ? (sp.type as (typeof TYPES)[number]) : "all";
  const page = Math.max(1, Number(sp.page) || 1);
  const { items, total, pageCount } = await listAssets({ type, page, q: sp.q?.slice(0, 100) });
  const providers = listProviders().map((p) => ({ id: p.id, name: p.name, configured: p.isConfigured(), attribution: p.attribution }));
  const anyConfigured = !!getDefaultProvider();
  const tab = ["biblioteca", "buscar", "subir"].includes(sp.tab ?? "") ? sp.tab! : "biblioteca";
  const href = (o: Record<string, string>) => `/multimedia?${new URLSearchParams({ tab: "biblioteca", type, ...o })}`;

  return (
    <>
      <PageHeader title="Multimedia" description="Biblioteca de fotos, videos y audio con su autor y licencia. Proveedor de búsqueda intercambiable." />
      <Tabs defaultValue={tab}>
        <TabsList>
          <TabsTrigger value="biblioteca">Biblioteca ({total})</TabsTrigger>
          <TabsTrigger value="buscar">Buscar fotos y videos{anyConfigured ? "" : " (sin proveedor)"}</TabsTrigger>
          <TabsTrigger value="subir">Subir archivo</TabsTrigger>
        </TabsList>
        <TabsContent value="biblioteca" className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            {TYPES.map((t) => <Button key={t} size="sm" variant={t === type ? "default" : "outline"} asChild><Link href={href({ type: t })}>{LABELS[t]}</Link></Button>)}
          </div>
          <LibraryTab assets={items.map((a) => ({ id: a.id, type: a.type, provider: a.provider, title: a.title, author: a.author, authorUrl: a.authorUrl, sourceUrl: a.sourceUrl, license: a.license, localPath: a.localPath, thumbPath: a.thumbPath, width: a.width, height: a.height, durationMs: a.durationMs, sizeBytes: a.sizeBytes }))} />
          {pageCount > 1 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Página {page} de {pageCount}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} asChild={page > 1}>{page > 1 ? <Link href={href({ page: String(page - 1) })}>Anterior</Link> : <span>Anterior</span>}</Button>
                <Button variant="outline" size="sm" disabled={page >= pageCount} asChild={page < pageCount}>{page < pageCount ? <Link href={href({ page: String(page + 1) })}>Siguiente</Link> : <span>Siguiente</span>}</Button>
              </div>
            </div>
          )}
        </TabsContent>
        <TabsContent value="buscar" className="mt-4"><SearchTab providers={providers} /></TabsContent>
        <TabsContent value="subir" className="mt-4"><UploadTab /></TabsContent>
      </Tabs>
    </>
  );
}
