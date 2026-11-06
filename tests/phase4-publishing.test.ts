import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { createPage } from "@/lib/services/pages";
import { pageFormSchema } from "@/lib/validation/page";
import { MetaApiError, MetaNetworkError } from "@/lib/integrations/meta/errors";
import type { MetaClient } from "@/lib/integrations/meta/client";
import { storageRoot } from "@/lib/storage";
import { composeMessage } from "@/lib/integrations/meta/compose";
import { setAutomationsPaused } from "@/lib/services/settings";
import { findDueSchedules, MAX_ATTEMPTS, publishSchedule } from "@/lib/services/publishing";
import { autoSchedulePage, retryFailed, schedulePost, SchedulingError, unschedulePost } from "@/lib/services/scheduling";
import { connectPendingPage, disconnectPage, listPendingPages, storePendingPages } from "@/lib/services/meta-connection";

const PREFIX = "TEST_ff4_";
const NOW = new Date("2026-11-06T12:00:00Z");
let pageId = "";
let seq = 0;

function fake() {
  return {
    publishText: vi.fn(async () => ({ id: "fb_text_1" })),
    publishPhoto: vi.fn(async () => ({ id: "ph1", post_id: "fb_photo_1" })),
    reelStart: vi.fn(async () => ({ video_id: "V1", upload_url: "u" })),
    reelUpload: vi.fn(async () => ({ success: true })),
    reelFinish: vi.fn(async () => ({ success: true })),
    reelStatus: vi.fn(async (): Promise<{ videoStatus: string | null; publishStatus: string | null; errors: string[] }> => ({ videoStatus: "ready", publishStatus: "published", errors: [] })),
    recentPosts: vi.fn(async () => [] as { id: string; message: string | null; createdTime: string | null }[]),
    getPage: vi.fn(async () => ({ id: "1", name: "P" })),
  };
}
type Fake = ReturnType<typeof fake>;
const deps = (c: Fake, now = NOW) => ({ client: () => c as unknown as MetaClient, now: () => now, sleep: async () => {} });

async function mkPost(over: Record<string, unknown> = {}) {
  seq++;
  return prisma.contentPost.create({
    data: { pageId, internalTitle: `${PREFIX}${seq}`, format: "TEXT", status: "READY", approved: true, facebookCaption: `Texto único ${seq} ${Math.random()}`, hashtags: ["fe"], ...over },
  });
}
/** Programa en un instante futuro y devuelve el id del schedule; luego "avanza" el reloj con NOW+. */
async function mkScheduled(over: Record<string, unknown> = {}, when = new Date(NOW.getTime() + 10 * 60_000)) {
  const post = await mkPost(over);
  const s = await schedulePost(post.id, when, { now: NOW, allowOverLimit: true });
  return { post, s, due: new Date(when.getTime() + 1000) };
}

async function cleanup() {
  await prisma.socialPage.deleteMany({ where: { name: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await cleanup();
  pageId = (await createPage(pageFormSchema.parse({ name: PREFIX + "P", description: "Descripción larga de prueba", topic: "Tema", timezone: "America/Argentina/Buenos_Aires" }))).id;
  await prisma.socialPage.update({ where: { id: pageId }, data: { facebookPageId: "9001", accessTokenEnc: encryptSecret("PAGE_TOKEN_SECRETO"), connectionStatus: "CONNECTED" } });
  await prisma.automationRule.update({ where: { pageId }, data: { maxPostsPerDay: 50 } });
});
afterAll(async () => {
  await setAutomationsPaused(false);
  await cleanup();
  await prisma.systemSetting.deleteMany({ where: { key: "meta.pending" } });
  await prisma.$disconnect();
});
beforeEach(async () => {
  await setAutomationsPaused(false);
  await prisma.socialPage.update({ where: { id: pageId }, data: { connectionStatus: "CONNECTED", isActive: true } });
});

describe("programación: validaciones", () => {
  it("exige página conectada, aprobación, fecha futura, estado Listo y texto", async () => {
    const future = new Date(NOW.getTime() + 3600_000);
    const p = await mkPost();
    await expect(schedulePost(p.id, new Date(NOW.getTime() + 30_000), { now: NOW })).rejects.toThrow(/2 minutos/);
    await expect(schedulePost(p.id, new Date(NOW.getTime() + 400 * 86400_000), { now: NOW })).rejects.toThrow(/año/);
    const unapproved = await mkPost({ approved: false });
    await expect(schedulePost(unapproved.id, future, { now: NOW })).rejects.toThrow(/aprobado/);
    const draft = await mkPost({ status: "DRAFT" });
    await expect(schedulePost(draft.id, future, { now: NOW })).rejects.toThrow(/Listo/);
    const empty = await mkPost({ facebookCaption: null, body: null });
    await expect(schedulePost(empty.id, future, { now: NOW })).rejects.toThrow(/texto/);
    await prisma.socialPage.update({ where: { id: pageId }, data: { connectionStatus: "NOT_CONNECTED" } });
    await expect(schedulePost(p.id, future, { now: NOW })).rejects.toThrow(/conectada/);
  });
  it("exige imagen para fotos y video renderizado para Reels", async () => {
    const future = new Date(NOW.getTime() + 3600_000);
    const img = await mkPost({ format: "QUOTE_IMAGE" });
    await expect(schedulePost(img.id, future, { now: NOW })).rejects.toThrow(/imagen/i);
    const reel = await mkPost({ format: "REEL" });
    await expect(schedulePost(reel.id, future, { now: NOW })).rejects.toThrow(/Renderizá/);
  });
  it("respeta el máximo diario salvo confirmación explícita", async () => {
    await prisma.automationRule.update({ where: { pageId }, data: { maxPostsPerDay: 1 } });
    const day = new Date("2026-12-10T15:00:00Z");
    const a = await mkPost();
    await schedulePost(a.id, day, { now: NOW });
    const b = await mkPost();
    await expect(schedulePost(b.id, new Date(day.getTime() + 3600_000), { now: NOW })).rejects.toThrow(/máximo/);
    await expect(schedulePost(b.id, new Date(day.getTime() + 3600_000), { now: NOW, allowOverLimit: true })).resolves.toBeTruthy();
    await prisma.automationRule.update({ where: { pageId }, data: { maxPostsPerDay: 50 } });
  });
  it("programa, reprograma (misma fila, nueva clave) y cancela", async () => {
    const p = await mkPost();
    const t1 = new Date(NOW.getTime() + 3600_000);
    const s1 = await schedulePost(p.id, t1, { now: NOW });
    const s2 = await schedulePost(p.id, new Date(t1.getTime() + 7200_000), { now: NOW });
    expect(s2.id).toBe(s1.id);
    expect(s2.idempotencyKey).not.toBe(s1.idempotencyKey);
    expect(await prisma.publicationSchedule.count({ where: { postId: p.id } })).toBe(1);
    await unschedulePost(p.id);
    expect((await prisma.contentPost.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("READY");
    expect((await prisma.publicationSchedule.findUniqueOrThrow({ where: { postId: p.id } })).status).toBe("CANCELLED");
    await expect(unschedulePost(p.id)).rejects.toThrow(SchedulingError);
    await schedulePost(p.id, t1, { now: NOW }); // se puede volver a programar
  });
  it("programa automáticamente según reglas y no excede el máximo por día", async () => {
    await prisma.automationRule.update({ where: { pageId }, data: { maxPostsPerDay: 1, windowStart: "10:00", windowEnd: "20:00" } });
    await prisma.contentPost.deleteMany({ where: { pageId, status: "READY", schedule: null } });
    for (let i = 0; i < 3; i++) await mkPost();
    const r = await autoSchedulePage(pageId, new Date("2027-03-01T12:00:00Z"));
    expect(r.scheduled).toHaveLength(3);
    expect(new Set(r.scheduled.map((x) => x.at.toISOString().slice(0, 10))).size).toBe(3);
    await prisma.automationRule.update({ where: { pageId }, data: { maxPostsPerDay: 50 } });
  });
});

describe("publicación sin duplicados", () => {
  it("publica un texto, registra intento exitoso y el id real de Meta", async () => {
    const { post, s, due } = await mkScheduled();
    const c = fake();
    const out = await publishSchedule(s.id, deps(c, due));
    expect(out).toEqual({ status: "published", facebookId: "fb_text_1" });
    const call = c.publishText.mock.calls[0] as unknown as [string, string, { message: string }];
    expect(call[0]).toBe("9001");
    expect(call[1]).toBe("PAGE_TOKEN_SECRETO"); // token descifrado solo en memoria
    expect(call[2].message).toBe(composeMessage(post));
    const p = await prisma.contentPost.findUniqueOrThrow({ where: { id: post.id } });
    expect(p).toMatchObject({ status: "PUBLISHED", facebookPostId: "fb_text_1" });
    const att = await prisma.publicationAttempt.findMany({ where: { scheduleId: s.id } });
    expect(att).toHaveLength(1);
    expect(att[0]).toMatchObject({ status: "SUCCEEDED", attemptNo: 1, facebookObjectId: "fb_text_1" });
  });

  it("no publica antes de la hora ni dos veces: reclamos concurrentes y reintentos de un job ya publicado", async () => {
    const { s, due } = await mkScheduled();
    const c = fake();
    expect((await publishSchedule(s.id, deps(c, NOW))).status).toBe("skipped"); // aún no vence
    const results = await Promise.all(Array.from({ length: 6 }, () => publishSchedule(s.id, deps(c, due))));
    expect(results.filter((r) => r.status === "published")).toHaveLength(1);
    expect(c.publishText).toHaveBeenCalledTimes(1);
    expect((await publishSchedule(s.id, deps(c, due))).status).toBe("skipped"); // ya publicado
    expect(c.publishText).toHaveBeenCalledTimes(1);
    expect(await prisma.publicationAttempt.count({ where: { scheduleId: s.id } })).toBe(1);
  });

  it("error temporal de Meta: reintenta con espera y publica una sola vez", async () => {
    const { post, s, due } = await mkScheduled();
    const c = fake();
    c.publishText.mockRejectedValueOnce(new MetaApiError("temporal", 2, undefined, 400));
    const first = await publishSchedule(s.id, deps(c, due));
    expect(first.status).toBe("retry");
    const row = await prisma.publicationSchedule.findUniqueOrThrow({ where: { id: s.id } });
    expect(row.status).toBe("SCHEDULED");
    expect(row.nextAttemptAt!.getTime()).toBeGreaterThan(due.getTime());
    expect((await publishSchedule(s.id, deps(c, due))).status).toBe("skipped"); // respeta el backoff
    const later = new Date(row.nextAttemptAt!.getTime() + 1000);
    expect((await publishSchedule(s.id, deps(c, later))).status).toBe("published");
    expect(c.publishText).toHaveBeenCalledTimes(2);
    expect((await prisma.publicationAttempt.findMany({ where: { scheduleId: s.id }, orderBy: { attemptNo: "asc" } })).map((a) => a.status)).toEqual(["FAILED", "SUCCEEDED"]);
    expect((await prisma.contentPost.findUniqueOrThrow({ where: { id: post.id } })).status).toBe("PUBLISHED");
  });

  it("resultado ambiguo (timeout) + la publicación SÍ existe en Meta: la reconcilia y NO republica", async () => {
    const { post, s, due } = await mkScheduled();
    const c = fake();
    c.publishText.mockRejectedValueOnce(new MetaNetworkError("timeout"));
    expect((await publishSchedule(s.id, deps(c, due))).status).toBe("retry");
    expect((await prisma.publicationAttempt.findFirstOrThrow({ where: { scheduleId: s.id } })).status).toBe("RECONCILING");
    // En Meta el post ya existe (se creó justo antes del timeout)
    c.recentPosts.mockResolvedValue([{ id: "fb_real_77", message: composeMessage(post), createdTime: new Date(due.getTime() + 5000).toISOString() }]);
    const row = await prisma.publicationSchedule.findUniqueOrThrow({ where: { id: s.id } });
    const out = await publishSchedule(s.id, deps(c, new Date(row.nextAttemptAt!.getTime() + 1000)));
    expect(out).toEqual({ status: "published", facebookId: "fb_real_77" });
    expect(c.publishText).toHaveBeenCalledTimes(1); // nunca se volvió a publicar
    expect((await prisma.contentPost.findUniqueOrThrow({ where: { id: post.id } })).facebookPostId).toBe("fb_real_77");
  });

  it("resultado ambiguo y NO existe en Meta: reintenta y publica", async () => {
    const { s, due } = await mkScheduled();
    const c = fake();
    c.publishText.mockRejectedValueOnce(new MetaNetworkError("timeout"));
    await publishSchedule(s.id, deps(c, due));
    const row = await prisma.publicationSchedule.findUniqueOrThrow({ where: { id: s.id } });
    const out = await publishSchedule(s.id, deps(c, new Date(row.nextAttemptAt!.getTime() + 1000)));
    expect(out.status).toBe("published");
    expect(c.publishText).toHaveBeenCalledTimes(2);
    expect(c.recentPosts).toHaveBeenCalledTimes(1);
  });

  it("si no se puede verificar el intento anterior, no republica a ciegas", async () => {
    const { s, due } = await mkScheduled();
    const c = fake();
    c.publishText.mockRejectedValueOnce(new MetaNetworkError("timeout"));
    await publishSchedule(s.id, deps(c, due));
    c.recentPosts.mockRejectedValue(new MetaNetworkError("sin red"));
    const row = await prisma.publicationSchedule.findUniqueOrThrow({ where: { id: s.id } });
    const out = await publishSchedule(s.id, deps(c, new Date(row.nextAttemptAt!.getTime() + 1000)));
    expect(out.status).toBe("retry");
    expect(c.publishText).toHaveBeenCalledTimes(1);
  });

  it("un worker caído (PUBLISHING colgado) se recupera y reconcilia antes de reintentar", async () => {
    const { post, s, due } = await mkScheduled();
    // Simula un proceso que murió tras registrar el intento
    await prisma.publicationSchedule.update({ where: { id: s.id }, data: { status: "PUBLISHING" } });
    await prisma.publicationAttempt.create({ data: { scheduleId: s.id, attemptNo: 1, status: "STARTED", startedAt: due } });
    const later = new Date(due.getTime() + 20 * 60_000);
    await prisma.$executeRaw`UPDATE PublicationSchedule SET updatedAt = ${new Date(due.getTime() - 3600_000)} WHERE id = ${s.id}`;
    const found = await findDueSchedules(later);
    expect(found.recovered).toBeGreaterThanOrEqual(1);
    expect(found.ids).toContain(s.id);
    const c = fake();
    c.recentPosts.mockResolvedValue([{ id: "fb_recovered", message: composeMessage(post), createdTime: new Date(due.getTime() + 1000).toISOString() }]);
    expect(await publishSchedule(s.id, deps(c, later))).toEqual({ status: "published", facebookId: "fb_recovered" });
    expect(c.publishText).not.toHaveBeenCalled();
  });

  it("token vencido (190): falla sin reintentar y marca la página como vencida", async () => {
    const { post, s, due } = await mkScheduled();
    const c = fake();
    c.publishText.mockRejectedValue(new MetaApiError("Error validating access token", 190, 463, 400));
    const out = await publishSchedule(s.id, deps(c, due));
    expect(out.status).toBe("failed");
    expect(c.publishText).toHaveBeenCalledTimes(1);
    expect((await prisma.socialPage.findUniqueOrThrow({ where: { id: pageId } })).connectionStatus).toBe("EXPIRED");
    const p = await prisma.contentPost.findUniqueOrThrow({ where: { id: post.id } });
    expect(p.status).toBe("FAILED");
    expect(p.failureReason).toMatch(/Reconectá/);
    expect(p.failureReason).not.toContain("PAGE_TOKEN_SECRETO");
  });

  it("errores definitivos (duplicado, permisos) fallan sin reintentar; el reintento manual los reprograma", async () => {
    const { post, s, due } = await mkScheduled();
    const c = fake();
    c.publishText.mockRejectedValueOnce(new MetaApiError("Duplicate status message", 506, undefined, 400));
    const out = await publishSchedule(s.id, deps(c, due));
    expect(out).toMatchObject({ status: "failed" });
    expect((await prisma.contentPost.findUniqueOrThrow({ where: { id: post.id } })).failureReason).toMatch(/duplicado/);
    await retryFailed(post.id, due);
    expect((await prisma.publicationSchedule.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("SCHEDULED");
    expect((await publishSchedule(s.id, deps(c, new Date(due.getTime() + 1000)))).status).toBe("published");
    expect(c.publishText).toHaveBeenCalledTimes(2);
  });

  it("agota los intentos y falla", async () => {
    const { s, due } = await mkScheduled();
    const c = fake();
    c.publishText.mockRejectedValue(new MetaApiError("limite", 4, undefined, 400));
    let t = due;
    let last: Awaited<ReturnType<typeof publishSchedule>> = { status: "skipped" };
    for (let i = 0; i < MAX_ATTEMPTS + 1; i++) {
      last = await publishSchedule(s.id, deps(c, t));
      const row = await prisma.publicationSchedule.findUniqueOrThrow({ where: { id: s.id } });
      if (row.status !== "SCHEDULED") break;
      t = new Date(row.nextAttemptAt!.getTime() + 1000);
    }
    expect(last.status).toBe("failed");
    expect(c.publishText).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });

  it("la pausa global impide publicar y deja todo programado sin consumir intentos", async () => {
    const { s, due } = await mkScheduled();
    const c = fake();
    await setAutomationsPaused(true);
    expect((await publishSchedule(s.id, deps(c, due))).status).toBe("paused");
    expect(c.publishText).not.toHaveBeenCalled();
    expect((await prisma.publicationSchedule.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("SCHEDULED");
    expect(await prisma.publicationAttempt.count({ where: { scheduleId: s.id } })).toBe(0);
    await setAutomationsPaused(false);
    expect((await publishSchedule(s.id, deps(c, due))).status).toBe("published");
  });

  it("publica una foto con el archivo generado y usa el post_id", async () => {
    const post = await mkPost({ format: "QUOTE_IMAGE" });
    const rel = `images/${post.id}/t.png`;
    await mkdir(path.join(storageRoot(), "images", post.id), { recursive: true });
    await writeFile(path.join(storageRoot(), rel), "png");
    await prisma.mediaAsset.create({ data: { postId: post.id, pageId, type: "RENDERED_IMAGE", provider: "template", localPath: rel } });
    const when = new Date(NOW.getTime() + 600_000);
    const s = await schedulePost(post.id, when, { now: NOW, allowOverLimit: true });
    const c = fake();
    const out = await publishSchedule(s.id, deps(c, new Date(when.getTime() + 1000)));
    expect(out).toEqual({ status: "published", facebookId: "fb_photo_1" });
    expect((c.publishPhoto.mock.calls[0] as unknown as [string, string, { filePath: string }])[2].filePath).toContain(rel);
  });

  it("publica un Reel: start → upload → finish → estado; guarda el video_id antes de subir", async () => {
    const post = await mkPost({ format: "REEL" });
    const rel = `renders/${post.id}/r.mp4`;
    await mkdir(path.join(storageRoot(), "renders", post.id), { recursive: true });
    await writeFile(path.join(storageRoot(), rel), "mp4data");
    await prisma.videoRenderJob.create({ data: { postId: post.id, status: "COMPLETED", outputPath: rel, durationSec: 15 } });
    const when = new Date(NOW.getTime() + 600_000);
    const s = await schedulePost(post.id, when, { now: NOW, allowOverLimit: true });
    const c = fake();
    c.reelUpload.mockImplementation(async () => {
      expect((await prisma.publicationAttempt.findFirstOrThrow({ where: { scheduleId: s.id } })).facebookObjectId).toBe("V1");
      return { success: true };
    });
    c.reelStatus.mockResolvedValueOnce({ videoStatus: "processing", publishStatus: null, errors: [] }).mockResolvedValue({ videoStatus: "ready", publishStatus: "published", errors: [] });
    const out = await publishSchedule(s.id, deps(c, new Date(when.getTime() + 1000)));
    expect(out).toEqual({ status: "published", facebookId: "V1" });
    expect(c.reelFinish).toHaveBeenCalledTimes(1);
    expect((c.reelUpload.mock.calls[0] as unknown as [string, string, string, number])[3]).toBe(7); // tamaño del archivo
  });

  it("Reel: si Meta lo rechaza al procesar, falla; si sigue procesando, queda pendiente y luego reconcilia por estado", async () => {
    const post = await mkPost({ format: "REEL" });
    const rel = `renders/${post.id}/r.mp4`;
    await mkdir(path.join(storageRoot(), "renders", post.id), { recursive: true });
    await writeFile(path.join(storageRoot(), rel), "mp4data");
    await prisma.videoRenderJob.create({ data: { postId: post.id, status: "COMPLETED", outputPath: rel, durationSec: 15 } });
    const when = new Date(NOW.getTime() + 600_000);
    const s = await schedulePost(post.id, when, { now: NOW, allowOverLimit: true });
    const c = fake();
    c.reelStatus.mockResolvedValue({ videoStatus: "processing", publishStatus: null, errors: [] });
    const t1 = new Date(when.getTime() + 1000);
    expect((await publishSchedule(s.id, deps(c, t1))).status).toBe("retry"); // sigue procesando
    const row = await prisma.publicationSchedule.findUniqueOrThrow({ where: { id: s.id } });
    c.reelStatus.mockResolvedValue({ videoStatus: "ready", publishStatus: "published", errors: [] });
    const out = await publishSchedule(s.id, deps(c, new Date(row.nextAttemptAt!.getTime() + 1000)));
    expect(out).toEqual({ status: "published", facebookId: "V1" });
    expect(c.reelStart).toHaveBeenCalledTimes(1); // no se creó un segundo Reel
  });
});

describe("conexión de páginas", () => {
  it("guarda los tokens cifrados, exige CREATE_CONTENT y no permite reutilizar una Página de Facebook", async () => {
    await prisma.socialPage.update({ where: { id: pageId }, data: { connectionStatus: "NOT_CONNECTED", accessTokenEnc: null, facebookPageId: null } });
    await storePendingPages(pageId, [
      { id: "7001", name: "Mi Página", category: "Blog", accessToken: "TOKEN_A", tasks: ["CREATE_CONTENT", "MANAGE"] },
      { id: "7002", name: "Solo lectura", category: null, accessToken: "TOKEN_B", tasks: ["ANALYZE"] },
    ]);
    const raw = JSON.stringify((await prisma.systemSetting.findUniqueOrThrow({ where: { key: "meta.pending" } })).value);
    expect(raw).not.toContain("TOKEN_A");
    expect((await listPendingPages(pageId)).map((p) => [p.id, p.canPublish])).toEqual([["7001", true], ["7002", false]]);
    await expect(connectPendingPage(pageId, "7002")).rejects.toThrow(/CREATE_CONTENT/);
    const p = await connectPendingPage(pageId, "7001");
    expect(p).toMatchObject({ connectionStatus: "CONNECTED", facebookPageId: "7001", facebookPageName: "Mi Página" });
    expect(p.accessTokenEnc).not.toContain("TOKEN_A");
    expect(await listPendingPages(pageId)).toEqual([]);
  });
  it("no deja desconectar con publicaciones programadas", async () => {
    await prisma.socialPage.update({ where: { id: pageId }, data: { connectionStatus: "CONNECTED", accessTokenEnc: encryptSecret("X") } });
    await prisma.publicationSchedule.updateMany({ where: { pageId, status: { in: ["SCHEDULED", "PUBLISHING"] } }, data: { status: "CANCELLED" } }); // aislar de otros tests
    const { post } = await mkScheduled();
    await expect(disconnectPage(pageId)).rejects.toThrow(/1 publicación/);
    await unschedulePost(post.id);
    await disconnectPage(pageId);
    expect((await prisma.socialPage.findUniqueOrThrow({ where: { id: pageId } })).accessTokenEnc).toBeNull();
  });
});
