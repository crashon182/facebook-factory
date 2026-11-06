import "server-only";
import path from "node:path";
import { copyFile, rename } from "node:fs/promises";
import { prisma } from "@/lib/db";
import type { MediaType, Prisma } from "@/generated/prisma/client";
import { safeDownload } from "@/lib/net/safe-fetch";
import { ensureDir, fileSize, MIME_BY_EXT, removeQuiet, resolveInStorage, sha256File, storageRoot, toRel } from "@/lib/storage";
import { ffmpeg, probe } from "@/lib/video/ffmpeg";
import { getProvider } from "@/lib/integrations/media";
import type { MediaCandidate } from "@/lib/integrations/media/types";
import { logActivity } from "./activity";

export class MediaError extends Error {}

const MAX_BYTES = { photo: 25 * 1024 * 1024, video: 300 * 1024 * 1024, audio: 60 * 1024 * 1024 };

async function makeThumb(abs: string, type: "PHOTO" | "VIDEO", id: string): Promise<string | null> {
  try {
    const out = path.join(storageRoot(), "thumbs", `${id}.jpg`);
    await ensureDir(path.dirname(out));
    await ffmpeg([...(type === "VIDEO" ? ["-ss", "0.5"] : []), "-i", abs, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", out], { timeoutMs: 60_000 });
    return toRel(out);
  } catch {
    return null;
  }
}

export type ListQuery = { q?: string; type: "all" | "PHOTO" | "VIDEO" | "AUDIO" | "RENDERED_IMAGE"; page: number };

export async function listAssets(query: ListQuery) {
  const where: Prisma.MediaAssetWhereInput = { type: query.type === "all" ? { in: ["PHOTO", "VIDEO", "AUDIO", "RENDERED_IMAGE"] } : query.type };
  if (query.q) where.OR = [{ title: { contains: query.q } }, { author: { contains: query.q } }, { externalId: query.q }];
  const pageSize = 24;
  const [total, items] = await Promise.all([
    prisma.mediaAsset.count({ where }),
    prisma.mediaAsset.findMany({ where, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * pageSize, take: pageSize }),
  ]);
  return { total, items, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Descarga un candidato del proveedor a la biblioteca. Evita duplicados por (proveedor, id, tipo) y por checksum. */
export async function importCandidate(candidate: MediaCandidate, pageId?: string | null) {
  const type: MediaType = candidate.kind === "video" ? "VIDEO" : "PHOTO";
  const existing = await prisma.mediaAsset.findUnique({ where: { provider_externalId_type: { provider: candidate.provider, externalId: candidate.externalId, type } } });
  if (existing) return { asset: existing, duplicate: true };

  const provider = getProvider(candidate.provider);
  if (!provider) throw new MediaError("Proveedor desconocido");
  const ext = candidate.kind === "video" ? ".mp4" : ".jpg";
  const rel = `media/${candidate.provider}/${candidate.kind}/${candidate.externalId}${ext}`;
  const abs = resolveInStorage(rel);
  const dl = await safeDownload(candidate.downloadUrl, abs, {
    allowedHosts: provider.allowedDownloadHosts,
    maxBytes: candidate.kind === "video" ? MAX_BYTES.video : MAX_BYTES.photo,
    accept: candidate.kind === "video" ? /^(video\/|application\/octet-stream)/ : /^image\//,
  });

  const sameFile = await prisma.mediaAsset.findFirst({ where: { checksum: dl.sha256, type } });
  if (sameFile) {
    await removeQuiet(abs);
    return { asset: sameFile, duplicate: true };
  }
  const info = await probe(abs).catch(() => null);
  if (!info || (candidate.kind === "video" ? !info.hasVideo : !info.hasVideo)) {
    await removeQuiet(abs);
    throw new MediaError("El archivo descargado no es un medio válido.");
  }
  const asset = await prisma.mediaAsset.create({
    data: {
      pageId: pageId ?? null, type, provider: candidate.provider, externalId: candidate.externalId, sourceUrl: candidate.sourceUrl, localPath: rel,
      author: candidate.author, authorUrl: candidate.authorUrl, license: candidate.license, title: candidate.title,
      width: info.width, height: info.height, durationMs: candidate.kind === "video" ? Math.round(info.durationSec * 1000) : null,
      checksum: dl.sha256, mimeType: candidate.kind === "video" ? "video/mp4" : "image/jpeg", sizeBytes: dl.bytes,
    },
  });
  const thumb = await makeThumb(abs, type as "PHOTO" | "VIDEO", asset.id);
  const final = thumb ? await prisma.mediaAsset.update({ where: { id: asset.id }, data: { thumbPath: thumb } }) : asset;
  await logActivity({ action: "media.imported", message: `Recurso guardado desde ${provider.name}: ${candidate.kind} ${candidate.externalId}`, pageId, entity: "MediaAsset", entityId: asset.id });
  return { asset: final, duplicate: false };
}

/** Registra un archivo subido manualmente (ya escrito en un temporal). Valida el contenido real con ffprobe. */
export async function registerUpload(tmpFile: string, meta: { originalName: string; title?: string; license: string; keywords?: string[] }) {
  if (!meta.license.trim()) throw new MediaError("Indicá la licencia o el origen de los derechos del archivo.");
  const info = await probe(tmpFile).catch(() => null);
  if (!info || (!info.hasVideo && !info.hasAudio)) {
    await removeQuiet(tmpFile);
    throw new MediaError("El archivo no es una imagen, video o audio válido.");
  }
  const isImage = info.hasVideo && /image2|png_pipe|jpeg_pipe|webp_pipe|gif/.test(info.formatName) && info.durationSec < 0.1;
  const type: MediaType = info.hasVideo ? (isImage ? "PHOTO" : "VIDEO") : "AUDIO";
  const size = await fileSize(tmpFile);
  const limit = type === "PHOTO" ? MAX_BYTES.photo : type === "VIDEO" ? MAX_BYTES.video : MAX_BYTES.audio;
  if (size > limit) {
    await removeQuiet(tmpFile);
    throw new MediaError(`El archivo supera el máximo permitido (${Math.round(limit / 1048576)} MB).`);
  }
  const checksum = await sha256File(tmpFile);
  const dup = await prisma.mediaAsset.findFirst({ where: { checksum, type } });
  if (dup) {
    await removeQuiet(tmpFile);
    return { asset: dup, duplicate: true };
  }
  const ext = type === "PHOTO" ? ".jpg" : type === "VIDEO" ? ".mp4" : ".mp3";
  const rel = `media/upload/${type.toLowerCase()}/${checksum.slice(0, 24)}${path.extname(meta.originalName).toLowerCase().replace(/[^.a-z0-9]/g, "") || ext}`;
  const abs = resolveInStorage(rel);
  await ensureDir(path.dirname(abs));
  await rename(tmpFile, abs).catch(async () => { await copyFile(tmpFile, abs); await removeQuiet(tmpFile); });
  const asset = await prisma.mediaAsset.create({
    data: {
      type, provider: "upload", localPath: rel, title: meta.title?.trim() || meta.originalName.slice(0, 200), license: meta.license.trim().slice(0, 2000),
      keywords: meta.keywords ?? undefined, width: info.width, height: info.height,
      durationMs: type === "PHOTO" ? null : Math.round(info.durationSec * 1000), checksum, sizeBytes: size, mimeType: MIME_BY_EXT[path.extname(rel)] ?? null,
    },
  });
  const thumb = type === "AUDIO" ? null : await makeThumb(abs, type as "PHOTO" | "VIDEO", asset.id);
  const final = thumb ? await prisma.mediaAsset.update({ where: { id: asset.id }, data: { thumbPath: thumb } }) : asset;
  await logActivity({ action: "media.uploaded", message: `Archivo subido: ${final.title}`, entity: "MediaAsset", entityId: asset.id });
  return { asset: final, duplicate: false };
}

export async function deleteAsset(id: string) {
  const a = await prisma.mediaAsset.findUnique({ where: { id }, include: { scenes: { select: { id: true } } } });
  if (!a) throw new MediaError("El recurso no existe.");
  await prisma.mediaAsset.delete({ where: { id } });
  if (a.localPath) await removeQuiet(resolveInStorage(a.localPath));
  if (a.thumbPath) await removeQuiet(resolveInStorage(a.thumbPath));
  await logActivity({ action: "media.deleted", message: `Recurso eliminado: ${a.title ?? a.externalId ?? a.id}`, level: "WARN", entity: "MediaAsset", entityId: id });
}
