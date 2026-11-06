import { z } from "zod";

// Formatos de contenido (espejo del enum ContentFormat de Prisma)
export const CONTENT_FORMATS = ["TEXT", "IMAGE", "QUOTE_IMAGE", "REEL", "REFLECTION", "EDUCATIONAL", "INSPIRATIONAL", "SHORT_STORY"] as const;
export const WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;

// Todos los campos son obligatorios y sin refinamientos: es compatible con salidas estructuradas "strict" de OpenAI.
// Las reglas de negocio extra se verifican en `checkStrategy`.
export const strategySchema = z.object({
  editorialDescription: z.string(),
  targetAudience: z.string(),
  tone: z.string(),
  categories: z.array(z.object({ name: z.string(), description: z.string(), keywords: z.array(z.string()), weight: z.number().int() })),
  mainThemes: z.array(z.string()),
  keywords: z.array(z.string()),
  visualStyle: z.string(),
  recommendedFormats: z.array(z.object({ format: z.enum(CONTENT_FORMATS), rationale: z.string(), weeklyFrequency: z.number().int() })),
  initialIdeas: z.array(z.object({ title: z.string(), summary: z.string(), format: z.enum(CONTENT_FORMATS), category: z.string() })),
  editorialCalendar: z.array(z.object({ weekday: z.enum(WEEKDAYS), format: z.enum(CONTENT_FORMATS), category: z.string(), note: z.string() })),
  postingTimeHypotheses: z.array(z.object({ days: z.array(z.enum(WEEKDAYS)), timeLocal: z.string(), rationale: z.string() })),
  measurableGoals: z.array(z.object({ metric: z.string(), target: z.string(), horizonDays: z.number().int() })),
  repetitionRules: z.array(z.string()),
  engagementRecommendations: z.array(z.string()),
  caveats: z.string(),
});
export type Strategy = z.infer<typeof strategySchema>;

/** Reglas adicionales (no expresables en el esquema strict). Devuelve la lista de problemas. */
export function checkStrategy(s: Strategy): string[] {
  const issues: string[] = [];
  if (s.editorialDescription.trim().length < 20) issues.push("La descripción editorial es demasiado corta.");
  if (s.categories.length < 1) issues.push("Debe haber al menos una categoría de contenido.");
  if (s.initialIdeas.length < 1) issues.push("Debe haber al menos una idea inicial.");
  if (s.recommendedFormats.length < 1) issues.push("Debe haber al menos un formato recomendado.");
  for (const c of s.categories) if (c.weight < 1 || c.weight > 10) issues.push(`Peso fuera de rango (1–10) en la categoría «${c.name}».`);
  for (const h of s.postingTimeHypotheses) if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(h.timeLocal)) issues.push(`Horario inválido «${h.timeLocal}» (usar HH:MM).`);
  return issues;
}
