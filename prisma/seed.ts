import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../src/generated/prisma/client";

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error("Definí ADMIN_EMAIL y ADMIN_PASSWORD en el entorno antes de ejecutar el seed.");
  if (password.length < 12) throw new Error("ADMIN_PASSWORD debe tener al menos 12 caracteres.");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL no definida");

  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL) });
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.upsert({
      where: { email },
      create: { email, name: process.env.ADMIN_NAME || "Administrador", passwordHash, role: "ADMIN" },
      update: { passwordHash, name: process.env.ADMIN_NAME || "Administrador" },
    });
    await prisma.systemSetting.upsert({
      where: { key: "automations.paused" },
      create: { key: "automations.paused", value: false },
      update: {},
    });
    console.log(`✔ Administrador listo: ${email}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
