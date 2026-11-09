import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Next exige el `matcher` escrito literalmente en proxy.ts (no se puede importar de otro módulo) y importar el proxy
// arrastra next-auth, así que se lee el texto del archivo y se evalúa el patrón tal como lo hace Next.
const src = readFileSync("src/proxy.ts", "utf8");
const literal = /matcher:\s*\["((?:[^"\\]|\\.)*)"\]/.exec(src)?.[1];
const re = new RegExp(`^${JSON.parse(`"${literal}"`)}$`);
const passesThroughProxy = (p: string) => re.test(p);

describe("matcher del proxy", () => {
  it("encuentra el patrón", () => {
    expect(literal).toBeTruthy();
  });
  it("protege las rutas privadas", () => {
    for (const p of ["/", "/paginas", "/paginas/abc/conectar", "/multimedia", "/api/meta/oauth/start", "/api/meta/oauth/callback"]) expect(passesThroughProxy(p), p).toBe(true);
  });
  it("no intercepta rutas públicas ni la subida de archivos (el proxy cortaría el cuerpo a 10 MB)", () => {
    for (const p of ["/api/media/upload", "/api/health", "/api/webhooks/meta", "/api/auth/session", "/legal/mi-pagina/privacidad", "/_next/static/x.js"]) expect(passesThroughProxy(p), p).toBe(false);
  });
});
