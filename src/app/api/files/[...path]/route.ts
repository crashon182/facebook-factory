import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { auth } from "@/lib/auth/auth";
import { MIME_BY_EXT, PUBLIC_DIRS, resolveInStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Sirve archivos del almacenamiento solo a administradores autenticados, con soporte de Range (reproductor de video). */
export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const session = await auth();
  if (!session?.user) return new Response("No autorizado", { status: 401 });

  const parts = (await params).path;
  if (!parts.length || !(PUBLIC_DIRS as readonly string[]).includes(parts[0]) || parts.some((p) => p === ".." || p.includes("\0"))) {
    return new Response("No encontrado", { status: 404 });
  }
  let abs: string;
  try {
    abs = resolveInStorage(parts.join("/"));
  } catch {
    return new Response("No encontrado", { status: 404 });
  }
  const type = MIME_BY_EXT[path.extname(abs).toLowerCase()];
  if (!type) return new Response("No encontrado", { status: 404 });
  const st = await stat(abs).catch(() => null);
  if (!st?.isFile()) return new Response("No encontrado", { status: 404 });

  const headers: Record<string, string> = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": "inline",
  };
  const range = req.headers.get("range");
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : st.size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : st.size - 1;
    start = Math.max(0, start);
    end = Math.min(end, st.size - 1);
    if (start > end || start >= st.size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${st.size}` } });
    return new Response(Readable.toWeb(createReadStream(abs, { start, end })) as ReadableStream, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${st.size}`, "Content-Length": String(end - start + 1) },
    });
  }
  return new Response(Readable.toWeb(createReadStream(abs)) as ReadableStream, { headers: { ...headers, "Content-Length": String(st.size) } });
}
