import "server-only";
import { prisma } from "@/lib/db";
import { PAGE_SIZE } from "@/lib/constants";
import { slugify } from "@/lib/slug";
import { Prisma } from "@/generated/prisma/client";
import type { AutomationValues, PageFormValues } from "@/lib/validation/page";
import { removePostFiles } from "./contents";
import { logActivity } from "./activity";

export type PageListQuery = {
  q?: string;
  status: "all" | "active" | "inactive";
  connection: "all" | "CONNECTED" | "NOT_CONNECTED" | "EXPIRED" | "ERROR";
  page: number;
};

export async function listPages(query: PageListQuery) {
  const where: Prisma.SocialPageWhereInput = {};
  if (query.q) {
    where.OR = [{ name: { contains: query.q } }, { topic: { contains: query.q } }, { description: { contains: query.q } }];
  }
  if (query.status !== "all") where.isActive = query.status === "active";
  if (query.connection !== "all") where.connectionStatus = query.connection;

  const [total, items] = await Promise.all([
    prisma.socialPage.count({ where }),
    prisma.socialPage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { automation: true, _count: { select: { posts: true } } },
    }),
  ]);
  return { total, items, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export function getPage(id: string) {
  return prisma.socialPage.findUnique({
    where: { id },
    include: {
      automation: true,
      strategies: { orderBy: { version: "desc" }, take: 1 },
      _count: { select: { posts: true, strategies: true, pillars: true } },
    },
  });
}

async function uniqueSlug(name: string, excludeId?: string) {
  const base = slugify(name);
  let slug = base;
  for (let i = 2; i < 100; i++) {
    const existing = await prisma.socialPage.findUnique({ where: { slug } });
    if (!existing || existing.id === excludeId) return slug;
    slug = `${base}-${i}`;
  }
  return `${base}-${Date.now()}`;
}

export async function createPage(values: PageFormValues) {
  const slug = await uniqueSlug(values.name);
  const page = await prisma.socialPage.create({
    data: {
      ...values,
      slug,
      // Cada página nace con su regla de automatización desactivada y con aprobación manual.
      automation: { create: { enabled: false, requireApproval: true, autoPublish: false } },
    },
  });
  await logActivity({ action: "page.created", message: `Página creada: ${page.name}`, pageId: page.id, entity: "SocialPage", entityId: page.id });
  return page;
}

export async function updatePage(id: string, values: PageFormValues) {
  const current = await prisma.socialPage.findUniqueOrThrow({ where: { id } });
  const slug = current.name === values.name ? current.slug : await uniqueSlug(values.name, id);
  const page = await prisma.socialPage.update({
    where: { id },
    data: {
      ...values,
      slug,
      // Campos opcionales vaciados → null
      targetAudience: values.targetAudience ?? null,
      targetCountry: values.targetCountry ?? null,
      tone: values.tone ?? null,
      growthGoals: values.growthGoals ?? null,
      profileImageUrl: values.profileImageUrl ?? null,
      visualIdentity: values.visualIdentity ?? null,
      primaryColor: values.primaryColor ?? null,
      secondaryColor: values.secondaryColor ?? null,
      facebookPageId: values.facebookPageId ?? null,
    },
  });
  await logActivity({ action: "page.updated", message: `Página actualizada: ${page.name}`, pageId: id, entity: "SocialPage", entityId: id });
  return page;
}

export async function deletePage(id: string) {
  const postIds = (await prisma.contentPost.findMany({ where: { pageId: id }, select: { id: true } })).map((p) => p.id);
  const page = await prisma.socialPage.delete({ where: { id } });
  await Promise.all(postIds.map(removePostFiles));
  await logActivity({ action: "page.deleted", message: `Página eliminada: ${page.name}`, level: "WARN", entity: "SocialPage", entityId: id });
}

export async function setPageActive(id: string, isActive: boolean) {
  const page = await prisma.socialPage.update({ where: { id }, data: { isActive } });
  await logActivity({ action: isActive ? "page.activated" : "page.deactivated", message: `${isActive ? "Activada" : "Desactivada"}: ${page.name}`, pageId: id });
}

export async function updateAutomation(pageId: string, v: AutomationValues) {
  const { publishDays, allowedFormats, generationFrequency, ...rest } = v;
  const data = {
    ...rest,
    editorialRestrictions: v.editorialRestrictions || null,
    ...(generationFrequency ? { generationFrequency } : {}),
    ...(publishDays !== undefined ? { publishDays: publishDays.length ? [...new Set(publishDays)].sort() : Prisma.JsonNull } : {}),
    ...(allowedFormats !== undefined ? { allowedFormats: allowedFormats.length ? [...new Set(allowedFormats)] : Prisma.JsonNull } : {}),
  };
  const rule = await prisma.automationRule.upsert({
    where: { pageId },
    create: { pageId, ...data },
    update: data,
  });
  await logActivity({ action: "automation.updated", message: `Automatización ${v.enabled ? "activada" : "desactivada"}`, pageId, entity: "AutomationRule", entityId: rule.id });
  return rule;
}

export async function setPageAutomationEnabled(pageId: string, enabled: boolean) {
  await prisma.automationRule.upsert({
    where: { pageId },
    create: { pageId, enabled },
    update: { enabled },
  });
  await logActivity({ action: enabled ? "automation.enabled" : "automation.disabled", message: `Automatización ${enabled ? "activada" : "pausada"}`, pageId });
}
