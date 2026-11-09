import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeFile } from "node:fs/promises";

// El ffmpeg real no interviene: el mock escribe un «mp3» en la ruta de salida (último argumento).
const ffmpegArgs: string[][] = [];
vi.mock("@/lib/video/ffmpeg", () => ({
  ffmpeg: vi.fn(async (args: string[]) => {
    ffmpegArgs.push(args);
    await writeFile(args[args.length - 1], Buffer.from("MP3DATA"));
    return "";
  }),
}));

import { GeminiTTSProvider, pickGeminiVoice, GEMINI_DEFAULT_MODEL } from "@/lib/integrations/tts/gemini";
import { getTTSProvider } from "@/lib/integrations/tts";

const ok = (data: Buffer, mimeType = "audio/L16;codec=pcm;rate=24000") =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: data.toString("base64"), mimeType } }] } }] }), { status: 200 });

describe("proveedor de voz Gemini", () => {
  const env = { ...process.env };
  beforeEach(() => {
    ffmpegArgs.length = 0;
    process.env.GEMINI_API_KEY = "gk-secreta";
    delete process.env.GEMINI_TTS_MODEL;
    delete process.env.GEMINI_TTS_VOICE;
    process.env.TTS_PROVIDER = "gemini";
  });
  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
  });

  it("se selecciona con TTS_PROVIDER=gemini y exige la clave", () => {
    expect(getTTSProvider()?.id).toBe("gemini");
    delete process.env.GEMINI_API_KEY;
    expect(getTTSProvider()).toBeNull();
  });

  it("elige solo voces de Gemini e ignora nombres de otros proveedores", () => {
    expect(pickGeminiVoice("kore")).toBe("Kore");
    expect(pickGeminiVoice("marin")).toBe("Sulafat");
    expect(pickGeminiVoice("marin", { GEMINI_TTS_VOICE: "Puck" } as never)).toBe("Puck");
  });

  it("llama a la API con clave por header, pide audio y convierte PCM a mp3", async () => {
    const fetchMock = vi.fn(async () => ok(Buffer.from([1, 2, 3, 4])));
    vi.stubGlobal("fetch", fetchMock);
    const r = await new GeminiTTSProvider().synthesize({ text: "Hola mundo", language: "es", voice: "marin" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain(`/models/${GEMINI_DEFAULT_MODEL}:generateContent`);
    expect(url).not.toContain("gk-secreta");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("gk-secreta");
    const body = JSON.parse(init.body as string);
    expect(body.generationConfig.responseModalities).toEqual(["AUDIO"]);
    expect(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Sulafat");
    expect(body.contents[0].parts[0].text).toBe("Hola mundo");
    expect(ffmpegArgs[0]).toEqual(expect.arrayContaining(["-f", "s16le", "-ar", "24000", "-ac", "1"]));
    expect(r.audio.toString()).toBe("MP3DATA");
    expect(r.provider).toBe("gemini");
  });

  it("si la respuesta es WAV no fuerza formato PCM", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(8)]), "audio/wav")));
    await new GeminiTTSProvider().synthesize({ text: "x" });
    expect(ffmpegArgs[0]).not.toContain("s16le");
  });

  it("ante un 400 reintenta con la otra forma de voiceConfig", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Invalid" } }), { status: 400 }))
      .mockResolvedValueOnce(ok(Buffer.from([1, 2])));
    vi.stubGlobal("fetch", fetchMock);
    await new GeminiTTSProvider().synthesize({ text: "x", voice: "Kore" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body as string).generationConfig.speechConfig.voiceConfig).toEqual({ voice: "Kore" });
  });

  it("informa errores sin filtrar la clave y detecta respuestas sin audio", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "API key gk-secreta not valid" } }), { status: 403 })));
    await expect(new GeminiTTSProvider().synthesize({ text: "x" })).rejects.toThrow(/403.*\*\*\*/);
    await expect(new GeminiTTSProvider().synthesize({ text: "x" })).rejects.not.toThrow(/gk-secreta/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ candidates: [{ finishReason: "OTHER" }] }), { status: 200 })));
    await expect(new GeminiTTSProvider().synthesize({ text: "x" })).rejects.toThrow(/no devolvió audio/);
  });

  it("la etiqueta de caché cambia con la voz y el modelo", () => {
    const p = new GeminiTTSProvider();
    expect(p.cacheTag("Kore")).not.toBe(p.cacheTag("Puck"));
    process.env.GEMINI_TTS_MODEL = "otro-modelo";
    expect(p.cacheTag("Kore")).toContain("otro-modelo");
  });
});
