import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Layers, Plus, ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ActiveBadge, AutomationBadge, ConnectionBadge } from "@/components/shared/status-badges";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listPages } from "@/lib/services/pages";
import { getAutomationsPaused } from "@/lib/services/settings";
import { listQuerySchema } from "@/lib/validation/page";
import { PageFilters } from "./filters";
import { PageRowActions } from "./row-actions";

export const metadata: Metadata = { title: "Páginas" };

export default async function PagesRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const parsed = listQuerySchema.safeParse(Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])));
  const query = parsed.success ? parsed.data : listQuerySchema.parse({});
  const [{ items, total, pageCount }, paused] = await Promise.all([listPages(query), getAutomationsPaused()]);
  const filtered = !!(query.q || query.status !== "all" || query.connection !== "all");

  const href = (p: number) => {
    const n = new URLSearchParams();
    if (query.q) n.set("q", query.q);
    if (query.status !== "all") n.set("status", query.status);
    if (query.connection !== "all") n.set("connection", query.connection);
    n.set("page", String(p));
    return `/paginas?${n}`;
  };

  return (
    <>
      <PageHeader
        title="Páginas"
        description={`${total} ${total === 1 ? "página" : "páginas"} ${filtered ? "con los filtros aplicados" : "administradas"}`}
        actions={<Button asChild><Link href="/paginas/nueva"><Plus /> Nueva página</Link></Button>}
      />
      <div className="space-y-4">
        <Suspense fallback={<Skeleton className="h-9 w-full" />}>
          <PageFilters />
        </Suspense>
        {items.length === 0 ? (
          <EmptyState
            icon={Layers}
            title={filtered ? "Sin resultados" : "Todavía no hay páginas"}
            description={filtered ? "Probá con otros filtros o términos de búsqueda." : "Creá tu primera página de trabajo para empezar a definir su estrategia editorial."}
            action={!filtered && <Button asChild><Link href="/paginas/nueva"><Plus /> Crear página</Link></Button>}
          />
        ) : (
          <Card className="overflow-hidden py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Página</TableHead>
                  <TableHead className="hidden md:table-cell">Temática</TableHead>
                  <TableHead>Conexión</TableHead>
                  <TableHead className="hidden sm:table-cell">Estado</TableHead>
                  <TableHead className="hidden lg:table-cell">Automatización</TableHead>
                  <TableHead className="hidden lg:table-cell text-right">Contenidos</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Link href={`/paginas/${p.id}`} className="flex items-center gap-3 font-medium hover:underline">
                        <span className="size-8 shrink-0 rounded-lg" style={{ background: `linear-gradient(135deg, ${p.primaryColor ?? "#4f46e5"}, ${p.secondaryColor ?? "#7c3aed"})` }} />
                        {p.name}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden max-w-56 truncate text-muted-foreground md:table-cell">{p.topic}</TableCell>
                    <TableCell><ConnectionBadge status={p.connectionStatus} /></TableCell>
                    <TableCell className="hidden sm:table-cell"><ActiveBadge active={p.isActive} /></TableCell>
                    <TableCell className="hidden lg:table-cell"><AutomationBadge enabled={!!p.automation?.enabled} paused={paused} /></TableCell>
                    <TableCell className="hidden text-right tabular-nums lg:table-cell">{p._count.posts}</TableCell>
                    <TableCell>
                      <PageRowActions id={p.id} name={p.name} isActive={p.isActive} automationEnabled={!!p.automation?.enabled} />
                    </TableCell>
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
