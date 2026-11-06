// Worker de renderizado de Reels. Proceso independiente: `npm run worker:render`.
import "dotenv/config";
import { Worker } from "bullmq";
import { prisma } from "@/lib/db";
import { createRedisConnection } from "@/lib/queue/connection";
import { startHeartbeat } from "@/lib/queue/heartbeat";
import { RENDER_ATTEMPTS, RENDER_QUEUE } from "@/lib/queue/render-queue";
import { renderReel } from "@/lib/video/reel";
import { cleanOldTmp } from "@/lib/storage";

const concurrency = Math.max(1, Number(process.env.RENDER_CONCURRENCY) || 1);

const stopHeartbeat = startHeartbeat("render");

const worker = new Worker(
  RENDER_QUEUE,
  async (job) => {
    const jobId = (job.data as { jobId: string }).jobId;
    await renderReel(jobId, {
      attempt: job.attemptsMade + 1,
      maxAttempts: job.opts.attempts ?? RENDER_ATTEMPTS,
      isCancelled: async () => (await prisma.videoRenderJob.findUnique({ where: { id: jobId }, select: { status: true } }))?.status === "CANCELLED",
    });
  },
  { connection: createRedisConnection(), concurrency, lockDuration: 120_000 },
);

worker.on("ready", () => console.log(`[render-worker] listo (concurrencia ${concurrency})`));
worker.on("failed", (job, err) => console.error(`[render-worker] job ${job?.id} falló (intento ${job?.attemptsMade}):`, err.message));
worker.on("completed", (job) => console.log(`[render-worker] job ${job.id} completado`));
worker.on("error", (err) => console.error("[render-worker] error:", err.message));

// Retención de temporales: al iniciar y cada hora
void cleanOldTmp().then((n) => n && console.log(`[render-worker] ${n} carpetas temporales antiguas eliminadas`));
setInterval(() => void cleanOldTmp(), 3600_000).unref();

async function shutdown() {
  console.log("[render-worker] cerrando…");
  await worker.close();
  await stopHeartbeat();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
