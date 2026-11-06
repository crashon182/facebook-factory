import "server-only";
import { prisma } from "@/lib/db";
import type { ContentFormat } from "@/generated/prisma/client";
import { AIBudgetError, assertBudget, isOpenAIConfigured } from "@/lib/integrations/openai/client";
import { generateContent } from "@/lib/services/contents";
import { generateIdeas } from "@/lib/services/ideas";
import { getActiveStrategy } from "@/lib/services/strategies";
import { autoSchedulePage } from "@/lib/services/scheduling";
import { getAutomationsPaused } from "@/lib/services/settings";
import { logActivity } from "@/lib/services/activity";
import { DEFAULT_FORMATS, frequencyDue, neededPosts, pickFormat, targetPosts } from "./plan";

export const MAX_GENERATIONS_PER_RUN = 3;
const LOCK_MS = 15 * 60_000;
const MAX_CONSECUTIVE_FAILURES = 2;

export type RunSummary = {
  skipped?: string;
  generated: number;
  ideasCreated: number;
  autoApproved: number;
  scheduled: number;
  scheduleSkipped: string[];
  notes: string[];
  needed: number;
  pipeline: number;
  target: number;
};

export type EngineDeps = {
  now: () => Date;
  generateIdeas: typeof generateIdeas;
  generateContent: typeof generateContent;
  assertBudget: typeof assertBudget;
  postprocess: (postId: string) => Promise<void>;
  autoSchedule: typeof autoSchedulePage;
  aiConfigured: () => boolean;
};

const empty = (): RunSummary => ({ generated: 0, ideasCreated: 0, autoApproved: 0, scheduled: 0, scheduleSkipped: [], notes: [], needed: 0, pipeline: 0, target: 0 });

/**
 * Una corrida de automatización para una página. Seguridad:
 *  - se detiene si hay pausa global, la página está inactiva o la regla está desactivada;
 *  - bloqueo por página (UPDATE condicional): dos instancias no corren a la vez;
 *  - nunca supera el presupuesto diario, el máximo por corrida ni los límites de programación;
 *  - con aprobación manual obligatoria, no aprueba ni programa nada por su cuenta.
 */
export async function runPageAutomation(pageId: string, opts: { force?: boolean; deps?: Partial<EngineDeps> } = {}): Promise<RunSummary> {
  const deps: EngineDeps = {
    now: () => new Date(), generateIdeas, generateContent, assertBudget, autoSchedule: autoSchedulePage, aiConfigured: isOpenAIConfigured,
    postprocess: async (id) => { const { enqueuePostprocess } = await import("@/lib/queue/automation-queue"); await enqueuePostprocess(id); },
    ...Object.fromEntries(Object.entries(opts.deps ?? {}).filter(([, v]) => v !== undefined)), // un valor undefined no pisa el predeterminado
  };
  const now = deps.now();
  const out = empty();
  const skip = (reason: string) => ({ ...out, skipped: reason });

  const page = await prisma.socialPage.findUnique({ where: { id: pageId }, include: { automation: true } });
  const rule = page?.automation;
  if (!page || !rule) return skip("La página no existe o no tiene reglas.");
  if (await getAutomationsPaused()) return skip("Pausa global activa.");
  if (!page.isActive) return skip("La página está inactiva.");
  if (!rule.enabled) return skip("La automatización de la página está desactivada.");

  const claim = await prisma.automationRule.updateMany({ where: { pageId, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] }, data: { lockedUntil: new Date(now.getTime() + LOCK_MS) } });
  if (claim.count !== 1) return skip("Ya hay una corrida en curso para esta página.");

  try {
    const allowed = Array.isArray(rule.allowedFormats) && (rule.allowedFormats as string[]).length ? (rule.allowedFormats as string[]) : [...DEFAULT_FORMATS];
    const publishDays = Array.isArray(rule.publishDays) ? (rule.publishDays as number[]) : null;

    // ── Fase 1: generación (sujeta a frecuencia, presupuesto y stock) ──
    const due = opts.force || frequencyDue(rule.generationFrequency, rule.lastGeneratedAt, now);
    if (!due) out.notes.push("Generación omitida por frecuencia configurada.");
    else if (!deps.aiConfigured()) out.notes.push("OpenAI no está configurado: no se genera contenido.");
    else {
      out.pipeline = await prisma.contentPost.count({ where: { pageId, status: { in: ["READY", "SCHEDULED", "GENERATING"] }, OR: [{ scheduledAt: null }, { scheduledAt: { gt: now } }] } });
      out.target = targetPosts({ now, tz: page.timezone, daysAhead: rule.daysAhead, maxPerDay: rule.maxPostsPerDay, publishDays });
      out.needed = neededPosts(out.target, out.pipeline, MAX_GENERATIONS_PER_RUN);
      if (out.needed === 0) out.notes.push(`Stock suficiente (${out.pipeline} de ${out.target} preparados).`);

      if (out.needed > 0) {
        const strat = await getActiveStrategy(pageId);
        const recent = await prisma.contentPost.findMany({ where: { pageId, status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" }, take: 12, select: { format: true } });
        const recentFormats = recent.map((r) => r.format as string);
        let failures = 0;
        let ideasTried = false;

        for (let i = 0; i < out.needed; i++) {
          try {
            await deps.assertBudget(pageId);
          } catch (e) {
            if (e instanceof AIBudgetError) { out.notes.push(e.message); break; }
            throw e;
          }
          const format = pickFormat({ allowed: allowed, recommended: strat?.strategy.recommendedFormats ?? [], recentFormats }) as ContentFormat;
          const nextIdea = async () =>
            (await prisma.contentIdea.findFirst({ where: { pageId, status: "NEW", format }, orderBy: { createdAt: "asc" } })) ??
            (await prisma.contentIdea.findFirst({ where: { pageId, status: "NEW", format: { in: allowed as ContentFormat[] } }, orderBy: { createdAt: "asc" } }));
          let idea = await nextIdea();
          if (!idea && !ideasTried) {
            ideasTried = true;
            try {
              out.ideasCreated += await deps.generateIdeas(pageId, 5);
              idea = await nextIdea();
            } catch (e) {
              out.notes.push(`No se pudieron generar ideas: ${(e as Error).message}`);
            }
          }
          try {
            const useFormat = (idea && allowed.includes(idea.format) ? idea.format : format) as ContentFormat;
            const postId = await deps.generateContent({ pageId, format: useFormat, ideaId: idea?.id });
            out.generated++;
            failures = 0;
            recentFormats.unshift(useFormat);
            const approve = !rule.requireApproval;
            await prisma.contentPost.update({ where: { id: postId }, data: { autoGenerated: true, ...(approve ? { approved: true } : {}) } });
            if (approve) out.autoApproved++;
            await deps.postprocess(postId).catch((e) => out.notes.push(`No se pudo encolar la preparación de medios: ${(e as Error).message}`));
          } catch (e) {
            out.notes.push(`Falló una generación: ${(e as Error).message}`);
            if (++failures >= MAX_CONSECUTIVE_FAILURES) { out.notes.push("Se detiene la corrida tras fallos consecutivos."); break; }
          }
        }
      }
    }

    // ── Fase 2: programación automática (solo si el administrador la habilitó) ──
    if (rule.autoPublish) {
      if (page.connectionStatus !== "CONNECTED") out.notes.push("Publicación automática activa pero la página no está conectada a Facebook.");
      else {
        const r = await deps.autoSchedule(pageId, now);
        out.scheduled = r.scheduled.length;
        out.scheduleSkipped = [...new Set(r.skipped.map((s) => s.reason))];
      }
    }
  } finally {
    await prisma.automationRule.update({ where: { pageId }, data: { lockedUntil: null, lastRunAt: now, ...(out.generated > 0 ? { lastGeneratedAt: now } : {}), lastRunSummary: JSON.parse(JSON.stringify(out)) } });
    await logActivity({
      action: "automation.run", pageId, level: out.notes.some((n) => /Falló|detiene/.test(n)) ? "WARN" : "INFO",
      message: `Automatización: ${out.generated} generados, ${out.autoApproved} auto-aprobados, ${out.scheduled} programados${out.notes.length ? ` — ${out.notes[0]}` : ""}`,
      metadata: JSON.parse(JSON.stringify(out)),
    });
  }
  return out;
}
