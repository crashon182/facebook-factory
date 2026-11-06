import Redis from "ioredis";

/** BullMQ exige maxRetriesPerRequest = null en sus conexiones. */
export function createRedisConnection() {
  const url = process.env.REDIS_URL?.trim();
  if (!url) throw new Error("REDIS_URL no está definida");
  return new Redis(url, { maxRetriesPerRequest: null });
}
