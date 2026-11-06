import "server-only";

export type IntegrationState = {
  key: string;
  name: string;
  description: string;
  configured: boolean;
  missing: string[];
  phase: number;
};

import { spawnSync } from "node:child_process";
import { getTTSProvider } from "./tts";
import { getDefaultProvider } from "./media";

function check(vars: string[]) {
  const missing = vars.filter((v) => !process.env[v]?.trim());
  return { configured: missing.length === 0, missing };
}

function hasBinary(bin: string) {
  return spawnSync(bin, ["-version"], { timeout: 5000 }).status === 0;
}

/** Estado real de configuración (solo comprueba presencia de variables; no llama a las APIs). */
export function getIntegrationStatus(): IntegrationState[] {
  return [
    { key: "openai", name: "OpenAI", description: "Estrategias, contenido y análisis", phase: 2, ...check(["OPENAI_API_KEY"]) },
    { key: "pexels", name: "Pexels", description: `Fotografías y clips de video${getDefaultProvider() ? "" : " (proveedor intercambiable: MediaProvider)"}`, phase: 3, ...check(["PEXELS_API_KEY"]) },
    { key: "tts", name: "Narración (TTS)", description: "Voz para los Reels (por defecto OpenAI, reutiliza OPENAI_API_KEY)", phase: 3, configured: !!getTTSProvider(), missing: getTTSProvider() ? [] : ["OPENAI_API_KEY (o un TTS_PROVIDER soportado)"] },
    { key: "ffmpeg", name: "FFmpeg", description: "Renderizado de Reels e imágenes", phase: 3, configured: hasBinary(process.env.FFMPEG_PATH?.trim() || "ffmpeg"), missing: ["ffmpeg en el PATH (o FFMPEG_PATH)"] },
    { key: "pixabay", name: "Pixabay", description: "Fotografías y videos (alternativa a Pexels)", phase: 3, ...check(["PIXABAY_API_KEY"]) },
    { key: "meta", name: "Meta Graph API", description: "Publicación y estadísticas", phase: 4, ...check(["META_APP_ID", "META_APP_SECRET", "META_GRAPH_VERSION"]) },
    { key: "redis", name: "Redis / BullMQ", description: "Colas y workers", phase: 5, ...check(["REDIS_URL"]) },
  ];
}
