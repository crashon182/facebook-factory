import "server-only";
import { prisma } from "@/lib/db";
import { getDefaultProvider } from "@/lib/integrations/media";
import { generateQuoteImage } from "@/lib/services/images";
import { importCandidate } from "@/lib/services/media";
import { requestRender } from "@/lib/services/renders";

export type MediaDeps = {
  quoteImage: typeof generateQuoteImage;
  requestRender: typeof requestRender;
  defaultProvider: typeof getDefaultProvider;
  importCandidate: typeof importCandidate;
};
const real: MediaDeps = { quoteImage: generateQuoteImage, requestRender, defaultProvider: getDefaultProvider, importCandidate };

const firstSentence = (t: string) => (t.match(/^[\s\S]{20,220}?[.!?…](?=\s|$)/)?.[0] ?? t).slice(0, 220).trim();

/**
 * Prepara el medio que necesita un contenido generado automáticamente:
 *  - QUOTE_IMAGE → renderiza la imagen con frase (plantilla según los colores de la página)
 *  - IMAGE → descarga una foto del proveedor activo según las palabras clave
 *  - REEL → encola el render del video (worker de render)
 * Devuelve una nota legible; nunca lanza por falta de proveedor (queda pendiente y se avisa).
 */
export async function prepareMedia(postId: string, deps: Partial<MediaDeps> = {}): Promise<string> {
  const d = { ...real, ...deps };
  const post = await prisma.contentPost.findUnique({ where: { id: postId }, include: { page: true } });
  if (!post) return "El contenido ya no existe.";

  if (post.format === "QUOTE_IMAGE") {
    const has = await prisma.mediaAsset.count({ where: { postId, type: "RENDERED_IMAGE" } });
    if (has) return "La imagen ya existe.";
    const text = (post.imageText?.trim() || firstSentence(post.facebookCaption ?? post.body ?? "")).trim();
    if (text.length < 3) return "Sin frase para la imagen.";
    const branded = !!(post.page.primaryColor && post.page.secondaryColor);
    await d.quoteImage(postId, { text, template: branded ? "brand-gradient" : "classic-dark", aspect: "square" });
    return "Imagen con frase generada.";
  }

  if (post.format === "IMAGE") {
    if (post.mediaAssetId) return "La foto ya está asignada.";
    const provider = d.defaultProvider();
    const kws = Array.isArray(post.imageKeywords) ? (post.imageKeywords as string[]).filter(Boolean) : [];
    if (!provider) return "Sin proveedor multimedia configurado: la foto queda pendiente de asignar.";
    if (!kws.length) return "El contenido no tiene palabras clave para buscar la foto.";
    for (const q of [kws.slice(0, 3).join(" "), kws[0]]) {
      const res = await provider.search({ query: q, kind: "photo", quality: "large", perPage: 10 });
      const cand = res.items.find((c) => c.width >= 800) ?? res.items[0];
      if (!cand) continue;
      const { asset } = await d.importCandidate(cand, post.pageId);
      await prisma.contentPost.update({ where: { id: postId }, data: { mediaAssetId: asset.id } });
      return `Foto asignada desde ${provider.name} (${asset.externalId}).`;
    }
    return "No se encontró una foto adecuada: queda pendiente de asignar.";
  }

  if (post.format === "REEL") {
    const done = await prisma.videoRenderJob.count({ where: { postId, status: { in: ["COMPLETED", "QUEUED", "RUNNING"] } } });
    if (done) return "El video ya está listo o en proceso.";
    try {
      await d.requestRender(postId, { durationSec: 30 });
      return "Render del Reel encolado.";
    } catch (e) {
      return `No se pudo encolar el render: ${(e as Error).message}`;
    }
  }
  return "No requiere medios.";
}
