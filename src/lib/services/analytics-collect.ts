import "server-only";
import { prisma } from "@/lib/db";
import { MetaClient } from "@/lib/integrations/meta/client";
import { describeMetaError, MetaApiError } from "@/lib/integrations/meta/errors";
import { getPageToken } from "./meta-connection";
import { logActivity } from "./activity";

/**
 * Nombres de métricas de Insights. Meta retiró varias en nov-2025 (impresiones, "me gusta" de la Página) y otras de
 * alcance únicas están en transición, así que son configurables por entorno y cada una se pide por separado:
 * si Meta rechaza una (error 100), se registra como "no disponible" y el resto se guarda igual.
 */
export function metricNames(env: NodeJS.ProcessEnv = process.env) {
  const get = (k: string, d: string) => env[k]?.trim() || d;
  return {
    pageViews: get("META_PAGE_VIEWS_METRIC", "page_media_view"),
    pageReach: get("META_PAGE_REACH_METRIC", "page_total_media_view_unique"),
    pageEngagements: get("META_PAGE_ENGAGEMENTS_METRIC", "page_post_engagements"),
    postViews: get("META_POST_VIEWS_METRIC", "post_media_view"),
    postReach: get("META_POST_REACH_METRIC", "post_total_media_view_unique"),
  };
}

export type CollectDeps = { client?: () => MetaClient; now?: () => Date };
export type CollectSummary = { pageSnapshot: boolean; postSnapshots: number; postsChecked: number; unavailable: string[]; error?: string; skipped?: string };

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const analyticsDays = () => Math.max(1, Number(process.env.ANALYTICS_POST_DAYS) || 30);
const MAX_POSTS_PER_RUN = 60;

/** Cada cuánto se vuelve a medir una publicación según su antigüedad: al inicio rinde más cambio, después casi nada. */
export function minSnapshotGapMs(ageMs: number): number {
  if (ageMs < 2 * DAY) return 3 * HOUR;
  if (ageMs < 7 * DAY) return 12 * HOUR;
  return 24 * HOUR;
}

class AbortCollect extends Error {
  constructor(readonly cause2: unknown) {
    super(describeMetaError(cause2));
  }
}

/** Ejecuta una lectura de métrica: errores "de métrica" (100/desconocida) se toleran; auth, permisos, límites y red abortan. */
async function tryMetric<T>(name: string, unavailable: string[], fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof MetaApiError && (e.kind === "invalid" || e.kind === "unknown")) {
      unavailable.push(name);
      return null;
    }
    throw new AbortCollect(e);
  }
}

const lastValue = (pts: { value: number; endTime: string | null }[]) => (pts.length ? pts[pts.length - 1].value : null);

async function markAuthFailure(pageId: string, e: unknown) {
  const auth = e instanceof MetaApiError && e.kind === "auth";
  if (auth) {
    await prisma.socialPage.update({ where: { id: pageId }, data: { connectionStatus: "EXPIRED", lastCheckedAt: new Date() } });
  }
  await logActivity({ action: "analytics.collect_failed", message: `No se pudieron recopilar métricas: ${describeMetaError(e)}`, level: "WARN", pageId });
}

/** Recopila la métrica de la Página y de sus publicaciones recientes. Idempotente: respeta la cadencia mínima entre snapshots. */
export async function collectPageMetrics(pageId: string, opts: { force?: boolean } = {}, deps: CollectDeps = {}): Promise<CollectSummary> {
  const now = (deps.now ?? (() => new Date()))();
  const out: CollectSummary = { pageSnapshot: false, postSnapshots: 0, postsChecked: 0, unavailable: [] };
  const page = await prisma.socialPage.findUnique({ where: { id: pageId } });
  if (!page) return { ...out, skipped: "La página no existe." };
  const token = getPageToken(page);
  if (!page.facebookPageId || !token || page.connectionStatus !== "CONNECTED") return { ...out, skipped: "La página no está conectada a Facebook." };
  const client = (deps.client ?? (() => MetaClient.fromEnv()))();
  const m = metricNames();
  const fbPageId = page.facebookPageId;

  try {
    // ── Página: una foto por corrida (como máximo cada 6 h) ──
    const lastPage = await prisma.pageMetric.findFirst({ where: { pageId }, orderBy: { capturedAt: "desc" }, select: { capturedAt: true } });
    if (opts.force || !lastPage || now.getTime() - lastPage.capturedAt.getTime() >= 6 * HOUR) {
      const since = Math.floor((now.getTime() - 3 * DAY) / 1000);
      const until = Math.floor(now.getTime() / 1000);
      const series = (metric: string) => tryMetric(metric, out.unavailable, async () => lastValue(await client.insightSeries(fbPageId, token, metric, { period: "day", since, until })));
      const followers = await tryMetric("followers_count", out.unavailable, () => client.pageFollowers(fbPageId, token));
      const views = await series(m.pageViews);
      const reach = await series(m.pageReach);
      const engagements = await series(m.pageEngagements);
      if ([followers, views, reach, engagements].some((v) => v != null)) {
        await prisma.pageMetric.create({ data: { pageId, capturedAt: now, followers, impressions: views, reach, engagements, raw: { metrics: { views: m.pageViews, reach: m.pageReach, engagements: m.pageEngagements } } } });
        out.pageSnapshot = true;
      }
    }

    // ── Publicaciones recientes ──
    const posts = await prisma.contentPost.findMany({
      where: { pageId, status: "PUBLISHED", facebookPostId: { not: null }, publishedAt: { gte: new Date(now.getTime() - analyticsDays() * DAY) } },
      orderBy: { publishedAt: "desc" },
      take: MAX_POSTS_PER_RUN,
      select: { id: true, facebookPostId: true, publishedAt: true },
    });
    const lasts = await prisma.postMetric.groupBy({ by: ["postId"], where: { postId: { in: posts.map((p) => p.id) } }, _max: { capturedAt: true } });
    const lastBy = new Map(lasts.map((l) => [l.postId, l._max.capturedAt]));
    for (const p of posts) {
      const age = now.getTime() - (p.publishedAt?.getTime() ?? now.getTime());
      const last = lastBy.get(p.id);
      if (!opts.force && last && now.getTime() - last.getTime() < minSnapshotGapMs(age)) continue;
      out.postsChecked++;
      const fbId = p.facebookPostId!;
      const eng = await tryMetric("post_engagement", out.unavailable, () => client.postEngagement(fbId, token));
      const insight = (metric: string) => tryMetric(metric, out.unavailable, async () => lastValue(await client.insightSeries(fbId, token, metric, { period: "lifetime" })));
      const views = await insight(m.postViews);
      const reach = await insight(m.postReach);
      const engagements = eng ? (eng.reactions ?? 0) + (eng.comments ?? 0) + (eng.shares ?? 0) : null;
      if (engagements == null && views == null && reach == null) continue;
      await prisma.postMetric.create({
        data: { postId: p.id, pageId, capturedAt: now, views, impressions: views, reach, reactions: eng?.reactions ?? null, comments: eng?.comments ?? null, shares: eng?.shares ?? null, engagements },
      });
      out.postSnapshots++;
    }
    out.unavailable = [...new Set(out.unavailable)];
    await prisma.socialPage.update({ where: { id: pageId }, data: { lastCheckedAt: now } });
    await logActivity({
      action: "analytics.collected",
      message: `Métricas recopiladas: ${out.postSnapshots} publicación(es)${out.pageSnapshot ? " y la Página" : ""}${out.unavailable.length ? ` · no disponibles: ${out.unavailable.join(", ")}` : ""}`,
      level: out.unavailable.length ? "WARN" : "INFO",
      pageId,
    });
    return out;
  } catch (e) {
    const cause = e instanceof AbortCollect ? e.cause2 : e;
    await markAuthFailure(pageId, cause);
    return { ...out, unavailable: [...new Set(out.unavailable)], error: describeMetaError(cause) };
  }
}

/** Páginas con conexión activa (candidatas a recopilar). */
export function connectedPageIds() {
  return prisma.socialPage.findMany({ where: { isActive: true, connectionStatus: "CONNECTED", facebookPageId: { not: null } }, select: { id: true } }).then((r) => r.map((p) => p.id));
}
