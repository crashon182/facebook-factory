import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { rateLimit } from "@/lib/rate-limit";
import { ensureDir, storageRoot } from "@/lib/storage";
import { MediaError, registerUpload } from "@/lib/services/media";

export const dynamic = "force-dynamic";
const MAX_REQUEST = 320 * 1024 * 1024;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!rateLimit(`upload:${session.user.id}`, 20, 60_000).ok) return NextResponse.json({ error: "Demasiadas subidas seguidas." }, { status: 429 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_REQUEST) return NextResponse.json({ error: "Archivo demasiado grande." }, { status: 413 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const license = String(form?.get("license") ?? "").trim();
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Seleccioná un archivo." }, { status: 400 });
  if (!license) return NextResponse.json({ error: "Indicá la licencia o el origen de los derechos del archivo." }, { status: 400 });

  const tmp = path.join(storageRoot(), "tmp", `upload-${randomUUID()}`);
  await ensureDir(path.dirname(tmp));
  await writeFile(tmp, Buffer.from(await file.arrayBuffer()));
  try {
    // El tipo real se determina con ffprobe dentro de registerUpload (no se confía en la extensión ni en el MIME del cliente).
    const keywords = String(form?.get("keywords") ?? "").split(",").map((k) => k.trim()).filter(Boolean).slice(0, 20);
    const res = await registerUpload(tmp, { originalName: file.name, title: String(form?.get("title") ?? "") || undefined, license: license.slice(0, 2000), keywords });
    return NextResponse.json({ id: res.asset.id, duplicate: res.duplicate });
  } catch (e) {
    if (e instanceof MediaError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[upload]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "No se pudo procesar el archivo." }, { status: 500 });
  }
}
