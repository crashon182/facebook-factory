import "server-only";
import { prisma } from "@/lib/db";
import { SETTING_KEYS } from "@/lib/constants";

export async function getAutomationsPaused(): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEYS.automationsPaused } });
  return row?.value === true;
}

export async function setAutomationsPaused(paused: boolean) {
  await prisma.systemSetting.upsert({
    where: { key: SETTING_KEYS.automationsPaused },
    create: { key: SETTING_KEYS.automationsPaused, value: paused },
    update: { value: paused },
  });
}
