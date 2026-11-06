import "server-only";
import { access } from "node:fs/promises";
import { prisma } from "@/lib/db";
import { idempotencyKey, publishKindFor } from "@/lib/integrations/meta/compose";
import { planSlots } from "@/lib/scheduling/plan";
import { dayKey, startOfDayUtc, addDaysKey } from "@/lib/time/tz";
import { resolveInStorage } from "@/lib/storage";
import { strategySchema } from "@/lib/validation/strategy";
import { logActivity } from "./activity";


export class SchedulingError extends Error {}

export const MIN_LEAD_MS = 2 * 60_000;
export const MAX_AHEAD_MS = 365 * 24 * 3600_000;
export const REELS_PER_24H = 30; // límite de la Reels API de Meta

const exists = (p: string) => access(p).then(() => true, () => false);

/** Medio que se publicará con este contenido (o null si falta). */
export async function resolvePublishMedia(postId: string, format: string): Promise<{ kind: "photo" | "reel"; file: string } | null> {
  const kind = publishKindFor(format);
  if (kind === "photo") {
    // Prioridad: imagen generada por el sistema para este contenido; si no, la foto principal elegida/descargada.
    const own = await prisma.mediaAsset.findFirst({ where: { postId, type: { in: ["RENDERED_IMAGE", "PHOTO"] } }, orderBy: { createdAt: "desc" } });
    const primary = own ? null : (await prisma.contentPost.findUnique({ where: { id: postId }, select: { mediaAsset: true } }))?.mediaAsset;
    const a = own ?? (primary && primary.type === "PHOTO" ? primary : null);
    return a?.localPath ? { kind: "photo", file: resolveInStorage(a.localPath) } : null;
  }
  if (kind === "reel") {
    const j = await prisma.videoRenderJob.findFirst({ where: { postId, status: "COMPLETED", outputPath: { not: null } }, orderBy: { createdAt: "desc" } });
    return j?.outputPath ? { kind: "reel", file: resolveInStorage(j.outputPath) } : null;
  }
  return null;
}

export type ScheduleOptions = { allowOverLimit?: boolean; immediate?: boolean; now?: Date };

async function validate(postId: string, when: Date, opts: ScheduleOptions) {
  const now = opts.now ?? new Date();
  const post = await prisma.contentPost.findUnique({ where: { id: postId }, include: { page: { include: { automation: true } }, schedule: true } });
  if (!post) throw new SchedulingError("El contenido no existe.");
  const page = post.page;
  const rule = page.automation;

  const reschedulable = post.status === "SCHEDULED" && post.schedule?.status === "SCHEDULED";
  if (post.status !== "READY" && !reschedulable && !(post.status === "FAILED" && post.schedule)) {
    throw new SchedulingError("Solo se puede programar un contenido en estado Listo (o reprogramar uno programado).");
  }
  if (!page.isActive) throw new SchedulingError("La página está inactiva.");
  if (page.connectionStatus !== "CONNECTED" || !page.accessTokenEnc || !page.facebookPageId) throw new SchedulingError("La página no está conectada a Facebook. Conectala desde su detalle.");
  if ((rule?.requireApproval ?? true) && !post.approved) throw new SchedulingError("El contenido debe estar aprobado antes de programarlo.");
  if (!opts.immediate) {
    if (when.getTime() < now.getTime() + MIN_LEAD_MS) throw new SchedulingError("La fecha debe ser al menos 2 minutos en el futuro.");
    if (when.getTime() > now.getTime() + MAX_AHEAD_MS) throw new SchedulingError("La fecha no puede superar un año.");
  }

  const kind = publishKindFor(post.format);
  const hasText = !!(post.facebookCaption?.trim() || post.body?.trim()); // los hashtags solos no alcanzan
  if (kind === "text" && !hasText) throw new SchedulingError("El contenido no tiene texto para publicar.");
  if (kind === "photo") {
    const m = await resolvePublishMedia(post.id, post.format);
    if (!m || !(await exists(m.file))) throw new SchedulingError("Generá la imagen (o asociá una foto) antes de programar.");
    if (!hasText) throw new SchedulingError("La imagen necesita un texto (caption) para publicarse.");
  }
  if (kind === "reel") {
    const m = await resolvePublishMedia(post.id, post.format);
    if (!m || !(await exists(m.file))) throw new SchedulingError("Renderizá el video del Reel antes de programarlo.");
    const from = new Date(when.getTime() - 24 * 3600_000);
    const to = new Date(when.getTime() + 24 * 3600_000);
    const n = await prisma.publicationSchedule.count({ where: { pageId: page.id, postId: { not: post.id }, status: { in: ["SCHEDULED", "PUBLISHING", "PUBLISHED"] }, scheduledAt: { gt: from, lt: to }, post: { format: "REEL" } } });
    if (n >= REELS_PER_24H) throw new SchedulingError(`Meta permite ${REELS_PER_24H} Reels por API cada 24 horas en una Página; ya hay ${n} en esa ventana.`);
  }

  if (rule && !opts.allowOverLimit) {
    const start = startOfDayUtc(dayKey(when, page.timezone), page.timezone);
    const end = startOfDayUtc(addDaysKey(dayKey(when, page.timezone), 1), page.timezone);
    const n = await prisma.publicationSchedule.count({ where: { pageId: page.id, postId: { not: post.id }, status: { in: ["SCHEDULED", "PUBLISHING", "PUBLISHED"] }, scheduledAt: { gte: start, lt: end } } });
    if (n >= rule.maxPostsPerDay) throw new SchedulingError(`Se alcanzó el máximo de ${rule.maxPostsPerDay} publicación(es) por día para esta página. Podés superarlo confirmando la opción correspondiente o subir el límite.`);
  }
  return { post, page };
}

/** Programa o reprograma. La clave de idempotencia depende de (contenido, fecha): un mismo horario no se duplica. */
export async function schedulePost(postId: string, when: Date, opts: ScheduleOptions = {}) {
  const { post, page } = await validate(postId, when, opts);
  const key = idempotencyKey(post.id, when);
  const clash = await prisma.publicationSchedule.findUnique({ where: { idempotencyKey: key } });
  if (clash && clash.postId !== post.id) throw new SchedulingError("Conflicto de programación.");

  const schedule = await prisma.$transaction(async (tx) => {
    const s = await tx.publicationSchedule.upsert({
      where: { postId: post.id },
      create: { pageId: page.id, postId: post.id, scheduledAt: when, status: "SCHEDULED", idempotencyKey: key },
      update: { scheduledAt: when, status: "SCHEDULED", idempotencyKey: key, nextAttemptAt: null, lastError: null },
    });
    await tx.contentPost.update({ where: { id: post.id }, data: { status: "SCHEDULED", scheduledAt: when, failureReason: null } });
    return s;
  });
  await logActivity({ action: "post.scheduled", message: `Programado: ${post.internalTitle} (${when.toISOString()})`, pageId: page.id, entity: "ContentPost", entityId: post.id });
  return schedule;
}

/** Quita la programación y devuelve el contenido a «Listo». No se puede si ya se está publicando. */
export async function unschedulePost(postId: string) {
  const s = await prisma.publicationSchedule.findUnique({ where: { postId }, include: { post: true } });
  if (!s || s.status !== "SCHEDULED") {
    if (s?.status === "PUBLISHING") throw new SchedulingError("Se está publicando en este momento; no se puede cancelar.");
    throw new SchedulingError("El contenido no está programado.");
  }
  const upd = await prisma.publicationSchedule.updateMany({ where: { id: s.id, status: "SCHEDULED" }, data: { status: "CANCELLED", nextAttemptAt: null } });
  if (upd.count !== 1) throw new SchedulingError("Se está publicando en este momento; no se puede cancelar.");
  await prisma.contentPost.update({ where: { id: postId }, data: { status: "READY", scheduledAt: null } });
  await logActivity({ action: "post.unscheduled", message: `Programación cancelada: ${s.post.internalTitle}`, level: "WARN", pageId: s.pageId, entity: "ContentPost", entityId: postId });
}

/** Reintento manual de un contenido fallido: vuelve a quedar programado para ahora. */
export async function retryFailed(postId: string, now = new Date()) {
  const s = await prisma.publicationSchedule.findUnique({ where: { postId }, include: { post: true } });
  if (!s || s.status !== "FAILED") throw new SchedulingError("Solo se puede reintentar una publicación fallida.");
  await prisma.$transaction([
    prisma.publicationSchedule.update({ where: { id: s.id }, data: { status: "SCHEDULED", scheduledAt: now, nextAttemptAt: null, lastError: null, idempotencyKey: idempotencyKey(postId, now) } }),
    prisma.contentPost.update({ where: { id: postId }, data: { status: "SCHEDULED", scheduledAt: now, failureReason: null } }),
  ]);
  await logActivity({ action: "post.retry", message: `Reintento manual: ${s.post.internalTitle}`, pageId: s.pageId, entity: "ContentPost", entityId: postId });
}

/** Programa automáticamente los contenidos listos y aprobados de una página según su estrategia y reglas. */
export async function autoSchedulePage(pageId: string, now = new Date()) {
  const page = await prisma.socialPage.findUniqueOrThrow({ where: { id: pageId }, include: { automation: true } });
  const rule = page.automation;
  const candidates = await prisma.contentPost.findMany({ where: { pageId, status: "READY", approved: true, schedule: null }, orderBy: { createdAt: "asc" }, take: 60 });
  if (candidates.length === 0) return { scheduled: [] as { postId: string; at: Date }[], skipped: [] as { postId: string; reason: string }[] };

  const strat = await prisma.pageStrategy.findFirst({ where: { pageId, status: "ACTIVE" }, orderBy: { version: "desc" } });
  const parsed = strat ? strategySchema.safeParse(strat.data) : null;
  const existingRows = await prisma.publicationSchedule.findMany({ where: { pageId, status: { in: ["SCHEDULED", "PUBLISHING", "PUBLISHED"] }, scheduledAt: { gte: new Date(now.getTime() - 24 * 3600_000) } }, select: { scheduledAt: true } });
  const existing: Record<string, number> = {};
  for (const r of existingRows) existing[dayKey(r.scheduledAt, page.timezone)] = (existing[dayKey(r.scheduledAt, page.timezone)] ?? 0) + 1;

  const slots = planSlots({
    tz: page.timezone, now, count: candidates.length,
    hypotheses: parsed?.success ? parsed.data.postingTimeHypotheses : [],
    windowStart: rule?.windowStart ?? "09:00", windowEnd: rule?.windowEnd ?? "21:00", maxPerDay: rule?.maxPostsPerDay ?? 1,
    publishDays: Array.isArray(rule?.publishDays) ? (rule!.publishDays as number[]) : null, existing,
  });

  const scheduled: { postId: string; at: Date }[] = [];
  const skipped: { postId: string; reason: string }[] = [];
  for (const [i, post] of candidates.entries()) {
    const at = slots[i];
    if (!at) { skipped.push({ postId: post.id, reason: "No hay más horarios disponibles en el horizonte de 60 días." }); continue; }
    try {
      await schedulePost(post.id, at, { now });
      scheduled.push({ postId: post.id, at });
    } catch (e) {
      skipped.push({ postId: post.id, reason: e instanceof SchedulingError ? e.message : "Error inesperado" });
    }
  }
  return { scheduled, skipped };
}
