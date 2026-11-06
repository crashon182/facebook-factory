import { createWriteStream } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import dns from "node:dns";
import https from "node:https";
import net from "node:net";
import type { LookupAddress } from "node:dns";
import { ensureDir } from "@/lib/storage";
import path from "node:path";

export class UnsafeUrlError extends Error {}
export class DownloadError extends Error {}

/** IPs que nunca deben alcanzarse desde descargas externas (protección SSRF). */
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === "::" || l === "::1") return true;
    if (l.startsWith("::ffff:")) return isPrivateIp(l.slice(7));
    return l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe8") || l.startsWith("fe9") || l.startsWith("fea") || l.startsWith("feb") || l.startsWith("ff");
  }
  return true;
}

export function hostAllowed(host: string, allowed: string[]) {
  const h = host.toLowerCase();
  return allowed.some((a) => h === a || h.endsWith("." + a));
}

/** Valida esquema, credenciales, puerto y host permitido. No resuelve DNS (eso se fija al conectar). */
export function assertSafeUrl(raw: string, allowedHosts: string[]): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new UnsafeUrlError("URL inválida");
  }
  if (u.protocol !== "https:") throw new UnsafeUrlError("Solo se permiten URLs https");
  if (u.username || u.password) throw new UnsafeUrlError("La URL no puede incluir credenciales");
  if (u.port && u.port !== "443") throw new UnsafeUrlError("Puerto no permitido");
  if (net.isIP(u.hostname)) throw new UnsafeUrlError("No se permiten IPs literales");
  if (!hostAllowed(u.hostname, allowedHosts)) throw new UnsafeUrlError(`Host no permitido: ${u.hostname}`);
  return u;
}

/** `lookup` que rechaza IPs privadas: la conexión queda fijada a la IP validada (anti DNS-rebinding). */
const safeLookup: typeof dns.lookup = ((hostname: string, options: unknown, cb: unknown) => {
  const callback = (typeof options === "function" ? options : cb) as (err: Error | null, addr?: string | LookupAddress[], family?: number) => void;
  const opts = (typeof options === "object" && options ? options : {}) as dns.LookupOptions;
  dns.lookup(hostname, { ...opts, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = addresses as LookupAddress[];
    const bad = list.find((a) => isPrivateIp(a.address));
    if (bad || list.length === 0) return callback(new UnsafeUrlError("El host resuelve a una dirección no permitida"));
    if (opts.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}) as typeof dns.lookup;

export type DownloadResult = { bytes: number; sha256: string; contentType: string | null };

/**
 * Descarga una URL permitida a `destPath` con: https, lista de hosts, IP pública,
 * hasta 3 redirecciones revalidadas, límite de tamaño y de tiempo. Escribe a un archivo temporal y renombra.
 */
export async function safeDownload(rawUrl: string, destPath: string, opts: { allowedHosts: string[]; maxBytes: number; timeoutMs?: number; accept?: RegExp }): Promise<DownloadResult> {
  await ensureDir(path.dirname(destPath));
  const part = destPath + ".part";
  let url = rawUrl;
  try {
    for (let hop = 0; hop <= 3; hop++) {
      const u = assertSafeUrl(url, opts.allowedHosts);
      const result = await new Promise<{ redirect?: string; data?: DownloadResult }>((resolve, reject) => {
        const req = https.get(u, { lookup: safeLookup, timeout: opts.timeoutMs ?? 120_000, headers: { "User-Agent": "FacebookFactory/1.0" } }, (res) => {
          const status = res.statusCode ?? 0;
          if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
            res.resume();
            return resolve({ redirect: new URL(res.headers.location, u).toString() });
          }
          if (status !== 200) {
            res.resume();
            return reject(new DownloadError(`La descarga respondió ${status}`));
          }
          const ct = res.headers["content-type"] ?? null;
          if (opts.accept && !(ct && opts.accept.test(ct))) {
            res.resume();
            return reject(new DownloadError(`Tipo de contenido no permitido: ${ct ?? "desconocido"}`));
          }
          const declared = Number(res.headers["content-length"] ?? 0);
          if (declared > opts.maxBytes) {
            res.resume();
            return reject(new DownloadError("El archivo supera el tamaño máximo permitido"));
          }
          const hash = createHash("sha256");
          const out = createWriteStream(part);
          let bytes = 0;
          res.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            hash.update(chunk);
            if (bytes > opts.maxBytes) {
              res.destroy(new DownloadError("El archivo supera el tamaño máximo permitido"));
            }
          });
          res.on("error", (e) => { out.destroy(); reject(e); });
          res.pipe(out);
          out.on("finish", () => resolve({ data: { bytes, sha256: hash.digest("hex"), contentType: ct } }));
          out.on("error", reject);
        });
        req.on("timeout", () => req.destroy(new DownloadError("Tiempo de espera agotado en la descarga")));
        req.on("error", reject);
      });
      if (result.data) {
        await rename(part, destPath);
        return result.data;
      }
      url = result.redirect!;
    }
    throw new DownloadError("Demasiadas redirecciones");
  } catch (e) {
    await rm(part, { force: true }).catch(() => {});
    throw e;
  }
}
