import { describe, expect, it, vi } from "vitest";
import { mapImage, mapVideo, pickVideoFile, PixabayProvider } from "@/lib/integrations/media/pixabay";
import { MediaProviderError, MediaProviderNotConfiguredError, MediaRateLimitError } from "@/lib/integrations/media/types";
import { getDefaultProvider, getProvider, listProviders } from "@/lib/integrations/media";
import { assertSafeUrl } from "@/lib/net/safe-fetch";

const img = { id: 195893, pageURL: "https://pixabay.com/photos/blossom-195893/", tags: "blossom, bloom, flower", previewURL: "https://cdn.pixabay.com/photo/p_150.jpg", webformatURL: "https://pixabay.com/get/w_640.jpg", webformatWidth: 640, webformatHeight: 960, largeImageURL: "https://pixabay.com/get/l_1280.jpg", imageWidth: 3000, imageHeight: 4500, user: "Josch13", user_id: 1664300 };
const vf = (w: number, h: number, url = `https://cdn.pixabay.com/video/${w}.mp4`) => ({ url, width: w, height: h, size: 1000, thumbnail: `https://cdn.pixabay.com/video/${w}.jpg` });
const vid = (id: number, files: object, duration = 12) => ({ id, pageURL: `https://pixabay.com/videos/v-${id}/`, tags: "sea, waves", duration, user: "Coverr-Free-Footage", user_id: 1281706, videos: files });

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
const uniq = () => `consulta-${Math.random().toString(36).slice(2)}`;
const asFetch = (f: unknown) => f as unknown as typeof fetch;

describe("mapeo Pixabay", () => {
  it("fotos: autor, perfil, licencia y calidad", () => {
    const large = mapImage(img, "large");
    expect(large).toMatchObject({ provider: "pixabay", externalId: "195893", kind: "photo", title: "blossom", downloadUrl: img.largeImageURL, author: "Josch13", sourceUrl: img.pageURL });
    expect(large.authorUrl).toBe("https://pixabay.com/users/Josch13-1664300/");
    expect(large.license).toContain("pixabay.com/service/license-summary");
    expect(mapImage(img, "small").downloadUrl).toBe(img.webformatURL);
    expect(large).toMatchObject({ width: 853, height: 1280 }); // 3000x4500 escalado a 1280 px de lado mayor (lo que realmente se descarga)
  });
  it("videos: elige tamaño y cae a otro si la URL está vacía (large no siempre existe)", () => {
    const files = { large: { url: "", width: 0, height: 0 }, medium: vf(1920, 1080), small: vf(1280, 720), tiny: vf(960, 540) };
    expect(pickVideoFile(files, "large")?.width).toBe(1920);
    expect(pickVideoFile(files, "medium")?.width).toBe(1920);
    expect(pickVideoFile(files, "small")?.width).toBe(1280);
    expect(pickVideoFile({ large: { url: "", width: 0, height: 0 } }, "medium")).toBeNull();
    const c = mapVideo(vid(5, files) as never, "medium")!;
    expect(c).toMatchObject({ kind: "video", durationSec: 12, downloadUrl: "https://cdn.pixabay.com/video/1920.mp4", previewUrl: "https://cdn.pixabay.com/video/1920.jpg" });
    expect(mapVideo(vid(6, {}) as never)).toBeNull();
  });
  it("las URLs de descarga pasan la validación anti-SSRF con el host permitido", () => {
    const allowed = new PixabayProvider("k").allowedDownloadHosts;
    expect(() => assertSafeUrl("https://cdn.pixabay.com/video/1.mp4", allowed)).not.toThrow();
    expect(() => assertSafeUrl("https://pixabay.com/get/x.jpg", allowed)).not.toThrow();
    expect(() => assertSafeUrl("https://pixabay.com.evil.io/x.jpg", allowed)).toThrow();
  });
});

describe("PixabayProvider.search", () => {
  it("sin clave lanza 'no configurado'", async () => {
    const p = new PixabayProvider("", vi.fn());
    expect(p.isConfigured()).toBe(false);
    await expect(p.search({ query: "x", kind: "photo" })).rejects.toBeInstanceOf(MediaProviderNotConfiguredError);
  });

  it("fotos: parámetros correctos (orientación, idioma, safesearch) y caché de la segunda llamada", async () => {
    const f = vi.fn(async () => json({ total: 9000, totalHits: 500, hits: [img] }, { headers: { "x-ratelimit-remaining": "97" } }));
    const p = new PixabayProvider("SECRETKEY", asFetch(f));
    const q = uniq();
    const a = await p.search({ query: q, kind: "photo", orientation: "portrait", quality: "large", language: "es", perPage: 15 });
    expect(a).toMatchObject({ total: 500, rateLimitRemaining: 97, page: 1, perPage: 15 });
    expect(a.items).toHaveLength(1);
    const url = new URL(String((f.mock.calls[0] as unknown[])[0]));
    expect(url.origin + url.pathname).toBe("https://pixabay.com/api/");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ key: "SECRETKEY", q, image_type: "photo", orientation: "vertical", lang: "es", safesearch: "true", per_page: "15" });
    await p.search({ query: q, kind: "photo", orientation: "portrait", quality: "large", language: "es", perPage: 15 });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("limita per_page (3–200), recorta q a 100 y descarta idiomas no soportados", async () => {
    const f = vi.fn(async () => json({ total: 0, totalHits: 0, hits: [] }));
    const p = new PixabayProvider("K", asFetch(f));
    await p.search({ query: "a".repeat(150), kind: "photo", perPage: 1000, language: "xx" });
    await p.search({ query: uniq(), kind: "photo", perPage: 1 });
    const u1 = new URL(String((f.mock.calls[0] as unknown[])[0]));
    const u2 = new URL(String((f.mock.calls[1] as unknown[])[0]));
    expect(u1.searchParams.get("q")).toHaveLength(100);
    expect(u1.searchParams.get("per_page")).toBe("200");
    expect(u1.searchParams.has("lang")).toBe(false);
    expect(u2.searchParams.get("per_page")).toBe("3");
  });

  it("videos: usa el endpoint de videos y filtra la orientación del lado del cliente", async () => {
    const portrait = vid(1, { medium: vf(1080, 1920), small: vf(720, 1280) });
    const landscape = vid(2, { medium: vf(1920, 1080), small: vf(1280, 720) });
    const noFiles = vid(3, { large: { url: "", width: 0, height: 0 } });
    const f = vi.fn(async () => json({ total: 3, totalHits: 3, hits: [portrait, landscape, noFiles] }));
    const p = new PixabayProvider("K", asFetch(f));
    const r = await p.search({ query: uniq(), kind: "video", orientation: "portrait", quality: "medium" });
    const url = new URL(String((f.mock.calls[0] as unknown[])[0]));
    expect(url.pathname).toBe("/api/videos/");
    expect(url.searchParams.has("orientation")).toBe(false);
    expect(r.items.map((i) => i.externalId)).toEqual(["1"]);
    const all = await new PixabayProvider("K", asFetch(f)).search({ query: uniq(), kind: "video", quality: "medium" });
    expect(all.items.map((i) => i.externalId)).toEqual(["1", "2"]); // el sin archivos se descarta
  });

  it("maneja 429 (segundos restantes), clave inválida, 5xx, red y respuestas raras", async () => {
    const mk = (r: () => Response | Promise<Response>) => new PixabayProvider("K", asFetch(async () => r()));
    const e429 = await mk(() => new Response("API rate limit exceeded", { status: 429, headers: { "x-ratelimit-reset": "42" } })).search({ query: uniq(), kind: "photo" }).catch((x) => x);
    expect(e429).toBeInstanceOf(MediaRateLimitError);
    expect(e429.retryAfterSec).toBe(42);
    await expect(mk(() => new Response("[ERROR 400] Invalid or missing API key", { status: 400 })).search({ query: uniq(), kind: "photo" })).rejects.toThrow(/clave/);
    await expect(mk(() => new Response("", { status: 403 })).search({ query: uniq(), kind: "photo" })).rejects.toThrow(/clave/);
    await expect(mk(() => new Response("", { status: 503 })).search({ query: uniq(), kind: "photo" })).rejects.toThrow(/503/);
    await expect(mk(() => { throw new Error("net"); }).search({ query: uniq(), kind: "photo" })).rejects.toBeInstanceOf(MediaProviderError);
    await expect(mk(() => json({ nada: true })).search({ query: uniq(), kind: "photo" })).rejects.toThrow(/inesperada/);
  });

  it("los errores no filtran la clave", async () => {
    const p = new PixabayProvider("SECRETKEY", asFetch(async () => { throw new Error("fallo con key=SECRETKEY"); }));
    const e = (await p.search({ query: uniq(), kind: "photo" }).catch((x) => x)) as Error;
    expect(e.message).not.toContain("SECRETKEY");
  });
});

describe("registro de proveedores", () => {
  it("incluye Pexels y Pixabay con su atribución", () => {
    expect(listProviders().map((p) => p.id)).toEqual(["pexels", "pixabay"]);
    expect(getProvider("pixabay")?.attribution?.url).toBe("https://pixabay.com");
    expect(getProvider("desconocido")).toBeUndefined();
    const d = getDefaultProvider();
    expect(d === null || d.isConfigured()).toBe(true);
  });
});
