import { z } from "zod";
import { CONTENT_FORMATS } from "./strategy";

// Salida de la IA (strict-compatible)
export const generatedContentSchema = z.object({
  internalTitle: z.string(),
  topic: z.string(),
  body: z.string(),
  facebookCaption: z.string(),
  script: z.string().nullable(),
  imageText: z.string().nullable(),
  verseReference: z.string().nullable(),
  verseText: z.string().nullable(),
  hashtags: z.array(z.string()),
  imageKeywords: z.array(z.string()),
  scenes: z.array(z.object({ narration: z.string(), visualKeywords: z.array(z.string()) })),
});
export type GeneratedContent = z.infer<typeof generatedContentSchema>;

export const contentFormatEnum = z.enum(CONTENT_FORMATS);

export const generateRequestSchema = z.object({
  pageId: z.string().min(1),
  format: contentFormatEnum,
  topic: z.string().trim().max(300).optional().transform((v) => v || undefined),
  ideaId: z.string().optional(),
});
export type GenerateRequest = z.infer<typeof generateRequestSchema>;

const hashtag = z.string().trim().transform((t) => t.replace(/^#+/, "").replace(/\s+/g, "")).pipe(z.string().min(1).max(60));

export const contentEditSchema = z.object({
  internalTitle: z.string().trim().min(2, "Mínimo 2 caracteres").max(200),
  topic: z.string().trim().max(300).optional().transform((v) => v || null),
  body: z.string().trim().max(10000).optional().transform((v) => v || null),
  facebookCaption: z.string().trim().max(5000).optional().transform((v) => v || null),
  script: z.string().trim().max(10000).optional().transform((v) => v || null),
  verseReference: z.string().trim().max(160).optional().transform((v) => v || null),
  verseText: z.string().trim().max(2000).optional().transform((v) => v || null),
  hashtags: z.array(hashtag).max(30).default([]),
});
export type ContentEditInput = z.input<typeof contentEditSchema>;

export const contentListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  pageId: z.string().optional(),
  status: z.enum(["all", "DRAFT", "GENERATING", "READY", "SCHEDULED", "PUBLISHING", "PUBLISHED", "FAILED", "CANCELLED"]).default("all"),
  format: z.enum(["all", ...CONTENT_FORMATS]).default("all"),
  page: z.coerce.number().int().min(1).default(1),
});
