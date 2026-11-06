"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { rateLimit } from "@/lib/rate-limit";
import { userMessageForError } from "@/lib/integrations/openai/client";
import { contentFormatEnum, generateRequestSchema } from "@/lib/validation/content";
import * as svc from "@/lib/services/contents";
import type { ActionResult } from "@/lib/action-result";

function fail(e: unknown): { ok: false; error: string; fieldErrors?: Record<string, string[]> } {
  if (e instanceof z.ZodError) return { ok: false, error: "Revisá los campos del formulario", fieldErrors: z.flattenError(e).fieldErrors as Record<string, string[]> };
  if (e instanceof svc.ContentError) return { ok: false, error: e.message };
  if ((e as { code?: string })?.code === "P2025") return { ok: false, error: "El elemento no existe" };
  console.error("[content.action]", e instanceof Error ? e.message : e);
  return { ok: false, error: userMessageForError(e) };
}

const done = (id?: string) => {
  revalidatePath("/contenidos");
  if (id) revalidatePath(`/contenidos/${id}`);
  revalidatePath("/");
};

export async function generateContentAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await requireAdmin();
  if (!rateLimit(`ai:content:${user.id}`, 10, 60_000).ok) return { ok: false, error: "Demasiadas generaciones seguidas. Esperá un minuto." };
  try {
    const id = await svc.generateContent(generateRequestSchema.parse(input));
    done();
    return { ok: true, data: { id } };
  } catch (e) {
    done();
    return fail(e);
  }
}

export async function createDraftAction(pageId: string, format: string): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  try {
    const id = await svc.createDraft(z.string().min(1).parse(pageId), contentFormatEnum.parse(format));
    done();
    return { ok: true, data: { id } };
  } catch (e) {
    return fail(e);
  }
}

export async function saveContentAction(id: string, input: unknown): Promise<ActionResult<null>> {
  await requireAdmin();
  try {
    await svc.updateContent(id, input as never);
    done(id);
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

export async function regenerateContentAction(id: string): Promise<ActionResult<null>> {
  const user = await requireAdmin();
  if (!rateLimit(`ai:content:${user.id}`, 10, 60_000).ok) return { ok: false, error: "Demasiadas generaciones seguidas. Esperá un minuto." };
  try {
    await svc.regenerateContent(id);
    done(id);
    return { ok: true, data: null };
  } catch (e) {
    done(id);
    return fail(e);
  }
}

async function simple(id: string, fn: (id: string) => Promise<unknown>): Promise<ActionResult<null>> {
  await requireAdmin();
  try {
    await fn(id);
    done(id);
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

export async function markReadyAction(id: string) {
  return simple(id, svc.markReady);
}
export async function approveContentAction(id: string, approved: boolean) {
  return simple(id, (i) => svc.setApproved(i, approved));
}
export async function cancelContentAction(id: string) {
  return simple(id, svc.cancelContent);
}
export async function deleteContentAction(id: string) {
  return simple(id, svc.deleteContent);
}
export async function duplicateContentAction(id: string): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  try {
    const copy = await svc.duplicateContent(id);
    done();
    return { ok: true, data: { id: copy } };
  } catch (e) {
    return fail(e);
  }
}
