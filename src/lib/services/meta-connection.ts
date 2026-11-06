import "server-only";
import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { MetaClient, type MetaPage } from "@/lib/integrations/meta/client";
import { describeMetaError, MetaApiError } from "@/lib/integrations/meta/errors";
import { logActivity } from "./activity";

export class ConnectionError extends Error {}

const PENDING_KEY = "meta.pending";
const PENDING_TTL_MS = 15 * 60_000;
type Pending = { expiresAt: number; socialPageId: string; pages: { id: string; name: string; category: string | null; tasks: string[]; tokenEnc: string }[] };

/** Guarda (cifrados) los tokens de las Páginas obtenidas por OAuth hasta que el administrador elija cuál conectar. */
export async function storePendingPages(socialPageId: string, pages: MetaPage[]) {
  const value: Pending = { expiresAt: Date.now() + PENDING_TTL_MS, socialPageId, pages: pages.map((p) => ({ id: p.id, name: p.name, category: p.category, tasks: p.tasks, tokenEnc: encryptSecret(p.accessToken) })) };
  await prisma.systemSetting.upsert({ where: { key: PENDING_KEY }, create: { key: PENDING_KEY, value }, update: { value } });
}

async function loadPending(socialPageId: string): Promise<Pending | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: PENDING_KEY } });
  const v = row?.value as Pending | undefined;
  if (!v || v.socialPageId !== socialPageId || v.expiresAt < Date.now()) return null;
  return v;
}

/** Lista las Páginas disponibles (sin tokens). */
export async function listPendingPages(socialPageId: string) {
  const p = await loadPending(socialPageId);
  return p ? p.pages.map(({ id, name, category, tasks }) => ({ id, name, category, tasks, canPublish: tasks.length === 0 || tasks.includes("CREATE_CONTENT") })) : [];
}

export async function connectPendingPage(socialPageId: string, fbPageId: string) {
  const pending = await loadPending(socialPageId);
  const chosen = pending?.pages.find((p) => p.id === fbPageId);
  if (!pending || !chosen) throw new ConnectionError("La sesión de conexión venció. Volvé a iniciar «Conectar con Facebook».");
  if (chosen.tasks.length > 0 && !chosen.tasks.includes("CREATE_CONTENT")) {
    throw new ConnectionError("Tu usuario no tiene la tarea CREATE_CONTENT en esa Página, necesaria para publicar.");
  }
  const clash = await prisma.socialPage.findFirst({ where: { facebookPageId: fbPageId, id: { not: socialPageId } }, select: { name: true } });
  if (clash) throw new ConnectionError(`Esa Página de Facebook ya está conectada a «${clash.name}».`);
  const page = await prisma.socialPage.update({
    where: { id: socialPageId },
    data: { facebookPageId: chosen.id, facebookPageName: chosen.name, accessTokenEnc: chosen.tokenEnc, connectionStatus: "CONNECTED", connectedAt: new Date(), lastCheckedAt: new Date(), tokenExpiresAt: null },
  });
  await prisma.systemSetting.delete({ where: { key: PENDING_KEY } }).catch(() => {});
  await logActivity({ action: "meta.connected", message: `Página de Facebook conectada: ${chosen.name}`, pageId: socialPageId, entity: "SocialPage", entityId: socialPageId });
  return page;
}

export async function disconnectPage(socialPageId: string) {
  const active = await prisma.publicationSchedule.count({ where: { pageId: socialPageId, status: { in: ["SCHEDULED", "PUBLISHING"] } } });
  if (active > 0) throw new ConnectionError(`Hay ${active} publicación(es) programada(s). Cancelalas antes de desconectar la Página.`);
  await prisma.socialPage.update({ where: { id: socialPageId }, data: { accessTokenEnc: null, connectionStatus: "NOT_CONNECTED", connectedAt: null, tokenExpiresAt: null, facebookPageName: null } });
  await logActivity({ action: "meta.disconnected", message: "Página de Facebook desconectada", level: "WARN", pageId: socialPageId, entity: "SocialPage", entityId: socialPageId });
}

export function getPageToken(page: { accessTokenEnc: string | null }): string | null {
  return page.accessTokenEnc ? decryptSecret(page.accessTokenEnc) : null;
}

/** Comprueba con Meta que el token siga siendo válido y actualiza el estado de conexión. */
export async function verifyConnection(socialPageId: string, client: MetaClient = MetaClient.fromEnv()) {
  const page = await prisma.socialPage.findUniqueOrThrow({ where: { id: socialPageId } });
  const token = getPageToken(page);
  if (!page.facebookPageId || !token) throw new ConnectionError("La página no está conectada a Facebook.");
  try {
    const info = await client.getPage(page.facebookPageId, token);
    await prisma.socialPage.update({ where: { id: socialPageId }, data: { connectionStatus: "CONNECTED", facebookPageName: info.name, lastCheckedAt: new Date() } });
    return { ok: true as const, name: info.name };
  } catch (e) {
    const auth = e instanceof MetaApiError && e.kind === "auth";
    await prisma.socialPage.update({ where: { id: socialPageId }, data: { connectionStatus: auth ? "EXPIRED" : "ERROR", lastCheckedAt: new Date() } });
    await logActivity({ action: "meta.verify_failed", message: `Verificación de conexión falló: ${describeMetaError(e)}`, level: "WARN", pageId: socialPageId });
    return { ok: false as const, error: describeMetaError(e), expired: auth };
  }
}
