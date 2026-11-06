import "server-only";
import { prisma } from "@/lib/db";
import { FORMAT_LABELS } from "@/lib/constants";
import { getAutomationsPaused } from "./settings";

export async function getDashboardData() {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const since14 = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const [
    pagesTotal, pagesConnected, todayPosts, scheduled, published, failed,
    reelsGenerated, reelsPending, openaiMonth, usage14, recent, rulesEnabled, paused,
    postsByPageStatus, pages, postsByFormat,
  ] = await Promise.all([
    prisma.socialPage.count(),
    prisma.socialPage.count({ where: { connectionStatus: "CONNECTED" } }),
    prisma.contentPost.count({ where: { scheduledAt: { gte: startOfDay, lt: endOfDay } } }),
    prisma.contentPost.count({ where: { status: "SCHEDULED" } }),
    prisma.contentPost.count({ where: { status: "PUBLISHED" } }),
    prisma.contentPost.count({ where: { status: "FAILED" } }),
    prisma.videoRenderJob.count({ where: { status: "COMPLETED" } }),
    prisma.videoRenderJob.count({ where: { status: { in: ["QUEUED", "RUNNING"] } } }),
    prisma.aPIUsageLog.aggregate({
      where: { provider: "openai", createdAt: { gte: monthStart } },
      _sum: { costUsd: true, inputTokens: true, outputTokens: true },
      _count: true,
    }),
    prisma.aPIUsageLog.findMany({ where: { createdAt: { gte: since14 } }, select: { createdAt: true, costUsd: true } }),
    prisma.activityLog.findMany({ orderBy: { createdAt: "desc" }, take: 8, include: { page: { select: { name: true } } } }),
    prisma.automationRule.count({ where: { enabled: true, page: { isActive: true } } }),
    getAutomationsPaused(),
    prisma.contentPost.groupBy({ by: ["pageId", "status"], _count: true }),
    prisma.socialPage.findMany({ select: { id: true, name: true } }),
    prisma.contentPost.groupBy({ by: ["format"], _count: true }),
  ]);

  const nameById = new Map(pages.map((p) => [p.id, p.name]));
  const perPage = new Map<string, { page: string; Publicados: number; Programados: number; Fallidos: number; Otros: number }>();
  for (const row of postsByPageStatus) {
    const entry = perPage.get(row.pageId) ?? { page: nameById.get(row.pageId) ?? "—", Publicados: 0, Programados: 0, Fallidos: 0, Otros: 0 };
    if (row.status === "PUBLISHED") entry.Publicados += row._count;
    else if (row.status === "SCHEDULED") entry.Programados += row._count;
    else if (row.status === "FAILED") entry.Fallidos += row._count;
    else entry.Otros += row._count;
    perPage.set(row.pageId, entry);
  }

  const costByDay = new Map<string, number>();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    costByDay.set(d.toISOString().slice(5, 10), 0);
  }
  for (const u of usage14) {
    const k = u.createdAt.toISOString().slice(5, 10);
    if (costByDay.has(k)) costByDay.set(k, (costByDay.get(k) ?? 0) + Number(u.costUsd));
  }

  return {
    counts: { pagesTotal, pagesConnected, todayPosts, scheduled, published, failed, reelsGenerated, reelsPending },
    openai: {
      calls: openaiMonth._count,
      costUsd: Number(openaiMonth._sum.costUsd ?? 0),
      tokens: (openaiMonth._sum.inputTokens ?? 0) + (openaiMonth._sum.outputTokens ?? 0),
    },
    automation: { rulesEnabled, paused },
    recent,
    postsPerPage: [...perPage.values()],
    postsByFormat: postsByFormat.map((r) => ({ format: FORMAT_LABELS[r.format] ?? r.format, total: r._count })),
    costByDay: [...costByDay.entries()].map(([day, cost]) => ({ day, cost: Number(cost.toFixed(4)) })),
  };
}
