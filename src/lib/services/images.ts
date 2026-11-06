import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { ensureDir, resolveInStorage } from "@/lib/storage";
import path from "node:path";
import { ASPECTS, IMAGE_TEMPLATES, renderQuoteImage, type AspectId, type TemplateId } from "@/lib/video/image-templates";
import { logActivity } from "./activity";

export class ImageError extends Error {}

export async function generateQuoteImage(postId: string, o: { text: string; attribution?: string; template: TemplateId; aspect: AspectId; backgroundAssetId?: string }) {
  if (!IMAGE_TEMPLATES.some((t) => t.id === o.template) || !(o.aspect in ASPECTS)) throw new ImageError("Plantilla o formato inválido.");
  const post = await prisma.contentPost.findUnique({ where: { id: postId }, include: { page: true } });
  if (!post) throw new ImageError("El contenido no existe.");
  if (!["DRAFT", "READY", "FAILED"].includes(post.status)) throw new ImageError("Este contenido no admite cambios en su estado actual.");
  const text = o.text.trim();
  if (text.length < 3 || text.length > 600) throw new ImageError("La frase debe tener entre 3 y 600 caracteres.");

  let backgroundFile: string | null = null;
  if (o.template === "photo-veil") {
    const bg = o.backgroundAssetId ? await prisma.mediaAsset.findUnique({ where: { id: o.backgroundAssetId } }) : null;
    if (!bg || bg.type !== "PHOTO" || !bg.localPath) throw new ImageError("Elegí una foto de la biblioteca para esta plantilla.");
    backgroundFile = resolveInStorage(bg.localPath);
  }
  const rel = `images/${post.id}/${randomUUID()}.png`;
  const abs = resolveInStorage(rel);
  await ensureDir(path.dirname(abs));
  await renderQuoteImage({
    text, attribution: o.attribution?.trim() || null, brandName: post.page.name, template: o.template, aspect: o.aspect,
    primaryColor: post.page.primaryColor, secondaryColor: post.page.secondaryColor, backgroundFile, outFile: abs,
  });
  const { w, h } = ASPECTS[o.aspect];
  const asset = await prisma.mediaAsset.create({
    data: { postId: post.id, pageId: post.pageId, type: "RENDERED_IMAGE", provider: "template", localPath: rel, title: `${IMAGE_TEMPLATES.find((t) => t.id === o.template)!.label} · ${o.aspect}`, width: w, height: h, mimeType: "image/png", thumbPath: rel, license: "Generada por el sistema (el fondo fotográfico conserva su propia licencia)." },
  });
  await prisma.contentPost.update({ where: { id: post.id }, data: { imageText: text } });
  await logActivity({ action: "image.generated", message: `Imagen con frase generada: ${post.internalTitle}`, pageId: post.pageId, entity: "MediaAsset", entityId: asset.id });
  return asset;
}
