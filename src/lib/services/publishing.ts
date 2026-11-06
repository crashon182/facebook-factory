import "server-only";
import { stat } from "node:fs/promises";
import { prisma } from "@/lib/db";
import type { PublicationAttempt, PublicationSchedule, ContentPost, SocialPage } from "@/generated/prisma/client";
import { MetaClient } from "@/lib/integrations/meta/client";
import { composeMessage, matchesAttempt, publishKindFor } from "@/lib/integrations/meta/compose";
import { describeMetaError, MetaApiError, MetaNetworkError } from "@/lib/integrations/meta/errors";
import { getPageToken } from "./meta-connection";
import { resolvePublishMedia } from "./scheduling";
import { getAutomationsPaused } from "./settings";

/**
 * Publicación sin duplicados. Meta no ofrece claves de idempotencia, así que la garantía se construye así:
 *  1. Reclamo atómico en BD (SCHEDULED → PUBLISHING con UPDATE condicional): solo un proceso publica.
 *  2. Antes de llamar a Meta se registra el intento (STARTED). Si el proceso muere o hay timeout, el intento queda sin cerrar.
 *  3. Un intento sin cerrar NUNCA se reintenta a ciegas: primero se reconcilia con Meta (¿ya existe esa publicación?).
 *  4. Solo errores definitivos de Meta (respuesta con error 4xx) cuentan como "no publicado" y habilitan reintentar.
 */

export const MAX_ATTEMPTS = 4;
export type PublishDeps = { client: () => MetaClient; now: () => Date; sleep: (ms: number) => Promise<void> };
const defaultDeps: PublishDeps = { client: () => MetaClient.fromEnv(), now: () => new Date(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

export type PublishOutcome =
  | { status: "published"; facebookId: string }
  | { status: "retry"; reason: string; nextAttemptAt: Date }
  | { status: "failed"; reason: string }
  | { status: "paused" | "skipped"; reason?: string };

class PublishPending extends Error {}
class PermanentPublishError extends Error {}

type Loaded = PublicationSchedule & { post: ContentPost; page: SocialPage; attempts: PublicationAttempt[] };

export function backoffMs(kind: "rate" | "transient" | "network", failures: number) {
  const base = kind === "rate" ? 15 * 60_000 : kind === "network" ? 2 * 60_000 : 60_000;
  return Math.min(base * 2 ** Math.max(0, failures - 1), 6 * 3600_000);
}

async function finalizePublished(s: Loaded, facebookId: string, attemptId: string | null, now: Date) {
  await prisma.$transaction([
    ...(attemptId ? [prisma.publicationAttempt.update({ where: { id: attemptId }, data: { status: "SUCCEEDED", facebookObjectId: facebookId, finishedAt: now, errorCode: null, errorMessage: null } })] : []),
    prisma.publicationSchedule.update({ where: { id: s.id }, data: { status: "PUBLISHED", nextAttemptAt: null, lastError: null } }),
    prisma.contentPost.update({ where: { id: s.postId }, data: { status: "PUBLISHED", publishedAt: now, facebookPostId: facebookId, failureReason: null } }),
    prisma.activityLog.create({ data: { action: "post.published", message: `Publicado en Facebook: ${s.post.internalTitle}`, pageId: s.pageId, entity: "ContentPost", entityId: s.postId, metadata: { facebookId } } }),
  ]);
}

async function finalizeFailed(s: Loaded, reason: string, extra?: { expirePage?: boolean }) {
  await prisma.$transaction([
    prisma.publicationSchedule.update({ where: { id: s.id }, data: { status: "FAILED", lastError: reason.slice(0, 2000), nextAttemptAt: null } }),
    prisma.contentPost.update({ where: { id: s.postId }, data: { status: "FAILED", failureReason: reason.slice(0, 2000) } }),
    ...(extra?.expirePage ? [prisma.socialPage.update({ where: { id: s.pageId }, data: { connectionStatus: "EXPIRED" } })] : []),
    prisma.activityLog.create({ data: { action: "post.publish_failed", level: "ERROR", message: `Falló la publicación de «${s.post.internalTitle}»: ${reason.slice(0, 300)}`, pageId: s.pageId, entity: "ContentPost", entityId: s.postId } }),
  ]);
}

async function deferRetry(s: Loaded, reason: string, at: Date) {
  await prisma.$transaction([
    prisma.publicationSchedule.update({ where: { id: s.id }, data: { status: "SCHEDULED", nextAttemptAt: at, lastError: reason.slice(0, 2000) } }),
    prisma.contentPost.update({ where: { id: s.postId }, data: { status: "SCHEDULED" } }),
  ]);
}

type Reconcile = { kind: "found"; id: string } | { kind: "not_found"; note?: string } | { kind: "pending" } | { kind: "unknown"; error: string };

/** ¿Llegó a publicarse el intento anterior? Se pregunta a Meta antes de reintentar. */
async function reconcile(s: Loaded, attempt: PublicationAttempt, token: string, client: MetaClient): Promise<Reconcile> {
  const kind = publishKindFor(s.post.format);
  try {
    if (kind === "reel") {
      if (!attempt.facebookObjectId) return { kind: "not_found", note: "El intento anterior no llegó a crear el video en Meta." };
      const st = await client.reelStatus(attempt.facebookObjectId, token);
      if (st.publishStatus === "published") return { kind: "found", id: attempt.facebookObjectId };
      if (st.publishStatus === "draft" || st.publishStatus === "error" || ["error", "expired", "upload_failed"].includes(st.videoStatus ?? "")) {
        return { kind: "not_found", note: `El Reel anterior no se publicó (${st.videoStatus ?? "?"}/${st.publishStatus ?? "?"}).` };
      }
      return { kind: "pending" };
    }
    const posts = await client.recentPosts(s.page.facebookPageId!, token, 25);
    const message = composeMessage(s.post);
    const hit = posts.find((p) => matchesAttempt(p, message, attempt.startedAt));
    return hit ? { kind: "found", id: hit.id } : { kind: "not_found" };
  } catch (e) {
    if (e instanceof MetaApiError && e.kind === "auth") throw e;
    return { kind: "unknown", error: describeMetaError(e) };
  }
}

async function doPublish(s: Loaded, attempt: PublicationAttempt, token: string, deps: PublishDeps): Promise<string> {
  const client = deps.client();
  const pageId = s.page.facebookPageId!;
  const message = composeMessage(s.post);
  const kind = publishKindFor(s.post.format);

  if (kind === "text") return (await client.publishText(pageId, token, { message })).id;

  const media = await resolvePublishMedia(s.postId, s.post.format);
  if (!media) throw new PermanentPublishError(kind === "photo" ? "No hay imagen para publicar." : "No hay un video renderizado para publicar.");
  const size = await stat(media.file).then((x) => x.size, () => 0);
  if (!size) throw new PermanentPublishError("El archivo multimedia no existe en el almacenamiento.");

  if (kind === "photo") {
    const r = await client.publishPhoto(pageId, token, { caption: message, filePath: media.file });
    return r.post_id ?? r.id;
  }

  // Reel: start → upload → finish → verificación de estado
  const started = await client.reelStart(pageId, token);
  await prisma.publicationAttempt.update({ where: { id: attempt.id }, data: { facebookObjectId: started.video_id } }); // permite reconciliar si algo falla después
  await client.reelUpload(started.video_id, token, media.file, size);
  await client.reelFinish(pageId, token, { videoId: started.video_id, description: message, title: s.post.internalTitle.slice(0, 100) });
  for (let i = 0; i < 30; i++) {
    const st = await client.reelStatus(started.video_id, token);
    if (st.publishStatus === "published") return started.video_id;
    if (["error", "expired", "upload_failed"].includes(st.videoStatus ?? "") || st.publishStatus === "error") {
      throw new PermanentPublishError(`Meta no pudo procesar el Reel (${st.videoStatus ?? "?"}): ${st.errors.join("; ") || "sin detalle"}`);
    }
    await deps.sleep(10_000);
  }
  throw new PublishPending("El Reel sigue procesándose en Meta.");
}

export async function publishSchedule(scheduleId: string, deps: Partial<PublishDeps> = {}): Promise<PublishOutcome> {
  const d: PublishDeps = { ...defaultDeps, ...deps };
  const now = d.now();

  // 1) Reclamo atómico: solo un worker/proceso puede pasar de SCHEDULED a PUBLISHING.
  const claim = await prisma.publicationSchedule.updateMany({
    where: { id: scheduleId, status: "SCHEDULED", scheduledAt: { lte: now }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
    data: { status: "PUBLISHING" },
  });
  if (claim.count !== 1) return { status: "skipped", reason: "Ya fue reclamada, no está vencida o no está programada." };

  const s = (await prisma.publicationSchedule.findUnique({ where: { id: scheduleId }, include: { post: true, page: true, attempts: { orderBy: { attemptNo: "asc" } } } })) as Loaded;
  const release = async () => { await prisma.publicationSchedule.update({ where: { id: s.id }, data: { status: "SCHEDULED" } }); };

  if (await getAutomationsPaused()) { await release(); return { status: "paused" }; }
  await prisma.contentPost.update({ where: { id: s.postId }, data: { status: "PUBLISHING" } });

  if (s.post.facebookPostId) { await finalizePublished(s, s.post.facebookPostId, null, now); return { status: "published", facebookId: s.post.facebookPostId }; }

  const token = getPageToken(s.page);
  if (!s.page.facebookPageId || !token || s.page.connectionStatus === "NOT_CONNECTED") {
    await finalizeFailed(s, "La página no está conectada a Facebook.");
    return { status: "failed", reason: "La página no está conectada a Facebook." };
  }
  if (!s.page.isActive) { await release(); return { status: "skipped", reason: "Página inactiva" }; }

  const failures = s.attempts.filter((a) => a.status !== "SUCCEEDED").length;
  try {
    // 2) Reconciliar un intento anterior sin cerrar antes de intentar de nuevo.
    const open = [...s.attempts].reverse().find((a) => a.status === "STARTED" || a.status === "RECONCILING");
    if (open) {
      const r = await reconcile(s, open, token, d.client());
      if (r.kind === "found") { await finalizePublished(s, r.id, open.id, d.now()); return { status: "published", facebookId: r.id }; }
      if ((r.kind === "pending" || r.kind === "unknown") && d.now().getTime() - s.scheduledAt.getTime() > 24 * 3600_000) {
        const why = "No se pudo confirmar en 24 horas si la publicación se realizó. Revisá la Página en Facebook antes de reintentar.";
        await finalizeFailed(s, why);
        return { status: "failed", reason: why };
      }
      if (r.kind === "pending" || r.kind === "unknown") {
        const at = new Date(d.now().getTime() + backoffMs("network", Math.max(1, failures)));
        await deferRetry(s, r.kind === "pending" ? "Esperando que Meta termine de procesar el intento anterior." : `No se pudo verificar el intento anterior: ${r.error}`, at);
        return { status: "retry", reason: "Verificación pendiente", nextAttemptAt: at };
      }
      await prisma.publicationAttempt.update({ where: { id: open.id }, data: { status: "FAILED", finishedAt: d.now(), errorMessage: r.note ?? "No se encontró en Meta; se reintenta." } });
    }

    if (failures >= MAX_ATTEMPTS) {
      const why = `Se agotaron los ${MAX_ATTEMPTS} intentos. Último error: ${s.lastError ?? "desconocido"}`;
      await finalizeFailed(s, why);
      return { status: "failed", reason: why };
    }

    // 3) Nuevo intento: se registra ANTES de hablar con Meta.
    const attempt = await prisma.publicationAttempt.create({ data: { scheduleId: s.id, attemptNo: (s.attempts.at(-1)?.attemptNo ?? 0) + 1, status: "STARTED", startedAt: d.now() } });
    try {
      const id = await doPublish(s, attempt, token, d);
      await finalizePublished(s, id, attempt.id, d.now());
      return { status: "published", facebookId: id };
    } catch (e) {
      return await handleFailure(s, attempt, e, failures + 1, d);
    }
  } catch (e) {
    // Error de autenticación durante la reconciliación u otro fallo inesperado
    if (e instanceof MetaApiError && e.kind === "auth") {
      await finalizeFailed(s, `El token de Facebook venció o fue revocado. Reconectá la página. (${describeMetaError(e)})`, { expirePage: true });
      return { status: "failed", reason: "Token vencido" };
    }
    await release().catch(() => {});
    throw e;
  }
}

async function handleFailure(s: Loaded, attempt: PublicationAttempt, e: unknown, failures: number, d: PublishDeps): Promise<PublishOutcome> {
  const now = d.now();
  const close = (status: "FAILED" | "RECONCILING", e2: unknown) =>
    prisma.publicationAttempt.update({ where: { id: attempt.id }, data: { status, finishedAt: now, errorCode: e2 instanceof MetaApiError ? String(e2.code ?? e2.httpStatus ?? "") : null, errorMessage: describeMetaError(e2) } });

  if (e instanceof PublishPending) {
    await close("RECONCILING", e);
    const at = new Date(now.getTime() + 5 * 60_000);
    await deferRetry(s, e.message, at);
    return { status: "retry", reason: e.message, nextAttemptAt: at };
  }
  if (e instanceof PermanentPublishError) {
    await close("FAILED", e);
    await finalizeFailed(s, e.message);
    return { status: "failed", reason: e.message };
  }
  if (e instanceof MetaNetworkError) {
    // Ambiguo: puede haberse publicado. El próximo paso reconcilia antes de reintentar.
    await close("RECONCILING", e);
    const at = new Date(now.getTime() + backoffMs("network", failures));
    await deferRetry(s, e.message, at);
    return { status: "retry", reason: e.message, nextAttemptAt: at };
  }
  if (e instanceof MetaApiError) {
    if (!e.definitelyNotPublished) {
      await close("RECONCILING", e); // 5xx: ambiguo
      const at = new Date(now.getTime() + backoffMs("transient", failures));
      await deferRetry(s, describeMetaError(e), at);
      return { status: "retry", reason: describeMetaError(e), nextAttemptAt: at };
    }
    await close("FAILED", e);
    if (e.kind === "auth") {
      const reason = `El token de Facebook venció o fue revocado. Reconectá la página. (${describeMetaError(e)})`;
      await finalizeFailed(s, reason, { expirePage: true });
      return { status: "failed", reason };
    }
    if ((e.kind === "rate" || e.kind === "transient") && failures < MAX_ATTEMPTS) {
      const at = new Date(now.getTime() + backoffMs(e.kind, failures));
      await deferRetry(s, describeMetaError(e), at);
      return { status: "retry", reason: describeMetaError(e), nextAttemptAt: at };
    }
    const reason = e.kind === "duplicate" ? `Meta rechazó el contenido por duplicado. Cambiá el texto. (${describeMetaError(e)})` : describeMetaError(e);
    await finalizeFailed(s, reason);
    return { status: "failed", reason };
  }
  await close("FAILED", e);
  const reason = describeMetaError(e);
  await finalizeFailed(s, reason);
  return { status: "failed", reason };
}

/** Encuentra publicaciones vencidas y recupera las que quedaron "PUBLISHING" por una caída del worker. */
export async function findDueSchedules(now = new Date(), staleMs = 15 * 60_000) {
  // Recuperación: un PUBLISHING viejo implica proceso caído; el intento sin cerrar se reconciliará en el próximo reclamo.
  const stale = await prisma.publicationSchedule.updateMany({ where: { status: "PUBLISHING", updatedAt: { lt: new Date(now.getTime() - staleMs) } }, data: { status: "SCHEDULED", nextAttemptAt: null } });
  const due = await prisma.publicationSchedule.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: now }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
    orderBy: { scheduledAt: "asc" }, take: 50, select: { id: true },
  });
  return { ids: due.map((x) => x.id), recovered: stale.count };
}
