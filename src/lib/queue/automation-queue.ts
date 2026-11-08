import { Queue } from "bullmq";
import { createRedisConnection } from "./connection";

export const AUTOMATION_QUEUE = "automation";

let queue: Queue | null = null;
export function getAutomationQueue() {
  queue ??= new Queue(AUTOMATION_QUEUE, { connection: createRedisConnection() });
  return queue;
}

const opts = { removeOnComplete: 200, removeOnFail: 200, attempts: 1 };

/** Una corrida por página y por franja de 5 minutos: evita apilar corridas duplicadas. */
export async function enqueuePageRun(pageId: string, force = false, now = Date.now()) {
  const bucket = force ? `force-${now}` : String(Math.floor(now / 300_000));
  return getAutomationQueue().add("page-run", { pageId, force }, { ...opts, jobId: `page-run-${pageId}-${bucket}` });
}

export async function enqueuePostprocess(postId: string) {
  return getAutomationQueue().add("postprocess", { postId }, { ...opts, attempts: 2, backoff: { type: "exponential", delay: 30_000 }, jobId: `postprocess-${postId}` });
}

/** Recopilación de métricas de una página (una por franja de 30 min salvo `force`). */
export async function enqueueCollect(pageId: string, force = false, now = Date.now()) {
  const bucket = force ? `force-${now}` : String(Math.floor(now / 1_800_000));
  return getAutomationQueue().add("collect-page", { pageId, force }, { ...opts, jobId: `collect-${pageId}-${bucket}` });
}

/** Informe semanal con IA de una página. */
export async function enqueueReport(pageId: string, force = false, now = Date.now()) {
  const bucket = force ? `force-${now}` : String(Math.floor(now / 3_600_000));
  return getAutomationQueue().add("report-page", { pageId, force }, { ...opts, jobId: `report-${pageId}-${bucket}` });
}

/** Definiciones periódicas (idempotentes): con varias instancias del planificador existe una sola de cada una. */
export async function ensureAutomationSchedulers(tickMs = Number(process.env.AUTOMATION_TICK_MS) || 300_000) {
  const q = getAutomationQueue();
  await q.upsertJobScheduler("automation-tick", { every: tickMs }, { name: "tick", opts: { removeOnComplete: 20, removeOnFail: 20 } });
  await q.upsertJobScheduler("metrics-collect", { pattern: "15 */6 * * *" }, { name: "collect-metrics", opts: { removeOnComplete: 20, removeOnFail: 20 } });
  await q.upsertJobScheduler("weekly-reports", { pattern: "0 8 * * 1" }, { name: "weekly-reports", opts: { removeOnComplete: 10, removeOnFail: 10 } });
  await q.upsertJobScheduler("optimize-daily", { pattern: "45 4 * * *" }, { name: "optimize", opts: { removeOnComplete: 10, removeOnFail: 10 } });
  await q.upsertJobScheduler("maintenance-daily", { pattern: "30 3 * * *" }, { name: "maintenance", opts: { removeOnComplete: 10, removeOnFail: 10 } });
}
