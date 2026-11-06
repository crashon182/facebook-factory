import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { getMonitorSnapshot } from "@/lib/services/monitoring";
import { MonitorPanel } from "./monitor-panel";

export const metadata: Metadata = { title: "Automatización" };

export default async function AutomationPage() {
  const [snapshot, activity] = await Promise.all([
    getMonitorSnapshot(),
    prisma.activityLog.findMany({ where: { action: { startsWith: "automation." } }, orderBy: { createdAt: "desc" }, take: 10, include: { page: { select: { name: true } } } }),
  ]);
  return (
    <>
      <PageHeader title="Automatización y monitoreo" description="Estado de los procesos, las colas y la automatización de cada página." />
      <MonitorPanel initial={snapshot} />
      <Card className="mt-6">
        <CardHeader><CardTitle className="text-base">Actividad de la automatización</CardTitle></CardHeader>
        <CardContent>
          {activity.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">Todavía no hubo corridas.</p> : (
            <ul className="divide-y">
              {activity.map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-2 text-sm">
                  <span className={`size-2 shrink-0 rounded-full ${a.level === "ERROR" ? "bg-destructive" : a.level === "WARN" ? "bg-warning" : "bg-success"}`} />
                  <span className="min-w-0 flex-1 truncate">{a.page ? `${a.page.name}: ` : ""}{a.message}</span>
                  <time className="shrink-0 text-xs text-muted-foreground">{a.createdAt.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}</time>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
