"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { describeMetaError } from "@/lib/integrations/meta/errors";
import { isMetaConfigured } from "@/lib/integrations/meta/config";
import { ConnectionError, connectPendingPage, disconnectPage, verifyConnection } from "@/lib/services/meta-connection";
import type { ActionResult } from "@/lib/action-result";

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof ConnectionError) return { ok: false, error: e.message };
  if ((e as { code?: string })?.code === "P2002") return { ok: false, error: "Esa Página de Facebook ya está conectada a otra página de trabajo." };
  console.error("[meta.action]", e instanceof Error ? e.message : e);
  return { ok: false, error: describeMetaError(e) };
}
const done = (id: string) => { revalidatePath(`/paginas/${id}`); revalidatePath(`/paginas/${id}/conectar`); revalidatePath("/paginas"); revalidatePath("/"); };

export async function connectFacebookPageAction(pageId: string, fbPageId: string): Promise<ActionResult<{ name: string | null }>> {
  await requireAdmin();
  try {
    const p = await connectPendingPage(z.string().min(1).parse(pageId), z.string().regex(/^\d{5,25}$/).parse(fbPageId));
    done(pageId);
    return { ok: true, data: { name: p.facebookPageName } };
  } catch (e) {
    return fail(e);
  }
}

export async function disconnectFacebookPageAction(pageId: string): Promise<ActionResult<null>> {
  await requireAdmin();
  try {
    await disconnectPage(pageId);
    done(pageId);
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

export async function verifyFacebookConnectionAction(pageId: string): Promise<ActionResult<{ name: string }>> {
  await requireAdmin();
  if (!isMetaConfigured()) return { ok: false, error: "Meta no está configurado (META_APP_ID / META_APP_SECRET)." };
  try {
    const r = await verifyConnection(pageId);
    done(pageId);
    return r.ok ? { ok: true, data: { name: r.name } } : { ok: false, error: r.expired ? "El token venció o fue revocado: reconectá la página." : r.error };
  } catch (e) {
    return fail(e);
  }
}
