import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const OAUTH_COOKIE = "ff_meta_oauth";
const TTL_MS = 10 * 60_000;

function key() {
  const k = process.env.AUTH_SECRET;
  if (!k) throw new Error("AUTH_SECRET no definida");
  return k;
}
const sign = (payload: string) => createHmac("sha256", key()).update(payload).digest("base64url");

/** Estado anti-CSRF: nonce aleatorio + página destino, firmado y con vencimiento. El nonce viaja en `state`; el firmado, en cookie httpOnly. */
export function createOAuthState(pageId: string, now = Date.now()) {
  const nonce = randomBytes(24).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ n: nonce, p: pageId, e: now + TTL_MS })).toString("base64url");
  return { state: nonce, cookie: `${payload}.${sign(payload)}` };
}

export function readOAuthState(cookie: string | undefined, stateParam: string | null, now = Date.now()): { pageId: string } | null {
  if (!cookie || !stateParam) return null;
  const [payload, sig] = cookie.split(".");
  if (!payload || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const v = JSON.parse(Buffer.from(payload, "base64url").toString()) as { n: string; p: string; e: number };
    const sa = Buffer.from(v.n);
    const sb = Buffer.from(stateParam);
    if (v.e < now || sa.length !== sb.length || !timingSafeEqual(sa, sb)) return null;
    return { pageId: v.p };
  } catch {
    return null;
  }
}
