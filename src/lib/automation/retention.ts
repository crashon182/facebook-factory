import "server-only";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { cleanOldTmp, removeQuiet, resolveInStorage, storageRoot } from "@/lib/storage";

const DAY = 24 * 3600_000;
const envDays = (k: string, d: number) => { const n = Number(process.env[k]); return Number.isFinite(n) && n >= 0 && process.env[k]?.trim() ? n : d; };

export type MaintenanceSummary = { tmpRemoved: number; activityDeleted: number; ttsCacheRemoved: number; rendersRemoved: number; pendingMetaCleared: boolean };

/**
 * Política de retención (diaria):
 *  - temporales (storage/tmp) > 24 h
 *  - cache de TTS > TTS_CACHE_RETENTION_DAYS (30)
 *  - registro de actividad > ACTIVITY_RETENTION_DAYS (90)
 *  - videos renderizados de contenidos ya publicados hace más de RENDER_RETENTION_DAYS (0 = no borrar nunca)
 */
export async function runMaintenance(now = new Date()): Promise<MaintenanceSummary> {
  const out: MaintenanceSummary = { tmpRemoved: await cleanOldTmp(), activityDeleted: 0, ttsCacheRemoved: 0, rendersRemoved: 0, pendingMetaCleared: false };

  out.activityDeleted = (await prisma.activityLog.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - envDays("ACTIVITY_RETENTION_DAYS", 90) * DAY) } } })).count;

  const ttsDir = path.join(storageRoot(), "tts-cache");
  const ttsCutoff = now.getTime() - envDays("TTS_CACHE_RETENTION_DAYS", 30) * DAY;
  for (const f of await readdir(ttsDir).catch(() => [] as string[])) {
    const p = path.join(ttsDir, f);
    const st = await stat(p).catch(() => null);
    if (st && st.mtimeMs < ttsCutoff) { await removeQuiet(p); out.ttsCacheRemoved++; }
  }

  const renderDays = envDays("RENDER_RETENTION_DAYS", 0);
  if (renderDays > 0) {
    const jobs = await prisma.videoRenderJob.findMany({ where: { status: "COMPLETED", outputPath: { not: null }, post: { status: "PUBLISHED", publishedAt: { lt: new Date(now.getTime() - renderDays * DAY) } } }, take: 200 });
    for (const j of jobs) {
      await removeQuiet(resolveInStorage(j.outputPath!));
      await prisma.videoRenderJob.update({ where: { id: j.id }, data: { outputPath: null } });
      out.rendersRemoved++;
    }
  }

  const pending = await prisma.systemSetting.findUnique({ where: { key: "meta.pending" } });
  if (pending && (pending.value as { expiresAt?: number }).expiresAt! < now.getTime()) { await prisma.systemSetting.delete({ where: { key: "meta.pending" } }); out.pendingMetaCleared = true; }
  return out;
}
