import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { createPage } from "@/lib/services/pages";
import { pageFormSchema } from "@/lib/validation/page";
import { validStrategy } from "./phase2-units.test";

const gen = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/integrations/openai/client", async (orig) => {
  const real = await orig<typeof import("@/lib/integrations/openai/client")>();
  return { ...real, generateStructured: gen.fn, getModel: () => "test-model" };
});

const { generateStrategy, saveManualStrategy, restoreStrategyVersion, listStrategyVersions, getActiveStrategy } = await import("@/lib/services/strategies");
const contents = await import("@/lib/services/contents");

const PREFIX = "TEST_ff2_";
let pageId = "";
const post = (over: object = {}) => ({
  internalTitle: "Título IA", topic: "Esperanza", body: "Cuerpo", facebookCaption: "Texto único " + Math.random(),
  script: null, imageText: null, hashtags: ["#fe", "paz"], imageKeywords: [], scenes: [], ...over,
});

beforeAll(async () => {
  await prisma.socialPage.deleteMany({ where: { name: { startsWith: PREFIX } } });
  pageId = (await createPage(pageFormSchema.parse({ name: PREFIX + "A", description: "Descripción de prueba larga", topic: "Test", timezone: "UTC" }))).id;
});
afterAll(async () => {
  await prisma.aPIUsageLog.deleteMany({ where: { operation: "test" } });
  await prisma.socialPage.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.$disconnect();
});
beforeEach(() => {
  gen.fn.mockReset();
});

describe("estrategias (MySQL + IA simulada)", () => {
  it("genera v1, crea pilares e ideas y versiona al regenerar", async () => {
    gen.fn.mockResolvedValue({ data: validStrategy, costUsd: 0.01, inputTokens: 1, outputTokens: 1 });
    const v1 = await generateStrategy(pageId);
    expect(v1.version).toBe(1);
    expect(await prisma.contentPillar.count({ where: { pageId } })).toBe(1);
    expect(await prisma.contentIdea.count({ where: { pageId } })).toBe(1);
    const v2 = await generateStrategy(pageId);
    expect(v2.version).toBe(2);
    expect(await prisma.contentIdea.count({ where: { pageId } })).toBe(1); // sin duplicar
    const versions = await listStrategyVersions(pageId);
    expect(versions.map((v) => v.status)).toEqual(["ACTIVE", "ARCHIVED"]);
  });

  it("rechaza una estrategia de la IA que no cumple las reglas y no guarda nada", async () => {
    gen.fn.mockResolvedValue({ data: { ...validStrategy, categories: [] }, costUsd: 0, inputTokens: 1, outputTokens: 1 });
    const before = await prisma.pageStrategy.count({ where: { pageId } });
    await expect(generateStrategy(pageId)).rejects.toThrow(/categoría/);
    expect(await prisma.pageStrategy.count({ where: { pageId } })).toBe(before);
  });

  it("edición manual y restauración crean versiones nuevas", async () => {
    const edited = await saveManualStrategy(pageId, { ...validStrategy, tone: "Editado a mano" });
    expect(edited.source).toBe("MANUAL");
    expect((await getActiveStrategy(pageId))?.strategy.tone).toBe("Editado a mano");
    const all = await listStrategyVersions(pageId);
    const old = all.find((v) => v.version === 1)!;
    const restored = await restoreStrategyVersion(pageId, old.id);
    expect(restored.version).toBe(edited.version + 1);
    expect((await getActiveStrategy(pageId))?.strategy.tone).toBe("Cálido");
    await expect(saveManualStrategy(pageId, { tone: "x" })).rejects.toThrow();
  });
});

describe("contenidos (MySQL + IA simulada)", () => {
  it("genera contenido READY con hashtags limpios", async () => {
    gen.fn.mockResolvedValue({ data: post(), costUsd: 0, inputTokens: 1, outputTokens: 1 });
    const id = await contents.generateContent({ pageId, format: "TEXT" });
    const p = await prisma.contentPost.findUniqueOrThrow({ where: { id } });
    expect(p.status).toBe("READY");
    expect(p.hashtags).toEqual(["fe", "paz"]);
    expect(p.contentHash).toHaveLength(64);
  });

  it("guarda escenas para Reels", async () => {
    gen.fn.mockResolvedValue({ data: post({ script: "Guion", scenes: [{ narration: "Uno", visualKeywords: ["sun"] }, { narration: "Dos", visualKeywords: ["sea"] }] }), costUsd: 0, inputTokens: 1, outputTokens: 1 });
    const id = await contents.generateContent({ pageId, format: "REEL" });
    expect(await prisma.contentScene.count({ where: { postId: id } })).toBe(2);
  });

  it("reintenta una vez si la IA repite contenido y falla si repite dos veces", async () => {
    const same = post({ facebookCaption: "Contenido repetido exacto" });
    gen.fn.mockResolvedValue({ data: same, costUsd: 0, inputTokens: 1, outputTokens: 1 });
    await contents.generateContent({ pageId, format: "TEXT" }); // primero: único
    gen.fn.mockClear();
    await expect(contents.generateContent({ pageId, format: "TEXT" })).rejects.toThrow(/repetido/);
    expect(gen.fn).toHaveBeenCalledTimes(2);
    const failed = await prisma.contentPost.findFirst({ where: { pageId, status: "FAILED" } });
    expect(failed?.failureReason).toMatch(/repetido/);
  });

  it("un error de la IA deja el contenido FAILED con motivo", async () => {
    const calls: string[] = [];
    gen.fn.mockImplementation(() => {
      calls.push("llamada");
      throw Object.assign(new Error("boom sk-abc123"), { status: 429 });
    });
    let message = "";
    try {
      await contents.generateContent({ pageId, format: "TEXT" });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(calls).toHaveLength(1);
    expect(message).toMatch(/429/);
    expect(message).not.toContain("sk-abc123");
    const failed = await prisma.contentPost.findFirst({ where: { pageId, failureReason: { contains: "429" } } });
    expect(failed?.status).toBe("FAILED");
  });

  it("flujo editar → listo → aprobar → duplicar → cancelar → eliminar", async () => {
    const id = await contents.createDraft(pageId, "TEXT");
    await expect(contents.setApproved(id, true)).rejects.toThrow(/Listo/);
    await expect(contents.markReady(id)).rejects.toThrow(/texto/);
    await contents.updateContent(id, { internalTitle: "Manual", facebookCaption: "Hola mundo " + Math.random(), hashtags: ["#a"] });
    await contents.markReady(id);
    await contents.setApproved(id, true);
    expect((await prisma.contentPost.findUniqueOrThrow({ where: { id } })).approved).toBe(true);
    await contents.updateContent(id, { internalTitle: "Manual 2", facebookCaption: "Otro texto " + Math.random() });
    expect((await prisma.contentPost.findUniqueOrThrow({ where: { id } })).approved).toBe(false); // editar retira aprobación
    const copyId = await contents.duplicateContent(id);
    expect((await prisma.contentPost.findUniqueOrThrow({ where: { id: copyId } })).status).toBe("DRAFT");
    await contents.cancelContent(id);
    await contents.deleteContent(id);
    expect(await prisma.contentPost.findUnique({ where: { id } })).toBeNull();
  });

  it("no permite editar ni borrar contenido programado/publicado", async () => {
    const id = await contents.createDraft(pageId, "TEXT");
    await prisma.contentPost.update({ where: { id }, data: { status: "SCHEDULED" } });
    await expect(contents.updateContent(id, { internalTitle: "x" })).rejects.toThrow(/editar/);
    await expect(contents.deleteContent(id)).rejects.toThrow(/eliminar/);
    await expect(contents.regenerateContent(id)).rejects.toThrow();
  });
});

describe("presupuesto", () => {
  it("assertBudget corta cuando el gasto del día supera el límite de la página", async () => {
    const real = await vi.importActual<typeof import("@/lib/integrations/openai/client")>("@/lib/integrations/openai/client");
    await prisma.automationRule.update({ where: { pageId }, data: { dailyBudgetUsd: 0.5 } });
    await expect(real.assertBudget(pageId)).resolves.toBeUndefined();
    await prisma.aPIUsageLog.create({ data: { pageId, provider: "openai", operation: "test", costUsd: 0.6 } });
    await expect(real.assertBudget(pageId)).rejects.toThrow(/presupuesto diario/);
  });
});
