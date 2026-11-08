import type { NextAuthConfig } from "next-auth";

// Configuración compatible con el proxy (sin Prisma ni bcrypt).
export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const isLogged = !!auth?.user;
      const { pathname, search, origin } = request.nextUrl;
      // Detrás de Nginx el origen interno trae el puerto de la app (p. ej. :3007) y las redirecciones salían a una URL
      // inalcanzable. Usamos la URL pública (AUTH_URL) para construirlas.
      const base = process.env.AUTH_URL?.trim().replace(/\/+$/, "") || origin;
      if (pathname === "/login") return isLogged ? Response.redirect(new URL("/", base)) : true;
      if (isLogged) return true;
      const login = new URL("/login", base);
      login.searchParams.set("callbackUrl", new URL(pathname + search, base).href);
      return Response.redirect(login);
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
