import "server-only";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { generateStructured } from "@/lib/integrations/openai/client";
import { buildReportPrompt, reportSchema, type ReportFacts } from "@/lib/prompts/report";
import { getPageOverview } from "./analytics";
import { logActivity } from "./activity";

const DAY = 24 * 3600_000;

export class ReportError extends Error {}

const pct = (r: number | null) => (r == null ? null : Math.round(r * 1000) / 10);
const round1 = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10);

export async function buildReportFacts(pageId: string, now = new Date()): Promise<{ facts: ReportFacts; overview: NonNullable<Awaited<ReturnType<typeof getPageOverview>>> } | null> {
  const page = await prisma.socialPage.findUnique({ where: { id: pageId }, select: { name: true, topic: true, language: true } });
  const overview = await getPageOverview(pageId, 7, now);
  if (!page || !overview) return null;
  const ranked = overview.posts.filter((p) => p.index != null).sort((a, b) => b.index! - a.index!);
  const row = (p: (typeof ranked)[number]) => ({ title: p.title.slice(0, 80), format: p.format, engagementRatePct: pct(p.rate), index: round1(p.index) });
  const totals = (t: typeof overview.current) => ({ posts: t.posts, views: t.views, reach: t.reach, engagements: t.engagements, avgEngagementRatePct: pct(t.avgRate) });
  const lastMetricRaw = await prisma.activityLog.findFirst({ where: { pageId, action: "analytics.collected" }, orderBy: { createdAt: "desc" }, select: { message: true } });
  const unavailable = /no disponibles: (.+)$/.exec(lastMetricRaw?.message ?? "")?.[1]?.split(", ") ?? [];
  const facts: ReportFacts = {
    page,
    period: { from: new Date(now.getTime() - 7 * DAY).toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) },
    current: totals(overview.current),
    previous: totals(overview.previous),
    followers: { now: overview.followers, deltaInPeriod: overview.followersDelta },
    formats: overview.formats.map((f) => ({ format: f.key, posts: f.n, performanceIndex: round1(f.avgIndex)! })),
    bestHoursLocal: overview.hours.slice(0, 3).map((h) => ({ hour: Number(h.key), posts: h.n, performanceIndex: round1(h.avgIndex)! })),
    topPosts: ranked.slice(0, 3).map(row),
    bottomPosts: ranked.length > 3 ? ranked.slice(-3).reverse().map(row) : [],
    unavailableMetrics: unavailable,
  };
  return { facts, overview };
}

/**
 * Informe semanal con IA de una página. Una sola vez por semana salvo `force`. Los experimentos que sugiere la IA se guardan
 * como PROPUESTOS (nunca se aplican solos: solo el ajuste de franja horaria tiene un camino automático, en optimization.ts).
 */
export async function generateWeeklyReport(pageId: string, opts: { force?: boolean } = {}, now = new Date()) {
  if (!opts.force) {
    const recent = await prisma.aIAnalysisReport.findFirst({ where: { pageId, type: "WEEKLY", createdAt: { gte: new Date(now.getTime() - 6 * DAY) } } });
    if (recent) return { skipped: "Ya hay un informe de esta semana.", reportId: recent.id };
  }
  const built = await buildReportFacts(pageId, now);
  if (!built) throw new ReportError("La página no existe.");
  const { facts } = built;
  if (facts.current.posts === 0 && facts.previous.posts === 0) return { skipped: "Todavía no hay publicaciones con métricas para analizar." };

  const { system, user } = buildReportPrompt(facts);
  const { data, costUsd } = await generateStructured({ schema: reportSchema, schemaName: "weekly_report", system, user, operation: "weekly_report", pageId, maxOutputTokens: 2500 });
  const report = await prisma.aIAnalysisReport.create({
    data: { pageId, type: "WEEKLY", periodStart: new Date(now.getTime() - 7 * DAY), periodEnd: now, summary: data.summary, data: { facts, ...data } as unknown as Prisma.InputJsonValue },
  });
  for (const e of data.experiments) {
    await prisma.optimizationExperiment.create({ data: { pageId, hypothesis: e.hypothesis.slice(0, 1000), variable: e.variable.slice(0, 190), status: "PROPOSED" } });
  }
  await logActivity({ action: "analytics.report", message: `Informe semanal generado (USD ${costUsd.toFixed(4)})`, pageId, entity: "AIAnalysisReport", entityId: report.id });
  return { reportId: report.id, costUsd };
}
