export const LANGUAGES = [
  { value: "es", label: "Español" },
  { value: "en", label: "Inglés" },
  { value: "pt", label: "Portugués" },
  { value: "fr", label: "Francés" },
  { value: "it", label: "Italiano" },
  { value: "de", label: "Alemán" },
] as const;

export const TIMEZONES = [
  "America/Argentina/Buenos_Aires",
  "America/Mexico_City",
  "America/Bogota",
  "America/Lima",
  "America/Santiago",
  "America/Caracas",
  "America/Sao_Paulo",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Europe/Madrid",
  "Europe/London",
  "UTC",
] as const;

export const CONNECTION_LABELS: Record<string, string> = {
  NOT_CONNECTED: "Sin conectar",
  CONNECTED: "Conectada",
  EXPIRED: "Token vencido",
  ERROR: "Error de conexión",
};

export const POST_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Borrador",
  GENERATING: "Generando",
  READY: "Listo",
  SCHEDULED: "Programado",
  PUBLISHING: "Publicando",
  PUBLISHED: "Publicado",
  FAILED: "Fallido",
  CANCELLED: "Cancelado",
};

export const FORMAT_LABELS: Record<string, string> = {
  TEXT: "Texto",
  IMAGE: "Imagen",
  QUOTE_IMAGE: "Imagen con frase",
  REEL: "Reel",
  REFLECTION: "Reflexión",
  EDUCATIONAL: "Educativo",
  INSPIRATIONAL: "Inspiracional",
  SHORT_STORY: "Historia corta",
};

export const SETTING_KEYS = {
  automationsPaused: "automations.paused",
} as const;

export const PAGE_SIZE = 10;
