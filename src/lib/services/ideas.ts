import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { generateStructured } from "@/lib/integrations/openai/client";
import { buildIdeasPrompt } from "@/lib/prompts/content";
import { DEFAULT_FORMATS } from "@/lib/automation/plan";
import { CONTENT_FORMATS } from "@/lib/validation/strategy";
import { getActiveStrategy } from "./strategies";
import { logActivity } from "./activity";

const ideasSchema = z.object({ ideas: z.array(z.object({ title: z.string(), summary: z.string(), format: z.enum(CONTENT_FORMATS), category: z.string() })) });

/** Genera ideas nuevas con IA (respetando formatos permitidos y evitando títulos ya usados) y las guarda como NEW. */
export async function generateIdeas(pageId: string, count = 5) {
  const page = await prisma.socialPage.findUniqueOrThrow({ where: { id: pageId } });
  const [rule, active, ideas, posts, pillars] = await Promise.all([
    prisma.automationRule.findUnique({ where: { pageId } }),
    getActiveStrategy(pageId),
    prisma.contentIdea.findMany({ where: { pageId }, orderBy: { createdAt: "desc" }, take: 40, select: { title: true } }),
    prisma.contentPost.findMany({ where: { pageId, status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" }, take: 25, select: { internalTitle: true } }),
    prisma.contentPillar.findMany({ where: { pageId }, select: { id: true, name: true } }),
  ]);
  const allowed = Array.isArray(rule?.allowedFormats) && (rule!.allowedFormats as string[]).length ? (rule!.allowedFormats as string[]) : [...DEFAULT_FORMATS];
  const used = new Set([...ideas.map((i) => i.title), ...posts.map((p) => p.internalTitle)].map((t) => t.toLowerCase()));
  const { system, user } = buildIdeasPrompt({ page, strategy: active?.strategy ?? null, count, formats: allowed, recentTitles: [...used].slice(0, 60), rule });
  const { data } = await generateStructured({ schema: ideasSchema, schemaName: "content_ideas", system, user, operation: "ideas.generate", pageId, maxOutputTokens: 3000 });

  const pillarByName = new Map(pillars.map((p) => [p.name.toLowerCase(), p.id]));
  const fresh = data.ideas
    .filter((i) => allowed.includes(i.format) && i.title.trim() && !used.has(i.title.trim().toLowerCase()))
    .slice(0, count);
  if (fresh.length) {
    await prisma.contentIdea.createMany({ data: fresh.map((i) => ({ pageId, pillarId: pillarByName.get(i.category.toLowerCase()) ?? null, title: i.title.trim().slice(0, 190), summary: i.summary, format: i.format })) });
  }
  await logActivity({ action: "ideas.generated", message: `${fresh.length} ideas nuevas para ${page.name}`, pageId });
  return fresh.length;
}
