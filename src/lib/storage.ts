import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

/** Raíz de almacenamiento (fuera del repositorio y de public/). */
export function storageRoot() {
  return path.resolve(/* turbopackIgnore: true */ process.env.STORAGE_DIR?.trim() || "./storage");
}

/** Subcarpetas que se pueden servir al navegador. El resto (tmp, tts-cache) es privado. */
export const PUBLIC_DIRS = ["media", "renders", "images", "thumbs"] as const;

/** Resuelve una ruta relativa dentro del almacenamiento; lanza si intenta salir de él. */
export function resolveInStorage(rel: string): string {
  const root = storageRoot();
  const full = path.resolve(root, rel);
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error("Ruta fuera del almacenamiento");
  return full;
}

export async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function sha256File(file: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest("hex");
}

export async function fileSize(file: string) {
  return (await stat(file)).size;
}

export async function removeQuiet(target: string) {
  await rm(target, { recursive: true, force: true }).catch(() => {});
}

/** Borra subcarpetas de `tmp` más antiguas que `maxAgeMs` (política de retención de temporales). */
export async function cleanOldTmp(maxAgeMs = 24 * 3600 * 1000): Promise<number> {
  const tmp = path.join(storageRoot(), "tmp");
  let removed = 0;
  let entries: string[] = [];
  try {
    entries = await readdir(tmp);
  } catch {
    return 0;
  }
  for (const name of entries) {
    const p = path.join(tmp, name);
    try {
      if (Date.now() - (await stat(p)).mtimeMs > maxAgeMs) {
        await rm(p, { recursive: true, force: true });
        removed++;
      }
    } catch {}
  }
  return removed;
}

/** Ruta relativa (con barras /) para guardar en BD y servir por /api/files. */
export function toRel(abs: string) {
  return path.relative(storageRoot(), abs).split(path.sep).join("/");
}

export const MIME_BY_EXT: Record<string, string> = {
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".ogg": "audio/ogg",
};
