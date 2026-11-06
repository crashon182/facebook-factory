import type { NextAuthConfig } from "next-auth";

// Configuración compatible con el proxy (sin Prisma ni bcrypt).
export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const isLogged = !!auth?.user;
      const isLogin = request.nextUrl.pathname === "/login";
      if (isLogin) return isLogged ? Response.redirect(new URL("/", request.nextUrl)) : true;
      return isLogged;
    },
    jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.role = (user as { role?: string }).role ?? "ADMIN";
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.uid as string;
        (session.user as { role?: string }).role = token.role as string;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
