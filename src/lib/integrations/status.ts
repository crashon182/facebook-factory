import "server-only";

export type IntegrationState = {
  key: string;
  name: string;
  description: string;
  configured: boolean;
  missing: string[];
  phase: number;
};

function check(vars: string[]) {
  const missing = vars.filter((v) => !process.env[v]?.trim());
  return { configured: missing.length === 0, missing };
}

/** Estado real de configuración (solo comprueba presencia de variables; no llama a las APIs). */
export function getIntegrationStatus(): IntegrationState[] {
  return [
    { key: "openai", name: "OpenAI", description: "Estrategias, contenido y análisis", phase: 2, ...check(["OPENAI_API_KEY"]) },
    { key: "pexels", name: "Pexels", description: "Fotografías y clips de video", phase: 3, ...check(["PEXELS_API_KEY"]) },
    { key: "tts", name: "Narración (TTS)", description: "Voz para los Reels", phase: 3, ...check(["TTS_PROVIDER", "TTS_API_KEY"]) },
    { key: "meta", name: "Meta Graph API", description: "Publicación y estadísticas", phase: 4, ...check(["META_APP_ID", "META_APP_SECRET", "META_GRAPH_VERSION"]) },
    { key: "redis", name: "Redis / BullMQ", description: "Colas y workers", phase: 5, ...check(["REDIS_URL"]) },
  ];
}
