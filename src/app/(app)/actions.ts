"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/session";
import { setAutomationsPaused } from "@/lib/services/settings";
import { logActivity } from "@/lib/services/activity";

export async function toggleGlobalPauseAction(paused: boolean) {
  await requireAdmin();
  await setAutomationsPaused(paused);
  await logActivity({
    action: paused ? "automation.global_paused" : "automation.global_resumed",
    message: paused ? "Todas las automatizaciones fueron pausadas" : "Las automatizaciones fueron reanudadas",
    level: paused ? "WARN" : "INFO",
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}
