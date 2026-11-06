import type { TTSProvider } from "./types";
import { OpenAITTSProvider } from "./openai";

/** TTS_PROVIDER selecciona la implementación (por ahora solo "openai", que reutiliza OPENAI_API_KEY). */
export function getTTSProvider(): TTSProvider | null {
  const id = (process.env.TTS_PROVIDER?.trim() || "openai").toLowerCase();
  const p: TTSProvider | null = id === "openai" ? new OpenAITTSProvider() : null;
  return p?.isConfigured() ? p : null;
}
