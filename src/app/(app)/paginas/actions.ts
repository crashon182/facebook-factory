"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { automationSchema, pageFormSchema, type PageFormInput } from "@/lib/validation/page";
import * as pagesService from "@/lib/services/pages";

export type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

function fail(e: unknown): { ok: false; error: string; fieldErrors?: Record<string, string[]> } {
  if (e instanceof z.ZodError) {
    return { ok: false, error: "Revisá los campos del formulario", fieldErrors: z.flattenError(e).fieldErrors as Record<string, string[]> };
  }
  const code = (e as { code?: string })?.code;
  if (code === "P2002") return { ok: false, error: "Ya existe una página con ese Facebook Page ID" };
  if (code === "P2025") return { ok: false, error: "La página no existe" };
  console.error("[pages.action]", e);
  return { ok: false, error: "Ocurrió un error inesperado" };
}

export async function savePageAction(id: string | null, input: PageFormInput): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  try {
    const values = pageFormSchema.parse(input);
    const page = id ? await pagesService.updatePage(id, values) : await pagesService.createPage(values);
    revalidatePath("/paginas");
    revalidatePath("/");
    return { ok: true, data: { id: page.id } };
  } catch (e) {
    return fail(e);
  }
}

export async function deletePageAction(id: string): Promise<ActionResult<null>> {
  await requireAdmin();
  try {
    await pagesService.deletePage(z.string().min(1).parse(id));
    revalidatePath("/paginas");
    revalidatePath("/");
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

export async function setPageActiveAction(id: string, isActive: boolean): Promise<ActionResult<null>> {
  await requireAdmin();
  try {
    await pagesService.setPageActive(id, isActive);
    revalidatePath("/paginas");
    revalidatePath(`/paginas/${id}`);
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

export async function setPageAutomationAction(pageId: string, enabled: boolean): Promise<ActionResult<null>> {
  await requireAdmin();
  try {
    await pagesService.setPageAutomationEnabled(pageId, enabled);
    revalidatePath("/paginas");
    revalidatePath(`/paginas/${pageId}`);
    revalidatePath("/");
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

export async function saveAutomationAction(pageId: string, input: unknown): Promise<ActionResult<null>> {
  await requireAdmin();
  try {
    await pagesService.updateAutomation(pageId, automationSchema.parse(input));
    revalidatePath(`/paginas/${pageId}`);
    revalidatePath("/");
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}
