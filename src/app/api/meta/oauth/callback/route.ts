import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth/auth";
import { publicUrl } from "@/lib/public-url";
import { MetaClient } from "@/lib/integrations/meta/client";
import { describeMetaError } from "@/lib/integrations/meta/errors";
import { OAUTH_COOKIE, readOAuthState } from "@/lib/integrations/meta/oauth-state";
import { logActivity } from "@/lib/services/activity";
import { storePendingPages } from "@/lib/services/meta-connection";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.redirect(publicUrl("/login", req));
  const url = new URL(req.url);
  const jar = await cookies();
  const st = readOAuthState(jar.get(OAUTH_COOKIE)?.value, url.searchParams.get("state"));
  const done = (path: string) => {
    const r = NextResponse.redirect(publicUrl(path, req));
    r.cookies.set(OAUTH_COOKIE, "", { path: "/api/meta/oauth", maxAge: 0 });
    return r;
  };
  if (!st) return done("/paginas?error=oauth_state"); // CSRF o sesión vencida
  const back = `/paginas/${st.pageId}/conectar`;

  if (url.searchParams.get("error")) return done(`${back}?error=denied`);
  const code = url.searchParams.get("code");
  if (!code) return done(`${back}?error=no_code`);

  try {
    const client = MetaClient.fromEnv();
    const short = await client.exchangeCode(code);
    const long = await client.exchangeLongLived(short);
    const pages = await client.listPages(long);
    await storePendingPages(st.pageId, pages);
    return done(`${back}?step=choose`);
  } catch (e) {
    await logActivity({ action: "meta.oauth_failed", level: "ERROR", message: `Falló la conexión con Facebook: ${describeMetaError(e)}`, pageId: st.pageId });
    return done(`${back}?error=exchange`);
  }
}
