import { describe, expect, it } from "vitest";
import { estimateCostUsd, getPricing } from "@/lib/integrations/openai/pricing";
import { canTransition, isDeletable, isEditable } from "@/lib/services/content-status";
import { checkStrategy, strategySchema, type Strategy } from "@/lib/validation/strategy";
import { contentEditSchema } from "@/lib/validation/content";
import { hashBody } from "@/lib/services/contents";
import { buildContentPrompt } from "@/lib/prompts/content";

export const validStrategy: Strategy = {
  editorialDescription: "Página de reflexiones cristianas para fortalecer la fe cada día.",
  targetAudience: "Adultos de 25 a 55 años", tone: "Cálido", visualStyle: "Paisajes suaves", caveats: "Hipótesis a validar con datos.",
  categories: [{ name: "Fe diaria", description: "Reflexiones", keywords: ["fe"], weight: 5 }],
  mainThemes: ["Esperanza"], keywords: ["fe"],
  recommendedFormats: [{ format: "QUOTE_IMAGE", rationale: "Se comparte fácil", weeklyFrequency: 3 }],
  initialIdeas: [{ title: "Confiar en la espera", summary: "Reflexión", format: "REFLECTION", category: "Fe diaria" }],
  editorialCalendar: [{ weekday: "MON", format: "TEXT", category: "Fe diaria", note: "" }],
  postingTimeHypotheses: [{ days: ["MON"], timeLocal: "08:30", rationale: "Antes del trabajo" }],
  measurableGoals: [{ metric: "Seguidores", target: "+500", horizonDays: 90 }],
  repetitionRules: ["No repetir versículos en 60 días"], engagementRecommendations: ["Preguntas abiertas"],
};

describe("costos", () => {
  it("sin precios el costo es 0", () => {
    expect(getPricing({} as NodeJS.ProcessEnv)).toBeNull();
    expect(estimateCostUsd(1000, 1000, null)).toBe(0);
  });
  it("calcula con precios por millón", () => {
    const p = getPricing({ OPENAI_PRICE_INPUT_PER_1M: "1", OPENAI_PRICE_OUTPUT_PER_1M: "4" } as unknown as NodeJS.ProcessEnv);
    expect(estimateCostUsd(500_000, 250_000, p)).toBeCloseTo(1.5);
  });
  it("ignora precios inválidos", () => {
    expect(getPricing({ OPENAI_PRICE_INPUT_PER_1M: "abc", OPENAI_PRICE_OUTPUT_PER_1M: "4" } as unknown as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe("máquina de estados", () => {
  it("permite el flujo normal y bloquea saltos", () => {
    expect(canTransition("DRAFT", "READY")).toBe(true);
    expect(canTransition("GENERATING", "READY")).toBe(true);
    expect(canTransition("PUBLISHED", "DRAFT")).toBe(false);
    expect(canTransition("PUBLISHED", "CANCELLED")).toBe(false);
    expect(canTransition("DRAFT", "PUBLISHED")).toBe(false);
  });
  it("no deja editar ni borrar lo programado o publicado", () => {
    for (const s of ["SCHEDULED", "PUBLISHING", "PUBLISHED", "GENERATING"] as const) {
      expect(isEditable(s)).toBe(false);
      expect(isDeletable(s)).toBe(false);
    }
    expect(isEditable("READY")).toBe(true);
  });
});

describe("estrategia", () => {
  it("una estrategia válida pasa esquema y reglas", () => {
    expect(strategySchema.safeParse(validStrategy).success).toBe(true);
    expect(checkStrategy(validStrategy)).toEqual([]);
  });
  it("detecta problemas de negocio", () => {
    const bad = { ...validStrategy, categories: [], postingTimeHypotheses: [{ days: ["MON" as const], timeLocal: "25:99", rationale: "x" }] };
    const issues = checkStrategy(bad);
    expect(issues.some((i) => i.includes("categoría"))).toBe(true);
    expect(issues.some((i) => i.includes("Horario"))).toBe(true);
    expect(checkStrategy({ ...validStrategy, categories: [{ ...validStrategy.categories[0], weight: 99 }] }).length).toBeGreaterThan(0);
  });
});

describe("contenido", () => {
  it("normaliza hashtags y vacíos", () => {
    const r = contentEditSchema.parse({ internalTitle: "Título", hashtags: ["#Fe", " esperanza ", "mi tag"], topic: "" });
    expect(r.hashtags).toEqual(["Fe", "esperanza", "mitag"]);
    expect(r.topic).toBeNull();
  });
  it("el hash ignora mayúsculas, signos y espacios", () => {
    expect(hashBody("¡Hola,   Mundo!")).toBe(hashBody("hola mundo"));
    expect(hashBody("a")).not.toBe(hashBody("b"));
  });
  it("el prompt incluye restricciones y contenidos recientes", () => {
    const { system, user } = buildContentPrompt({
      page: { name: "P", topic: "T", description: "D", language: "es" } as never, strategy: validStrategy, format: "REEL",
      recent: [{ internalTitle: "Ya publicado", topic: "x" }], rule: { editorialRestrictions: "Sin política" } as never,
    });
    expect(system).toContain("scenes");
    expect(user).toContain("Sin política");
    expect(user).toContain("Ya publicado");
  });
});
