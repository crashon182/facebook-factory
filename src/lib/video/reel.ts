import "server-only";
import { createHash } from "node:crypto";
import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import type { ContentScene, MediaAsset, SocialPage } from "@/generated/prisma/client";
import { getDefaultProvider } from "@/lib/integrations/media";
import { getTTSProvider } from "@/lib/integrations/tts";
import { importCandidate } from "@/lib/services/media";
import { ensureDir, removeQuiet, resolveInStorage, storageRoot, toRel } from "@/lib/storage";
import { ffmpeg, probe } from "./ffmpeg";
import { buildAss, buildCues, cleanSubtitleText } from "./subtitles";
import { computeTimeline, FADE_SEC } from "./timeline";

export type RenderOptions = { voice?: string; musicAssetId?: string };
export class RenderCancelled extends Error {}

const W = 1080;
const H = 1920;
const FPS = 30;
const FONT_DIR = () => process.env.FONT_DIR?.trim() || "/usr/share/fonts/truetype/dejavu";
const TRANSITIONS = ["fade", "fadeblack", "slideleft", "dissolve"];

const hexToFf = (c: string | null | undefined, d: string) => (c && /^#[0-9a-fA-F]{6}$/.test(c) ? "0x" + c.slice(1) : d);

type Visual = { kind: "video" | "photo" | "generated"; file?: string; asset?: MediaAsset };

async function exists(p: string) {
  return access(p).then(() => true, () => false);
}

class Reporter {
  private lines: string[] = [];
  constructor(private jobId: string) {}
  log(msg: string) {
    this.lines.push(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
  }
  async flush(progress?: number, stage?: string) {
    const data: { logs: string; progress?: number; stage?: string } = { logs: this.lines.join("\n").slice(-60000) };
    if (progress !== undefined) data.progress = Math.round(progress);
    if (stage) data.stage = stage;
    await prisma.videoRenderJob.update({ where: { id: this.jobId }, data });
  }
  get text() {
    return this.lines.join("\n");
  }
}

async function narrate(page: SocialPage, text: string, voice: string | undefined, rep: Reporter): Promise<string> {
  const tts = getTTSProvider();
  if (!tts) throw new Error("La narración (TTS) no está configurada.");
  const clean = cleanSubtitleText(text);
  const model = process.env.TTS_MODEL?.trim() || "default";
  const key = createHash("sha1").update([tts.id, model, voice ?? "", page.language, clean].join("|")).digest("hex");
  const file = path.join(storageRoot(), "tts-cache", `${key}.mp3`);
  if (await exists(file)) {
    rep.log(`TTS en caché (${clean.length} caracteres)`);
    return file;
  }
  const res = await tts.synthesize({ text: clean, language: page.language, voice });
  await ensureDir(path.dirname(file));
  await writeFile(file, res.audio);
  await prisma.aPIUsageLog.create({ data: { pageId: page.id, provider: "tts", operation: "speech", model: res.model, inputTokens: res.characters, costUsd: 0 } });
  rep.log(`TTS generado (${res.characters} caracteres, ${res.provider}/${res.model})`);
  return file;
}

async function resolveVisual(scene: ContentScene, neededSec: number, rep: Reporter, wantPhoto = false): Promise<Visual> {
  if (scene.mediaAssetId) {
    const a = await prisma.mediaAsset.findUnique({ where: { id: scene.mediaAssetId } });
    if (a?.localPath && (a.type === "VIDEO" || a.type === "PHOTO") && (await exists(resolveInStorage(a.localPath)))) {
      rep.log(`Escena ${scene.sceneOrder}: recurso asignado (${a.provider} ${a.externalId ?? a.id})`);
      return { kind: a.type === "VIDEO" ? "video" : "photo", file: resolveInStorage(a.localPath), asset: a };
    }
    rep.log(`Escena ${scene.sceneOrder}: el recurso asignado ya no está disponible, se busca otro`);
  }
  const provider = getDefaultProvider();
  const kws = Array.isArray(scene.visualKeywords) ? (scene.visualKeywords as string[]).filter(Boolean) : [];
  if (provider && kws.length) {
    const queries = [kws.slice(0, 3).join(" "), ...kws.slice(0, 2)];
    for (const q of queries) {
      try {
        const base = { query: q, kind: wantPhoto ? ("photo" as const) : ("video" as const), quality: "medium" as const, perPage: 10 };
        let res = await provider.search({ ...base, orientation: "portrait" });
        // Hay proveedores con pocos clips verticales: se reintenta sin filtro (el render recorta al centro a 9:16).
        if (res.items.length === 0) res = await provider.search(base);
        const cand = res.items.find((c) => (c.durationSec ?? 99) >= neededSec) ?? res.items[0];
        if (!cand) continue;
        const { asset, duplicate } = await importCandidate(cand);
        rep.log(`Escena ${scene.sceneOrder}: ${provider.name} «${q}» → ${asset.externalId}${duplicate ? " (ya en biblioteca)" : ""}`);
        return { kind: asset.type === "VIDEO" ? "video" : "photo", file: resolveInStorage(asset.localPath!), asset };
      } catch (e) {
        rep.log(`Escena ${scene.sceneOrder}: búsqueda «${q}» falló: ${(e as Error).message}`);
        if ((e as Error).name === "Error" && /429|limit/i.test((e as Error).message)) break;
      }
    }
  } else if (!provider) rep.log(`Escena ${scene.sceneOrder}: sin proveedor multimedia configurado`);
  rep.log(`Escena ${scene.sceneOrder}: se usa un fondo generado con los colores de la página`);
  return { kind: "generated" };
}

async function encodeSegment(v: Visual, page: SocialPage, lenSec: number, out: string, idx: number) {
  const common = ["-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(FPS)];
  const L = lenSec.toFixed(3);
  if (v.kind === "video") {
    await ffmpeg(["-stream_loop", "-1", "-i", v.file!, "-t", L, "-vf", `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${FPS}`, ...common, out], { timeoutMs: 300_000 });
  } else if (v.kind === "photo") {
    const frames = Math.ceil(lenSec * FPS);
    await ffmpeg(
      ["-loop", "1", "-framerate", String(FPS), "-i", v.file!, "-t", L, "-vf",
        `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},zoompan=z='min(1+0.0007*on,1.12)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${FPS},setsar=1,trim=end_frame=${frames}`, ...common, out],
      { timeoutMs: 300_000 },
    );
  } else {
    const c0 = hexToFf(page.primaryColor, "0x4f46e5");
    const c1 = hexToFf(page.secondaryColor, "0x7c3aed");
    // Alterna la orientación para variar entre escenas
    const [x1, y1] = idx % 2 ? [W, 0] : [0, H];
    await ffmpeg(["-f", "lavfi", "-i", `gradients=s=${W}x${H}:c0=${c0}:c1=${c1}:x0=0:y0=${idx % 2 ? H : 0}:x1=${x1}:y1=${y1}:d=${L}:speed=0.02:n=2:r=${FPS}`, "-t", L, ...common, out], { timeoutMs: 120_000 });
  }
}

export function buildFilterGraph(opts: { n: number; starts: number[]; durations: number[]; tempo: number; hasMusic: boolean; total: number; fontDir: string }): string {
  const { n, starts, durations, tempo, hasMusic, total, fontDir } = opts;
  const f: string[] = [];
  if (n === 1) f.push("[0:v]null[vx]");
  else {
    let prev = "[0:v]";
    for (let i = 1; i < n; i++) {
      const out = i === n - 1 ? "[vx]" : `[x${i}]`;
      f.push(`${prev}[${i}:v]xfade=transition=${TRANSITIONS[(i - 1) % TRANSITIONS.length]}:duration=${FADE_SEC}:offset=${starts[i].toFixed(3)}${out}`);
      prev = out;
    }
  }
  f.push(`[vx]subtitles=subs.ass:fontsdir=${fontDir}[v]`);
  for (let i = 0; i < n; i++) {
    f.push(`[${n + i}:a]${tempo !== 1 ? `atempo=${tempo},` : ""}apad=whole_dur=${durations[i].toFixed(3)},atrim=0:${durations[i].toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
  }
  f.push(`${Array.from({ length: n }, (_, i) => `[a${i}]`).join("")}concat=n=${n}:v=0:a=1[narr]`);
  if (hasMusic) {
    f.push(`[${2 * n}:a]volume=0.12,atrim=0:${total.toFixed(3)},asetpts=PTS-STARTPTS[m]`);
    f.push("[narr][m]amix=inputs=2:duration=first:normalize=0[mix]");
    f.push("[mix]loudnorm=I=-16:TP=-1.5:LRA=11[aout]");
  } else f.push("[narr]loudnorm=I=-16:TP=-1.5:LRA=11[aout]");
  return f.join(";\n");
}

export async function renderReel(jobId: string, ctl: { attempt: number; maxAttempts: number; isCancelled: () => Promise<boolean> }) {
  const rep = new Reporter(jobId);
  const job = await prisma.videoRenderJob.findUniqueOrThrow({ where: { id: jobId }, include: { post: { include: { page: true, scenes: { orderBy: { sceneOrder: "asc" } } } } } });
  if (job.status === "CANCELLED" || job.status === "COMPLETED") return;
  const post = job.post;
  const page = post.page;
  const options = (job.options ?? {}) as RenderOptions;
  const work = path.join(storageRoot(), "tmp", `render-${jobId}`);
  const check = async () => {
    if (await ctl.isCancelled()) throw new RenderCancelled();
  };

  await prisma.videoRenderJob.update({ where: { id: jobId }, data: { status: "RUNNING", attempts: ctl.attempt, startedAt: new Date(), error: null, progress: 0, stage: "iniciando" } });
  rep.log(`Inicio de render (intento ${ctl.attempt}/${ctl.maxAttempts}) — objetivo ${job.durationSec}s`);

  try {
    if (post.format !== "REEL" || post.scenes.length === 0) throw new Error("El contenido no es un Reel con escenas.");
    await ensureDir(work);

    // 1) Narración
    await rep.flush(2, "narración");
    const audioFiles: string[] = [];
    const audioSecs: number[] = [];
    for (const [i, s] of post.scenes.entries()) {
      await check();
      const f = await narrate(page, s.narration, options.voice, rep);
      const info = await probe(f);
      if (!info.hasAudio || info.durationSec <= 0) throw new Error(`Narración inválida en la escena ${s.sceneOrder}`);
      audioFiles.push(f);
      audioSecs.push(info.durationSec);
      await rep.flush(2 + (18 * (i + 1)) / post.scenes.length);
    }

    // 2) Línea de tiempo
    const tl = computeTimeline(audioSecs, { targetSec: job.durationSec });
    rep.log(`Duración total ${tl.totalSec}s (objetivo ${job.durationSec}s)${tl.tempo > 1 ? `, narración acelerada x${tl.tempo}` : ""}`);
    if (tl.overTarget) rep.log("AVISO: el guion es más largo que la duración objetivo aun acelerando la voz; conviene acortarlo.");

    // 3) Multimedia por escena
    await rep.flush(20, "multimedia");
    const visuals: Visual[] = [];
    for (const [i, s] of post.scenes.entries()) {
      await check();
      const needed = tl.scenes[i].durationSec + FADE_SEC;
      const v = await resolveVisual(s, needed, rep);
      visuals.push(v);
      await prisma.contentScene.update({ where: { id: s.id }, data: { durationMs: Math.round(tl.scenes[i].durationSec * 1000), mediaAssetId: v.asset?.id ?? null } });
      await rep.flush(20 + (25 * (i + 1)) / post.scenes.length);
    }

    // 4) Segmentos de video
    await rep.flush(45, "segmentos");
    const segs: string[] = [];
    for (const [i, v] of visuals.entries()) {
      await check();
      const isLast = i === visuals.length - 1;
      const len = tl.scenes[i].durationSec + (isLast ? 0 : FADE_SEC);
      const out = path.join(work, `seg${i}.mp4`);
      await encodeSegment(v, page, len, out, i);
      segs.push(out);
      await rep.flush(45 + (25 * (i + 1)) / visuals.length);
    }

    // 5) Subtítulos
    const cues = buildCues(post.scenes.map((s, i) => ({ timing: tl.scenes[i], text: s.narration })));
    await writeFile(path.join(work, "subs.ass"), buildAss(cues, { width: W, height: H }));
    rep.log(`Subtítulos: ${cues.length} fragmentos (sincronizados por proporción dentro de cada escena)`);

    // 6) Música (solo si el administrador eligió un archivo con licencia registrada)
    let music: string | null = null;
    if (options.musicAssetId) {
      const m = await prisma.mediaAsset.findUnique({ where: { id: options.musicAssetId } });
      if (m?.type === "AUDIO" && m.localPath && m.license?.trim()) {
        music = resolveInStorage(m.localPath);
        rep.log(`Música: «${m.title}» (licencia registrada)`);
      } else rep.log("AVISO: la música elegida no es válida o no tiene licencia registrada; se omite.");
    } else rep.log("Sin música (no se agrega música sin una pista con licencia elegida por el administrador).");

    // 7) Composición final
    await check();
    await rep.flush(70, "composición");
    const graph = buildFilterGraph({ n: segs.length, starts: tl.scenes.map((s) => s.startSec), durations: tl.scenes.map((s) => s.durationSec), tempo: tl.tempo, hasMusic: !!music, total: tl.totalSec, fontDir: FONT_DIR() });
    await writeFile(path.join(work, "graph.txt"), graph);
    const outAbs = resolveInStorage(`renders/${post.id}/${jobId}.mp4`);
    await ensureDir(path.dirname(outAbs));
    const inputs = [...segs.flatMap((s) => ["-i", s]), ...audioFiles.flatMap((a) => ["-i", a]), ...(music ? ["-stream_loop", "-1", "-i", music] : [])];
    await ffmpeg(
      [...inputs, "-filter_complex_script", "graph.txt", "-map", "[v]", "-map", "[aout]", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(FPS),
        "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-movflags", "+faststart", "-t", tl.totalSec.toFixed(3), outAbs],
      { cwd: work, timeoutMs: 900_000, onProgressMs: (ms) => { void prisma.videoRenderJob.update({ where: { id: jobId }, data: { progress: Math.min(97, Math.round(70 + (27 * ms) / (tl.totalSec * 1000))) } }).catch(() => {}); } },
    );

    // 8) Verificación y miniatura
    await rep.flush(98, "miniatura");
    const info = await probe(outAbs);
    if (info.width !== W || info.height !== H || !info.hasAudio) throw new Error(`Salida inesperada: ${info.width}x${info.height}, audio=${info.hasAudio}`);
    const thumbAbs = resolveInStorage(`thumbs/render-${jobId}.jpg`);
    await ensureDir(path.dirname(thumbAbs));
    await ffmpeg(["-ss", String(Math.min(1, tl.totalSec / 2)), "-i", outAbs, "-frames:v", "1", "-vf", "scale=540:-2", "-q:v", "3", thumbAbs], { timeoutMs: 60_000 });
    rep.log(`Listo: ${info.width}x${info.height}, ${info.durationSec.toFixed(1)}s`);
    await prisma.videoRenderJob.update({
      where: { id: jobId },
      data: { status: "COMPLETED", progress: 100, stage: "completado", outputPath: toRel(outAbs), thumbnailPath: toRel(thumbAbs), finishedAt: new Date(), logs: rep.text.slice(-60000), error: null },
    });
    await prisma.activityLog.create({ data: { action: "reel.rendered", message: `Reel renderizado: ${post.internalTitle}`, pageId: page.id, entity: "VideoRenderJob", entityId: jobId } });
  } catch (e) {
    const cancelled = e instanceof RenderCancelled;
    const last = ctl.attempt >= ctl.maxAttempts;
    const msg = cancelled ? "Cancelado por el usuario" : ((e as { stderrTail?: string }).stderrTail ? `${(e as Error).message}: ${(e as { stderrTail: string }).stderrTail.slice(-400)}` : (e as Error).message);
    rep.log(cancelled ? "Render cancelado" : `ERROR: ${msg}`);
    await prisma.videoRenderJob.update({
      where: { id: jobId },
      data: { status: cancelled ? "CANCELLED" : last ? "FAILED" : "QUEUED", error: cancelled ? null : msg.slice(0, 1000), stage: cancelled ? "cancelado" : last ? "falló" : "reintentando", finishedAt: cancelled || last ? new Date() : null, logs: rep.text.slice(-60000) },
    });
    if (!cancelled && last) {
      await prisma.activityLog.create({ data: { action: "reel.failed", level: "ERROR", message: `Falló el render de «${post.internalTitle}»: ${msg.slice(0, 200)}`, pageId: page.id, entity: "VideoRenderJob", entityId: jobId } });
    }
    if (!cancelled) throw e;
  } finally {
    await removeQuiet(work);
  }
}
