import "server-only";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { generateStructured, getModel } from "@/lib/integrations/openai/client";
import { buildStrategyPrompt } from "@/lib/prompts/strategy";
import { checkStrategy, strategySchema, type Strategy } from "@/lib/validation/strategy";
import { logActivity } from "./activity";

export class StrategyValidationError extends Error {
  constructor(public issues: string[]) {
    super(issues.join(" "));
  }
}

export async function getActiveStrategy(pageId: string) {
  const row = await prisma.pageStrategy.findFirst({ where: { pageId, status: "ACTIVE" }, orderBy: { version: "desc" } });
  if (!row) return null;
  const parsed = strategySchema.safeParse(row.data);
  return parsed.success ? { ...row, strategy: parsed.data } : null;
}

export function listStrategyVersions(pageId: string) {
  return prisma.pageStrategy.findMany({
    where: { pageId },
    orderBy: { version: "desc" },
    select: { id: true, version: true, status: true, source: true, model: true, notes: true, createdAt: true },
  });
}

/** Sincroniza pilares e ideas iniciales a partir de la estrategia (sin duplicar existentes). */
async function syncDerived(tx: Prisma.TransactionClient, pageId: string, s: Strategy) {
  const pillars = new Map<string, string>();
  for (const [i, c] of s.categories.entries()) {
    const p = await tx.contentPillar.upsert({
      where: { pageId_name: { pageId, name: c.name.slice(0, 190) } },
      create: { pageId, name: c.name.slice(0, 190), description: c.description, keywords: c.keywords, weight: c.weight, sortOrder: i },
      update: { description: c.description, keywords: c.keywords, weight: c.weight, sortOrder: i },
    });
    pillars.set(c.name, p.id);
  }
  const existing = new Set((await tx.contentIdea.findMany({ where: { pageId }, select: { title: true } })).map((i) => i.title.toLowerCase()));
  const fresh = s.initialIdeas.filter((i) => !existing.has(i.title.toLowerCase()));
  if (fresh.length) {
    await tx.contentIdea.createMany({
      data: fresh.map((i) => ({ pageId, pillarId: pillars.get(i.category) ?? null, title: i.title.slice(0, 190), summary: i.summary, format: i.format })),
    });
  }
}

async function saveVersion(pageId: string, strategy: Strategy, source: "AI" | "MANUAL", model: string | null, notes?: string) {
  return prisma.$transaction(async (tx) => {
    const last = await tx.pageStrategy.findFirst({ where: { pageId }, orderBy: { version: "desc" }, select: { version: true } });
    await tx.pageStrategy.updateMany({ where: { pageId, status: "ACTIVE" }, data: { status: "ARCHIVED" } });
    const row = await tx.pageStrategy.create({
      data: { pageId, version: (last?.version ?? 0) + 1, status: "ACTIVE", source, model, notes, data: strategy as unknown as Prisma.InputJsonValue },
    });
    await syncDerived(tx, pageId, strategy);
    return row;
  });
}

export async function generateStrategy(pageId: string) {
  const page = await prisma.socialPage.findUniqueOrThrow({ where: { id: pageId } });
  const current = await getActiveStrategy(pageId);
  const { system, user } = buildStrategyPrompt(page, current?.strategy);
  const { data, costUsd } = await generateStructured({ schema: strategySchema, schemaName: "page_strategy", system, user, operation: "strategy.generate", pageId, maxOutputTokens: 12000 });
  const issues = checkStrategy(data);
  if (issues.length) throw new StrategyValidationError(issues);
  const row = await saveVersion(pageId, data, "AI", getModel(), current ? "Regenerada con IA" : "Generada con IA");
  await logActivity({ action: "strategy.generated", message: `Estrategia v${row.version} generada con IA para ${page.name}`, pageId, entity: "PageStrategy", entityId: row.id, metadata: { costUsd } });
  return row;
}

export async function saveManualStrategy(pageId: string, input: unknown) {
  const parsed = strategySchema.safeParse(input);
  if (!parsed.success) throw new StrategyValidationError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  const issues = checkStrategy(parsed.data);
  if (issues.length) throw new StrategyValidationError(issues);
  const row = await saveVersion(pageId, parsed.data, "MANUAL", null, "Edición manual");
  await logActivity({ action: "strategy.edited", message: `Estrategia v${row.version} guardada manualmente`, pageId, entity: "PageStrategy", entityId: row.id });
  return row;
}

/** Restaura una versión anterior creando una nueva versión (el historial nunca se reescribe). */
export async function restoreStrategyVersion(pageId: string, versionId: string) {
  const old = await prisma.pageStrategy.findFirstOrThrow({ where: { id: versionId, pageId } });
  const parsed = strategySchema.parse(old.data);
  const row = await saveVersion(pageId, parsed, old.source, old.model, `Restaurada desde v${old.version}`);
  await logActivity({ action: "strategy.restored", message: `Estrategia restaurada desde v${old.version} (nueva v${row.version})`, pageId, entity: "PageStrategy", entityId: row.id });
  return row;
}
