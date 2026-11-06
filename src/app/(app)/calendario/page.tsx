import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Suspense } from "react";
import { prisma } from "@/lib/db";
import { isOpenAIConfigured } from "@/lib/integrations/openai/client";
import { isViewKey, monthGrid, shiftKey, viewRange, viewRangeUtc, weekStartKey, type CalendarView } from "@/lib/calendar";
import { addDaysKey, dayKey, formatInTz, startOfDayUtc } from "@/lib/time/tz";
import { GenerateDialog } from "../contenidos/generate-dialog";
import { CalendarFilters } from "./filters";
import { ItemChip, type CalItem } from "./item-chip";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Calendario" };

const VIEW_LABEL: Record<CalendarView, string> = { month: "Mensual", week: "Semanal", day: "Diaria", list: "Lista" };
const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const FORMATS = ["TEXT", "IMAGE", "QUOTE_IMAGE", "REEL", "REFLECTION", "EDUCATIONAL", "INSPIRATIONAL", "SHORT_STORY"];
const STATUSES = ["SCHEDULED", "PUBLISHING", "PUBLISHED", "FAILED"];

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const pages = await prisma.socialPage.findMany({ where: { isActive: true }, select: { id: true, name: true, timezone: true }, orderBy: { name: "asc" } });
  const pageFilter = pages.find((p) => p.id === sp.pageId);
  // Zona de visualización: la de la página filtrada o, si no hay filtro, la de la primera página.
  const tz = pageFilter?.timezone ?? pages[0]?.timezone ?? "America/Argentina/Buenos_Aires";
  const view: CalendarView = isViewKey(sp.view) ? sp.view : "month";
  const todayKey = dayKey(new Date(), tz);
  const key = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : todayKey;

  const { from, to } = viewRangeUtc(view, key, tz);
  const format = FORMATS.includes(sp.format ?? "") ? sp.format : undefined;
  const status = STATUSES.includes(sp.status ?? "") ? sp.status : undefined;
  const rows = await prisma.contentPost.findMany({
    where: {
      ...(pageFilter ? { pageId: pageFilter.id } : {}),
      ...(format ? { format: format as never } : {}),
      ...(status ? { status: status as never } : {}),
      OR: [{ scheduledAt: { gte: from, lt: to } }, { publishedAt: { gte: from, lt: to } }],
    },
    include: { page: { select: { name: true } } },
    orderBy: { scheduledAt: "asc" },
    take: 500,
  });
  const items: CalItem[] = rows.map((r) => {
    const at = r.publishedAt ?? r.scheduledAt!;
    return { id: r.id, title: r.internalTitle, pageName: r.page.name, format: r.format, status: r.status, timeLabel: formatInTz(at, tz, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }), dayKey: dayKey(at, tz), sortKey: at.getTime() };
  });
  const byDay = new Map<string, CalItem[]>();
  for (const it of items) byDay.set(it.dayKey, [...(byDay.get(it.dayKey) ?? []), it].sort((a, b) => a.sortKey - b.sortKey));

  const qs = (o: Record<string, string>) => {
    const n = new URLSearchParams();
    for (const k of ["pageId", "format", "status"] as const) if (sp[k]) n.set(k, sp[k]!);
    n.set("view", o.view ?? view);
    n.set("date", o.date ?? key);
    return `/calendario?${n}`;
  };
  const title = view === "month" ? formatInTz(startOfDayUtc(key.slice(0, 8) + "01", tz), tz, { month: "long", year: "numeric" })
    : view === "day" ? formatInTz(startOfDayUtc(key, tz), tz, { dateStyle: "full" })
    : `${formatInTz(startOfDayUtc(viewRange(view, key).fromKey, tz), tz, { day: "numeric", month: "short" })} – ${formatInTz(startOfDayUtc(addDaysKey(viewRange(view, key).toKey, -1), tz), tz, { day: "numeric", month: "short", year: "numeric" })}`;
  const create = (dk: string, compact = true) => <GenerateDialog pages={pages} configured={isOpenAIConfigured()} defaultPageId={pageFilter?.id} presetDay={dk} compact={compact} />;
  const dayLabel = (dk: string) => formatInTz(startOfDayUtc(dk, tz), tz, { weekday: "long", day: "numeric", month: "long" });

  return (
    <>
      <PageHeader title="Calendario editorial" description={`Horarios mostrados en ${tz}. Se guardan en UTC y cada página publica en su propia zona.`} />
      <div className="space-y-4">
        <Suspense fallback={null}><CalendarFilters pages={pages.map((p) => ({ id: p.id, name: p.name }))} pageId={pageFilter?.id} /></Suspense>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" asChild aria-label="Anterior"><Link href={qs({ date: shiftKey(view, key, -1) })}><ChevronLeft /></Link></Button>
            <Button variant="outline" size="icon" asChild aria-label="Siguiente"><Link href={qs({ date: shiftKey(view, key, 1) })}><ChevronRight /></Link></Button>
            <Button variant="outline" asChild><Link href={qs({ date: todayKey })}>Hoy</Link></Button>
          </div>
          <h2 className="ml-2 text-lg font-semibold first-letter:uppercase">{title}</h2>
          <div className="ml-auto flex gap-1 rounded-lg bg-muted p-1">
            {(Object.keys(VIEW_LABEL) as CalendarView[]).map((v) => (
              <Button key={v} size="sm" variant={v === view ? "default" : "ghost"} asChild><Link href={qs({ view: v })}>{VIEW_LABEL[v]}</Link></Button>
            ))}
          </div>
        </div>

        {pages.length === 0 && <EmptyState icon={CalendarDays} title="No hay páginas activas" description="Creá una página para empezar a programar contenido." />}

        {pages.length > 0 && view === "month" && (
          <div className="overflow-x-auto rounded-xl border">
            <div className="min-w-[44rem]">
              <div className="grid grid-cols-7 border-b bg-muted/50 text-center text-xs font-medium text-muted-foreground">{WEEKDAYS.map((d) => <div key={d} className="py-2">{d}</div>)}</div>
              {monthGrid(key).weeks.map((w, i) => (
                <div key={i} className="grid grid-cols-7 border-b last:border-b-0">
                  {w.map((d) => {
                    const list = byDay.get(d.key) ?? [];
                    return (
                      <div key={d.key} className={cn("group min-h-28 space-y-1 border-r p-1.5 last:border-r-0", !d.inMonth && "bg-muted/30 text-muted-foreground", d.key === todayKey && "bg-primary/5")}>
                        <div className="flex items-center justify-between">
                          <Link href={qs({ view: "day", date: d.key })} className={cn("flex size-6 items-center justify-center rounded-full text-xs hover:bg-accent", d.key === todayKey && "bg-primary text-primary-foreground hover:bg-primary")}>{Number(d.key.slice(8))}</Link>
                          {create(d.key)}
                        </div>
                        {list.slice(0, 3).map((it) => <ItemChip key={it.id} item={it} />)}
                        {list.length > 3 && <Link href={qs({ view: "day", date: d.key })} className="block px-1 text-[11px] text-muted-foreground hover:underline">+{list.length - 3} más</Link>}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}

        {pages.length > 0 && view === "week" && (
          <div className="grid gap-3 md:grid-cols-7">
            {Array.from({ length: 7 }, (_, i) => addDaysKey(weekStartKey(key), i)).map((dk, i) => (
              <div key={dk} className={cn("group min-h-40 space-y-1.5 rounded-xl border p-2", dk === todayKey && "border-primary/50 bg-primary/5")}>
                <div className="flex items-center justify-between text-xs font-medium"><Link href={qs({ view: "day", date: dk })} className="hover:underline">{WEEKDAYS[i]} {Number(dk.slice(8))}</Link>{create(dk)}</div>
                {(byDay.get(dk) ?? []).map((it) => <ItemChip key={it.id} item={it} />)}
              </div>
            ))}
          </div>
        )}

        {pages.length > 0 && view === "day" && (
          <div className="group space-y-2 rounded-xl border p-4">
            <div className="flex items-center justify-between"><h3 className="font-medium first-letter:uppercase">{dayLabel(key)}</h3>{create(key, false)}</div>
            {(byDay.get(key) ?? []).length === 0
              ? <p className="py-8 text-center text-sm text-muted-foreground">No hay publicaciones para este día.</p>
              : (byDay.get(key) ?? []).map((it) => <ItemChip key={it.id} item={it} wide />)}
          </div>
        )}

        {pages.length > 0 && view === "list" && (
          items.length === 0
            ? <EmptyState icon={CalendarDays} title="Sin publicaciones en este período" description="Programá contenidos listos y aprobados desde su editor o con «Programar automáticamente»." />
            : <div className="space-y-4">
                {[...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dk, list]) => (
                  <div key={dk} className="space-y-1.5">
                    <h3 className="text-sm font-medium capitalize text-muted-foreground first-letter:uppercase">{dayLabel(dk)}</h3>
                    {list.map((it) => <ItemChip key={it.id} item={it} wide />)}
                  </div>
                ))}
              </div>
        )}

        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {[["Programado", "bg-warning/40"], ["Publicado", "bg-success/40"], ["Con error", "bg-destructive/40"], ["Publicando", "bg-primary/40"]].map(([l, c]) => <span key={l} className="flex items-center gap-1.5"><span className={`size-2.5 rounded-sm ${c}`} />{l}</span>)}
        </div>
      </div>
    </>
  );
}
