import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { publicUrl } from "@/lib/public-url";
import { prisma } from "@/lib/db";
import { MetaClient } from "@/lib/integrations/meta/client";
import { isMetaConfigured } from "@/lib/integrations/meta/config";
import { createOAuthState, OAUTH_COOKIE } from "@/lib/integrations/meta/oauth-state";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.redirect(publicUrl("/login", req));
  const pageId = new URL(req.url).searchParams.get("pageId") ?? "";
  const page = pageId ? await prisma.socialPage.findUnique({ where: { id: pageId }, select: { id: true } }) : null;
  if (!page) return NextResponse.redirect(publicUrl("/paginas", req));
  if (!isMetaConfigured()) return NextResponse.redirect(publicUrl(`/paginas/${page.id}/conectar?error=not_configured`, req));

  const { state, cookie } = createOAuthState(page.id);
  const res = NextResponse.redirect(MetaClient.fromEnv().authorizeUrl(state));
  res.cookies.set(OAUTH_COOKIE, cookie, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/meta/oauth", maxAge: 600 });
  return res;
}
