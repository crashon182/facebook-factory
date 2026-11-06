import { Queue } from "bullmq";
import { createRedisConnection } from "./connection";

export const RENDER_QUEUE = "render";
export const RENDER_ATTEMPTS = 3;

let queue: Queue | null = null;
export function getRenderQueue() {
  queue ??= new Queue(RENDER_QUEUE, { connection: createRedisConnection() });
  return queue;
}

/** jobId determinista: encolar dos veces el mismo render no lo duplica. */
export async function enqueueRender(dbJobId: string) {
  return getRenderQueue().add(
    "render-reel",
    { jobId: dbJobId },
    { jobId: `render-${dbJobId}`, attempts: RENDER_ATTEMPTS, backoff: { type: "exponential", delay: 15_000 }, removeOnComplete: 100, removeOnFail: 200 },
  );
}

export async function removeQueuedRender(dbJobId: string) {
  const j = await getRenderQueue().getJob(`render-${dbJobId}`);
  if (j && (await j.isWaiting() || await j.isDelayed())) await j.remove();
}
