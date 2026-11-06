import { Queue } from "bullmq";
import { createRedisConnection } from "./connection";

export const PUBLISH_QUEUE = "publish";

let queue: Queue | null = null;
export function getPublishQueue() {
  queue ??= new Queue(PUBLISH_QUEUE, { connection: createRedisConnection() });
  return queue;
}

/** jobId por programación: un mismo vencimiento no se encola dos veces. (La garantía real es el reclamo atómico en BD.) */
export async function enqueuePublish(scheduleId: string) {
  return getPublishQueue().add("publish-post", { scheduleId }, { jobId: `publish-${scheduleId}`, attempts: 1, removeOnComplete: true, removeOnFail: 100 });
}

/**
 * Escáner de vencimientos como "job scheduler" de BullMQ: con varias instancias del worker
 * existe una sola definición (upsert por id), así que el escaneo no se duplica.
 */
export async function ensureDueScanner(everyMs = 30_000) {
  await getPublishQueue().upsertJobScheduler("due-scanner", { every: everyMs }, { name: "scan-due", opts: { removeOnComplete: true, removeOnFail: 20 } });
}
