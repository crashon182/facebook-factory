import "server-only";
import { prisma } from "@/lib/db";
import { dayKey } from "@/lib/time/tz";
import { bestHour, formatPerformance, hourPerformance, mean, pctChange, scorePosts, weekdayPerformance, type Bucket, type PostSample, type ScoredPost } from "@/lib/analytics/stats";

const DAY = 24 * 3600_000;
export const RANGES = [7, 30, 90] as const;
export const parseRange = (v: string | undefined): (typeof RANGES)[number] => (RANGES.find((r) => String(r) === v) ?? 30);

/** Publicaciones publicadas en [from, to) con su última medición. Las que aún no tienen métricas se omiten del análisis. */
export async function getPostSamples(pageId: string, from: Date, to: Date): Promise<PostSample[]> {
  const rows = await prisma.contentPost.findMany({
    where: { pageId, status: "PUBLISHED", publishedAt: { gte: from, lt: to }, metrics: { some: {} } },
    select: { id: true, internalTitle: true, format: true, publishedAt: true, metrics: { orderBy: { capturedAt: "desc" }, take: 1, select: { reach: true, views: true, engagements: true } } },
    orderBy: { publishedAt: "desc" },
  });
  return rows.map((r) => ({ id: r.id, title: r.internalTitle, format: r.format, publishedAt: r.publishedAt!, reach: r.metrics[0]?.reach ?? null, views: r.metrics[0]?.views ?? null, engagements: r.metrics[0]?.engagements ?? null }));
}

const sum = (xs: (number | null)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);

export type PeriodTotals = { posts: number; views: number; reach: number; engagements: number; avgRate: number | null };
export function totalsOf(scored: ScoredPost[]): PeriodTotals {
  return {
    posts: scored.length,
    views: sum(scored.map((p) => p.views)),
    reach: sum(scored.map((p) => p.reach)),
    engagements: sum(scored.map((p) => p.engagements)),
    avgRate: mean(scored.flatMap((p) => (p.rate == null ? [] : [p.rate]))),
  };
}

export type PageOverview = {
  pageId: string;
  timezone: string;
  days: number;
  lastCollectedAt: Date | null;
  followers: number | null;
  followersDelta: number | null;
  current: PeriodTotals;
  previous: PeriodTotals;
  changes: { views: number | null; reach: number | null; engagements: number | null; avgRate: number | null };
  daily: { day: string; views: number | null; reach: number | null; followers: number | null }[];
  posts: ScoredPost[];
  formats: Bucket[];
  hours: Bucket[];
  weekdays: Bucket[];
  bestHour: number | null;
};

export async function getPageOverview(pageId: string, days: number, now = new Date()): Promise<PageOverview | null> {
  const page = await prisma.socialPage.findUnique({ where: { id: pageId }, select: { id: true, timezone: true } });
  if (!page) return null;
  const from = new Date(now.getTime() - days * DAY);
  const prevFrom = new Date(from.getTime() - days * DAY);
  const [curSamples, prevSamples, snaps] = await Promise.all([
    getPostSamples(pageId, from, now),
    getPostSamples(pageId, prevFrom, from),
    prisma.pageMetric.findMany({ where: { pageId, capturedAt: { gte: prevFrom } }, orderBy: { capturedAt: "asc" } }),
  ]);
  // El índice se normaliza con TODAS las publicaciones de ambos períodos para que sean comparables entre sí.
  const scoredAll = scorePosts([...curSamples, ...prevSamples]);
  const byId = new Map(scoredAll.map((p) => [p.id, p]));
  const posts = curSamples.map((s) => byId.get(s.id)!);
  const current = totalsOf(posts);
  const previous = totalsOf(prevSamples.map((s) => byId.get(s.id)!));

  // Página: nos quedamos con la última foto de cada día local.
  const perDay = new Map<string, (typeof snaps)[number]>();
  for (const s of snaps) if (s.capturedAt >= from) perDay.set(dayKey(s.capturedAt, page.timezone), s);
  const daily = [...perDay.entries()].map(([day, s]) => ({ day, views: s.impressions, reach: s.reach, followers: s.followers }));
  const inRange = snaps.filter((s) => s.capturedAt >= from && s.followers != null);
  const followers = snaps.length ? [...snaps].reverse().find((s) => s.followers != null)?.followers ?? null : null;
  const followersDelta = inRange.length >= 2 ? inRange[inRange.length - 1].followers! - inRange[0].followers! : null;

  const hours = hourPerformance(posts, page.timezone);
  return {
    pageId, timezone: page.timezone, days,
    lastCollectedAt: snaps.length ? snaps[snaps.length - 1].capturedAt : null,
    followers, followersDelta, current, previous,
    changes: {
      views: pctChange(current.views, previous.views || null),
      reach: pctChange(current.reach, previous.reach || null),
      engagements: pctChange(current.engagements, previous.engagements || null),
      avgRate: pctChange(current.avgRate, previous.avgRate),
    },
    daily, posts,
    formats: formatPerformance(posts),
    hours,
    weekdays: weekdayPerformance(posts, page.timezone),
    bestHour: bestHour(hours),
  };
}

export type ConsolidatedRow = { pageId: string; name: string; connected: boolean; followers: number | null; followersDelta: number | null; current: PeriodTotals; changeViews: number | null };

/** Vista consolidada: una fila por página activa y los totales de todas. */
export async function getConsolidated(days: number, now = new Date()) {
  const pages = await prisma.socialPage.findMany({ where: { isActive: true }, select: { id: true, name: true, connectionStatus: true }, orderBy: { name: "asc" } });
  const rows: ConsolidatedRow[] = [];
  for (const p of pages) {
    const o = await getPageOverview(p.id, days, now);
    if (!o) continue;
    rows.push({ pageId: p.id, name: p.name, connected: p.connectionStatus === "CONNECTED", followers: o.followers, followersDelta: o.followersDelta, current: o.current, changeViews: o.changes.views });
  }
  const total: PeriodTotals = {
    posts: rows.reduce((a, r) => a + r.current.posts, 0),
    views: rows.reduce((a, r) => a + r.current.views, 0),
    reach: rows.reduce((a, r) => a + r.current.reach, 0),
    engagements: rows.reduce((a, r) => a + r.current.engagements, 0),
    avgRate: mean(rows.flatMap((r) => (r.current.avgRate == null ? [] : [r.current.avgRate]))),
  };
  return { rows, total, followers: rows.reduce((a, r) => a + (r.followers ?? 0), 0) };
}
