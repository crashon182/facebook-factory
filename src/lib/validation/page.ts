import { z } from "zod";
import { CONTENT_FORMATS } from "./strategy";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Color hexadecimal inválido (ej. #4f46e5)")
  .optional()
  .or(z.literal("").transform(() => undefined));

const httpsUrl = z
  .string()
  .trim()
  .max(1024)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "https:" || u.protocol === "http:";
    } catch {
      return false;
    }
  }, "URL inválida")
  .optional()
  .or(z.literal("").transform(() => undefined));

export const pageFormSchema = z.object({
  name: z.string().trim().min(2, "Mínimo 2 caracteres").max(120),
  description: z.string().trim().min(10, "Describí la página (mínimo 10 caracteres)").max(2000),
  topic: z.string().trim().min(2, "Indicá la temática").max(160),
  targetAudience: optionalText(1000),
  language: z.string().trim().min(2).max(8).default("es"),
  targetCountry: optionalText(80),
  timezone: z.string().trim().min(3).max(64).refine(isValidTimezone, "Zona horaria inválida"),
  tone: optionalText(200),
  growthGoals: optionalText(2000),
  profileImageUrl: httpsUrl,
  visualIdentity: optionalText(2000),
  primaryColor: hexColor,
  secondaryColor: hexColor,
  isActive: z.boolean().default(true),
  facebookPageId: z
    .string()
    .trim()
    .regex(/^\d{5,25}$/, "El Page ID de Facebook es numérico")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export type PageFormInput = z.input<typeof pageFormSchema>;
export type PageFormValues = z.output<typeof pageFormSchema>;

function isValidTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const automationSchema = z.object({
  enabled: z.boolean(),
  maxPostsPerDay: z.number().int().min(1).max(20),
  requireApproval: z.boolean(),
  autoPublish: z.boolean(),
  autoOptimizeTimes: z.boolean(),
  daysAhead: z.number().int().min(1).max(30),
  dailyBudgetUsd: z.number().min(0).max(1000),
  windowStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  windowEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  editorialRestrictions: z.string().trim().max(2000).optional(),
  generationFrequency: z.enum(["HOURLY", "EVERY_6_HOURS", "DAILY", "WEEKLY"]).optional(),
  /** 0 = domingo … 6 = sábado; vacío = todos los días */
  publishDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  /** vacío = formatos por defecto (los que no requieren fotos externas ni video) */
  allowedFormats: z.array(z.enum(CONTENT_FORMATS)).optional(),
});
export type AutomationValues = z.infer<typeof automationSchema>;

export const listQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["all", "active", "inactive"]).default("all"),
  connection: z.enum(["all", "CONNECTED", "NOT_CONNECTED", "EXPIRED", "ERROR"]).default("all"),
  page: z.coerce.number().int().min(1).default(1),
});
