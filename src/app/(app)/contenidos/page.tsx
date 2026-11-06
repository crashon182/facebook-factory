import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { PostStatusBadge } from "@/components/shared/content-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FORMAT_LABELS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { isOpenAIConfigured } from "@/lib/integrations/openai/client";
import { listContents } from "@/lib/services/contents";
import { contentListQuerySchema } from "@/lib/validation/content";
import { ContentFilters } from "./filters";
import { GenerateDialog } from "./generate-dialog";

export const metadata: Metadata = { title: "Contenidos" };

export default async function ContentsRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const parsed = contentListQuerySchema.safeParse(Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])));
  const query = parsed.success ? parsed.data : contentListQuerySchema.parse({});
  const [{ items, total, pageCount }, pages] = await Promise.all([
    listContents(query),
    prisma.socialPage.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const filtered = !!(query.q || query.pageId || query.status !== "all" || query.format !== "all");
  const href = (p: number) => {
    const n = new URLSearchParams(Object.entries(sp).filter(([, v]) => typeof v === "string") as [string, string][]);
    n.set("page", String(p));
    return `/contenidos?${n}`;
  };

  return (
    <>
      <PageHeader
        title="Contenidos"
        description={`${total} ${total === 1 ? "contenido" : "contenidos"}${filtered ? " con los filtros aplicados" : ""}`}
        actions={<GenerateDialog pages={pages} configured={isOpenAIConfigured()} defaultPageId={query.pageId} />}
      />
      <div className="space-y-4">
        <Suspense fallback={<Skeleton className="h-9 w-full" />}>
          <ContentFilters pages={pages.map((p) => ({ id: p.id, name: p.name }))} />
        </Suspense>
        {items.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={filtered ? "Sin resultados" : "Todavía no hay contenidos"}
            description={filtered ? "Probá con otros filtros." : pages.length ? "Generá tu primer contenido con IA o creá un borrador manual." : "Primero creá una página para poder generar contenidos."}
          />
        ) : (
          <Card className="overflow-hidden py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Título</TableHead>
                  <TableHead className="hidden md:table-cell">Página</TableHead>
                  <TableHead className="hidden sm:table-cell">Formato</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="hidden lg:table-cell text-right">Creado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="max-w-xs">
                      <Link href={`/contenidos/${c.id}`} className="block truncate font-medium hover:underline">{c.internalTitle}</Link>
                      {c.topic && <span className="block truncate text-xs text-muted-foreground">{c.topic}</span>}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{c.page.name}</TableCell>
                    <TableCell className="hidden sm:table-cell"><Badge variant="secondary" className="font-normal">{FORMAT_LABELS[c.format]}</Badge></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <PostStatusBadge status={c.status} />
                        {c.approved && <Badge variant="outline" className="border-success/30 text-success">Aprobado</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-right text-xs text-muted-foreground lg:table-cell">{c.createdAt.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {pageCount > 1 && (
              <div className="flex items-center justify-between border-t px-4 py-3 text-sm">
                <span className="text-muted-foreground">Página {query.page} de {pageCount}</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" asChild={query.page > 1} disabled={query.page <= 1}>
                    {query.page > 1 ? <Link href={href(query.page - 1)}><ChevronLeft /> Anterior</Link> : <span><ChevronLeft /> Anterior</span>}
                  </Button>
                  <Button variant="outline" size="sm" asChild={query.page < pageCount} disabled={query.page >= pageCount}>
                    {query.page < pageCount ? <Link href={href(query.page + 1)}>Siguiente <ChevronRight /></Link> : <span>Siguiente <ChevronRight /></span>}
                  </Button>
                </div>
              </div>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
