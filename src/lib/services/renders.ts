import "server-only";
import { prisma } from "@/lib/db";
import { getTTSProvider } from "@/lib/integrations/tts";
import { enqueueRender, removeQueuedRender } from "@/lib/queue/render-queue";
import { logActivity } from "./activity";

export class RenderError extends Error {}
export const DURATION_OPTIONS = [15, 30, 45] as const;

export async function requestRender(postId: string, opts: { durationSec: number; voice?: string; musicAssetId?: string }) {
  const post = await prisma.contentPost.findUnique({ where: { id: postId }, include: { scenes: true } });
  if (!post) throw new RenderError("El contenido no existe.");
  if (post.format !== "REEL") throw new RenderError("Solo los contenidos de formato Reel se renderizan como video.");
  if (post.scenes.length === 0) throw new RenderError("El Reel no tiene escenas. Regeneralo o agregá escenas.");
  if (!getTTSProvider()) throw new RenderError("La narración (TTS) no está configurada: falta OPENAI_API_KEY (o GEMINI_API_KEY con TTS_PROVIDER=gemini).");
  if (!process.env.REDIS_URL?.trim()) throw new RenderError("Redis no está configurado (REDIS_URL).");
  if (!Number.isInteger(opts.durationSec) || opts.durationSec < 5 || opts.durationSec > 90) throw new RenderError("Duración inválida (5 a 90 segundos).");
  const active = await prisma.videoRenderJob.findFirst({ where: { postId, status: { in: ["QUEUED", "RUNNING"] } } });
  if (active) throw new RenderError("Ya hay un render en curso para este Reel.");
  if (opts.musicAssetId) {
    const m = await prisma.mediaAsset.findUnique({ where: { id: opts.musicAssetId } });
    if (!m || m.type !== "AUDIO" || !m.license?.trim()) throw new RenderError("La música elegida no existe o no tiene licencia registrada.");
  }
  const job = await prisma.videoRenderJob.create({
    data: { postId, durationSec: opts.durationSec, status: "QUEUED", stage: "en cola", options: { voice: opts.voice || undefined, musicAssetId: opts.musicAssetId || undefined } },
  });
  try {
    await enqueueRender(job.id);
  } catch {
    await prisma.videoRenderJob.update({ where: { id: job.id }, data: { status: "FAILED", error: "No se pudo encolar: Redis no está disponible.", finishedAt: new Date() } });
    throw new RenderError("No se pudo encolar el render: Redis no está disponible.");
  }
  await logActivity({ action: "reel.queued", message: `Render de Reel encolado: ${post.internalTitle}`, pageId: post.pageId, entity: "VideoRenderJob", entityId: job.id });
  return job.id;
}

export async function cancelRender(jobId: string) {
  const job = await prisma.videoRenderJob.findUnique({ where: { id: jobId } });
  if (!job) throw new RenderError("El render no existe.");
  if (!["QUEUED", "RUNNING"].includes(job.status)) throw new RenderError("El render ya terminó.");
  await prisma.videoRenderJob.update({ where: { id: jobId }, data: { status: "CANCELLED", stage: "cancelado", finishedAt: new Date() } });
  await removeQueuedRender(jobId).catch(() => {});
}

export function listRenders(postId: string) {
  return prisma.videoRenderJob.findMany({ where: { postId }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, status: true, progress: true, stage: true, durationSec: true, outputPath: true, thumbnailPath: true, error: true, attempts: true, createdAt: true, finishedAt: true } });
}

export function getRender(jobId: string) {
  return prisma.videoRenderJob.findUnique({ where: { id: jobId } });
}
