export const DEFAULT_GRAPH_VERSION = "v27.0"; // última versión según la documentación de Meta (2026-11-06); configurable por entorno

/** Permisos del flujo OAuth. pages_show_list + pages_manage_posts + pages_read_engagement bastan para publicar (incl. Reels). */
export const DEFAULT_SCOPES = ["pages_show_list", "pages_manage_posts", "pages_read_engagement", "read_insights"];

export type MetaConfig = {
  appId: string;
  appSecret: string;
  version: string;
  verifyToken: string | null;
  scopes: string[];
  redirectUri: string;
  /** Bases de las APIs. Solo se pueden sobrescribir fuera de producción (pruebas contra un Graph API simulado). */
  graphBase: string;
  uploadBase: string;
};

export function getMetaConfig(env: NodeJS.ProcessEnv = process.env): MetaConfig | null {
  const appId = env.META_APP_ID?.trim();
  const appSecret = env.META_APP_SECRET?.trim();
  if (!appId || !appSecret) return null;
  const version = env.META_GRAPH_VERSION?.trim() || DEFAULT_GRAPH_VERSION;
  if (!/^v\d+\.\d+$/.test(version)) throw new Error("META_GRAPH_VERSION inválida (ej. v27.0)");
  const base = (env.AUTH_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
  const devOverride = env.NODE_ENV !== "production";
  const graphBase = (devOverride && env.META_GRAPH_BASE_URL?.trim()) || "https://graph.facebook.com";
  const uploadBase = (devOverride && env.META_UPLOAD_BASE_URL?.trim()) || "https://rupload.facebook.com";
  return {
    appId, appSecret, version,
    verifyToken: env.META_WEBHOOK_VERIFY_TOKEN?.trim() || null,
    scopes: env.META_SCOPES?.split(",").map((s) => s.trim()).filter(Boolean) ?? DEFAULT_SCOPES,
    redirectUri: `${base}/api/meta/oauth/callback`,
    graphBase: graphBase.replace(/\/+$/, ""),
    uploadBase: uploadBase.replace(/\/+$/, ""),
  };
}

export function isMetaConfigured() {
  return getMetaConfig() !== null;
}
