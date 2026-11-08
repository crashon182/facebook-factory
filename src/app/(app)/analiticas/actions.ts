"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { enqueueCollect, enqueueReport } from "@/lib/queue/automation-queue";
import { isOpenAIConfigured } from "@/lib/integrations/openai/client";
import { approveExperiment, ExperimentError, resolveExperiment, revertExperiment } from "@/lib/services/optimization";
import { logActivity } from "@/lib/services/activity";
import type { ActionResult } from "@/lib/action-result";

async function guard(userId: string, key: string): Promise<ActionResult<null> | null> {
  return (await rateLimit(`analytics:${key}:${userId}`, 10, 60_000)).ok ? null : { ok: false, error: "Demasiadas solicitudes seguidas. Esperá un momento." };
}

export async function collectNowAction(pageId: string): Promise<ActionResult<null>> {
  const user = await requireAdmin();
  const limited = await guard(user.id, "collect");
  if (limited) return limited;
  const page = await prisma.socialPage.findUnique({ where: { id: pageId }, select: { connectionStatus: true } });
  if (!page) return { ok: false, error: "La página no existe." };
  if (page.connectionStatus !== "CONNECTED") return { ok: false, error: "Conectá la página a Facebook para recopilar métricas." };
  try {
    await enqueueCollect(pageId, true);
    await logActivity({ action: "analytics.collect_requested", message: "Recopilación de métricas solicitada", pageId });
    revalidatePath("/analiticas");
    return { ok: true, data: null };
  } catch {
    return { ok: false, error: "No se pudo encolar (Redis no disponible)." };
  }
}

export async function generateReportAction(pageId: string): Promise<ActionResult<null>> {
  const user = await requireAdmin();
  const limited = await guard(user.id, "report");
  if (limited) return limited;
  if (!isOpenAIConfigured()) return { ok: false, error: "OpenAI no está configurado (OPENAI_API_KEY)." };
  if (!(await prisma.socialPage.findUnique({ where: { id: pageId }, select: { id: true } }))) return { ok: false, error: "La página no existe." };
  try {
    await enqueueReport(pageId, true);
    await logActivity({ action: "analytics.report_requested", message: "Informe con IA solicitado", pageId });
    revalidatePath("/analiticas");
    return { ok: true, data: null };
  } catch {
    return { ok: false, error: "No se pudo encolar (Redis no disponible)." };
  }
}

export type ExperimentOp = "approve" | "reject" | "revert" | "done";

export async function experimentAction(id: string, op: ExperimentOp): Promise<ActionResult<null>> {
  const user = await requireAdmin();
  const limited = await guard(user.id, "experiment");
  if (limited) return limited;
  try {
    if (op === "approve") await approveExperiment(id);
    else if (op === "revert") await revertExperiment(id);
    else if (op === "reject") await resolveExperiment(id, "REJECTED");
    else if (op === "done") await resolveExperiment(id, "COMPLETED");
    else return { ok: false, error: "Operación desconocida." };
    revalidatePath("/analiticas");
    return { ok: true, data: null };
  } catch (e) {
    if (e instanceof ExperimentError) return { ok: false, error: e.message };
    throw e;
  }
}
