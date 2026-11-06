import { NextResponse } from "next/server";
import { getMetaConfig } from "@/lib/integrations/meta/config";
import { verifyChallenge, verifySignature } from "@/lib/integrations/meta/webhook";
import { logActivity } from "@/lib/services/activity";

export const dynamic = "force-dynamic";

/** Verificación de suscripción de Meta (hub.challenge). */
export async function GET(req: Request) {
  const challenge = verifyChallenge(new URL(req.url).searchParams, getMetaConfig()?.verifyToken ?? null);
  return challenge === null ? new NextResponse("Forbidden", { status: 403 }) : new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
}

/** Eventos: se valida X-Hub-Signature-256 sobre el cuerpo crudo antes de procesar nada. */
export async function POST(req: Request) {
  const cfg = getMetaConfig();
  if (!cfg) return new NextResponse("Not configured", { status: 503 });
  const raw = await req.text();
  if (raw.length > 1_000_000 || !verifySignature(raw, req.headers.get("x-hub-signature-256"), cfg.appSecret)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }
  try {
    const body = JSON.parse(raw) as { object?: string; entry?: { id?: string; changes?: { field?: string }[] }[] };
    for (const e of (body.entry ?? []).slice(0, 20)) {
      await logActivity({ action: "meta.webhook", message: `Evento de Meta (${body.object ?? "?"}): ${(e.changes ?? []).map((c) => c.field).join(", ") || "sin cambios"}`, metadata: { entryId: e.id ?? null } });
    }
  } catch {
    return new NextResponse("Bad request", { status: 400 });
  }
  return new NextResponse("OK", { status: 200 }); // Meta reintenta si no recibe 200
}
