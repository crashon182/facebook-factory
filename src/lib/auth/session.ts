import "server-only";
import { redirect } from "next/navigation";
import { auth } from "./auth";

/** Capa de acceso: toda acción de servidor / página protegida debe pasar por aquí. */
export async function requireAdmin() {
  const session = await auth();
  if (!session?.user || (session.user as { role?: string }).role !== "ADMIN") redirect("/login");
  return session.user as { id: string; email?: string | null; name?: string | null; role: string };
}
