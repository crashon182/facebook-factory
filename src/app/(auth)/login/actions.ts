"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth/auth";

export type LoginState = { error?: string };

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/",
    });
    return {};
  } catch (e) {
    if (e instanceof AuthError) return { error: "Credenciales incorrectas o demasiados intentos. Probá de nuevo en unos minutos." };
    throw e; // incluye el redirect de Next
  }
}
