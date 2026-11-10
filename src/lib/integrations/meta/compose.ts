import { createHash } from "node:crypto";

export const TEXT_FORMATS = ["TEXT", "REFLECTION", "EDUCATIONAL", "INSPIRATIONAL", "SHORT_STORY"] as const;
export type PublishKind = "text" | "photo" | "reel";

export function publishKindFor(format: string): PublishKind {
  if (format === "REEL") return "reel";
  if (format === "IMAGE" || format === "QUOTE_IMAGE") return "photo";
  return "text";
}

/**
 * Texto final publicado. Con versículo: «versículo» + referencia, luego la reflexión (texto principal) y los hashtags.
 * Sin versículo: caption de Facebook (o el cuerpo) + hashtags, como antes.
 */
export function composeMessage(p: { facebookCaption?: string | null; body?: string | null; hashtags?: unknown; verseText?: string | null; verseReference?: string | null }): string {
  const verseText = p.verseText?.trim() ?? "";
  const verseRef = p.verseReference?.trim() ?? "";
  const verse = verseText ? (verseRef ? `«${verseText}»\n${verseRef}` : `«${verseText}»`) : "";
  const base = verse ? p.body?.trim() || p.facebookCaption?.trim() || "" : p.facebookCaption?.trim() || p.body?.trim() || "";
  const tags = Array.isArray(p.hashtags) ? (p.hashtags as unknown[]).map((t) => String(t).replace(/^#+/, "").replace(/\s+/g, "")).filter(Boolean) : [];
  const line = tags.map((t) => `#${t}`).join(" ");
  return [verse, base, line].filter(Boolean).join("\n\n").slice(0, 5000);
}

export const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** ¿Es este post de Meta el que intentamos publicar? Mismo texto y creado desde (casi) el inicio del intento. */
export function matchesAttempt(candidate: { message: string | null; createdTime: string | null }, message: string, attemptStartedAt: Date, slackMs = 120_000): boolean {
  if (!candidate.message || !candidate.createdTime) return false;
  if (normalize(candidate.message) !== normalize(message)) return false;
  return new Date(candidate.createdTime).getTime() >= attemptStartedAt.getTime() - slackMs;
}

export function idempotencyKey(postId: string, scheduledAt: Date) {
  return `pub-${createHash("sha256").update(`${postId}|${scheduledAt.toISOString()}`).digest("hex").slice(0, 40)}`;
}
