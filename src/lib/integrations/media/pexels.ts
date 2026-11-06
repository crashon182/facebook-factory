import { createHash } from "node:crypto";
import { cacheGet, cacheSet } from "@/lib/cache";
import {
  MediaProviderError, MediaProviderNotConfiguredError, MediaRateLimitError,
  type MediaCandidate, type MediaProvider, type MediaSearchParams, type MediaSearchResult, type Quality,
} from "./types";

const API = "https://api.pexels.com";
export const PEXELS_LICENSE = "Licencia de Pexels (https://www.pexels.com/license/): uso gratuito, sin atribución obligatoria. No incluye derechos sobre personas, marcas ni música identificables.";

type PexelsPhoto = {
  id: number; width: number; height: number; url: string; photographer: string; photographer_url: string; alt?: string;
  src: { original: string; large2x: string; large: string; medium: string; portrait?: string; landscape?: string };
};
type PexelsVideoFile = { id: number; quality: string | null; file_type: string; width: number | null; height: number | null; link: string };
type PexelsVideo = {
  id: number; width: number; height: number; url: string; image: string; duration: number;
  user: { name: string; url: string }; video_files: PexelsVideoFile[];
};

export function mapPhoto(p: PexelsPhoto, quality: Quality = "large"): MediaCandidate {
  const download = quality === "small" ? p.src.medium : quality === "medium" ? p.src.large : p.src.large2x;
  return {
    provider: "pexels", externalId: String(p.id), kind: "photo", title: p.alt || null, previewUrl: p.src.medium, downloadUrl: download,
    width: p.width, height: p.height, durationSec: null, author: p.photographer, authorUrl: p.photographer_url, sourceUrl: p.url, license: PEXELS_LICENSE,
  };
}

/** Elige el archivo mp4 más adecuado según la calidad pedida (small ≤ 720 px de lado menor, medium ≈ 1080, large = el mayor). */
export function pickVideoFile(files: PexelsVideoFile[], quality: Quality = "medium"): PexelsVideoFile | null {
  const mp4 = files.filter((f) => f.file_type === "video/mp4" && f.width && f.height && f.link);
  if (!mp4.length) return null;
  const side = (f: PexelsVideoFile) => Math.min(f.width!, f.height!);
  const target = quality === "small" ? 720 : quality === "medium" ? 1080 : 2160;
  // Prefiere el mayor archivo que no supere el objetivo; si todos lo superan, el más pequeño.
  const within = mp4.filter((f) => side(f) <= target).sort((a, b) => side(b) - side(a));
  return within[0] ?? [...mp4].sort((a, b) => side(a) - side(b))[0];
}

export function mapVideo(v: PexelsVideo, quality: Quality = "medium"): MediaCandidate | null {
  const file = pickVideoFile(v.video_files, quality);
  if (!file) return null;
  return {
    provider: "pexels", externalId: String(v.id), kind: "video", title: null, previewUrl: v.image, downloadUrl: file.link,
    width: file.width!, height: file.height!, durationSec: v.duration, author: v.user.name, authorUrl: v.user.url, sourceUrl: v.url, license: PEXELS_LICENSE,
  };
}

export class PexelsProvider implements MediaProvider {
  readonly id = "pexels";
  readonly name = "Pexels";
  readonly allowedDownloadHosts = ["pexels.com", ...(process.env.MEDIA_EXTRA_ALLOWED_HOSTS?.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean) ?? [])];

  constructor(private readonly apiKey = process.env.PEXELS_API_KEY?.trim(), private readonly fetchImpl: typeof fetch = fetch) {}

  isConfigured() {
    return !!this.apiKey;
  }

  async search(params: MediaSearchParams): Promise<MediaSearchResult> {
    if (!this.apiKey) throw new MediaProviderNotConfiguredError("Pexels");
    const query = params.query.trim();
    if (!query) throw new MediaProviderError("Ingresá un término de búsqueda.");
    const page = Math.max(1, params.page ?? 1);
    const perPage = Math.min(40, Math.max(1, params.perPage ?? 15));
    const qs = new URLSearchParams({ query, page: String(page), per_page: String(perPage) });
    if (params.orientation) qs.set("orientation", params.orientation);
    if (params.quality) qs.set("size", params.quality);
    const path = params.kind === "video" ? "/videos/search" : "/v1/search";
    const key = "media:pexels:" + createHash("sha1").update(`${params.kind}|${qs}`).digest("hex");

    const cached = await cacheGet<MediaSearchResult>(key);
    if (cached) return cached;

    const res = await this.fetchImpl(`${API}${path}?${qs}`, { headers: { Authorization: this.apiKey }, signal: AbortSignal.timeout(20_000) }).catch(() => {
      throw new MediaProviderError("No se pudo contactar a Pexels.");
    });
    const remaining = res.headers.get("x-ratelimit-remaining");
    if (res.status === 429) {
      const reset = Number(res.headers.get("x-ratelimit-reset"));
      throw new MediaRateLimitError(Number.isFinite(reset) && reset > 0 ? Math.max(0, reset - Math.floor(Date.now() / 1000)) : null);
    }
    if (res.status === 401 || res.status === 403) throw new MediaProviderError("Pexels rechazó la clave (revisá PEXELS_API_KEY).");
    if (!res.ok) throw new MediaProviderError(`Pexels respondió ${res.status}.`);

    const body = (await res.json()) as { photos?: PexelsPhoto[]; videos?: PexelsVideo[]; total_results?: number };
    const quality = params.quality ?? "medium";
    const items =
      params.kind === "video"
        ? (body.videos ?? []).map((v) => mapVideo(v, quality)).filter((x): x is MediaCandidate => !!x)
        : (body.photos ?? []).map((p) => mapPhoto(p, params.quality ?? "large"));
    const result: MediaSearchResult = { items, page, perPage, total: body.total_results ?? items.length, rateLimitRemaining: remaining ? Number(remaining) : null };
    await cacheSet(key, result, 600);
    return result;
  }
}
