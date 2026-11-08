import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { createPage } from "@/lib/services/pages";
import { pageFormSchema } from "@/lib/validation/page";
import { MetaApiError } from "@/lib/integrations/meta/errors";
import type { MetaClient } from "@/lib/integrations/meta/client";
import { bestHour, engagementRate, fromMin, hourPerformance, judgeExperiment, median, proposeWindowShift, scorePosts, toMin, type PostSample } from "@/lib/analytics/stats";
import { collectPageMetrics, minSnapshotGapMs } from "@/lib/services/analytics-collect";
import { approveExperiment, evaluateExperiments, ExperimentError, proposeTimeExperiment, resolveExperiment, revertExperiment, runOptimization } from "@/lib/services/optimization";
import { getPageOverview } from "@/lib/services/analytics";

const generateStructured = vi.hoisted(() => vi.fn());
vi.mock("@/lib/integrations/openai/client", () => ({ generateStructured }));
import { generateWeeklyReport } from "@/lib/services/analytics-report";

const PREFIX = "TEST_ff6_";
const NOW = new Date("2026-11-08T12:00:00Z");
const DAY = 24 * 3600_000;
const TZ = "America/Argentina/Buenos_Aires"; // UTC-3
let pageId = "";
let seq = 0;

const sample = (over: Partial<PostSample> = {}): PostSample => ({ id: `s${++seq}`, title: "t", format: "TEXT", publishedAt: NOW, reach: 1000, views: 1500, engagements: 100, ...over });

/** Publicación ya publicada con una medición. `localHour` es la hora local (UTC-3) de publicación. */
async function mkPublished(opts: { daysAgo: number; localHour: number; rate: number; format?: "TEXT" | "REEL"; fbId?: string | null; metric?: boolean }) {
  seq++;
  const day = new Date(NOW.getTime() - opts.daysAgo * DAY);
  const publishedAt = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), opts.localHour + 3, 10));
  const post = await prisma.contentPost.create({
    data: { pageId, internalTitle: `${PREFIX}post${seq}`, format: opts.format ?? "TEXT", status: "PUBLISHED", approved: true, publishedAt, facebookPostId: opts.fbId === undefined ? `fb_${seq}` : opts.fbId, facebookCaption: `texto ${seq}` },
  });
  if (opts.metric !== false) {
    await prisma.postMetric.create({ data: { postId: post.id, pageId, capturedAt: new Date(publishedAt.getTime() + 2 * DAY), reach: 1000, views: 1400, engagements: Math.round(1000 * opts.rate) } });
  }
  return post;
}

async function wipe() {
  await prisma.postMetric.deleteMany({ where: { pageId } });
  await prisma.pageMetric.deleteMany({ where: { pageId } });
  await prisma.optimizationExperiment.deleteMany({ where: { pageId } });
  await prisma.aIAnalysisReport.deleteMany({ where: { pageId } });
  await prisma.contentPost.deleteMany({ where: { pageId } });
  await prisma.activityLog.deleteMany({ where: { pageId } });
  await prisma.automationRule.update({ where: { pageId }, data: { windowStart: "09:00", windowEnd: "21:00", autoOptimizeTimes: false } });
  await prisma.socialPage.update({ where: { id: pageId }, data: { connectionStatus: "CONNECTED" } });
}

beforeAll(async () => {
  await prisma.socialPage.deleteMany({ where: { name: { startsWith: PREFIX } } });
  pageId = (await createPage(pageFormSchema.parse({ name: PREFIX + "P", description: "Descripción larga de prueba", topic: "Tema", timezone: TZ }))).id;
  await prisma.socialPage.update({ where: { id: pageId }, data: { facebookPageId: "7001", accessTokenEnc: encryptSecret("PAGE_TOKEN_SECRETO"), connectionStatus: "CONNECTED" } });
});
afterAll(async () => {
  await prisma.socialPage.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.$disconnect();
});
beforeEach(async () => {
  await wipe();
  generateStructured.mockReset();
});

// ───────────── Unidades ─────────────
describe("estadísticas puras", () => {
  it("tasa de interacción usa alcance, o vistas si no hay alcance, y null sin denominador", () => {
    expect(engagementRate({ reach: 1000, views: 5000, engagements: 50 })).toBe(0.05);
    expect(engagementRate({ reach: null, views: 500, engagements: 50 })).toBe(0.1);
    expect(engagementRate({ reach: 0, views: null, engagements: 50 })).toBeNull();
    expect(engagementRate({ reach: 100, views: 100, engagements: null })).toBeNull();
  });

  it("normaliza por la mediana de la página y no normaliza con pocas muestras", () => {
    const few = scorePosts([sample(), sample()]);
    expect(few.every((p) => p.index === null)).toBe(true);
    const s = scorePosts([sample({ engagements: 50 }), sample({ engagements: 100 }), sample({ engagements: 200 })]);
    expect(median(s.map((p) => p.rate!))).toBe(0.1);
    expect(s.map((p) => p.index)).toEqual([0.5, 1, 2]);
  });

  it("mejor hora: exige muestra mínima y pondera por cantidad", () => {
    expect(bestHour([{ key: "19", n: 3, avgIndex: 2 }])).toBeNull(); // total < 8
    const b = bestHour([{ key: "19", n: 6, avgIndex: 1 }, { key: "10", n: 4, avgIndex: 0.25 }]);
    expect(b).toBeCloseTo(17.71, 1);
    expect(bestHour([{ key: "7", n: 1, avgIndex: 5 }, { key: "8", n: 9, avgIndex: 0 }])).toBeNull(); // sin peso útil
  });

  it("agrupa por hora local, no por hora UTC", () => {
    const posts = scorePosts([1, 2, 3].map(() => sample({ publishedAt: new Date("2026-11-05T22:30:00Z") })));
    expect(hourPerformance(posts, TZ)[0].key).toBe("19");
  });

  it("propone mover la franja como máximo 60 min, conservando su ancho", () => {
    const s = proposeWindowShift({ windowStart: "09:00", windowEnd: "21:00" }, 19.5)!;
    expect(s).toEqual({ windowStart: "10:00", windowEnd: "22:00", shiftMin: 60 });
    const back = proposeWindowShift({ windowStart: "09:00", windowEnd: "21:00" }, 8)!;
    expect(back.shiftMin).toBe(-60);
    expect(toMin(back.windowEnd) - toMin(back.windowStart)).toBe(12 * 60);
  });

  it("no mueve si la mejor hora ya está dentro de la franja, y respeta 06:00–23:00", () => {
    expect(proposeWindowShift({ windowStart: "09:00", windowEnd: "21:00" }, 15)).toBeNull();
    expect(proposeWindowShift({ windowStart: "09:00", windowEnd: "21:00" }, null)).toBeNull();
    const s = proposeWindowShift({ windowStart: "12:00", windowEnd: "22:30" }, 23)!;
    expect(s.windowEnd).toBe("23:00");
    expect(s.shiftMin).toBe(30);
    expect(proposeWindowShift({ windowStart: "13:00", windowEnd: "23:00" }, 23)).toBeNull(); // ya en el tope
    expect(fromMin(toMin("06:05"))).toBe("06:05");
  });

  it("juzga experimentos: mejor, peor, neutral o insuficiente", () => {
    expect(judgeExperiment([0.1, 0.1, 0.1], [0.05, 0.05, 0.05]).verdict).toBe("worse");
    expect(judgeExperiment([0.1, 0.1, 0.1], [0.12, 0.12, 0.12]).verdict).toBe("better");
    expect(judgeExperiment([0.1, 0.1, 0.1], [0.1, 0.105, 0.1]).verdict).toBe("neutral");
    expect(judgeExperiment([0.1, 0.1], [0.05, 0.05, 0.05]).verdict).toBe("insufficient");
  });

  it("cadencia de medición: más seguida al inicio", () => {
    expect(minSnapshotGapMs(DAY)).toBeLessThan(minSnapshotGapMs(3 * DAY));
    expect(minSnapshotGapMs(3 * DAY)).toBeLessThan(minSnapshotGapMs(20 * DAY));
  });
});

// ───────────── Recopilación ─────────────
function fakeClient(over: Partial<Record<string, unknown>> = {}) {
  const calls: string[] = [];
  const c = {
    pageFollowers: vi.fn(async () => 1234),
    insightSeries: vi.fn(async (_id: string, _t: string, metric: string) => {
      calls.push(metric);
      return [{ value: 10, endTime: "a" }, { value: 77, endTime: "b" }];
    }),
    postEngagement: vi.fn(async () => ({ reactions: 10, comments: 3, shares: 2 })),
    ...over,
  };
  return { c, calls, deps: { client: () => c as unknown as MetaClient, now: () => NOW } };
}

describe("recopilación de métricas", () => {
  it("guarda la foto de la Página y de las publicaciones recientes", async () => {
    const post = await mkPublished({ daysAgo: 1, localHour: 10, rate: 0.1, metric: false });
    const { deps, c } = fakeClient();
    const r = await collectPageMetrics(pageId, {}, deps);
    expect(r).toMatchObject({ pageSnapshot: true, postSnapshots: 1, unavailable: [] });
    const pm = await prisma.pageMetric.findFirstOrThrow({ where: { pageId } });
    expect(pm).toMatchObject({ followers: 1234, impressions: 77, reach: 77, engagements: 77 });
    const m = await prisma.postMetric.findFirstOrThrow({ where: { postId: post.id } });
    expect(m).toMatchObject({ views: 77, reach: 77, reactions: 10, comments: 3, shares: 2, engagements: 15 });
    // Nunca se pide con el token en claro hacia afuera ni se guarda el token en el registro
    expect(JSON.stringify(await prisma.activityLog.findMany({ where: { pageId } }))).not.toContain("PAGE_TOKEN_SECRETO");
    expect(c.insightSeries.mock.calls[0][1]).toBe("PAGE_TOKEN_SECRETO");
  });

  it("es idempotente: no repite snapshots dentro de la cadencia mínima, salvo force", async () => {
    await mkPublished({ daysAgo: 1, localHour: 10, rate: 0.1, metric: false });
    const { deps } = fakeClient();
    await collectPageMetrics(pageId, {}, deps);
    const again = await collectPageMetrics(pageId, {}, deps);
    expect(again).toMatchObject({ pageSnapshot: false, postSnapshots: 0 });
    const forced = await collectPageMetrics(pageId, { force: true }, deps);
    expect(forced).toMatchObject({ pageSnapshot: true, postSnapshots: 1 });
    expect(await prisma.postMetric.count({ where: { pageId } })).toBe(2);
  });

  it("tolera una métrica retirada por Meta (error 100) y guarda el resto", async () => {
    await mkPublished({ daysAgo: 1, localHour: 10, rate: 0.1, metric: false });
    const { deps } = fakeClient({
      insightSeries: vi.fn(async (_i: string, _t: string, metric: string) => {
        if (metric === "page_media_view" || metric === "post_media_view") throw new MetaApiError("(#100) metric is deprecated", 100, undefined, 400);
        return [{ value: 5, endTime: null }];
      }),
    });
    const r = await collectPageMetrics(pageId, {}, deps);
    expect(r.unavailable).toEqual(expect.arrayContaining(["page_media_view", "post_media_view"]));
    expect(r.postSnapshots).toBe(1);
    const m = await prisma.postMetric.findFirstOrThrow({ where: { pageId } });
    expect(m.views).toBeNull();
    expect(m.reach).toBe(5);
  });

  it("ante token vencido corta, marca la Página como vencida y no guarda nada", async () => {
    await mkPublished({ daysAgo: 1, localHour: 10, rate: 0.1, metric: false });
    const { deps } = fakeClient({ pageFollowers: vi.fn(async () => { throw new MetaApiError("Invalid OAuth access token", 190, undefined, 400); }) });
    const r = await collectPageMetrics(pageId, {}, deps);
    expect(r.error).toContain("190");
    expect((await prisma.socialPage.findUniqueOrThrow({ where: { id: pageId } })).connectionStatus).toBe("EXPIRED");
    expect(await prisma.postMetric.count({ where: { pageId } })).toBe(0);
  });

  it("omite páginas sin conexión", async () => {
    await prisma.socialPage.update({ where: { id: pageId }, data: { connectionStatus: "NOT_CONNECTED" } });
    const { deps, c } = fakeClient();
    const r = await collectPageMetrics(pageId, {}, deps);
    expect(r.skipped).toBeTruthy();
    expect(c.pageFollowers).not.toHaveBeenCalled();
  });
});

// ───────────── Panel ─────────────
describe("resumen de la página", () => {
  it("compara contra el período anterior y calcula el índice normalizado", async () => {
    for (let i = 0; i < 4; i++) await mkPublished({ daysAgo: 2 + i, localHour: 19, rate: 0.2 });
    for (let i = 0; i < 4; i++) await mkPublished({ daysAgo: 40 + i, localHour: 10, rate: 0.1 });
    await mkPublished({ daysAgo: 3, localHour: 11, rate: 0.1, metric: false }); // sin métricas: no cuenta
    const o = (await getPageOverview(pageId, 30, NOW))!;
    expect(o.current.posts).toBe(4);
    expect(o.previous.posts).toBe(4); // hace 40 días cae en el período anterior (30–60)
    // Normalizado con la mediana de AMBOS períodos: 0.2 vs 0.1 → mediana 0.15
    expect(o.posts.every((p) => p.index != null)).toBe(true);
    expect(o.posts[0].index).toBeCloseTo(0.2 / 0.15, 5);
    expect(o.changes.engagements).toBeCloseTo(100, 5); // 800 vs 400 interacciones
    expect(o.changes.avgRate).toBeCloseTo(100, 5);
    expect(o.formats[0].key).toBe("TEXT");
  });
});

// ───────────── Optimización ─────────────
async function seedTimeData() {
  for (let i = 0; i < 6; i++) await mkPublished({ daysAgo: 2 + i, localHour: 19, rate: 0.2 });
  for (let i = 0; i < 4; i++) await mkPublished({ daysAgo: 10 + i, localHour: 10, rate: 0.05 });
}

describe("experimentos de horario", () => {
  it("sin datos suficientes no propone nada", async () => {
    const r = await proposeTimeExperiment(pageId, NOW);
    expect(r.created).toBeNull();
    expect(r.reason).toMatch(/datos/);
  });

  it("sin autoOptimizeTimes solo propone: la franja no cambia hasta aprobar", async () => {
    await seedTimeData();
    const { created } = await proposeTimeExperiment(pageId, NOW);
    expect(created?.status).toBe("PROPOSED");
    expect((await prisma.automationRule.findUniqueOrThrow({ where: { pageId } })).windowStart).toBe("09:00");
    expect((await proposeTimeExperiment(pageId, NOW)).reason).toMatch(/abierto/);

    const running = await approveExperiment(created!.id, NOW);
    expect(running.status).toBe("RUNNING");
    const rule = await prisma.automationRule.findUniqueOrThrow({ where: { pageId } });
    expect([rule.windowStart, rule.windowEnd]).toEqual(["10:00", "22:00"]);
    expect(rule.maxPostsPerDay).toBe(1); // los límites no se tocan
  });

  it("con autoOptimizeTimes lo aplica y queda en curso por 7 días", async () => {
    await seedTimeData();
    await prisma.automationRule.update({ where: { pageId }, data: { autoOptimizeTimes: true } });
    const { created } = await proposeTimeExperiment(pageId, NOW);
    expect(created?.status).toBe("RUNNING");
    expect(created?.endsAt?.getTime()).toBe(NOW.getTime() + 7 * DAY);
    expect((await prisma.automationRule.findUniqueOrThrow({ where: { pageId } })).windowEnd).toBe("22:00");
  });

  it("revertir devuelve la franja anterior, pero no pisa un cambio manual posterior", async () => {
    await seedTimeData();
    const { created } = await proposeTimeExperiment(pageId, NOW);
    await approveExperiment(created!.id, NOW);
    await revertExperiment(created!.id, "prueba", NOW);
    expect((await prisma.automationRule.findUniqueOrThrow({ where: { pageId } })).windowStart).toBe("09:00");

    await prisma.optimizationExperiment.deleteMany({ where: { pageId } });
    const again = (await proposeTimeExperiment(pageId, new Date(NOW.getTime() + 8 * DAY))).created!;
    await approveExperiment(again.id, NOW);
    await prisma.automationRule.update({ where: { pageId }, data: { windowStart: "08:00", windowEnd: "20:00" } }); // el usuario lo cambió a mano
    const r = await revertExperiment(again.id, "prueba", NOW);
    expect((r.result as { note: string }).note).toContain("modificada a mano");
    expect((await prisma.automationRule.findUniqueOrThrow({ where: { pageId } })).windowStart).toBe("08:00");
  });

  it("evaluación: si la interacción cae más de 15% revierte automáticamente", async () => {
    const start = new Date(NOW.getTime() - 8 * DAY);
    const end = new Date(NOW.getTime() - 1 * DAY);
    await prisma.automationRule.update({ where: { pageId }, data: { windowStart: "10:00", windowEnd: "22:00" } });
    const exp = await prisma.optimizationExperiment.create({
      data: { pageId, variable: "posting_window", hypothesis: "h", status: "RUNNING", startsAt: start, endsAt: end, result: { before: { windowStart: "09:00", windowEnd: "21:00" }, after: { windowStart: "10:00", windowEnd: "22:00" }, shiftMin: 60, bestHour: 19 } },
    });
    for (let i = 0; i < 3; i++) await mkPublished({ daysAgo: 10 + i, localHour: 12, rate: 0.2 }); // antes
    for (let i = 0; i < 3; i++) await mkPublished({ daysAgo: 3 + i, localHour: 12, rate: 0.05 }); // durante
    const r = await evaluateExperiments(pageId, NOW);
    expect(r).toEqual({ evaluated: 1, reverted: 1, extended: 0 });
    expect((await prisma.optimizationExperiment.findUniqueOrThrow({ where: { id: exp.id } })).status).toBe("REVERTED");
    expect((await prisma.automationRule.findUniqueOrThrow({ where: { pageId } })).windowStart).toBe("09:00");
  });

  it("evaluación: si no empeoró, el cambio se conserva; con pocos datos se prorroga una vez", async () => {
    const start = new Date(NOW.getTime() - 8 * DAY);
    await prisma.automationRule.update({ where: { pageId }, data: { windowStart: "10:00", windowEnd: "22:00" } });
    const mk = (id: string) => prisma.optimizationExperiment.create({ data: { pageId, variable: "posting_window", hypothesis: id, status: "RUNNING", startsAt: start, endsAt: new Date(NOW.getTime() - DAY), result: { before: { windowStart: "09:00", windowEnd: "21:00" }, after: { windowStart: "10:00", windowEnd: "22:00" }, shiftMin: 60, bestHour: 19 } } });

    const sparse = await mk("sparse");
    expect(await evaluateExperiments(pageId, NOW)).toEqual({ evaluated: 1, reverted: 0, extended: 1 });
    const ext = await prisma.optimizationExperiment.findUniqueOrThrow({ where: { id: sparse.id } });
    expect(ext.status).toBe("RUNNING");
    expect(ext.endsAt!.getTime()).toBeGreaterThan(NOW.getTime());
    // segunda evaluación (ya prorrogado) sin datos → revierte
    await prisma.optimizationExperiment.update({ where: { id: sparse.id }, data: { endsAt: new Date(NOW.getTime() - 1000) } });
    expect((await evaluateExperiments(pageId, NOW)).reverted).toBe(1);

    await prisma.optimizationExperiment.deleteMany({ where: { pageId } });
    await prisma.automationRule.update({ where: { pageId }, data: { windowStart: "10:00", windowEnd: "22:00" } });
    const good = await mk("good");
    for (let i = 0; i < 3; i++) await mkPublished({ daysAgo: 10 + i, localHour: 12, rate: 0.1 });
    for (let i = 0; i < 3; i++) await mkPublished({ daysAgo: 3 + i, localHour: 12, rate: 0.12 });
    expect((await evaluateExperiments(pageId, NOW)).reverted).toBe(0);
    expect((await prisma.optimizationExperiment.findUniqueOrThrow({ where: { id: good.id } })).status).toBe("COMPLETED");
    expect((await prisma.automationRule.findUniqueOrThrow({ where: { pageId } })).windowStart).toBe("10:00");
  });

  it("las sugerencias manuales no se aplican solas y se pueden descartar o marcar como hechas", async () => {
    const s = await prisma.optimizationExperiment.create({ data: { pageId, variable: "formato", hypothesis: "Más Reels", status: "PROPOSED" } });
    await expect(approveExperiment(s.id)).rejects.toBeInstanceOf(ExperimentError);
    expect((await resolveExperiment(s.id, "COMPLETED")).status).toBe("COMPLETED");
    await expect(resolveExperiment(s.id, "REJECTED")).rejects.toBeInstanceOf(ExperimentError);
    const w = await prisma.optimizationExperiment.create({ data: { pageId, variable: "posting_window", hypothesis: "x", status: "PROPOSED" } });
    await expect(resolveExperiment(w.id, "COMPLETED")).rejects.toBeInstanceOf(ExperimentError);
  });

  it("runOptimization combina evaluación y propuesta", async () => {
    await seedTimeData();
    const r = await runOptimization(pageId, NOW);
    expect(r.proposed).toBeTruthy();
  });
});

// ───────────── Informe con IA ─────────────
describe("informe semanal", () => {
  const ai = { summary: "Semana estable.", highlights: ["Los textos rinden"], concerns: [], recommendations: ["Probar 18 h"], experiments: [{ hypothesis: "Más preguntas al final mejora comentarios", variable: "tono" }] };

  it("genera el informe, guarda las sugerencias como propuestas y no se repite en la semana", async () => {
    for (let i = 0; i < 4; i++) await mkPublished({ daysAgo: 1 + i, localHour: 19, rate: 0.1 + i / 100 });
    generateStructured.mockResolvedValue({ data: ai, costUsd: 0.002 });
    const r = await generateWeeklyReport(pageId, {}, NOW);
    expect(r.reportId).toBeTruthy();
    const call = generateStructured.mock.calls[0][0];
    expect(call.user).toContain("performanceIndex");
    expect(call.system).toMatch(/ÚNICAMENTE/);
    expect(call.pageId).toBe(pageId);
    const rep = await prisma.aIAnalysisReport.findFirstOrThrow({ where: { pageId } });
    expect(rep.summary).toBe("Semana estable.");
    const exp = await prisma.optimizationExperiment.findFirstOrThrow({ where: { pageId } });
    expect(exp).toMatchObject({ status: "PROPOSED", variable: "tono" });

    const again = await generateWeeklyReport(pageId, {}, NOW);
    expect("skipped" in again).toBe(true);
    expect(generateStructured).toHaveBeenCalledTimes(1);
  });

  it("sin publicaciones medidas no llama a la IA", async () => {
    const r = await generateWeeklyReport(pageId, {}, NOW);
    expect(r).toMatchObject({ skipped: expect.any(String) });
    expect(generateStructured).not.toHaveBeenCalled();
  });
});
