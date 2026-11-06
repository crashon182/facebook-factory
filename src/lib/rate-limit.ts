import { getRedis } from "@/lib/cache";

// Limitador de uso. Con Redis la cuenta es compartida entre procesos/instancias (ventana fija);
// si Redis no responde cae a una ventana deslizante en memoria (nunca bloquea la aplicación por un fallo de Redis).
const buckets = new Map<string, number[]>();

function memoryLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return { ok: false, retryAfterMs: windowMs - (now - hits[0]) };
  }
  hits.push(now);
  buckets.set(key, hits);
  return { ok: true, retryAfterMs: 0 };
}

export async function rateLimit(key: string, limit: number, windowMs: number): Promise<{ ok: boolean; retryAfterMs: number }> {
  const r = getRedis();
  if (r) {
    try {
      const k = `ff:rl:${key}`;
      const n = await r.incr(k);
      if (n === 1) await r.pexpire(k, windowMs);
      if (n > limit) return { ok: false, retryAfterMs: Math.max(0, await r.pttl(k)) };
      return { ok: true, retryAfterMs: 0 };
    } catch {
      /* respaldo en memoria */
    }
  }
  return memoryLimit(key, limit, windowMs);
}

export async function resetRateLimit(key: string) {
  buckets.delete(key);
  try {
    await getRedis()?.del(`ff:rl:${key}`);
  } catch {}
}
