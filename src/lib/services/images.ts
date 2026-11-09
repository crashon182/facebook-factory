import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { ensureDir, resolveInStorage } from "@/lib/storage";
import path from "node:path";
import { ASPECTS, IMAGE_TEMPLATES, renderQuoteImage, type AspectId, type TemplateId } from "@/lib/video/image-templates";
import { logActivity } from "./activity";
import { getDefaultProvider } from "@/lib/integrations/media";
import { MediaProviderError, MediaProviderNotConfiguredError } from "@/lib/integrations/media/types";
import { DownloadError, UnsafeUrlError } from "@/lib/net/safe-fetch";
import { backgroundQueries, chooseCandidate } from "@/lib/media-pick";
import { importCandidate, MediaError } from "./media";

export class ImageError extends Error {}

/** Busca una foto de fondo en el proveedor activo (Pixabay/Pexels), la guarda en la biblioteca y devuelve su ruta local. */
async function autoBackground(post: { pageId: string; imageKeywords: unknown; topic: string | null; page: { topic: string | null; language: string } }, aspect: AspectId): Promise<string> {
  const provider = getDefaultProvider();
  if (!provider) throw new ImageError("No hay un proveedor de fotos configurado (PIXABAY_API_KEY o PEXELS_API_KEY). Elegí una foto de la biblioteca o subí una.");
  try {
    for (const query of backgroundQueries({ imageKeywords: post.imageKeywords, topic: post.topic, pageTopic: post.page.topic })) {
      const res = await provider.search({ query, kind: "photo", quality: "medium", perPage: 20, language: post.page.language, orientation: aspect === "portrait" ? "portrait" : undefined });
      if (!res.items.length) continue;
      const have = await prisma.mediaAsset.findMany({ where: { provider: provider.id, type: "PHOTO", externalId: { in: res.items.map((c) => c.externalId) } }, select: { externalId: true } });
      const cand = chooseCandidate(res.items, new Set(have.flatMap((h) => (h.externalId ? [h.externalId] : []))));
      if (!cand) continue;
      const { asset } = await importCandidate(cand, post.pageId);
      if (!asset.localPath) throw new ImageError("La foto descargada no tiene archivo local.");
      return resolveInStorage(asset.localPath);
    }
  } catch (e) {
    if (e instanceof ImageError) throw e;
    if (e instanceof MediaProviderNotConfiguredError || e instanceof MediaProviderError || e instanceof MediaError) throw new ImageError(`No se pudo traer la foto de fondo: ${e.message}`);
    if (e instanceof UnsafeUrlError || e instanceof DownloadError) throw new ImageError(`Descarga de la foto rechazada: ${e.message}`);
    throw e;
  }
  throw new ImageError("No se encontró una foto de fondo adecuada. Probá elegir una de la biblioteca.");
}

export async function generateQuoteImage(postId: string, o: { text: string; attribution?: string; template: TemplateId; aspect: AspectId; backgroundAssetId?: string }) {
  if (!IMAGE_TEMPLATES.some((t) => t.id === o.template) || !(o.aspect in ASPECTS)) throw new ImageError("Plantilla o formato inválido.");
  const post = await prisma.contentPost.findUnique({ where: { id: postId }, include: { page: true } });
  if (!post) throw new ImageError("El contenido no existe.");
  if (!["DRAFT", "READY", "FAILED"].includes(post.status)) throw new ImageError("Este contenido no admite cambios en su estado actual.");
  const text = o.text.trim();
  if (text.length < 3 || text.length > 600) throw new ImageError("La frase debe tener entre 3 y 600 caracteres.");

  let backgroundFile: string | null = null;
  if (o.template === "photo-veil") {
    if (!o.backgroundAssetId || o.backgroundAssetId === "auto") {
      backgroundFile = await autoBackground(post, o.aspect);
    } else {
      const bg = await prisma.mediaAsset.findUnique({ where: { id: o.backgroundAssetId } });
      if (!bg || bg.type !== "PHOTO" || !bg.localPath) throw new ImageError("Elegí una foto de la biblioteca para esta plantilla.");
      backgroundFile = resolveInStorage(bg.localPath);
    }
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
