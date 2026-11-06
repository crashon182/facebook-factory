import { describe, expect, it, vi } from "vitest";
import { computeTimeline } from "@/lib/video/timeline";
import { buildAss, buildCues, chunkText, cleanSubtitleText } from "@/lib/video/subtitles";
import { pickFontSize, wrapText } from "@/lib/video/image-templates";
import { buildFilterGraph } from "@/lib/video/reel";
import { assertSafeUrl, hostAllowed, isPrivateIp, UnsafeUrlError } from "@/lib/net/safe-fetch";
import { mapPhoto, mapVideo, pickVideoFile, PexelsProvider } from "@/lib/integrations/media/pexels";
import { MediaProviderError, MediaProviderNotConfiguredError, MediaRateLimitError } from "@/lib/integrations/media/types";
import { resolveInStorage } from "@/lib/storage";

describe("línea de tiempo", () => {
  it("suma audio + pausa y no acelera si entra en el objetivo", () => {
    const t = computeTimeline([4, 5, 3], { targetSec: 30 });
    expect(t.tempo).toBe(1);
    expect(t.scenes[1].startSec).toBeCloseTo(4.35);
    expect(t.totalSec).toBeCloseTo(12 + 3 * 0.35);
    expect(t.overTarget).toBe(false);
  });
  it("acelera la narración (máx. 1.3x) si se pasa >10% y avisa si aún excede", () => {
    const ok = computeTimeline([12, 12, 12], { targetSec: 30 });
    expect(ok.tempo).toBeGreaterThan(1);
    expect(ok.totalSec).toBeLessThan(31.5);
    const long = computeTimeline([20, 20, 20], { targetSec: 30 });
    expect(long.tempo).toBe(1.3);
    expect(long.overTarget).toBe(true);
  });
  it("las escenas son contiguas", () => {
    const t = computeTimeline([3, 4, 5, 2], { targetSec: 20 });
    for (let i = 1; i < t.scenes.length; i++) expect(t.scenes[i].startSec).toBeCloseTo(t.scenes[i - 1].startSec + t.scenes[i - 1].durationSec, 2);
  });
});

describe("subtítulos", () => {
  it("limpia emojis, llaves y saltos", () => {
    expect(cleanSubtitleText("Hola ✨ {mundo}\\N\n paz")).toBe("Hola mundoN paz");
  });
  it("divide en fragmentos cortos", () => {
    const c = chunkText("Cuando el corazón se inquieta, la paz de Cristo no depende de que todo esté resuelto.");
    expect(c.length).toBeGreaterThan(2);
    for (const x of c) { expect(x.split(" ").length).toBeLessThanOrEqual(5); expect(x.length).toBeLessThanOrEqual(34); }
  });
  it("los cues quedan dentro de la ventana de audio de cada escena y sin solaparse", () => {
    const scenes = [
      { timing: { index: 0, startSec: 0, durationSec: 5.35, audioSec: 5 }, text: "Una frase larga para la primera escena del reel." },
      { timing: { index: 1, startSec: 5.35, durationSec: 3.35, audioSec: 3 }, text: "Segunda escena." },
    ];
    const cues = buildCues(scenes);
    expect(cues.length).toBeGreaterThan(2);
    for (let i = 0; i < cues.length; i++) {
      expect(cues[i].endSec).toBeGreaterThan(cues[i].startSec);
      if (i) expect(cues[i].startSec).toBeGreaterThanOrEqual(cues[i - 1].endSec - 1e-6);
    }
    expect(cues.at(-1)!.endSec).toBeLessThanOrEqual(5.35 + 3 + 1e-6);
  });
  it("genera ASS válido", () => {
    const ass = buildAss([{ startSec: 1.5, endSec: 3.25, text: "Hola" }]);
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain("Dialogue: 0,0:00:01.50,0:00:03.25,Default,,0,0,0,,Hola");
  });
});

describe("plantillas de imagen", () => {
  it("ajusta el tamaño de fuente al largo y envuelve el texto", () => {
    expect(pickFontSize(30)).toBeGreaterThan(pickFontSize(300));
    const lines = wrapText("uno dos tres cuatro cinco seis siete ocho", 12);
    expect(lines.every((l) => l.length <= 12)).toBe(true);
    expect(lines.join(" ")).toBe("uno dos tres cuatro cinco seis siete ocho");
  });
});

describe("grafo de FFmpeg", () => {
  const base = { starts: [0, 5, 9], durations: [5, 4, 3], tempo: 1, total: 12, fontDir: "/fonts" };
  it("encadena xfade con los offsets de inicio de cada escena", () => {
    const g = buildFilterGraph({ ...base, n: 3, hasMusic: false });
    expect(g).toContain("offset=5.000[x1]");
    expect(g).toContain("offset=9.000[vx]");
    expect(g).toContain("concat=n=3:v=0:a=1[narr]");
    expect(g).not.toContain("amix");
  });
  it("mezcla música y aplica atempo solo cuando corresponde", () => {
    const g = buildFilterGraph({ ...base, n: 3, hasMusic: true, tempo: 1.2 });
    expect(g).toContain("atempo=1.2");
    expect(g).toContain("[6:a]volume=0.12");
    expect(g).toContain("amix=inputs=2");
  });
  it("funciona con una sola escena", () => {
    expect(buildFilterGraph({ starts: [0], durations: [5], tempo: 1, total: 5, fontDir: "/f", n: 1, hasMusic: false })).toContain("[0:v]null[vx]");
  });
});

describe("protección SSRF", () => {
  it("detecta IPs privadas y reservadas", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.5", "172.16.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) expect(isPrivateIp(ip)).toBe(true);
    for (const ip of ["8.8.8.8", "151.101.1.1", "2606:4700::1111"]) expect(isPrivateIp(ip)).toBe(false);
  });
  it("valida esquema, host, puerto, credenciales e IPs literales", () => {
    const allowed = ["pexels.com"];
    expect(assertSafeUrl("https://images.pexels.com/a.jpg", allowed).hostname).toBe("images.pexels.com");
    for (const bad of ["http://images.pexels.com/a.jpg", "https://evil.com/a.jpg", "https://pexels.com.evil.com/a", "https://user:pw@images.pexels.com/a", "https://images.pexels.com:8443/a", "https://127.0.0.1/a", "file:///etc/passwd", "no es url"]) {
      expect(() => assertSafeUrl(bad, allowed), bad).toThrow(UnsafeUrlError);
    }
    expect(hostAllowed("notpexels.com", allowed)).toBe(false);
  });
});

describe("almacenamiento", () => {
  it("impide salir de la carpeta de almacenamiento", () => {
    expect(() => resolveInStorage("../../etc/passwd")).toThrow();
    expect(() => resolveInStorage("media/../../x")).toThrow();
    expect(resolveInStorage("media/a.jpg")).toContain("media");
  });
});

describe("Pexels", () => {
  const photo = { id: 7, width: 4000, height: 6000, url: "https://www.pexels.com/photo/7", photographer: "Ana", photographer_url: "https://www.pexels.com/@ana", alt: "Montaña", src: { original: "o", large2x: "l2", large: "l", medium: "m" } };
  const files = [
    { id: 1, quality: "sd", file_type: "video/mp4", width: 640, height: 360, link: "https://videos.pexels.com/a360.mp4" },
    { id: 2, quality: "hd", file_type: "video/mp4", width: 1080, height: 1920, link: "https://videos.pexels.com/a1080.mp4" },
    { id: 3, quality: "uhd", file_type: "video/mp4", width: 2160, height: 3840, link: "https://videos.pexels.com/a2160.mp4" },
    { id: 4, quality: "hls", file_type: "application/x-mpegURL", width: null, height: null, link: "https://videos.pexels.com/a.m3u8" },
  ];
  it("mapea fotos con autor, licencia y calidad", () => {
    const c = mapPhoto(photo, "medium");
    expect(c).toMatchObject({ provider: "pexels", externalId: "7", kind: "photo", downloadUrl: "l", author: "Ana" });
    expect(c.license).toContain("pexels.com/license");
  });
  it("elige el archivo mp4 según calidad e ignora HLS", () => {
    expect(pickVideoFile(files, "small")?.id).toBe(1);
    expect(pickVideoFile(files, "medium")?.id).toBe(2);
    expect(pickVideoFile(files, "large")?.id).toBe(3);
    expect(pickVideoFile([files[3]], "medium")).toBeNull();
    expect(mapVideo({ id: 9, width: 1, height: 1, url: "u", image: "i", duration: 12, user: { name: "Bo", url: "bu" }, video_files: [files[3]] })).toBeNull();
  });

  const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
  const uniq = () => `consulta-${Math.random().toString(36).slice(2)}`;

  it("sin clave lanza 'no configurado'", async () => {
    await expect(new PexelsProvider("", vi.fn()).search({ query: "x", kind: "photo" })).rejects.toBeInstanceOf(MediaProviderNotConfiguredError);
  });
  it("envía la clave y filtros y devuelve resultados; el segundo pedido sale de la caché", async () => {
    const f = vi.fn(async () => json({ photos: [photo], total_results: 1 }, { headers: { "x-ratelimit-remaining": "190" } }));
    const p = new PexelsProvider("KEY123", f as unknown as typeof fetch);
    const q = uniq();
    const a = await p.search({ query: q, kind: "photo", orientation: "portrait", quality: "large" });
    expect(a.items).toHaveLength(1);
    expect(a.rateLimitRemaining).toBe(190);
    const [url, init] = f.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(url).toContain("/v1/search?");
    expect(url).toContain("orientation=portrait");
    expect(url).toContain("size=large");
    expect(init.headers.Authorization).toBe("KEY123");
    await p.search({ query: q, kind: "photo", orientation: "portrait", quality: "large" });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("usa el endpoint de videos", async () => {
    const f = vi.fn(async () => json({ videos: [{ id: 9, width: 1080, height: 1920, url: "u", image: "i", duration: 12, user: { name: "Bo", url: "bu" }, video_files: files }], total_results: 1 }));
    const r = await new PexelsProvider("K", f as unknown as typeof fetch).search({ query: uniq(), kind: "video", quality: "medium" });
    expect((f.mock.calls[0] as unknown as [string])[0]).toContain("/videos/search?");
    expect(r.items[0]).toMatchObject({ kind: "video", downloadUrl: "https://videos.pexels.com/a1080.mp4", durationSec: 12 });
  });
  it("maneja 429, 401 y errores de red", async () => {
    const reset = String(Math.floor(Date.now() / 1000) + 120);
    const p429 = new PexelsProvider("K", (async () => new Response("", { status: 429, headers: { "x-ratelimit-reset": reset } })) as unknown as typeof fetch);
    const e = await p429.search({ query: uniq(), kind: "photo" }).catch((x) => x);
    expect(e).toBeInstanceOf(MediaRateLimitError);
    expect(e.retryAfterSec).toBeGreaterThan(100);
    await expect(new PexelsProvider("K", (async () => new Response("", { status: 401 })) as unknown as typeof fetch).search({ query: uniq(), kind: "photo" })).rejects.toThrow(/clave/);
    await expect(new PexelsProvider("K", (async () => { throw new Error("net"); }) as unknown as typeof fetch).search({ query: uniq(), kind: "photo" })).rejects.toBeInstanceOf(MediaProviderError);
  });
});
