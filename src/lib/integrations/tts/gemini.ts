import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ffmpeg } from "@/lib/video/ffmpeg";
import type { SynthesizeRequest, SynthesizeResult, TTSProvider } from "./types";

// Voces predefinidas de Gemini TTS (documentación de Google AI Studio, verificada 2026-11-09).
export const GEMINI_VOICES = [
  "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede", "Callirrhoe", "Autonoe",
  "Enceladus", "Iapetus", "Umbriel", "Algieba", "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar",
  "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi", "Sadachbia", "Sadaltager", "Sulafat", "Vindemiatrix",
] as const;

export const GEMINI_DEFAULT_MODEL = "gemini-3.8-flash-tts"; // los nombres de modelo cambian seguido: se puede pisar con GEMINI_TTS_MODEL
export const GEMINI_DEFAULT_VOICE = "Sulafat"; // «Warm»
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const TIMEOUT_MS = 90_000;

/** Elige una voz válida de Gemini: la pedida, la de GEMINI_TTS_VOICE o la predeterminada (ignora nombres de otros proveedores, p. ej. «marin»). */
export function pickGeminiVoice(requested?: string | null, env: NodeJS.ProcessEnv = process.env): string {
  for (const c of [requested, env.GEMINI_TTS_VOICE]) {
    const hit = GEMINI_VOICES.find((v) => v.toLowerCase() === c?.trim().toLowerCase());
    if (hit) return hit;
  }
  return GEMINI_DEFAULT_VOICE;
}

export class GeminiTTSError extends Error {}

function clean(msg: string, key: string): string {
  return msg.split(key).join("***").slice(0, 500);
}

export class GeminiTTSProvider implements TTSProvider {
  readonly id = "gemini";
  isConfigured() {
    return !!process.env.GEMINI_API_KEY?.trim();
  }
  get model() {
    return process.env.GEMINI_TTS_MODEL?.trim() || GEMINI_DEFAULT_MODEL;
  }
  /** Parte de la clave de la caché de narraciones: cambiar modelo o voz genera audio nuevo. */
  cacheTag(voice?: string) {
    return `${this.model}|${pickGeminiVoice(voice)}`;
  }

  async synthesize(req: SynthesizeRequest): Promise<SynthesizeResult> {
    const key = process.env.GEMINI_API_KEY?.trim();
    if (!key) throw new GeminiTTSError("Falta GEMINI_API_KEY.");
    const model = this.model;
    const voice = pickGeminiVoice(req.voice);

    // La documentación muestra dos formas de indicar la voz; se prueba la clásica y, si Google responde 400, la nueva.
    const voiceConfigs = [{ prebuiltVoiceConfig: { voiceName: voice } }, { voice }];
    let res: Response | undefined;
    for (const voiceConfig of voiceConfigs) {
      res = await fetch(`${BASE_URL}/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: req.text }] }],
          generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig } },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status !== 400) break;
    }
    if (!res) throw new GeminiTTSError("Gemini TTS no respondió.");

    const raw = await res.text();
    let json: { candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] }; finishReason?: string }[]; error?: { message?: string } } = {};
    try {
      json = JSON.parse(raw);
    } catch {
      /* se informa abajo */
    }
    if (!res.ok) throw new GeminiTTSError(clean(`Gemini TTS ${res.status}: ${json.error?.message ?? raw}`, key));

    const inline = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
    if (!inline?.data) throw new GeminiTTSError(`Gemini no devolvió audio (motivo: ${json.candidates?.[0]?.finishReason ?? "desconocido"}).`);

    const bytes = Buffer.from(inline.data, "base64");
    const isWav = bytes.subarray(0, 4).toString("ascii") === "RIFF";
    const rate = /rate=(\d+)/.exec(inline.mimeType ?? "")?.[1] ?? "24000"; // PCM sin cabecera: 24 kHz, mono, 16 bits
    const dir = await mkdtemp(path.join(os.tmpdir(), "ff-gemini-tts-"));
    try {
      const input = path.join(dir, isWav ? "in.wav" : "in.pcm");
      const output = path.join(dir, "out.mp3");
      await writeFile(input, bytes);
      await ffmpeg([...(isWav ? [] : ["-f", "s16le", "-ar", rate, "-ac", "1"]), "-i", input, "-codec:a", "libmp3lame", "-q:a", "4", output], { timeoutMs: 60_000 });
      return { audio: await readFile(output), format: "mp3", characters: req.text.length, provider: this.id, model };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
