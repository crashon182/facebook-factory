import { NextResponse } from "next/server";
import { pingDb, pingRedis } from "@/lib/services/monitoring";
import { readHeartbeats } from "@/lib/queue/heartbeat";

export const dynamic = "force-dynamic";

/**
 * Health check público y mínimo (sin datos sensibles) para balanceadores/monitoreo.
 * 200 = base de datos y Redis responden. Los workers se informan como "ok"/"down" pero no cambian el código
 * (usar `?strict=1` para que también devuelva 503 si falta algún worker).
 */
export async function GET(req: Request) {
  const [db, redis, workers] = await Promise.all([pingDb(), pingRedis(), readHeartbeats()]);
  const down = workers.filter((w) => !w.alive).map((w) => w.name);
  const strict = new URL(req.url).searchParams.get("strict") === "1";
  const healthy = db && redis && (!strict || down.length === 0);
  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", db: db ? "up" : "down", redis: redis ? "up" : "down", workers: Object.fromEntries(workers.map((w) => [w.name, w.alive ? "up" : "down"])), time: new Date().toISOString() },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
