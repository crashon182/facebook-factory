import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { rateLimit, resetRateLimit } from "@/lib/rate-limit";
import { authConfig } from "./auth.config";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1).max(200),
});

// Hash válido de contraseña inexistente: iguala el tiempo de respuesta cuando el usuario no existe.
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", 12);

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        const key = `login:${email}`;
        if (!(await rateLimit(key, 5, 15 * 60 * 1000)).ok) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
        if (!user || !valid) return null;

        await resetRateLimit(key);
        return { id: user.id, email: user.email, name: user.name, role: user.role } as never;
      },
    }),
  ],
});
