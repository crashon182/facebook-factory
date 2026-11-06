import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db";
import { MetaClient } from "@/lib/integrations/meta/client";
import { isMetaConfigured } from "@/lib/integrations/meta/config";
import { createOAuthState, OAUTH_COOKIE } from "@/lib/integrations/meta/oauth-state";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.redirect(new URL("/login", req.url));
  const pageId = new URL(req.url).searchParams.get("pageId") ?? "";
  const page = pageId ? await prisma.socialPage.findUnique({ where: { id: pageId }, select: { id: true } }) : null;
  if (!page) return NextResponse.redirect(new URL("/paginas", req.url));
  if (!isMetaConfigured()) return NextResponse.redirect(new URL(`/paginas/${page.id}/conectar?error=not_configured`, req.url));

  const { state, cookie } = createOAuthState(page.id);
  const res = NextResponse.redirect(MetaClient.fromEnv().authorizeUrl(state));
  res.cookies.set(OAUTH_COOKIE, cookie, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/meta/oauth", maxAge: 600 });
  return res;
}
