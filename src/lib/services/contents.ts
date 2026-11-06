import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import type { ContentFormat, Prisma } from "@/generated/prisma/client";
import { PAGE_SIZE } from "@/lib/constants";
import { generateStructured, userMessageForError } from "@/lib/integrations/openai/client";
import { buildContentPrompt } from "@/lib/prompts/content";
import { generatedContentSchema, type ContentEditInput, type GenerateRequest, contentEditSchema, type GeneratedContent } from "@/lib/validation/content";
import { getActiveStrategy } from "./strategies";
import { canTransition, isCancellable, isDeletable, isEditable, type PostStatus } from "./content-status";
import { logActivity } from "./activity";

export class ContentError extends Error {}

export function hashBody(text: string) {
  return createHash("sha256").update(text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()).digest("hex");
}

export type ContentListQuery = { q?: string; pageId?: string; status: string; format: string; page: number };

export async function listContents(query: ContentListQuery) {
  const where: Prisma.ContentPostWhereInput = {};
  if (query.q) where.OR = [{ internalTitle: { contains: query.q } }, { topic: { contains: query.q } }, { body: { contains: query.q } }];
  if (query.pageId) where.pageId = query.pageId;
  if (query.status !== "all") where.status = query.status as PostStatus;
  if (query.format !== "all") where.format = query.format as ContentFormat;
  const [total, items] = await Promise.all([
    prisma.contentPost.count({ where }),
    prisma.contentPost.findMany({ where, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { page: { select: { id: true, name: true } } } }),
  ]);
  return { total, items, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export function getContent(id: string) {
  return prisma.contentPost.findUnique({ where: { id }, include: { page: true, scenes: { orderBy: { sceneOrder: "asc" } }, idea: true, pillar: true } });
}

async function runGeneration(postId: string, req: { pageId: string; format: ContentFormat; topic?: string; ideaId?: string | null }) {
  const page = await prisma.socialPage.findUniqueOrThrow({ where: { id: req.pageId } });
  const [active, rule, recent, idea] = await Promise.all([
    getActiveStrategy(req.pageId),
    prisma.automationRule.findUnique({ where: { pageId: req.pageId } }),
    prisma.contentPost.findMany({ where: { pageId: req.pageId, id: { not: postId }, status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" }, take: 25, select: { internalTitle: true, topic: true } }),
    req.ideaId ? prisma.contentIdea.findUnique({ where: { id: req.ideaId } }) : null,
  ]);
  const { system, user } = buildContentPrompt({ page, strategy: active?.strategy ?? null, format: req.format, topic: req.topic, ideaSummary: idea ? `${idea.title}. ${idea.summary ?? ""}` : undefined, recent, rule });

  // Hasta 2 intentos si la IA repite contenido ya existente en la página.
  let out: GeneratedContent | null = null;
  let hash = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const extra = attempt ? "\n\nIMPORTANTE: el intento anterior repetía contenido existente. Elegí un ángulo claramente distinto." : "";
    const res = await generateStructured({ schema: generatedContentSchema, schemaName: "content_post", system, user: user + extra, operation: "content.generate", pageId: req.pageId, maxOutputTokens: 6000 });
    out = res.data;
    hash = hashBody(out.facebookCaption || out.body);
    const dup = await prisma.contentPost.findFirst({ where: { pageId: req.pageId, contentHash: hash, id: { not: postId }, status: { not: "CANCELLED" } }, select: { id: true } });
    if (!dup) break;
    if (attempt === 1) throw new ContentError("La IA generó contenido repetido dos veces. Probá con otro tema.");
  }
  if (!out) throw new ContentError("No se generó contenido.");
  const data = out;

  await prisma.$transaction(async (tx) => {
    await tx.contentScene.deleteMany({ where: { postId } });
    await tx.contentPost.update({
      where: { id: postId },
      data: {
        internalTitle: data.internalTitle.slice(0, 200),
        topic: data.topic.slice(0, 300),
        body: data.imageText && req.format === "QUOTE_IMAGE" ? `${data.body}\n\n[Frase en imagen] ${data.imageText}` : data.body,
        facebookCaption: data.facebookCaption,
        script: data.script,
        hashtags: data.hashtags.map((h) => h.replace(/^#+/, "").trim()).filter(Boolean),
        status: "READY",
        approved: false,
        contentHash: hash,
        failureReason: null,
      },
    });
    if (req.format === "REEL" && data.scenes.length) {
      await tx.contentScene.createMany({ data: data.scenes.map((s, i) => ({ postId, sceneOrder: i + 1, narration: s.narration, visualKeywords: s.visualKeywords })) });
    }
    if (req.ideaId) await tx.contentIdea.update({ where: { id: req.ideaId }, data: { status: "USED" } });
  });
}

/** Crea el contenido en estado GENERATING y lo completa; si falla queda FAILED con el motivo. */
export async function generateContent(req: Omit<GenerateRequest, "topic"> & { topic?: string }) {
  const page = await prisma.socialPage.findUniqueOrThrow({ where: { id: req.pageId } });
  const post = await prisma.contentPost.create({
    data: { pageId: req.pageId, ideaId: req.ideaId ?? null, internalTitle: `Generando… (${req.format})`, format: req.format, topic: req.topic ?? null, status: "GENERATING" },
  });
  try {
    await runGeneration(post.id, { pageId: req.pageId, format: req.format, topic: req.topic, ideaId: req.ideaId });
  } catch (e) {
    const reason = e instanceof ContentError ? e.message : userMessageForError(e);
    await prisma.contentPost.update({ where: { id: post.id }, data: { status: "FAILED", failureReason: reason } });
    await logActivity({ action: "content.failed", message: `Falló la generación en ${page.name}: ${reason}`, level: "ERROR", pageId: page.id, entity: "ContentPost", entityId: post.id });
    throw new ContentError(reason);
  }
  await logActivity({ action: "content.generated", message: `Contenido generado para ${page.name}`, pageId: page.id, entity: "ContentPost", entityId: post.id });
  return post.id;
}

async function mustGet(id: string) {
  const p = await prisma.contentPost.findUnique({ where: { id } });
  if (!p) throw new ContentError("El contenido no existe.");
  return p;
}

export async function regenerateContent(id: string) {
  const p = await mustGet(id);
  if (!isEditable(p.status) && p.status !== "FAILED") throw new ContentError("Este contenido no se puede regenerar en su estado actual.");
  await prisma.contentPost.update({ where: { id }, data: { status: "GENERATING", approved: false } });
  try {
    await runGeneration(id, { pageId: p.pageId, format: p.format, topic: p.topic ?? undefined, ideaId: null });
  } catch (e) {
    const reason = e instanceof ContentError ? e.message : userMessageForError(e);
    await prisma.contentPost.update({ where: { id }, data: { status: "FAILED", failureReason: reason } });
    throw new ContentError(reason);
  }
  await logActivity({ action: "content.regenerated", message: `Contenido regenerado: ${p.internalTitle}`, pageId: p.pageId, entity: "ContentPost", entityId: id });
}

export async function createDraft(pageId: string, format: ContentFormat) {
  const post = await prisma.contentPost.create({ data: { pageId, internalTitle: "Borrador sin título", format, status: "DRAFT" } });
  await logActivity({ action: "content.drafted", message: "Borrador manual creado", pageId, entity: "ContentPost", entityId: post.id });
  return post.id;
}

export async function updateContent(id: string, input: ContentEditInput) {
  const p = await mustGet(id);
  if (!isEditable(p.status as PostStatus)) throw new ContentError("Este contenido no se puede editar en su estado actual.");
  const v = contentEditSchema.parse(input);
  const text = v.facebookCaption || v.body || "";
  await prisma.contentPost.update({
    where: { id },
    data: { ...v, contentHash: text ? hashBody(text) : null, approved: false, status: p.status === "DRAFT" || p.status === "CANCELLED" ? p.status : "READY" },
  });
  await logActivity({ action: "content.edited", message: `Contenido editado: ${v.internalTitle}`, pageId: p.pageId, entity: "ContentPost", entityId: id });
}

export async function markReady(id: string) {
  const p = await mustGet(id);
  if (!canTransition(p.status as PostStatus, "READY")) throw new ContentError("No se puede marcar como listo desde este estado.");
  if (!p.facebookCaption && !p.body) throw new ContentError("Agregá texto antes de marcar el contenido como listo.");
  await prisma.contentPost.update({ where: { id }, data: { status: "READY" } });
}

export async function setApproved(id: string, approved: boolean) {
  const p = await mustGet(id);
  if (p.status !== "READY") throw new ContentError("Solo se puede aprobar un contenido en estado Listo.");
  await prisma.contentPost.update({ where: { id }, data: { approved } });
  await logActivity({ action: approved ? "content.approved" : "content.unapproved", message: `${approved ? "Aprobado" : "Aprobación retirada"}: ${p.internalTitle}`, pageId: p.pageId, entity: "ContentPost", entityId: id });
}

export async function duplicateContent(id: string) {
  const p = await prisma.contentPost.findUnique({ where: { id }, include: { scenes: true } });
  if (!p) throw new ContentError("El contenido no existe.");
  const copy = await prisma.contentPost.create({
    data: {
      pageId: p.pageId, pillarId: p.pillarId, internalTitle: `${p.internalTitle} (copia)`.slice(0, 200), topic: p.topic, format: p.format,
      body: p.body, facebookCaption: p.facebookCaption, script: p.script, hashtags: p.hashtags ?? undefined, status: "DRAFT",
      scenes: { create: p.scenes.map((s) => ({ sceneOrder: s.sceneOrder, narration: s.narration, visualKeywords: s.visualKeywords ?? undefined, durationMs: s.durationMs })) },
    },
  });
  await logActivity({ action: "content.duplicated", message: `Contenido duplicado: ${p.internalTitle}`, pageId: p.pageId, entity: "ContentPost", entityId: copy.id });
  return copy.id;
}

export async function cancelContent(id: string) {
  const p = await mustGet(id);
  if (!isCancellable(p.status as PostStatus)) throw new ContentError("Este contenido no se puede cancelar en su estado actual.");
  await prisma.contentPost.update({ where: { id }, data: { status: "CANCELLED", approved: false } });
  await logActivity({ action: "content.cancelled", message: `Contenido cancelado: ${p.internalTitle}`, level: "WARN", pageId: p.pageId, entity: "ContentPost", entityId: id });
}

export async function deleteContent(id: string) {
  const p = await mustGet(id);
  if (!isDeletable(p.status as PostStatus)) throw new ContentError("No se puede eliminar un contenido programado, en publicación o publicado.");
  await prisma.contentPost.delete({ where: { id } });
  await logActivity({ action: "content.deleted", message: `Contenido eliminado: ${p.internalTitle}`, level: "WARN", pageId: p.pageId, entity: "ContentPost", entityId: id });
}
