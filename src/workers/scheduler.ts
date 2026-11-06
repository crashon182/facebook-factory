// Planificador de tareas. Proceso independiente (UNA instancia recomendada): `npm run scheduler`.
// Registra los "job schedulers" de BullMQ de forma idempotente: aunque por error corran varias instancias,
// existe una sola definición de cada tarea periódica en Redis, así que no se duplican las ejecuciones.
import "dotenv/config";
import { ensureAutomationSchedulers, getAutomationQueue } from "@/lib/queue/automation-queue";
import { ensureDueScanner, getPublishQueue } from "@/lib/queue/publish-queue";
import { getRenderQueue } from "@/lib/queue/render-queue";
import { startHeartbeat } from "@/lib/queue/heartbeat";

const stopHeartbeat = startHeartbeat("scheduler");

async function register() {
  try {
    await ensureAutomationSchedulers();
    await ensureDueScanner();
  } catch (e) {
    console.error("[scheduler] no se pudo registrar:", (e as Error).message);
  }
}

console.log("[scheduler] iniciando");
void register().then(() => console.log("[scheduler] tareas periódicas registradas"));
// Auto-reparación: si Redis se vacía o reinicia sin persistencia, se vuelven a registrar.
const t = setInterval(register, 60_000);

async function shutdown() {
  clearInterval(t);
  await stopHeartbeat();
  await Promise.all([getAutomationQueue().close(), getPublishQueue().close(), getRenderQueue().close()]);
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
