import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_FORMATS, frequencyDue, neededPosts, pickFormat, targetPosts } from "@/lib/automation/plan";
import { AUTOMATION_QUEUE, enqueuePageRun, ensureAutomationSchedulers, getAutomationQueue } from "@/lib/queue/automation-queue";
import { ensureDueScanner, getPublishQueue } from "@/lib/queue/publish-queue";
import { readHeartbeats, startHeartbeat } from "@/lib/queue/heartbeat";
import { getRenderQueue } from "@/lib/queue/render-queue";

describe("control de frecuencia y stock", () => {
  const now = new Date("2026-11-06T12:00:00Z");
  it("respeta el intervalo configurado (con 1 minuto de tolerancia)", () => {
    expect(frequencyDue("DAILY", null, now)).toBe(true);
    expect(frequencyDue("DAILY", new Date(now.getTime() - 23 * 3600_000), now)).toBe(false);
    expect(frequencyDue("DAILY", new Date(now.getTime() - 24 * 3600_000 + 30_000), now)).toBe(true);
    expect(frequencyDue("HOURLY", new Date(now.getTime() - 30 * 60_000), now)).toBe(false);
    expect(frequencyDue("HOURLY", new Date(now.getTime() - 61 * 60_000), now)).toBe(true);
    expect(frequencyDue("WEEKLY", new Date(now.getTime() - 3 * 86400_000), now)).toBe(false);
    expect(frequencyDue("RARO", new Date(now.getTime() - 25 * 3600_000), now)).toBe(true); // valor desconocido → diario
  });
  it("calcula el stock objetivo por días de publicación y máximo diario", () => {
    const base = { now, tz: "America/Argentina/Buenos_Aires", daysAhead: 7, maxPerDay: 2 };
    expect(targetPosts(base)).toBe(14);
    expect(targetPosts({ ...base, publishDays: [1, 3, 5] })).toBe(6); // hoy es viernes: vie, lun, mié, vie... dentro de 7 días: vie(6) lun(9) mié(11)
    expect(targetPosts({ ...base, daysAhead: 3, publishDays: [2] })).toBe(0); // vie, sáb, dom: ninguno es martes
  });
  it("pide solo lo que falta y respeta el tope por corrida", () => {
    expect(neededPosts(14, 4, 3)).toBe(3);
    expect(neededPosts(14, 13, 3)).toBe(1);
    expect(neededPosts(6, 6, 3)).toBe(0);
    expect(neededPosts(6, 20, 3)).toBe(0);
  });
});

describe("elección de formato", () => {
  it("usa los permitidos por defecto y rota para dar variedad", () => {
    const picks: string[] = [];
    const recent: string[] = [];
    for (let i = 0; i < 6; i++) { const f = pickFormat({ recommended: [], recentFormats: recent }); picks.push(f); recent.unshift(f); }
    expect(new Set(picks).size).toBe(6);
    expect(picks.every((f) => (DEFAULT_FORMATS as readonly string[]).includes(f))).toBe(true);
  });
  it("respeta los formatos permitidos y pondera la mezcla de la estrategia", () => {
    expect(pickFormat({ allowed: ["REFLECTION"], recommended: [{ format: "TEXT", weeklyFrequency: 9 }], recentFormats: [] })).toBe("REFLECTION");
    const rec = [{ format: "TEXT", weeklyFrequency: 6 }, { format: "QUOTE_IMAGE", weeklyFrequency: 2 }];
    const recent: string[] = [];
    const counts: Record<string, number> = {};
    for (let i = 0; i < 16; i++) { const f = pickFormat({ allowed: ["TEXT", "QUOTE_IMAGE", "REFLECTION"], recommended: rec, recentFormats: recent }); counts[f] = (counts[f] ?? 0) + 1; recent.unshift(f); }
    expect(counts.TEXT).toBeGreaterThan(counts.QUOTE_IMAGE);
    expect(counts.REFLECTION).toBeUndefined(); // fuera de la mezcla recomendada
  });
});

describe("colas y planificador (Redis real)", () => {
  afterAll(async () => {
    const q = getAutomationQueue();
    for (const s of await q.getJobSchedulers()) await q.removeJobScheduler(s.key);
    await q.obliterate({ force: true });
    const p = getPublishQueue();
    for (const s of await p.getJobSchedulers()) await p.removeJobScheduler(s.key);
    await Promise.all([q.close(), p.close(), getRenderQueue().close()]);
  });

  it("registrar los planificadores varias veces no los duplica (varias instancias)", async () => {
    await ensureAutomationSchedulers(60_000);
    await ensureAutomationSchedulers(60_000);
    await ensureAutomationSchedulers(60_000);
    await ensureDueScanner();
    await ensureDueScanner();
    const auto = await getAutomationQueue().getJobSchedulers();
    expect(auto.map((s) => s.key).sort()).toEqual(["automation-tick", "maintenance-daily"]);
    expect((await getPublishQueue().getJobSchedulers()).map((s) => s.key)).toEqual(["due-scanner"]);
  });

  it("encolar la misma corrida de página en la misma franja no la duplica; una forzada sí es nueva", async () => {
    const t = Date.now();
    await enqueuePageRun("pg-x", false, t);
    await enqueuePageRun("pg-x", false, t + 1000);
    await enqueuePageRun("pg-x", true, t + 2000);
    const jobs = await getAutomationQueue().getJobs(["waiting", "delayed", "prioritized"]);
    const mine = jobs.filter((j) => j.name === "page-run" && (j.data as { pageId: string }).pageId === "pg-x");
    expect(mine).toHaveLength(2);
    expect(AUTOMATION_QUEUE).toBe("automation");
  });

  it("los latidos informan procesos vivos y caídos", async () => {
    const stop = startHeartbeat("scheduler");
    await new Promise((r) => setTimeout(r, 300));
    const hb = await readHeartbeats();
    expect(hb.find((w) => w.name === "scheduler")).toMatchObject({ alive: true, pid: process.pid });
    expect(hb.find((w) => w.name === "render")?.alive).toBe(false);
    await stop();
    expect((await readHeartbeats()).find((w) => w.name === "scheduler")?.alive).toBe(false);
  });
});
