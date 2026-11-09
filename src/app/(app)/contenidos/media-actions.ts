"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { cancelRender, listRenders, RenderError, requestRender } from "@/lib/services/renders";
import { generateQuoteImage, ImageError } from "@/lib/services/images";
import { IMAGE_TEMPLATES } from "@/lib/video/image-templates";
import type { ActionResult } from "@/lib/action-result";

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof z.ZodError) return { ok: false, error: z.prettifyError(e) };
  if (e instanceof RenderError || e instanceof ImageError) return { ok: false, error: e.message };
  console.error("[content.media.action]", e instanceof Error ? e.message : e, (e as { stderrTail?: string })?.stderrTail ?? ""); // stderrTail: lo que dijo FFmpeg
  return { ok: false, error: "Ocurrió un error inesperado" };
}

const renderSchema = z.object({ durationSec: z.number().int().min(5).max(90), musicAssetId: z.string().optional() });

export async function requestRenderAction(postId: string, input: unknown): Promise<ActionResult<{ jobId: string }>> {
  const user = await requireAdmin();
  if (!(await rateLimit(`render:${user.id}`, 10, 60_000)).ok) return { ok: false, error: "Demasiados renders seguidos." };
  try {
    const o = renderSchema.parse(input);
    const jobId = await requestRender(z.string().min(1).parse(postId), { durationSec: o.durationSec, musicAssetId: o.musicAssetId || undefined });
    revalidatePath(`/contenidos/${postId}`);
    return { ok: true, data: { jobId } };
  } catch (e) {
    return fail(e);
  }
}

export async function cancelRenderAction(jobId: string, postId: string): Promise<ActionResult<null>> {
  await requireAdmin();
  try {
    await cancelRender(jobId);
    revalidatePath(`/contenidos/${postId}`);
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

export type RenderRow = { id: string; status: string; progress: number; stage: string | null; durationSec: number; outputPath: string | null; thumbnailPath: string | null; error: string | null; attempts: number; createdAt: string };

/** Consulta de estado para el sondeo desde el cliente. */
export async function getRendersAction(postId: string): Promise<RenderRow[]> {
  await requireAdmin();
  return (await listRenders(postId)).map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

export async function getRenderLogsAction(jobId: string): Promise<string> {
  await requireAdmin();
  return (await prisma.videoRenderJob.findUnique({ where: { id: jobId }, select: { logs: true } }))?.logs ?? "";
}

export async function setSceneMediaAction(sceneId: string, assetId: string | null): Promise<ActionResult<null>> {
  await requireAdmin();
  try {
    if (assetId) {
      const a = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
      if (!a || !(a.type === "VIDEO" || a.type === "PHOTO")) return { ok: false, error: "El recurso elegido no es una foto o video." };
    }
    const scene = await prisma.contentScene.update({ where: { id: sceneId }, data: { mediaAssetId: assetId } });
    revalidatePath(`/contenidos/${scene.postId}`);
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

const imageSchema = z.object({
  text: z.string().trim().min(3).max(600),
  attribution: z.string().trim().max(120).optional(),
  template: z.enum(IMAGE_TEMPLATES.map((t) => t.id) as [string, ...string[]]),
  aspect: z.enum(["square", "portrait"]),
  backgroundAssetId: z.string().optional(),
});

export async function generateImageAction(postId: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  try {
    const o = imageSchema.parse(input);
    const asset = await generateQuoteImage(postId, { ...o, template: o.template as never, backgroundAssetId: o.backgroundAssetId || undefined });
    revalidatePath(`/contenidos/${postId}`);
    revalidatePath("/multimedia");
    return { ok: true, data: { id: asset.id } };
  } catch (e) {
    return fail(e);
  }
}

/** Foto principal de un contenido de formato Imagen (la que se publicará si no hay una imagen generada). */
export async function setPostPhotoAction(postId: string, assetId: string | null): Promise<ActionResult<null>> {
  await requireAdmin();
  try {
    const post = await prisma.contentPost.findUnique({ where: { id: postId }, select: { status: true, format: true } });
    if (!post) return { ok: false, error: "El contenido no existe." };
    if (!["DRAFT", "READY", "FAILED"].includes(post.status)) return { ok: false, error: "Este contenido no admite cambios en su estado actual." };
    if (assetId) {
      const a = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
      if (!a || a.type !== "PHOTO") return { ok: false, error: "Elegí una foto de la biblioteca." };
    }
    await prisma.contentPost.update({ where: { id: postId }, data: { mediaAssetId: assetId, approved: false } });
    revalidatePath(`/contenidos/${postId}`);
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}
