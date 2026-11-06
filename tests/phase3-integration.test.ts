import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { copyFile, mkdtemp, readdir, writeFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prisma } from "@/lib/db";
import { createPage } from "@/lib/services/pages";
import { pageFormSchema } from "@/lib/validation/page";
import { ffmpeg, probe } from "@/lib/video/ffmpeg";
import { resolveInStorage, storageRoot } from "@/lib/storage";
import type { MediaCandidate } from "@/lib/integrations/media/types";

// ── Dobles de prueba: descarga (no hay red) y TTS (no gasta créditos) ──
const fixtures = vi.hoisted(() => ({ clip: "", tone: "" }));
vi.mock("@/lib/net/safe-fetch", async (orig) => {
  const real = await orig<typeof import("@/lib/net/safe-fetch")>();
  return {
    ...real,
    safeDownload: vi.fn(async (_url: string, dest: string) => {
      const { copyFile: cp, mkdir } = await import("node:fs/promises");
      const { createHash } = await import("node:crypto");
      const { readFile } = await import("node:fs/promises");
      const nodePath = await import("node:path");
      await mkdir(nodePath.dirname(dest), { recursive: true });
      await cp(fixtures.clip, dest);
      return { bytes: (await readFile(dest)).length, sha256: createHash("sha256").update(await readFile(dest)).digest("hex"), contentType: "video/mp4" };
    }),
  };
});
vi.mock("@/lib/integrations/tts", async () => {
  const { readFile } = await import("node:fs/promises");
  return {
    getTTSProvider: () => ({
      id: "fake", isConfigured: () => true,
      synthesize: async ({ text }: { text: string }) => ({ audio: await readFile(fixtures.tone), format: "mp3", characters: text.length, provider: "fake", model: "fake-tts" }),
    }),
  };
});

const { importCandidate, registerUpload, deleteAsset, MediaError } = await import("@/lib/services/media");
const { requestRender, RenderError, cancelRender } = await import("@/lib/services/renders");
const { renderReel } = await import("@/lib/video/reel");
const { getRenderQueue, removeQueuedRender } = await import("@/lib/queue/render-queue");

const PREFIX = "TEST_ff3_";
let pageId = "";
let work = "";

const candidate = (id: string): MediaCandidate => ({ provider: "pexels", externalId: id, kind: "video", title: "t", previewUrl: "p", downloadUrl: "https://videos.pexels.com/x.mp4", width: 720, height: 1280, durationSec: 4, author: "Ana", authorUrl: "https://www.pexels.com/@ana", sourceUrl: "https://www.pexels.com/video/1", license: "Licencia de Pexels" });

async function cleanup() {
  await prisma.socialPage.deleteMany({ where: { name: { startsWith: PREFIX } } });
  const assets = await prisma.mediaAsset.findMany({ where: { OR: [{ externalId: { startsWith: "t3-" } }, { title: { startsWith: PREFIX } }] } });
  for (const a of assets) await deleteAsset(a.id).catch(() => {});
}

beforeAll(async () => {
  await cleanup();
  work = await mkdtemp(path.join(os.tmpdir(), "ff3-"));
  fixtures.clip = path.join(work, "clip.mp4");
  fixtures.tone = path.join(work, "tone.mp3");
  await ffmpeg(["-f", "lavfi", "-i", "testsrc2=s=640x1138:r=30:d=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", fixtures.clip]);
  await ffmpeg(["-f", "lavfi", "-i", "sine=f=300:d=2.5", "-c:a", "libmp3lame", fixtures.tone]);
  pageId = (await createPage(pageFormSchema.parse({ name: PREFIX + "P", description: "Descripción larga de prueba", topic: "Tema", timezone: "UTC", primaryColor: "#4f46e5", secondaryColor: "#10b981" }))).id;
});
afterAll(async () => {
  await cleanup();
  await getRenderQueue().close();
  await prisma.$disconnect();
});

describe("biblioteca multimedia", () => {
  it("importa un candidato guardando autor, licencia, origen y miniatura", async () => {
    const { asset, duplicate } = await importCandidate(candidate("t3-1"));
    expect(duplicate).toBe(false);
    expect(asset).toMatchObject({ provider: "pexels", type: "VIDEO", author: "Ana", license: "Licencia de Pexels", width: 640, height: 1138 });
    expect(asset.thumbPath).toBeTruthy();
    await expect(access(resolveInStorage(asset.localPath!))).resolves.toBeUndefined();
    await expect(access(resolveInStorage(asset.thumbPath!))).resolves.toBeUndefined();
  });
  it("evita descargas duplicadas (mismo id y mismo contenido)", async () => {
    const a = await importCandidate(candidate("t3-1"));
    expect(a.duplicate).toBe(true);
    const b = await importCandidate(candidate("t3-2")); // otro id, mismo archivo → mismo checksum
    expect(b.duplicate).toBe(true);
    expect(await prisma.mediaAsset.count({ where: { externalId: { startsWith: "t3-" } } })).toBe(1);
  });
  it("rechaza subidas sin licencia o que no son medios", async () => {
    const bad = path.join(work, "x.txt");
    await writeFile(bad, "esto no es un video");
    await expect(registerUpload(bad, { originalName: "x.mp4", license: "propia" })).rejects.toThrow(MediaError);
    const ok = path.join(work, "ok.mp4");
    await copyFile(fixtures.clip, ok);
    await expect(registerUpload(ok, { originalName: "ok.mp4", license: "  " })).rejects.toThrow(/licencia/i);
  });
  it("acepta audio y detecta duplicados por contenido; borrar elimina archivos", async () => {
    const f = path.join(work, "m.mp3");
    await copyFile(fixtures.tone, f);
    const r = await registerUpload(f, { originalName: "m.mp3", title: PREFIX + "audio", license: "Propia" });
    expect(r.asset.type).toBe("AUDIO");
    const f2 = path.join(work, "m2.mp3");
    await copyFile(fixtures.tone, f2);
    expect((await registerUpload(f2, { originalName: "otro.mp3", license: "Propia" })).duplicate).toBe(true);
    const abs = resolveInStorage(r.asset.localPath!);
    await deleteAsset(r.asset.id);
    await expect(access(abs)).rejects.toThrow();
  });
});

describe("cola de renders (Redis real)", () => {
  const makeReel = async (scenes: number) =>
    prisma.contentPost.create({
      data: { pageId, internalTitle: PREFIX + "reel", format: "REEL", status: "READY", facebookCaption: "c",
        scenes: { create: Array.from({ length: scenes }, (_, i) => ({ sceneOrder: i + 1, narration: `Escena número ${i + 1} con un texto de ejemplo.`, visualKeywords: ["sky"] })) } },
    });

  it("valida formato, escenas y música sin licencia", async () => {
    const txt = await prisma.contentPost.create({ data: { pageId, internalTitle: PREFIX + "txt", format: "TEXT", status: "READY" } });
    await expect(requestRender(txt.id, { durationSec: 15 })).rejects.toThrow(/Reel/);
    const empty = await makeReel(0);
    await expect(requestRender(empty.id, { durationSec: 15 })).rejects.toThrow(/escenas/);
    const reel = await makeReel(1);
    await expect(requestRender(reel.id, { durationSec: 200 })).rejects.toThrow(RenderError);
    await expect(requestRender(reel.id, { durationSec: 15, musicAssetId: "inexistente" })).rejects.toThrow(/licencia/);
  });

  it("encola una sola vez por Reel (idempotencia) y permite cancelar", async () => {
    const reel = await makeReel(1);
    const id = await requestRender(reel.id, { durationSec: 15 });
    await expect(requestRender(reel.id, { durationSec: 15 })).rejects.toThrow(/en curso/);
    expect(await getRenderQueue().getJob(`render-${id}`)).toBeTruthy();
    await cancelRender(id);
    expect((await prisma.videoRenderJob.findUniqueOrThrow({ where: { id } })).status).toBe("CANCELLED");
    expect(await getRenderQueue().getJob(`render-${id}`)).toBeFalsy();
    await removeQueuedRender(id);
  });
});

describe("renderizado de Reel (FFmpeg real, TTS simulada)", () => {
  it("produce un MP4 1080×1920 H.264/AAC, guarda el resultado y limpia temporales", async () => {
    const clip = await registerUpload(await (async () => { const p = path.join(work, "c2.mp4"); await copyFile(fixtures.clip, p); return p; })(), { originalName: "c.mp4", title: PREFIX + "clip", license: "Propia" }).catch(async () => ({ asset: (await prisma.mediaAsset.findFirstOrThrow({ where: { type: "VIDEO" } })) }));
    const post = await prisma.contentPost.create({
      data: { pageId, internalTitle: PREFIX + "render", format: "REEL", status: "READY",
        scenes: { create: [
          { sceneOrder: 1, narration: "Primera escena con el clip asignado ✨", visualKeywords: [], mediaAssetId: clip.asset.id },
          { sceneOrder: 2, narration: "Segunda escena con fondo generado.", visualKeywords: ["x"] },
        ] } },
    });
    const job = await prisma.videoRenderJob.create({ data: { postId: post.id, durationSec: 15, status: "QUEUED" } });
    await renderReel(job.id, { attempt: 1, maxAttempts: 3, isCancelled: async () => false });

    const done = await prisma.videoRenderJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(done).toMatchObject({ status: "COMPLETED", progress: 100 });
    expect(done.logs).toContain("Listo: 1080x1920");
    const info = await probe(resolveInStorage(done.outputPath!));
    expect(info).toMatchObject({ width: 1080, height: 1920, hasAudio: true });
    expect(info.durationSec).toBeGreaterThan(5);
    await expect(access(resolveInStorage(done.thumbnailPath!))).resolves.toBeUndefined();
    const tmp = await readdir(path.join(storageRoot(), "tmp")).catch(() => [] as string[]);
    expect(tmp.filter((n) => n.includes(job.id))).toEqual([]);
    expect((await prisma.contentScene.findMany({ where: { postId: post.id } })).every((s) => (s.durationMs ?? 0) > 0)).toBe(true);
  });

  it("un fallo deja el job en QUEUED si quedan reintentos y en FAILED en el último", async () => {
    const post = await prisma.contentPost.create({ data: { pageId, internalTitle: PREFIX + "fail", format: "TEXT", status: "READY" } });
    const job = await prisma.videoRenderJob.create({ data: { postId: post.id, durationSec: 15, status: "QUEUED" } });
    await expect(renderReel(job.id, { attempt: 1, maxAttempts: 3, isCancelled: async () => false })).rejects.toThrow(/Reel/);
    expect((await prisma.videoRenderJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("QUEUED");
    await expect(renderReel(job.id, { attempt: 3, maxAttempts: 3, isCancelled: async () => false })).rejects.toThrow();
    const f = await prisma.videoRenderJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(f.status).toBe("FAILED");
    expect(f.error).toMatch(/Reel/);
  });

  it("respeta la cancelación entre pasos", async () => {
    const post = await prisma.contentPost.create({ data: { pageId, internalTitle: PREFIX + "cancel", format: "REEL", status: "READY", scenes: { create: [{ sceneOrder: 1, narration: "Texto", visualKeywords: [] }] } } });
    const job = await prisma.videoRenderJob.create({ data: { postId: post.id, durationSec: 15, status: "QUEUED" } });
    await renderReel(job.id, { attempt: 1, maxAttempts: 3, isCancelled: async () => true });
    expect((await prisma.videoRenderJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("CANCELLED");
  });
});
