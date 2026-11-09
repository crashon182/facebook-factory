/**
 * URL pública para redirecciones. Detrás de Nginx `req.url` trae el origen interno (http://localhost:3007), que el
 * navegador no puede abrir; se usa AUTH_URL (la URL pública configurada) y, si falta, el origen de la petición.
 */
export function publicUrl(path: string, req: Request): URL {
  const base = process.env.AUTH_URL?.trim().replace(/\/+$/, "") || new URL(req.url).origin;
  return new URL(path, base);
}
