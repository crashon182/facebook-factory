import { getOpenAIClient, isOpenAIConfigured } from "@/lib/integrations/openai/client";
import type { SynthesizeRequest, SynthesizeResult, TTSProvider } from "./types";

const LANG_NAME: Record<string, string> = { es: "español neutro", en: "inglés", pt: "portugués", fr: "francés", it: "italiano", de: "alemán" };

export class OpenAITTSProvider implements TTSProvider {
  readonly id = "openai";
  isConfigured() {
    return isOpenAIConfigured();
  }
  get model() {
    return process.env.TTS_MODEL?.trim() || "gpt-4o-mini-tts";
  }
  async synthesize(req: SynthesizeRequest): Promise<SynthesizeResult> {
    const model = this.model;
    const res = await getOpenAIClient().audio.speech.create({
      model,
      voice: (req.voice || process.env.TTS_VOICE?.trim() || "marin") as "alloy",
      input: req.text,
      response_format: "mp3",
      // `instructions` solo lo soporta la familia gpt-4o-*-tts
      ...(model.startsWith("gpt-4o") ? { instructions: `Narrá en ${LANG_NAME[req.language ?? "es"] ?? "el idioma del texto"}, con voz cálida, clara y ritmo pausado, apta para un video corto.` } : {}),
    });
    return { audio: Buffer.from(await res.arrayBuffer()), format: "mp3", characters: req.text.length, provider: this.id, model };
  }
}
