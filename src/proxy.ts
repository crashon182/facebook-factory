import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth/auth.config";

const { auth } = NextAuth(authConfig);

// Next.js 16: el archivo `proxy` reemplaza a `middleware`. Auth.js decide acceso vía callbacks.authorized.
export const proxy = auth;

export const config = {
  // Protege todo salvo assets estáticos, health check, rutas internas de Auth.js, las páginas legales públicas (/legal/...) que Meta necesita y la subida de archivos (/api/media/upload): el proxy copia el cuerpo en memoria y lo corta a los 10 MB, lo que rompía las subidas grandes; esa ruta valida la sesión por su cuenta
  matcher: ["/((?!api/auth|api/health|api/webhooks|api/media/upload|legal/|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)"],
};
