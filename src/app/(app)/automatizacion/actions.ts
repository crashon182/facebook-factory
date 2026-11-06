"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { enqueuePageRun } from "@/lib/queue/automation-queue";
import { getMonitorSnapshot, isQueueName, QUEUES, type MonitorSnapshot } from "@/lib/services/monitoring";
import { logActivity } from "@/lib/services/activity";
import type { ActionResult } from "@/lib/action-result";

export async function getMonitorAction(): Promise<MonitorSnapshot> {
  await requireAdmin();
  return getMonitorSnapshot();
}

/** Ejecuta ahora la automatización de una página (ignora la frecuencia, respeta pausa, presupuesto y límites). */
export async function runPageNowAction(pageId: string): Promise<ActionResult<null>> {
  const user = await requireAdmin();
  if (!(await rateLimit(`automation:run:${user.id}`, 10, 60_000)).ok) return { ok: false, error: "Demasiadas ejecuciones seguidas." };
  const rule = await prisma.automationRule.findUnique({ where: { pageId } });
  if (!rule) return { ok: false, error: "La página no tiene reglas de automatización." };
  if (!rule.enabled) return { ok: false, error: "Activá la automatización de la página para ejecutarla." };
  try {
    await enqueuePageRun(pageId, true);
    await logActivity({ action: "automation.run_requested", message: "Ejecución manual de la automatización solicitada", pageId });
    revalidatePath("/automatizacion");
    return { ok: true, data: null };
  } catch {
    return { ok: false, error: "No se pudo encolar (Redis no disponible)." };
  }
}

export async function retryFailedJobAction(queue: string, jobId: string): Promise<ActionResult<null>> {
  await requireAdmin();
  if (!isQueueName(queue)) return { ok: false, error: "Cola desconocida." };
  const job = await QUEUES[queue]().getJob(jobId);
  if (!job) return { ok: false, error: "El trabajo ya no existe." };
  try {
    await job.retry();
    return { ok: true, data: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message.slice(0, 200) };
  }
}

export async function removeFailedJobAction(queue: string, jobId: string): Promise<ActionResult<null>> {
  await requireAdmin();
  if (!isQueueName(queue)) return { ok: false, error: "Cola desconocida." };
  await (await QUEUES[queue]().getJob(jobId))?.remove().catch(() => {});
  return { ok: true, data: null };
}
