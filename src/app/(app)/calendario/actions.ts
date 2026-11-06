"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { enqueuePublish } from "@/lib/queue/publish-queue";
import { autoSchedulePage, retryFailed, schedulePost, SchedulingError, unschedulePost } from "@/lib/services/scheduling";
import { parseLocalInput } from "@/lib/time/tz";
import type { ActionResult } from "@/lib/action-result";

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof SchedulingError) return { ok: false, error: e.message };
  if (e instanceof z.ZodError) return { ok: false, error: z.prettifyError(e) };
  if (e instanceof Error && /Fecha y hora inválidas|Fecha inválida/.test(e.message)) return { ok: false, error: "Fecha y hora inválidas." };
  console.error("[calendar.action]", e instanceof Error ? e.message : e);
  return { ok: false, error: "Ocurrió un error inesperado" };
}
const done = (postId?: string) => {
  revalidatePath("/calendario");
  revalidatePath("/contenidos");
  revalidatePath("/");
  if (postId) revalidatePath(`/contenidos/${postId}`);
};

const when = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

/** La fecha ingresada se interpreta en la zona horaria de la página y se guarda en UTC. */
export async function scheduleAction(postId: string, localDateTime: string, allowOverLimit = false): Promise<ActionResult<{ atIso: string }>> {
  await requireAdmin();
  try {
    const post = await prisma.contentPost.findUnique({ where: { id: z.string().min(1).parse(postId) }, select: { page: { select: { timezone: true } } } });
    if (!post) return { ok: false, error: "El contenido no existe." };
    const at = parseLocalInput(when.parse(localDateTime), post.page.timezone);
    const s = await schedulePost(postId, at, { allowOverLimit });
    done(postId);
    return { ok: true, data: { atIso: s.scheduledAt.toISOString() } };
  } catch (e) {
    return fail(e);
  }
}

export async function unscheduleAction(postId: string): Promise<ActionResult<null>> {
  await requireAdmin();
  try {
    await unschedulePost(postId);
    done(postId);
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

/** Publica ahora: programa para este instante y encola. El reclamo atómico evita duplicados aunque se pulse dos veces. */
export async function publishNowAction(postId: string): Promise<ActionResult<null>> {
  const user = await requireAdmin();
  if (!rateLimit(`publish-now:${user.id}`, 10, 60_000).ok) return { ok: false, error: "Demasiadas publicaciones seguidas." };
  try {
    const current = await prisma.publicationSchedule.findUnique({ where: { postId }, select: { id: true, status: true } });
    let id = current?.id;
    if (!current || current.status !== "SCHEDULED") {
      const s = await schedulePost(postId, new Date(), { immediate: true, allowOverLimit: true });
      id = s.id;
    } else {
      await prisma.publicationSchedule.update({ where: { id: current.id }, data: { scheduledAt: new Date(), nextAttemptAt: null } });
      await prisma.contentPost.update({ where: { id: postId }, data: { scheduledAt: new Date() } });
    }
    await enqueuePublish(id!).catch(() => { throw new SchedulingError("Quedó programado para ahora, pero no se pudo encolar (Redis). Se publicará cuando el worker esté activo."); });
    done(postId);
    return { ok: true, data: null };
  } catch (e) {
    done(postId);
    return fail(e);
  }
}

export async function retryAction(postId: string): Promise<ActionResult<null>> {
  await requireAdmin();
  try {
    await retryFailed(postId);
    done(postId);
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

export async function autoScheduleAction(pageId: string): Promise<ActionResult<{ scheduled: number; skipped: string[] }>> {
  await requireAdmin();
  try {
    const r = await autoSchedulePage(z.string().min(1).parse(pageId));
    done();
    return { ok: true, data: { scheduled: r.scheduled.length, skipped: [...new Set(r.skipped.map((s) => s.reason))] } };
  } catch (e) {
    return fail(e);
  }
}

export type PublicationDetails = {
  id: string; title: string; format: string; status: string; approved: boolean; pageName: string; tz: string;
  caption: string; hashtags: string[]; scheduledAtIso: string | null; publishedAtIso: string | null; facebookPostId: string | null;
  failureReason: string | null; scheduleStatus: string | null; imagePath: string | null; videoPath: string | null; thumbPath: string | null;
  attempts: { no: number; status: string; startedAt: string; error: string | null; objectId: string | null }[];
};

export async function getPublicationDetailsAction(postId: string): Promise<PublicationDetails | null> {
  await requireAdmin();
  const p = await prisma.contentPost.findUnique({
    where: { id: postId },
    include: { page: { select: { name: true, timezone: true } }, schedule: { include: { attempts: { orderBy: { attemptNo: "asc" } } } } },
  });
  if (!p) return null;
  const [img, job] = await Promise.all([
    p.format === "REEL" ? null : prisma.mediaAsset.findFirst({ where: { postId, type: { in: ["RENDERED_IMAGE", "PHOTO"] } }, orderBy: { createdAt: "desc" } }),
    p.format === "REEL" ? prisma.videoRenderJob.findFirst({ where: { postId, status: "COMPLETED", outputPath: { not: null } }, orderBy: { createdAt: "desc" } }) : null,
  ]);
  return {
    id: p.id, title: p.internalTitle, format: p.format, status: p.status, approved: p.approved, pageName: p.page.name, tz: p.page.timezone,
    caption: p.facebookCaption ?? p.body ?? "", hashtags: Array.isArray(p.hashtags) ? (p.hashtags as string[]) : [],
    scheduledAtIso: p.scheduledAt?.toISOString() ?? null, publishedAtIso: p.publishedAt?.toISOString() ?? null, facebookPostId: p.facebookPostId,
    failureReason: p.failureReason, scheduleStatus: p.schedule?.status ?? null,
    imagePath: img?.localPath ?? null, videoPath: job?.outputPath ?? null, thumbPath: job?.thumbnailPath ?? null,
    attempts: (p.schedule?.attempts ?? []).map((a) => ({ no: a.attemptNo, status: a.status, startedAt: a.startedAt.toISOString(), error: a.errorMessage, objectId: a.facebookObjectId })),
  };
}
