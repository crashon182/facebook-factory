// Worker de publicación en Facebook. Proceso independiente: `npm run worker:publish`.
import "dotenv/config";
import { Worker } from "bullmq";
import { prisma } from "@/lib/db";
import { createRedisConnection } from "@/lib/queue/connection";
import { enqueuePublish, ensureDueScanner, PUBLISH_QUEUE } from "@/lib/queue/publish-queue";
import { findDueSchedules, publishSchedule } from "@/lib/services/publishing";
import { getAutomationsPaused } from "@/lib/services/settings";

const concurrency = Math.max(1, Number(process.env.PUBLISH_CONCURRENCY) || 2);

const worker = new Worker(
  PUBLISH_QUEUE,
  async (job) => {
    if (job.name === "scan-due") {
      if (await getAutomationsPaused()) return { paused: true };
      const { ids, recovered } = await findDueSchedules();
      for (const id of ids) await enqueuePublish(id);
      if (ids.length || recovered) console.log(`[publish-worker] vencidas: ${ids.length}, recuperadas: ${recovered}`);
      return { due: ids.length };
    }
    const { scheduleId } = job.data as { scheduleId: string };
    const out = await publishSchedule(scheduleId);
    console.log(`[publish-worker] ${scheduleId}: ${out.status}${"reason" in out && out.reason ? ` (${out.reason})` : ""}`);
    return out;
  },
  { connection: createRedisConnection(), concurrency, lockDuration: 600_000 },
);

worker.on("ready", async () => {
  await ensureDueScanner();
  console.log(`[publish-worker] listo (concurrencia ${concurrency}, escaneo cada 30 s)`);
});
worker.on("failed", (job, err) => console.error(`[publish-worker] job ${job?.name} falló:`, err.message));
worker.on("error", (err) => console.error("[publish-worker] error:", err.message));

async function shutdown() {
  console.log("[publish-worker] cerrando…");
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
