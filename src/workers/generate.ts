// Worker de automatización/generación de contenido. Proceso independiente: `npm run worker:generate`.
import "dotenv/config";
import { Worker } from "bullmq";
import { prisma } from "@/lib/db";
import { prepareMedia } from "@/lib/automation/media";
import { runPageAutomation } from "@/lib/automation/engine";
import { runMaintenance } from "@/lib/automation/retention";
import { AUTOMATION_QUEUE, enqueueCollect, enqueuePageRun, enqueueReport } from "@/lib/queue/automation-queue";
import { createRedisConnection } from "@/lib/queue/connection";
import { startHeartbeat } from "@/lib/queue/heartbeat";
import { collectPageMetrics, connectedPageIds } from "@/lib/services/analytics-collect";
import { generateWeeklyReport } from "@/lib/services/analytics-report";
import { runOptimization } from "@/lib/services/optimization";
import { userMessageForError } from "@/lib/integrations/openai/client";
import { getAutomationsPaused } from "@/lib/services/settings";

const concurrency = Math.max(1, Number(process.env.GENERATE_CONCURRENCY) || 2);
const stopHeartbeat = startHeartbeat("generate");

const worker = new Worker(
  AUTOMATION_QUEUE,
  async (job) => {
    switch (job.name) {
      case "tick": {
        if (await getAutomationsPaused()) return { paused: true };
        const rules = await prisma.automationRule.findMany({ where: { enabled: true, page: { isActive: true } }, select: { pageId: true } });
        for (const r of rules) await enqueuePageRun(r.pageId);
        return { pages: rules.length };
      }
      case "page-run": {
        const { pageId, force } = job.data as { pageId: string; force?: boolean };
        const s = await runPageAutomation(pageId, { force });
        console.log(`[generate-worker] ${pageId}: ${s.skipped ?? `${s.generated} generados, ${s.scheduled} programados`}`);
        return s;
      }
      case "postprocess": {
        const { postId } = job.data as { postId: string };
        const note = await prepareMedia(postId);
        console.log(`[generate-worker] medios ${postId}: ${note}`);
        return { note };
      }
      case "collect-metrics": {
        // Solo lectura de Meta: corre aunque la automatización esté en pausa global.
        const ids = await connectedPageIds();
        for (const id of ids) await enqueueCollect(id);
        return { pages: ids.length };
      }
      case "collect-page": {
        const { pageId, force } = job.data as { pageId: string; force?: boolean };
        const s = await collectPageMetrics(pageId, { force });
        console.log(`[generate-worker] métricas ${pageId}: ${s.error ?? s.skipped ?? `${s.postSnapshots} publicaciones${s.pageSnapshot ? " + página" : ""}`}`);
        return s;
      }
      case "weekly-reports": {
        if (await getAutomationsPaused()) return { paused: true };
        const ids = await connectedPageIds();
        for (const id of ids) await enqueueReport(id);
        return { pages: ids.length };
      }
      case "report-page": {
        const { pageId, force } = job.data as { pageId: string; force?: boolean };
        try {
          const r = await generateWeeklyReport(pageId, { force });
          console.log(`[generate-worker] informe ${pageId}: ${"skipped" in r ? r.skipped : "generado"}`);
          return r;
        } catch (e) {
          // Presupuesto agotado / OpenAI sin configurar: no es un fallo del proceso, se informa y se sigue.
          console.warn(`[generate-worker] informe ${pageId} omitido: ${userMessageForError(e)}`);
          return { skipped: userMessageForError(e) };
        }
      }
      case "optimize": {
        if (await getAutomationsPaused()) return { paused: true };
        const rules = await prisma.automationRule.findMany({ where: { page: { isActive: true, connectionStatus: "CONNECTED" } }, select: { pageId: true } });
        const out: Record<string, unknown> = {};
        for (const r of rules) out[r.pageId] = await runOptimization(r.pageId).catch((e: Error) => ({ error: e.message }));
        return out;
      }
      case "maintenance": {
        const r = await runMaintenance();
        console.log("[generate-worker] mantenimiento:", JSON.stringify(r));
        return r;
      }
      default:
        throw new Error(`Trabajo desconocido: ${job.name}`);
    }
  },
  { connection: createRedisConnection(), concurrency, lockDuration: 600_000 },
);

worker.on("ready", () => console.log(`[generate-worker] listo (concurrencia ${concurrency})`));
worker.on("failed", (job, err) => console.error(`[generate-worker] ${job?.name} falló:`, err.message));
worker.on("error", (err) => console.error("[generate-worker] error:", err.message));

async function shutdown() {
  console.log("[generate-worker] cerrando…");
  await worker.close();
  await stopHeartbeat();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
