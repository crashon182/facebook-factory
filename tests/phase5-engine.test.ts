import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { createPage } from "@/lib/services/pages";
import { pageFormSchema } from "@/lib/validation/page";
import { AIBudgetError } from "@/lib/integrations/openai/client";
import { runPageAutomation, type EngineDeps } from "@/lib/automation/engine";
import { prepareMedia } from "@/lib/automation/media";
import { runMaintenance } from "@/lib/automation/retention";
import { setAutomationsPaused } from "@/lib/services/settings";
import { resolvePublishMedia } from "@/lib/services/scheduling";
import { storageRoot } from "@/lib/storage";

const PREFIX = "TEST_ff5_";
let pageId = "";
let seq = 0;
const NOW = new Date("2026-11-06T12:00:00Z");

/** Dobles: la "generación" crea un contenido READY como lo haría generateContent, sin llamar a OpenAI. */
function mkDeps(over: Partial<EngineDeps> = {}) {
  const generateContent = vi.fn(async (req: { pageId: string; format: string; ideaId?: string }) => {
    seq++;
    const p = await prisma.contentPost.create({ data: { pageId: req.pageId, ideaId: req.ideaId ?? null, internalTitle: `${PREFIX}gen${seq}`, format: req.format as never, status: "READY", facebookCaption: `Texto generado ${seq} ${Math.random()}`, hashtags: ["fe"] } });
    return p.id;
  });
  const postprocess = vi.fn(async () => {});
  const generateIdeas = vi.fn(async (pid: string, n: number) => {
    await prisma.contentIdea.createMany({ data: Array.from({ length: n }, (_, i) => ({ pageId: pid, title: `${PREFIX}idea${++seq}-${i}`, summary: "s", format: "TEXT" as const })) });
    return n;
  });
  const deps: Partial<EngineDeps> = { now: () => NOW, generateContent: generateContent as never, generateIdeas: generateIdeas as never, assertBudget: vi.fn(async () => {}) as never, postprocess, aiConfigured: () => true, ...over };
  return { deps, generateContent, postprocess, generateIdeas };
}

async function setRule(data: Record<string, unknown>) {
  await prisma.automationRule.update({ where: { pageId }, data: { lockedUntil: null, lastGeneratedAt: null, lastRunAt: null, ...data } });
}
async function reset() {
  await prisma.contentPost.deleteMany({ where: { pageId } });
  await prisma.contentIdea.deleteMany({ where: { pageId } });
  await prisma.publicationSchedule.deleteMany({ where: { pageId } });
}

beforeAll(async () => {
  await prisma.socialPage.deleteMany({ where: { name: { startsWith: PREFIX } } });
  pageId = (await createPage(pageFormSchema.parse({ name: PREFIX + "P", description: "Descripción larga de prueba", topic: "Tema", timezone: "UTC" }))).id;
  await prisma.socialPage.update({ where: { id: pageId }, data: { facebookPageId: "9005", accessTokenEnc: encryptSecret("T"), connectionStatus: "CONNECTED" } });
});
afterAll(async () => {
  await setAutomationsPaused(false);
  await prisma.socialPage.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.$disconnect();
});
beforeEach(async () => {
  await setAutomationsPaused(false);
  await reset();
  await prisma.socialPage.update({ where: { id: pageId }, data: { isActive: true, connectionStatus: "CONNECTED" } });
  await setRule({ enabled: true, maxPostsPerDay: 2, daysAhead: 3, requireApproval: true, autoPublish: false, generationFrequency: "DAILY", allowedFormats: null, publishDays: null, dailyBudgetUsd: 5 });
});

describe("motor de automatización: condiciones de parada", () => {
  it("no hace nada si la regla está desactivada, la página inactiva o hay pausa global (y no deja el bloqueo tomado)", async () => {
    const { deps, generateContent } = mkDeps();
    await setRule({ enabled: false });
    expect((await runPageAutomation(pageId, { deps })).skipped).toMatch(/desactivada/);
    await setRule({ enabled: true });
    await prisma.socialPage.update({ where: { id: pageId }, data: { isActive: false } });
    expect((await runPageAutomation(pageId, { deps })).skipped).toMatch(/inactiva/);
    await prisma.socialPage.update({ where: { id: pageId }, data: { isActive: true } });
    await setAutomationsPaused(true);
    expect((await runPageAutomation(pageId, { deps, force: true })).skipped).toMatch(/Pausa global/);
    expect(generateContent).not.toHaveBeenCalled();
    expect((await prisma.automationRule.findUniqueOrThrow({ where: { pageId } })).lockedUntil).toBeNull();
  });
  it("sin OpenAI configurado no genera y lo informa", async () => {
    const { deps, generateContent } = mkDeps({ aiConfigured: () => false });
    const r = await runPageAutomation(pageId, { deps });
    expect(generateContent).not.toHaveBeenCalled();
    expect(r.notes.join(" ")).toMatch(/OpenAI no está configurado/);
  });
});

describe("motor de automatización: generación", () => {
  it("genera solo lo que falta, con tope por corrida, y converge sin sobreproducir", async () => {
    const { deps, generateContent } = mkDeps();
    // objetivo = 3 días × 2 = 6; tope por corrida = 3
    const r1 = await runPageAutomation(pageId, { deps, force: true });
    expect(r1).toMatchObject({ generated: 3, target: 6, pipeline: 0, needed: 3 });
    const r2 = await runPageAutomation(pageId, { deps, force: true });
    expect(r2).toMatchObject({ generated: 3, pipeline: 3 });
    const r3 = await runPageAutomation(pageId, { deps, force: true });
    expect(r3.generated).toBe(0);
    expect(r3.notes.join(" ")).toMatch(/Stock suficiente/);
    expect(generateContent).toHaveBeenCalledTimes(6);
    const posts = await prisma.contentPost.findMany({ where: { pageId } });
    expect(posts.every((p) => p.autoGenerated)).toBe(true);
  });
  it("respeta la frecuencia configurada salvo ejecución forzada", async () => {
    const { deps, generateContent } = mkDeps();
    await runPageAutomation(pageId, { deps });
    const rule = await prisma.automationRule.findUniqueOrThrow({ where: { pageId } });
    expect(rule.lastGeneratedAt).toEqual(NOW);
    expect(rule.lastRunSummary).toMatchObject({ generated: 3 });
    generateContent.mockClear();
    const r = await runPageAutomation(pageId, { deps }); // misma hora: no corresponde generar
    expect(r.generated).toBe(0);
    expect(r.notes.join(" ")).toMatch(/frecuencia/);
    expect(generateContent).not.toHaveBeenCalled();
    expect((await runPageAutomation(pageId, { deps, force: true })).generated).toBe(3);
  });
  it("usa solo los formatos permitidos", async () => {
    const { deps, generateContent } = mkDeps();
    await setRule({ allowedFormats: ["REFLECTION"] });
    await runPageAutomation(pageId, { deps });
    for (const call of generateContent.mock.calls) expect(call[0].format).toBe("REFLECTION");
  });
  it("genera ideas cuando no hay y las usa para el contenido", async () => {
    const { deps, generateContent, generateIdeas } = mkDeps();
    await runPageAutomation(pageId, { deps });
    expect(generateIdeas).toHaveBeenCalledTimes(1); // una vez por corrida
    expect(generateContent.mock.calls.some((c) => !!c[0].ideaId)).toBe(true);
  });
  it("se detiene sin consumir más al llegar al presupuesto diario", async () => {
    let n = 0;
    const { deps, generateContent } = mkDeps({ assertBudget: vi.fn(async () => { if (++n > 1) throw new AIBudgetError("Se alcanzó el presupuesto diario (USD 5.00)."); }) as never });
    const r = await runPageAutomation(pageId, { deps });
    expect(r.generated).toBe(1);
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(r.notes.join(" ")).toMatch(/presupuesto diario/);
  });
  it("corta tras fallos consecutivos y no entra en bucle", async () => {
    const { deps, generateContent } = mkDeps();
    generateContent.mockRejectedValue(new Error("OpenAI caído"));
    const r = await runPageAutomation(pageId, { deps });
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(r.generated).toBe(0);
    expect(r.notes.join(" ")).toMatch(/fallos consecutivos/);
    expect((await prisma.automationRule.findUniqueOrThrow({ where: { pageId } })).lockedUntil).toBeNull();
  });
  it("dos corridas simultáneas de la misma página: solo una trabaja (bloqueo)", async () => {
    const { deps, generateContent } = mkDeps();
    const [a, b] = await Promise.all([runPageAutomation(pageId, { deps, force: true }), runPageAutomation(pageId, { deps, force: true })]);
    expect([a.skipped, b.skipped].filter(Boolean)).toHaveLength(1);
    expect(generateContent).toHaveBeenCalledTimes(3);
  });
});

describe("motor de automatización: aprobación y programación", () => {
  it("con aprobación manual obligatoria NO aprueba ni programa, aunque la publicación automática esté activa", async () => {
    const { deps } = mkDeps();
    await setRule({ requireApproval: true, autoPublish: true });
    const r = await runPageAutomation(pageId, { deps });
    expect(r).toMatchObject({ generated: 3, autoApproved: 0, scheduled: 0 });
    const posts = await prisma.contentPost.findMany({ where: { pageId } });
    expect(posts.every((p) => !p.approved && p.status === "READY")).toBe(true);
  });
  it("sin aprobación manual aprueba lo generado; programa solo si la publicación automática está activa", async () => {
    const { deps } = mkDeps();
    await setRule({ requireApproval: false, autoPublish: false });
    const r1 = await runPageAutomation(pageId, { deps });
    expect(r1).toMatchObject({ generated: 3, autoApproved: 3, scheduled: 0 });
    expect(await prisma.publicationSchedule.count({ where: { pageId } })).toBe(0);

    await reset();
    await setRule({ requireApproval: false, autoPublish: true, maxPostsPerDay: 1, daysAhead: 3 });
    const r2 = await runPageAutomation(pageId, { deps, force: true });
    expect(r2).toMatchObject({ generated: 3, autoApproved: 3, scheduled: 3 });
    const schedules = await prisma.publicationSchedule.findMany({ where: { pageId } });
    expect(new Set(schedules.map((s) => s.scheduledAt.toISOString().slice(0, 10))).size).toBe(3); // máx. 1 por día
    expect(schedules.every((s) => s.scheduledAt > NOW)).toBe(true);
    expect((await prisma.contentPost.findMany({ where: { pageId } })).every((p) => p.status === "SCHEDULED")).toBe(true);
  });
  it("no programa si la página no está conectada a Facebook", async () => {
    const { deps } = mkDeps();
    await prisma.socialPage.update({ where: { id: pageId }, data: { connectionStatus: "NOT_CONNECTED" } });
    await setRule({ requireApproval: false, autoPublish: true });
    const r = await runPageAutomation(pageId, { deps });
    expect(r.scheduled).toBe(0);
    expect(r.notes.join(" ")).toMatch(/no está conectada/);
  });
  it("registra la corrida en la actividad con su resumen", async () => {
    const { deps } = mkDeps();
    await runPageAutomation(pageId, { deps });
    const log = await prisma.activityLog.findFirst({ where: { pageId, action: "automation.run" }, orderBy: { createdAt: "desc" } });
    expect(log?.message).toMatch(/3 generados/);
  });
});

describe("preparación de medios", () => {
  const mkPost = (over: Record<string, unknown>) => prisma.contentPost.create({ data: { pageId, internalTitle: PREFIX + "m" + ++seq, status: "READY", facebookCaption: "Una frase inspiradora para compartir hoy. Y otra más.", ...over } as never });

  it("QUOTE_IMAGE: renderiza la imagen con FFmpeg una sola vez", async () => {
    const p = await mkPost({ format: "QUOTE_IMAGE", imageText: "Confía en el Señor con todo tu corazón" });
    expect(await prepareMedia(p.id)).toMatch(/generada/);
    const asset = await prisma.mediaAsset.findFirstOrThrow({ where: { postId: p.id, type: "RENDERED_IMAGE" } });
    expect(asset.localPath).toBeTruthy();
    expect(await prepareMedia(p.id)).toMatch(/ya existe/);
    expect(await prisma.mediaAsset.count({ where: { postId: p.id } })).toBe(1);
    expect((await resolvePublishMedia(p.id, "QUOTE_IMAGE"))?.kind).toBe("photo");
  });
  it("IMAGE: descarga una foto del proveedor, la asigna y la usa al publicar; sin proveedor lo avisa", async () => {
    const p = await mkPost({ format: "IMAGE", imageKeywords: ["sunrise", "mountain"] });
    expect(await prepareMedia(p.id, { defaultProvider: () => null })).toMatch(/Sin proveedor/);
    const file = `media/test/${p.id}.jpg`;
    await mkdir(path.join(storageRoot(), "media/test"), { recursive: true });
    await writeFile(path.join(storageRoot(), file), "jpg");
    const asset = await prisma.mediaAsset.create({ data: { type: "PHOTO", provider: "fake", externalId: p.id, localPath: file } });
    const provider = { name: "Fake", search: vi.fn(async () => ({ items: [{ width: 1200, height: 800, externalId: p.id }], page: 1, perPage: 10, total: 1, rateLimitRemaining: null })) };
    const note = await prepareMedia(p.id, { defaultProvider: () => provider as never, importCandidate: (async () => ({ asset, duplicate: false })) as never });
    expect(note).toMatch(/Foto asignada/);
    expect((provider.search.mock.calls[0] as unknown as [{ query: string }])[0].query).toBe("sunrise mountain");
    expect((await prisma.contentPost.findUniqueOrThrow({ where: { id: p.id } })).mediaAssetId).toBe(asset.id);
    expect((await resolvePublishMedia(p.id, "IMAGE"))?.file).toContain(file);
    expect(await prepareMedia(p.id)).toMatch(/ya está asignada/);
  });
  it("REEL: encola el render; si falla informa sin lanzar", async () => {
    const p = await mkPost({ format: "REEL" });
    const rr = vi.fn(async () => "job1");
    expect(await prepareMedia(p.id, { requestRender: rr as never })).toMatch(/encolado/);
    expect(rr).toHaveBeenCalledWith(p.id, { durationSec: 30 });
    expect(await prepareMedia(p.id, { requestRender: (async () => { throw new Error("Falta TTS"); }) as never })).toMatch(/Falta TTS/);
    expect(await prepareMedia((await mkPost({ format: "TEXT" })).id)).toMatch(/No requiere/);
  });
});

describe("retención y mantenimiento", () => {
  it("borra actividad vieja, cache de TTS vencida y videos de contenidos publicados (si se habilita)", async () => {
    const old = new Date(NOW.getTime() - 120 * 86400_000);
    await prisma.activityLog.create({ data: { action: "test.old", message: "vieja", createdAt: old } });
    await prisma.activityLog.create({ data: { action: "test.new", message: "reciente", createdAt: NOW } });
    const dir = path.join(storageRoot(), "tts-cache");
    await mkdir(dir, { recursive: true });
    const oldF = path.join(dir, "zz-old.mp3");
    const newF = path.join(dir, "zz-new.mp3");
    await writeFile(oldF, "a"); await writeFile(newF, "b");
    await utimes(oldF, old, old);
    await utimes(newF, NOW, NOW);

    const post = await prisma.contentPost.create({ data: { pageId, internalTitle: PREFIX + "r", format: "REEL", status: "PUBLISHED", publishedAt: old } });
    const rel = `renders/${post.id}/r.mp4`;
    await mkdir(path.join(storageRoot(), "renders", post.id), { recursive: true });
    await writeFile(path.join(storageRoot(), rel), "x");
    const job = await prisma.videoRenderJob.create({ data: { postId: post.id, status: "COMPLETED", outputPath: rel } });

    const none = await runMaintenance(NOW); // RENDER_RETENTION_DAYS=0 → nunca borra videos
    expect(none.rendersRemoved).toBe(0);
    expect(none.activityDeleted).toBeGreaterThanOrEqual(1);
    expect(none.ttsCacheRemoved).toBeGreaterThanOrEqual(1);
    expect(await prisma.activityLog.count({ where: { action: "test.old" } })).toBe(0);
    expect(await prisma.activityLog.count({ where: { action: "test.new" } })).toBe(1);

    vi.stubEnv("RENDER_RETENTION_DAYS", "30");
    const on = await runMaintenance(NOW);
    vi.unstubAllEnvs();
    expect(on.rendersRemoved).toBe(1);
    expect((await prisma.videoRenderJob.findUniqueOrThrow({ where: { id: job.id } })).outputPath).toBeNull();
    await prisma.activityLog.deleteMany({ where: { action: "test.new" } });
    await prisma.mediaAsset.deleteMany({ where: { provider: "fake" } });
  });
});
