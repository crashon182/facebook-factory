import "server-only";
import { prisma } from "@/lib/db";
import type { OptimizationExperiment, Prisma } from "@/generated/prisma/client";
import { bestHour, engagementRate, hourPerformance, judgeExperiment, proposeWindowShift, scorePosts } from "@/lib/analytics/stats";
import { getPostSamples } from "./analytics";
import { logActivity } from "./activity";

export const WINDOW_VARIABLE = "posting_window";
const DAY = 24 * 3600_000;
export const EXPERIMENT_DAYS = 7;
const COOLDOWN_DAYS = 7;
const LOOKBACK_DAYS = 60;

export class ExperimentError extends Error {}

export type WindowChange = { windowStart: string; windowEnd: string };
export type WindowResult = { before: WindowChange; after: WindowChange; shiftMin: number; bestHour: number; extended?: number; verdict?: string; beforeAvg?: number | null; afterAvg?: number | null; changePct?: number | null; note?: string };

const asResult = (e: Pick<OptimizationExperiment, "result">) => (e.result ?? {}) as unknown as WindowResult;
const toJson = (r: WindowResult) => r as unknown as Prisma.InputJsonValue;

async function setWindow(pageId: string, w: WindowChange) {
  await prisma.automationRule.update({ where: { pageId }, data: { windowStart: w.windowStart, windowEnd: w.windowEnd } });
}

/**
 * Propone (o, con `autoOptimizeTimes`, aplica) un desplazamiento gradual de la franja de publicación hacia las horas que
 * mejor rindieron. Reglas de seguridad: ≤ 1 h por experimento, ancho de franja intacto, dentro de 06:00-23:00, no toca el
 * máximo de publicaciones por día ni el presupuesto, un solo experimento activo por página y enfriamiento entre cambios.
 */
export async function proposeTimeExperiment(pageId: string, now = new Date()): Promise<{ created: OptimizationExperiment | null; reason?: string }> {
  const page = await prisma.socialPage.findUnique({ where: { id: pageId }, include: { automation: true } });
  const rule = page?.automation;
  if (!page || !rule) return { created: null, reason: "La página no tiene reglas de automatización." };

  const open = await prisma.optimizationExperiment.findFirst({ where: { pageId, variable: WINDOW_VARIABLE, status: { in: ["PROPOSED", "RUNNING"] } } });
  if (open) return { created: null, reason: "Ya hay un experimento de horario abierto." };
  const recent = await prisma.optimizationExperiment.findFirst({ where: { pageId, variable: WINDOW_VARIABLE, createdAt: { gte: new Date(now.getTime() - COOLDOWN_DAYS * DAY) } } });
  if (recent) return { created: null, reason: "Hubo un experimento de horario hace menos de 7 días." };

  const samples = await getPostSamples(pageId, new Date(now.getTime() - LOOKBACK_DAYS * DAY), now);
  const best = bestHour(hourPerformance(scorePosts(samples), page.timezone));
  const shift = proposeWindowShift({ windowStart: rule.windowStart, windowEnd: rule.windowEnd }, best);
  if (best == null || !shift) return { created: null, reason: best == null ? "Todavía no hay datos suficientes." : "La franja actual ya cubre las mejores horas." };

  const result: WindowResult = {
    before: { windowStart: rule.windowStart, windowEnd: rule.windowEnd },
    after: { windowStart: shift.windowStart, windowEnd: shift.windowEnd },
    shiftMin: shift.shiftMin,
    bestHour: Math.round(best * 10) / 10,
  };
  const hypothesis = `Mover la franja de publicación de ${rule.windowStart}–${rule.windowEnd} a ${shift.windowStart}–${shift.windowEnd} (${shift.shiftMin > 0 ? "+" : ""}${shift.shiftMin} min) mejora la interacción: las publicaciones de las ${Math.round(best)}:00 h rinden mejor.`;

  if (rule.autoOptimizeTimes) {
    await setWindow(pageId, result.after);
    const exp = await prisma.optimizationExperiment.create({ data: { pageId, hypothesis, variable: WINDOW_VARIABLE, status: "RUNNING", startsAt: now, endsAt: new Date(now.getTime() + EXPERIMENT_DAYS * DAY), result: toJson(result) } });
    await logActivity({ action: "analytics.experiment_started", message: `Experimento de horario aplicado automáticamente: ${rule.windowStart}–${rule.windowEnd} → ${shift.windowStart}–${shift.windowEnd}`, pageId, entity: "OptimizationExperiment", entityId: exp.id });
    return { created: exp };
  }
  const exp = await prisma.optimizationExperiment.create({ data: { pageId, hypothesis, variable: WINDOW_VARIABLE, status: "PROPOSED", result: toJson(result) } });
  await logActivity({ action: "analytics.experiment_proposed", message: "Experimento de horario propuesto (requiere aprobación)", pageId, entity: "OptimizationExperiment", entityId: exp.id });
  return { created: exp };
}

/** Aprueba y aplica un experimento propuesto. */
export async function approveExperiment(id: string, now = new Date()) {
  const exp = await prisma.optimizationExperiment.findUnique({ where: { id } });
  if (!exp) throw new ExperimentError("El experimento no existe.");
  if (exp.status !== "PROPOSED") throw new ExperimentError("Solo se pueden aprobar experimentos propuestos.");
  if (exp.variable !== WINDOW_VARIABLE) throw new ExperimentError("Este experimento no se aplica automáticamente: aplicalo manualmente y marcalo como hecho.");
  const running = await prisma.optimizationExperiment.findFirst({ where: { pageId: exp.pageId, variable: WINDOW_VARIABLE, status: "RUNNING" } });
  if (running) throw new ExperimentError("Ya hay un experimento de horario en curso para esta página.");
  const r = asResult(exp);
  const rule = await prisma.automationRule.findUnique({ where: { pageId: exp.pageId } });
  if (!rule) throw new ExperimentError("La página no tiene reglas de automatización.");
  // La franja pudo cambiar a mano desde la propuesta: el "antes" es la actual.
  const result: WindowResult = { ...r, before: { windowStart: rule.windowStart, windowEnd: rule.windowEnd } };
  await setWindow(exp.pageId, r.after);
  const updated = await prisma.optimizationExperiment.update({ where: { id }, data: { status: "RUNNING", startsAt: now, endsAt: new Date(now.getTime() + EXPERIMENT_DAYS * DAY), result: toJson(result) } });
  await logActivity({ action: "analytics.experiment_started", message: `Experimento de horario aprobado: ${result.before.windowStart}–${result.before.windowEnd} → ${r.after.windowStart}–${r.after.windowEnd}`, pageId: exp.pageId, entity: "OptimizationExperiment", entityId: id });
  return updated;
}

/** Revierte un experimento en curso: devuelve la franja anterior (si nadie la cambió a mano mientras tanto). */
export async function revertExperiment(id: string, reason = "Revertido manualmente", now = new Date()) {
  const exp = await prisma.optimizationExperiment.findUnique({ where: { id } });
  if (!exp) throw new ExperimentError("El experimento no existe.");
  if (exp.status !== "RUNNING" && exp.status !== "COMPLETED") throw new ExperimentError("Solo se pueden revertir experimentos en curso o completados.");
  if (exp.variable !== WINDOW_VARIABLE) throw new ExperimentError("Este experimento no modificó ningún ajuste automático.");
  const r = asResult(exp);
  const rule = await prisma.automationRule.findUnique({ where: { pageId: exp.pageId } });
  let note = reason;
  if (rule) {
    if (rule.windowStart === r.after.windowStart && rule.windowEnd === r.after.windowEnd) await setWindow(exp.pageId, r.before);
    else note += " (la franja ya había sido modificada a mano: no se tocó)";
  }
  const updated = await prisma.optimizationExperiment.update({ where: { id }, data: { status: "REVERTED", revertedAt: now, result: toJson({ ...r, note }) } });
  await logActivity({ action: "analytics.experiment_reverted", message: `Experimento revertido: ${note}`, level: "WARN", pageId: exp.pageId, entity: "OptimizationExperiment", entityId: id });
  return updated;
}

/** Descarta una propuesta o marca como hecha una sugerencia manual. */
export async function resolveExperiment(id: string, status: "REJECTED" | "COMPLETED") {
  const exp = await prisma.optimizationExperiment.findUnique({ where: { id } });
  if (!exp) throw new ExperimentError("El experimento no existe.");
  if (exp.status !== "PROPOSED") throw new ExperimentError("Solo se pueden resolver propuestas pendientes.");
  if (status === "COMPLETED" && exp.variable === WINDOW_VARIABLE) throw new ExperimentError("Usá «Aprobar» para aplicar un cambio de horario.");
  return prisma.optimizationExperiment.update({ where: { id }, data: { status } });
}

/** Evalúa los experimentos de horario vencidos: conserva el cambio si no empeoró; si empeoró (o no hay datos tras una prórroga) lo revierte. */
export async function evaluateExperiments(pageId: string, now = new Date()): Promise<{ evaluated: number; reverted: number; extended: number }> {
  const due = await prisma.optimizationExperiment.findMany({ where: { pageId, variable: WINDOW_VARIABLE, status: "RUNNING", endsAt: { lte: now } } });
  const out = { evaluated: 0, reverted: 0, extended: 0 };
  for (const exp of due) {
    const start = exp.startsAt ?? exp.createdAt;
    const end = exp.endsAt ?? now;
    const span = end.getTime() - start.getTime();
    const [beforeS, afterS] = await Promise.all([getPostSamples(pageId, new Date(start.getTime() - 2 * span), start), getPostSamples(pageId, start, end)]);
    const rates = (xs: typeof beforeS) => xs.flatMap((s) => { const r = engagementRate(s); return r == null ? [] : [r]; });
    const j = judgeExperiment(rates(beforeS), rates(afterS));
    const r = asResult(exp);
    const details = { ...r, verdict: j.verdict, beforeAvg: j.beforeAvg, afterAvg: j.afterAvg, changePct: j.changePct };
    out.evaluated++;
    if (j.verdict === "insufficient" && !r.extended) {
      await prisma.optimizationExperiment.update({ where: { id: exp.id }, data: { endsAt: new Date(end.getTime() + EXPERIMENT_DAYS * DAY), result: toJson({ ...details, extended: 1, note: "Datos insuficientes: se extendió una semana." }) } });
      out.extended++;
    } else if (j.verdict === "worse" || j.verdict === "insufficient") {
      await prisma.optimizationExperiment.update({ where: { id: exp.id }, data: { result: toJson(details) } });
      await revertExperiment(exp.id, j.verdict === "worse" ? `La interacción cayó ${Math.abs(j.changePct ?? 0).toFixed(0)}%` : "Datos insuficientes tras la prórroga", now);
      out.reverted++;
    } else {
      await prisma.optimizationExperiment.update({ where: { id: exp.id }, data: { status: "COMPLETED", result: toJson({ ...details, note: j.verdict === "better" ? "Mejoró: el cambio se conserva." : "Sin diferencia relevante: el cambio se conserva." }) } });
      await logActivity({ action: "analytics.experiment_completed", message: `Experimento de horario completado (${j.verdict === "better" ? "mejoró" : "neutral"}${j.changePct != null ? `, ${j.changePct.toFixed(0)}%` : ""})`, pageId, entity: "OptimizationExperiment", entityId: exp.id });
    }
  }
  return out;
}

/** Tarea diaria por página: evaluar lo vencido y, si corresponde, proponer/aplicar el siguiente ajuste. */
export async function runOptimization(pageId: string, now = new Date()) {
  const evaluation = await evaluateExperiments(pageId, now);
  const proposal = await proposeTimeExperiment(pageId, now);
  return { evaluation, proposed: proposal.created?.id ?? null, reason: proposal.reason };
}
