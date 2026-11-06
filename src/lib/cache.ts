import Redis from "ioredis";

// Caché JSON con TTL: Redis si está disponible, memoria como respaldo (nunca rompe la operación).
let redis: Redis | null | undefined;
const mem = new Map<string, { v: string; exp: number }>();

export function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  const url = process.env.REDIS_URL?.trim();
  if (!url) return (redis = null);
  redis = new Redis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: false, connectTimeout: 1500 });
  redis.on("error", () => {});
  return redis;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const r = getRedis();
    if (r) {
      const v = await r.get(`ff:${key}`);
      if (v) return JSON.parse(v) as T;
    }
  } catch {}
  const m = mem.get(key);
  if (m && m.exp > Date.now()) return JSON.parse(m.v) as T;
  return null;
}

export async function cacheSet(key: string, value: unknown, ttlSec: number) {
  const s = JSON.stringify(value);
  mem.set(key, { v: s, exp: Date.now() + ttlSec * 1000 });
  if (mem.size > 500) mem.delete(mem.keys().next().value as string);
  try {
    await getRedis()?.set(`ff:${key}`, s, "EX", ttlSec);
  } catch {}
}

/** Devuelve la conexión lista (espera hasta `timeoutMs` a que termine de conectarse) o null si no hay Redis. */
export async function getReadyRedis(timeoutMs = 1500): Promise<Redis | null> {
  const r = getRedis();
  if (!r) return null;
  if (r.status === "ready") return r;
  return new Promise((resolve) => {
    const t = setTimeout(() => { r.off("ready", onReady); resolve(null); }, timeoutMs);
    const onReady = () => { clearTimeout(t); resolve(r); };
    r.once("ready", onReady);
  });
}
