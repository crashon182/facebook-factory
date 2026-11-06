import { createHash } from "node:crypto";
import { cacheGet, cacheSet } from "@/lib/cache";
import {
  MediaProviderError, MediaProviderNotConfiguredError, MediaRateLimitError,
  type MediaCandidate, type MediaProvider, type MediaSearchParams, type MediaSearchResult, type Quality,
} from "./types";

const API = "https://pixabay.com/api/";
export const PIXABAY_LICENSE = "Licencia de contenido de Pixabay (https://pixabay.com/service/license-summary/): uso gratuito, sin atribución obligatoria. Revisá sus restricciones (no redistribuir tal cual, personas y marcas identificables).";
const LANGS = new Set(["cs", "da", "de", "en", "es", "fr", "id", "it", "hu", "nl", "no", "pl", "pt", "ro", "sk", "fi", "sv", "tr", "vi", "th", "bg", "ru", "el", "ja", "ko", "zh"]);
// Los términos de Pixabay exigen cachear las consultas 24 horas.
const CACHE_TTL_SEC = 24 * 3600;

type PixabayImage = {
  id: number; pageURL: string; type?: string; tags?: string; previewURL: string; webformatURL: string; webformatWidth?: number; webformatHeight?: number;
  largeImageURL: string; imageWidth?: number; imageHeight?: number; user: string; user_id: number;
};
type PixabayVideoFile = { url: string; width: number; height: number; size?: number; thumbnail?: string };
type PixabayVideo = {
  id: number; pageURL: string; tags?: string; duration: number; user: string; user_id: number;
  videos: { large?: PixabayVideoFile; medium?: PixabayVideoFile; small?: PixabayVideoFile; tiny?: PixabayVideoFile };
};

const authorUrl = (user: string, id: number) => `https://pixabay.com/users/${encodeURIComponent(user)}-${id}/`;

/** Escala (w, h) para que el lado mayor sea `max` (largeImageURL llega hasta 1280 px). */
function fitTo(w: number, h: number, max: number) {
  const k = Math.min(1, max / Math.max(w, h));
  return { width: Math.round(w * k), height: Math.round(h * k) };
}

export function mapImage(h: PixabayImage, quality: Quality = "large"): MediaCandidate {
  // webformatURL = hasta 640 px; largeImageURL = hasta 1280 px (el original y Full HD requieren acceso ampliado).
  const small = quality === "small";
  const dims = small ? { width: h.webformatWidth ?? 640, height: h.webformatHeight ?? 480 } : fitTo(h.imageWidth ?? 1280, h.imageHeight ?? 960, 1280);
  return {
    provider: "pixabay", externalId: String(h.id), kind: "photo", title: h.tags?.split(",")[0]?.trim() || null, previewUrl: h.webformatURL,
    downloadUrl: small ? h.webformatURL : h.largeImageURL, ...dims,
    durationSec: null, author: h.user, authorUrl: authorUrl(h.user, h.user_id), sourceUrl: h.pageURL, license: PIXABAY_LICENSE,
  };
}

/** Elige el tamaño de video: small≈720p, medium≈1080p, large=4K si existe (si no, medium). Ignora tamaños con URL vacía. */
export function pickVideoFile(v: PixabayVideo["videos"], quality: Quality = "medium"): PixabayVideoFile | null {
  const order: (keyof PixabayVideo["videos"])[] = quality === "small" ? ["small", "medium", "tiny"] : quality === "large" ? ["large", "medium", "small"] : ["medium", "small", "large", "tiny"];
  for (const k of order) {
    const f = v[k];
    if (f?.url && f.width > 0 && f.height > 0) return f;
  }
  return null;
}

export function mapVideo(v: PixabayVideo, quality: Quality = "medium"): MediaCandidate | null {
  const file = pickVideoFile(v.videos, quality);
  if (!file) return null;
  const thumb = file.thumbnail || v.videos.tiny?.thumbnail || v.videos.small?.thumbnail || "";
  return {
    provider: "pixabay", externalId: String(v.id), kind: "video", title: v.tags?.split(",")[0]?.trim() || null, previewUrl: thumb,
    downloadUrl: file.url, width: file.width, height: file.height, durationSec: v.duration, author: v.user, authorUrl: authorUrl(v.user, v.user_id), sourceUrl: v.pageURL, license: PIXABAY_LICENSE,
  };
}

export class PixabayProvider implements MediaProvider {
  readonly id = "pixabay";
  readonly name = "Pixabay";
  // pixabay.com cubre cdn.pixabay.com (videos, miniaturas) y pixabay.com/get (imágenes)
  readonly allowedDownloadHosts = ["pixabay.com"];
  readonly attribution = { text: "Imágenes y videos de Pixabay", url: "https://pixabay.com" };

  constructor(private readonly apiKey = process.env.PIXABAY_API_KEY?.trim(), private readonly fetchImpl: typeof fetch = fetch) {}

  isConfigured() {
    return !!this.apiKey;
  }

  async search(params: MediaSearchParams): Promise<MediaSearchResult> {
    if (!this.apiKey) throw new MediaProviderNotConfiguredError("Pixabay");
    const query = params.query.trim().slice(0, 100);
    if (!query) throw new MediaProviderError("Ingresá un término de búsqueda.");
    const page = Math.max(1, params.page ?? 1);
    const perPage = Math.min(200, Math.max(3, params.perPage ?? 15));
    const quality = params.quality ?? "medium";

    const qs = new URLSearchParams({ q: query, page: String(page), per_page: String(perPage), safesearch: "true" });
    if (params.language && LANGS.has(params.language)) qs.set("lang", params.language);
    let base = API;
    if (params.kind === "photo") {
      qs.set("image_type", "photo");
      if (params.orientation === "portrait") qs.set("orientation", "vertical");
      else if (params.orientation === "landscape") qs.set("orientation", "horizontal");
    } else {
      base = API + "videos/"; // este endpoint no tiene parámetro de orientación: se filtra después
    }

    // La clave nunca forma parte de la clave de caché.
    const cacheKey = "media:pixabay:" + createHash("sha1").update(`${params.kind}|${qs}|${params.orientation ?? ""}|${quality}`).digest("hex");
    const cached = await cacheGet<MediaSearchResult>(cacheKey);
    if (cached) return cached;

    const url = new URL(base);
    url.search = qs.toString();
    url.searchParams.set("key", this.apiKey);
    const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(20_000), headers: { Accept: "application/json" } }).catch(() => {
      throw new MediaProviderError("No se pudo contactar a Pixabay."); // sin incluir la URL (lleva la clave)
    });

    const remaining = res.headers.get("x-ratelimit-remaining");
    if (res.status === 429) {
      const reset = Number(res.headers.get("x-ratelimit-reset"));
      throw new MediaRateLimitError(Number.isFinite(reset) && reset > 0 ? reset : null); // Pixabay informa los segundos restantes
    }
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      const body = (await res.text().catch(() => "")).toLowerCase();
      if (res.status !== 400 || body.includes("key")) throw new MediaProviderError("Pixabay rechazó la clave (revisá PIXABAY_API_KEY).");
      throw new MediaProviderError("Pixabay rechazó la consulta (parámetros inválidos).");
    }
    if (!res.ok) throw new MediaProviderError(`Pixabay respondió ${res.status}.`);

    const body = (await res.json().catch(() => null)) as { total?: number; totalHits?: number; hits?: unknown[] } | null;
    if (!body || !Array.isArray(body.hits)) throw new MediaProviderError("Respuesta inesperada de Pixabay.");

    let items: MediaCandidate[];
    if (params.kind === "video") {
      items = (body.hits as PixabayVideo[]).map((v) => mapVideo(v, quality)).filter((x): x is MediaCandidate => !!x);
      if (params.orientation === "portrait") items = items.filter((c) => c.height > c.width);
      else if (params.orientation === "landscape") items = items.filter((c) => c.width > c.height);
      else if (params.orientation === "square") items = items.filter((c) => c.width === c.height);
    } else {
      items = (body.hits as PixabayImage[]).map((h) => mapImage(h, quality));
    }
    // Pixabay limita a 500 resultados por consulta (totalHits)
    const result: MediaSearchResult = { items, page, perPage, total: body.totalHits ?? body.total ?? items.length, rateLimitRemaining: remaining ? Number(remaining) : null };
    await cacheSet(cacheKey, result, CACHE_TTL_SEC);
    return result;
  }
}
