import type { TTSProvider } from "./types";
import { OpenAITTSProvider } from "./openai";
import { GeminiTTSProvider } from "./gemini";

/** TTS_PROVIDER selecciona la implementación: "openai" (por defecto, reutiliza OPENAI_API_KEY) o "gemini" (GEMINI_API_KEY). */
export function getTTSProvider(): TTSProvider | null {
  const id = (process.env.TTS_PROVIDER?.trim() || "openai").toLowerCase();
  const p: TTSProvider | null = id === "openai" ? new OpenAITTSProvider() : id === "gemini" ? new GeminiTTSProvider() : null;
  return p?.isConfigured() ? p : null;
}
