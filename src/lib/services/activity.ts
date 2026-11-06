import "server-only";
import { prisma } from "@/lib/db";
import type { LogLevel, Prisma } from "@/generated/prisma/client";

export async function logActivity(input: {
  action: string;
  message: string;
  level?: LogLevel;
  pageId?: string | null;
  entity?: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
}) {
  await prisma.activityLog.create({
    data: {
      action: input.action,
      message: input.message,
      level: input.level ?? "INFO",
      pageId: input.pageId ?? null,
      entity: input.entity,
      entityId: input.entityId,
      metadata: input.metadata,
    },
  });
}
