import { describe, expect, it } from "vitest";
import { pageFormSchema, automationSchema } from "@/lib/validation/page";
import { slugify } from "@/lib/slug";
import { rateLimit } from "@/lib/rate-limit";

const base = { name: "Citas Bíblicas", description: "Reflexiones diarias de fe", topic: "Fe", timezone: "America/Bogota" };

describe("pageFormSchema", () => {
  it("acepta datos mínimos y normaliza vacíos", () => {
    const r = pageFormSchema.parse({ ...base, tone: "", facebookPageId: "", primaryColor: "" });
    expect(r.tone).toBeUndefined();
    expect(r.facebookPageId).toBeUndefined();
    expect(r.language).toBe("es");
    expect(r.isActive).toBe(true);
  });
  it("rechaza zona horaria, color y Page ID inválidos", () => {
    expect(pageFormSchema.safeParse({ ...base, timezone: "Mars/Olympus" }).success).toBe(false);
    expect(pageFormSchema.safeParse({ ...base, primaryColor: "rojo" }).success).toBe(false);
    expect(pageFormSchema.safeParse({ ...base, facebookPageId: "abc" }).success).toBe(false);
  });
  it("rechaza URLs con esquemas peligrosos", () => {
    expect(pageFormSchema.safeParse({ ...base, profileImageUrl: "javascript:alert(1)" }).success).toBe(false);
  });
});

describe("automationSchema", () => {
  const ok = { enabled: true, maxPostsPerDay: 2, requireApproval: true, autoPublish: false, autoOptimizeTimes: false, daysAhead: 3, dailyBudgetUsd: 1, windowStart: "09:00", windowEnd: "21:00" };
  it("valida límites", () => {
    expect(automationSchema.safeParse(ok).success).toBe(true);
    expect(automationSchema.safeParse({ ...ok, maxPostsPerDay: 100 }).success).toBe(false);
    expect(automationSchema.safeParse({ ...ok, windowStart: "25:00" }).success).toBe(false);
  });
});

describe("utilidades", () => {
  it("slugify quita acentos", () => expect(slugify("Reflexiones para la Vida!")).toBe("reflexiones-para-la-vida"));
  it("rateLimit bloquea al exceder", () => {
    const k = `t-${Math.random()}`;
    for (let i = 0; i < 3; i++) expect(rateLimit(k, 3, 1000).ok).toBe(true);
    expect(rateLimit(k, 3, 1000).ok).toBe(false);
  });
});
