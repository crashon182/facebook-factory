import "server-only";
import { statfs } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import type { Queue } from "bullmq";
import { prisma } from "@/lib/db";
import { getReadyRedis } from "@/lib/cache";
import { getAutomationQueue } from "@/lib/queue/automation-queue";
import { getPublishQueue } from "@/lib/queue/publish-queue";
import { getRenderQueue } from "@/lib/queue/render-queue";
import { readHeartbeats } from "@/lib/queue/heartbeat";
import { ensureDir, storageRoot } from "@/lib/storage";
import { spentTodayUsd } from "@/lib/integrations/openai/client";
import { getAutomationsPaused } from "./settings";

export const QUEUES: Record<string, () => Queue> = { automation: getAutomationQueue, render: getRenderQueue, publish: getPublishQueue };
export type QueueName = keyof typeof QUEUES;
export const isQueueName = (n: string): n is QueueName => n in QUEUES;

export type QueueStat = { name: string; waiting: number; active: number; delayed: number; failed: number; completed: number };
export type FailedJob = { queue: string; id: string; name: string; reason: string; attemptsMade: number; at: string | null };

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

export async function pingDb() {
  try { await prisma.$queryRaw`SELECT 1`; return true; } catch { return false; }
}
export async function pingRedis() {
  try { const r = await getReadyRedis(); return !!r && (await withTimeout(r.ping(), 1500, null)) === "PONG"; } catch { return false; }
}

let ffmpegOk: boolean | null = null;
function hasFfmpeg() {
  ffmpegOk ??= spawnSync(/* turbopackIgnore: true */ process.env.FFMPEG_PATH?.trim() || "ffmpeg", ["-version"], { timeout: 5000 }).status === 0;
  return ffmpegOk;
}

export async function diskInfo() {
  try {
    const dir = await ensureDir(storageRoot());
    const s = await statfs(dir);
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    return { totalGb: total / 1e9, freeGb: free / 1e9, freePct: total ? (free / total) * 100 : 0 };
  } catch {
    return null;
  }
}

export async function getQueueStats(): Promise<QueueStat[]> {
  return Promise.all(
    Object.entries(QUEUES).map(async ([name, get]) => {
      const c = await withTimeout(get().getJobCounts("waiting", "active", "delayed", "failed", "completed"), 3000, {} as Record<string, number>);
      return { name, waiting: c.waiting ?? 0, active: c.active ?? 0, delayed: c.delayed ?? 0, failed: c.failed ?? 0, completed: c.completed ?? 0 };
    }),
  );
}

export async function getFailedJobs(limit = 15): Promise<FailedJob[]> {
  const all: FailedJob[] = [];
  for (const [name, get] of Object.entries(QUEUES)) {
    const jobs = await withTimeout(get().getFailed(0, limit - 1), 3000, []);
    for (const j of jobs) all.push({ queue: name, id: String(j.id), name: j.name, reason: (j.failedReason ?? "").slice(0, 300), attemptsMade: j.attemptsMade, at: j.finishedOn ? new Date(j.finishedOn).toISOString() : null });
  }
  return all.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? "")).slice(0, limit);
}

export async function getSystemHealth() {
  const [db, redis, disk, workers, paused] = await Promise.all([pingDb(), pingRedis(), diskInfo(), readHeartbeats(), getAutomationsPaused()]);
  return { db, redis, ffmpeg: hasFfmpeg(), disk, workers, paused };
}

export type PageAutomationRow = {
  pageId: string; name: string; active: boolean; connection: string; enabled: boolean; requireApproval: boolean; autoPublish: boolean;
  frequency: string; lastRunAt: string | null; lastSummary: { generated?: number; scheduled?: number; skipped?: string; notes?: string[] } | null;
  ready: number; scheduled: number; published24h: number; failed: number; spentToday: number; budget: number; running: boolean;
};

export async function getPageAutomationRows(): Promise<PageAutomationRow[]> {
  const pages = await prisma.socialPage.findMany({ include: { automation: true }, orderBy: { name: "asc" } });
  const since = new Date(Date.now() - 24 * 3600_000);
  const [counts, published] = await Promise.all([
    prisma.contentPost.groupBy({ by: ["pageId", "status"], where: { status: { in: ["READY", "SCHEDULED", "FAILED"] } }, _count: true }),
    prisma.contentPost.groupBy({ by: ["pageId"], where: { status: "PUBLISHED", publishedAt: { gte: since } }, _count: true }),
  ]);
  const get = (pid: string, st: string) => counts.find((c) => c.pageId === pid && c.status === st)?._count ?? 0;
  return Promise.all(
    pages.map(async (p) => ({
      pageId: p.id, name: p.name, active: p.isActive, connection: p.connectionStatus,
      enabled: !!p.automation?.enabled, requireApproval: p.automation?.requireApproval ?? true, autoPublish: p.automation?.autoPublish ?? false,
      frequency: p.automation?.generationFrequency ?? "DAILY", lastRunAt: p.automation?.lastRunAt?.toISOString() ?? null,
      lastSummary: (p.automation?.lastRunSummary as PageAutomationRow["lastSummary"]) ?? null,
      ready: get(p.id, "READY"), scheduled: get(p.id, "SCHEDULED"), failed: get(p.id, "FAILED"),
      published24h: published.find((x) => x.pageId === p.id)?._count ?? 0,
      spentToday: await spentTodayUsd(p.id), budget: Number(p.automation?.dailyBudgetUsd ?? 0),
      running: !!p.automation?.lockedUntil && p.automation.lockedUntil > new Date(),
    })),
  );
}

export async function getMonitorSnapshot() {
  const [health, queues, failed, pages] = await Promise.all([getSystemHealth(), getQueueStats().catch(() => []), getFailedJobs().catch(() => []), getPageAutomationRows()]);
  return { health, queues, failed, pages, at: new Date().toISOString() };
}
export type MonitorSnapshot = Awaited<ReturnType<typeof getMonitorSnapshot>>;
