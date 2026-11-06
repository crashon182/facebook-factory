"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/session";
import { rateLimit } from "@/lib/rate-limit";
import { userMessageForError } from "@/lib/integrations/openai/client";
import { generateStrategy, restoreStrategyVersion, saveManualStrategy, StrategyValidationError } from "@/lib/services/strategies";
import type { ActionResult } from "@/lib/action-result";

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof StrategyValidationError) return { ok: false, error: `Estrategia inválida: ${e.issues.slice(0, 4).join(" · ")}` };
  console.error("[strategy.action]", e instanceof Error ? e.message : e);
  return { ok: false, error: userMessageForError(e) };
}

export async function generateStrategyAction(pageId: string): Promise<ActionResult<{ version: number }>> {
  const user = await requireAdmin();
  if (!rateLimit(`ai:strategy:${user.id}`, 6, 60_000).ok) return { ok: false, error: "Demasiadas generaciones seguidas. Esperá un minuto." };
  try {
    const row = await generateStrategy(pageId);
    revalidatePath(`/paginas/${pageId}`);
    revalidatePath("/");
    return { ok: true, data: { version: row.version } };
  } catch (e) {
    return fail(e);
  }
}

export async function saveStrategyAction(pageId: string, input: unknown): Promise<ActionResult<{ version: number }>> {
  await requireAdmin();
  try {
    const row = await saveManualStrategy(pageId, input);
    revalidatePath(`/paginas/${pageId}`);
    return { ok: true, data: { version: row.version } };
  } catch (e) {
    return fail(e);
  }
}

export async function restoreStrategyAction(pageId: string, versionId: string): Promise<ActionResult<{ version: number }>> {
  await requireAdmin();
  try {
    const row = await restoreStrategyVersion(pageId, versionId);
    revalidatePath(`/paginas/${pageId}`);
    return { ok: true, data: { version: row.version } };
  } catch (e) {
    return fail(e);
  }
}
