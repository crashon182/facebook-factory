import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth/auth.config";

const { auth } = NextAuth(authConfig);

// Next.js 16: el archivo `proxy` reemplaza a `middleware`. Auth.js decide acceso vía callbacks.authorized.
export const proxy = auth;

export const config = {
  // Protege todo salvo assets estáticos, health check y rutas internas de Auth.js
  matcher: ["/((?!api/auth|api/health|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)"],
};
