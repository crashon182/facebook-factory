import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createPage, deletePage, listPages, updateAutomation, updatePage, setPageAutomationEnabled } from "@/lib/services/pages";
import { getAutomationsPaused, setAutomationsPaused } from "@/lib/services/settings";
import { pageFormSchema } from "@/lib/validation/page";

// Integración contra la BD real de desarrollo; limpia solo lo que crea (prefijo TEST_).
const PREFIX = "TEST_ff_";
const values = (name: string) => pageFormSchema.parse({ name: PREFIX + name, description: "Descripción de prueba larga", topic: "Test", timezone: "UTC" });

async function cleanup() {
  await prisma.socialPage.deleteMany({ where: { name: { startsWith: PREFIX } } });
}
beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("servicio de páginas (MySQL)", () => {
  it("crea página con slug único y regla de automatización desactivada", async () => {
    const a = await createPage(values("Dup"));
    const b = await createPage(values("Dup"));
    expect(a.slug).not.toBe(b.slug);
    const rule = await prisma.automationRule.findUnique({ where: { pageId: a.id } });
    expect(rule).toMatchObject({ enabled: false, requireApproval: true, autoPublish: false });
  });

  it("actualiza y vacía campos opcionales", async () => {
    const p = await createPage({ ...values("Upd"), tone: "cálido" });
    const u = await updatePage(p.id, values("Upd"));
    expect(u.tone).toBeNull();
  });

  it("impide duplicar el Facebook Page ID", async () => {
    await createPage({ ...values("Fb1"), facebookPageId: "9990001112223" });
    await expect(createPage({ ...values("Fb2"), facebookPageId: "9990001112223" })).rejects.toMatchObject({ code: "P2002" });
  });

  it("lista con búsqueda y paginación", async () => {
    const r = await listPages({ q: PREFIX, status: "all", connection: "all", page: 1 });
    expect(r.total).toBeGreaterThanOrEqual(4);
    expect(r.items.length).toBeLessThanOrEqual(10);
    const none = await listPages({ q: "zzz-inexistente-zzz", status: "all", connection: "all", page: 1 });
    expect(none.total).toBe(0);
  });

  it("guarda reglas de automatización y las alterna", async () => {
    const p = await createPage(values("Auto"));
    await updateAutomation(p.id, { enabled: true, maxPostsPerDay: 3, requireApproval: true, autoPublish: false, autoOptimizeTimes: false, daysAhead: 5, dailyBudgetUsd: 2.5, windowStart: "08:00", windowEnd: "20:00" });
    await setPageAutomationEnabled(p.id, false);
    const rule = await prisma.automationRule.findUniqueOrThrow({ where: { pageId: p.id } });
    expect(rule).toMatchObject({ enabled: false, maxPostsPerDay: 3, daysAhead: 5 });
    expect(Number(rule.dailyBudgetUsd)).toBe(2.5);
  });

  it("elimina en cascada", async () => {
    const p = await createPage(values("Del"));
    await deletePage(p.id);
    expect(await prisma.automationRule.findUnique({ where: { pageId: p.id } })).toBeNull();
  });

  it("pausa global persiste", async () => {
    const before = await getAutomationsPaused();
    await setAutomationsPaused(true);
    expect(await getAutomationsPaused()).toBe(true);
    await setAutomationsPaused(before);
  });
});
