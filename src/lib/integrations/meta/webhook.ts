import { createHmac, timingSafeEqual } from "node:crypto";

/** X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(cuerpo crudo, app secret) en hex. Comparación en tiempo constante. */
export function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  let given: Buffer;
  try {
    given = Buffer.from(header.slice(7), "hex");
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Verificación de suscripción: devuelve hub.challenge solo si el modo y el token coinciden. */
export function verifyChallenge(params: URLSearchParams, verifyToken: string | null): string | null {
  if (!verifyToken || params.get("hub.mode") !== "subscribe") return null;
  const given = params.get("hub.verify_token") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(verifyToken);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return params.get("hub.challenge");
}
