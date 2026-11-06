"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { getProvider } from "@/lib/integrations/media";
import { MediaProviderError, MediaProviderNotConfiguredError, MediaRateLimitError, type MediaCandidate, type MediaSearchResult } from "@/lib/integrations/media/types";
import { DownloadError, UnsafeUrlError } from "@/lib/net/safe-fetch";
import { deleteAsset, importCandidate, MediaError } from "@/lib/services/media";
import type { ActionResult } from "@/lib/action-result";

const searchSchema = z.object({
  provider: z.string().min(1).max(40).default("pexels"),
  language: z.string().max(5).optional(),
  query: z.string().trim().min(2, "Escribí al menos 2 caracteres").max(100),
  kind: z.enum(["photo", "video"]),
  orientation: z.enum(["portrait", "landscape", "square"]).optional(),
  quality: z.enum(["small", "medium", "large"]).optional(),
  page: z.number().int().min(1).max(50).default(1),
});

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof z.ZodError) return { ok: false, error: z.prettifyError(e) };
  if (e instanceof MediaRateLimitError) return { ok: false, error: e.retryAfterSec ? `${e.message} (en ~${Math.ceil(e.retryAfterSec / 60)} min)` : e.message };
  if (e instanceof MediaProviderNotConfiguredError || e instanceof MediaProviderError || e instanceof MediaError) return { ok: false, error: e.message };
  if (e instanceof UnsafeUrlError || e instanceof DownloadError) return { ok: false, error: `Descarga rechazada: ${e.message}` };
  console.error("[media.action]", e instanceof Error ? e.message : e);
  return { ok: false, error: "Ocurrió un error inesperado" };
}

export async function searchMediaAction(input: unknown): Promise<ActionResult<MediaSearchResult>> {
  const user = await requireAdmin();
  if (!rateLimit(`media:search:${user.id}`, 40, 60_000).ok) return { ok: false, error: "Demasiadas búsquedas seguidas. Esperá un momento." };
  try {
    const p = searchSchema.parse(input);
    const provider = getProvider(p.provider);
    if (!provider) throw new MediaProviderError("Proveedor desconocido.");
    if (!provider.isConfigured()) throw new MediaProviderNotConfiguredError(`${provider.name} (falta su API key en el entorno)`);
    const result = await provider.search(p);
    await prisma.aPIUsageLog.create({ data: { provider: provider.id, operation: `search.${p.kind}`, costUsd: 0 } });
    return { ok: true, data: result };
  } catch (e) {
    return fail(e);
  }
}

const candidateSchema = z.object({
  provider: z.string().min(1).max(40),
  externalId: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  kind: z.enum(["photo", "video"]),
  title: z.string().max(300).nullable(),
  previewUrl: z.string().max(1024),
  downloadUrl: z.string().url().max(2048),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  durationSec: z.number().nullable(),
  author: z.string().max(200).nullable(),
  authorUrl: z.string().max(1024).nullable(),
  sourceUrl: z.string().max(1024),
  license: z.string().max(2000),
});

export async function importMediaAction(candidate: unknown): Promise<ActionResult<{ id: string; duplicate: boolean }>> {
  await requireAdmin();
  try {
    const c = candidateSchema.parse(candidate) as MediaCandidate;
    const { asset, duplicate } = await importCandidate(c);
    revalidatePath("/multimedia");
    return { ok: true, data: { id: asset.id, duplicate } };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteAssetAction(id: string): Promise<ActionResult<null>> {
  await requireAdmin();
  try {
    await deleteAsset(z.string().min(1).parse(id));
    revalidatePath("/multimedia");
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}
