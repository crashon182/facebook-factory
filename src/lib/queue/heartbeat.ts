import { getReadyRedis } from "@/lib/cache";
import { createRedisConnection } from "./connection";
import os from "node:os";

export const WORKER_NAMES = ["generate", "render", "publish", "scheduler"] as const;
export type WorkerName = (typeof WORKER_NAMES)[number];
const TTL_SEC = 30;

/** Cada proceso publica un latido cada 10 s (clave con TTL 30 s): si deja de latir, el monitoreo lo marca caído. */
export function startHeartbeat(name: WorkerName) {
  const r = createRedisConnection();
  r.on("error", () => {});
  const beat = () => void r.set(`ff:hb:${name}`, JSON.stringify({ pid: process.pid, host: os.hostname(), ts: Date.now() }), "EX", TTL_SEC).catch(() => {});
  beat();
  const t = setInterval(beat, 10_000);
  t.unref();
  return async () => { clearInterval(t); await r.del(`ff:hb:${name}`).catch(() => {}); r.disconnect(); };
}

export type WorkerStatus = { name: WorkerName; alive: boolean; pid: number | null; host: string | null; lastBeatMs: number | null };

export async function readHeartbeats(now = Date.now()): Promise<WorkerStatus[]> {
  const r = await getReadyRedis();
  return Promise.all(
    WORKER_NAMES.map(async (name) => {
      try {
        const v = r ? await r.get(`ff:hb:${name}`) : null;
        if (!v) return { name, alive: false, pid: null, host: null, lastBeatMs: null };
        const j = JSON.parse(v) as { pid: number; host: string; ts: number };
        return { name, alive: now - j.ts < TTL_SEC * 1000, pid: j.pid, host: j.host, lastBeatMs: j.ts };
      } catch {
        return { name, alive: false, pid: null, host: null, lastBeatMs: null };
      }
    }),
  );
}
