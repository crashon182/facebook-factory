import "server-only";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";
import { prisma } from "@/lib/db";
import { estimateCostUsd } from "./pricing";

export const DEFAULT_MODEL = "gpt-5.4-mini";

export class AINotConfiguredError extends Error {
  constructor() {
    super("OpenAI no está configurado: definí OPENAI_API_KEY en el entorno.");
  }
}
export class AIBudgetError extends Error {}
export class AIOutputError extends Error {}

export function isOpenAIConfigured() {
  return !!process.env.OPENAI_API_KEY?.trim();
}
export function getModel() {
  return process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
}

let client: OpenAI | null = null;
function getClient() {
  if (!isOpenAIConfigured()) throw new AINotConfiguredError();
  client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 2, timeout: 120_000 });
  return client;
}

/** Gasto de OpenAI del día (UTC), global o por página. */
export async function spentTodayUsd(pageId?: string): Promise<number> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const r = await prisma.aPIUsageLog.aggregate({
    where: { provider: "openai", createdAt: { gte: start }, ...(pageId ? { pageId } : {}) },
    _sum: { costUsd: true },
  });
  return Number(r._sum.costUsd ?? 0);
}

/** Corta la llamada si se superó el presupuesto diario de la página o el tope global. */
export async function assertBudget(pageId?: string) {
  const globalLimit = Number(process.env.OPENAI_DAILY_LIMIT_USD);
  if (Number.isFinite(globalLimit) && process.env.OPENAI_DAILY_LIMIT_USD?.trim()) {
    const spent = await spentTodayUsd();
    if (spent >= globalLimit) throw new AIBudgetError(`Se alcanzó el tope diario global de OpenAI (USD ${globalLimit}).`);
  }
  if (pageId) {
    const rule = await prisma.automationRule.findUnique({ where: { pageId }, select: { dailyBudgetUsd: true } });
    if (rule) {
      const limit = Number(rule.dailyBudgetUsd);
      const spent = await spentTodayUsd(pageId);
      if (spent >= limit) {
        throw new AIBudgetError(`Se alcanzó el presupuesto diario de generación de esta página (USD ${limit.toFixed(2)}). Podés ajustarlo en su panel de automatización.`);
      }
    }
  }
}

export type StructuredRequest<S extends z.ZodType> = {
  schema: S;
  schemaName: string;
  system: string;
  user: string;
  operation: string;
  pageId?: string;
  maxOutputTokens?: number;
};

export async function generateStructured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<{ data: z.output<S>; costUsd: number; inputTokens: number; outputTokens: number }> {
  const ai = getClient();
  await assertBudget(req.pageId);
  const model = getModel();
  try {
    const res = await ai.responses.parse({
      model,
      input: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
      text: { format: zodTextFormat(req.schema, req.schemaName) },
      max_output_tokens: req.maxOutputTokens ?? 8000,
      store: false,
    });
    const inputTokens = res.usage?.input_tokens ?? 0;
    const outputTokens = res.usage?.output_tokens ?? 0;
    const costUsd = estimateCostUsd(inputTokens, outputTokens);
    await prisma.aPIUsageLog.create({
      data: { pageId: req.pageId ?? null, provider: "openai", operation: req.operation, model, inputTokens, outputTokens, costUsd, success: !!res.output_parsed },
    });
    if (!res.output_parsed) {
      throw new AIOutputError(res.status === "incomplete" ? "La respuesta de la IA quedó incompleta (límite de tokens)." : "La IA no devolvió una salida válida.");
    }
    return { data: res.output_parsed as z.output<S>, costUsd, inputTokens, outputTokens };
  } catch (e) {
    if (e instanceof AIOutputError) throw e;
    await prisma.aPIUsageLog.create({
      data: { pageId: req.pageId ?? null, provider: "openai", operation: req.operation, model, success: false, errorMessage: sanitizeError(e) },
    });
    throw e;
  }
}

/** Mensaje de error apto para registrar: nunca incluye claves. */
export function sanitizeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/sk-[A-Za-z0-9_-]+/g, "sk-***").slice(0, 500);
}

/** Traduce errores del SDK a mensajes para el usuario. */
export function userMessageForError(e: unknown): string {
  if (e instanceof AINotConfiguredError || e instanceof AIBudgetError || e instanceof AIOutputError) return e.message;
  const status = (e as { status?: number })?.status;
  if (status === 401) return "OpenAI rechazó la clave (401). Revisá OPENAI_API_KEY.";
  if (status === 404) return `El modelo «${getModel()}» no está disponible para tu cuenta. Revisá OPENAI_MODEL.`;
  if (status === 429) return "OpenAI limitó las solicitudes o no hay saldo/cuota (429). Probá más tarde o revisá tu facturación.";
  if (status && status >= 500) return "OpenAI tuvo un error temporal. Reintentá en unos minutos.";
  return "No se pudo completar la generación con IA.";
}
