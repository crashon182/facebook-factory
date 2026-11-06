import { addDaysKey, dayKey, weekdayOfKey } from "@/lib/time/tz";

export const FREQUENCIES = {
  HOURLY: { label: "Cada hora", ms: 3600_000 },
  EVERY_6_HOURS: { label: "Cada 6 horas", ms: 6 * 3600_000 },
  DAILY: { label: "Una vez al día", ms: 24 * 3600_000 },
  WEEKLY: { label: "Una vez por semana", ms: 7 * 24 * 3600_000 },
} as const;
export type Frequency = keyof typeof FREQUENCIES;
export const isFrequency = (v: string): v is Frequency => v in FREQUENCIES;

/** Formatos permitidos por defecto: los que no requieren fotos externas, TTS ni render de video. */
export const DEFAULT_FORMATS = ["TEXT", "QUOTE_IMAGE", "REFLECTION", "INSPIRATIONAL", "EDUCATIONAL", "SHORT_STORY"] as const;

/** Control de frecuencia: ¿pasó el intervalo desde la última generación? (con 1 min de tolerancia por el reloj del planificador) */
export function frequencyDue(freq: string, lastGeneratedAt: Date | null, now: Date): boolean {
  const ms = (isFrequency(freq) ? FREQUENCIES[freq] : FREQUENCIES.DAILY).ms;
  return !lastGeneratedAt || now.getTime() - lastGeneratedAt.getTime() >= ms - 60_000;
}

/** Cantidad de publicaciones que deberían estar preparadas: días de publicación en la ventana × máximo diario. */
export function targetPosts(o: { now: Date; tz: string; daysAhead: number; maxPerDay: number; publishDays?: number[] | null }): number {
  let key = dayKey(o.now, o.tz);
  let days = 0;
  for (let i = 0; i < o.daysAhead; i++, key = addDaysKey(key, 1)) {
    if (o.publishDays?.length && !o.publishDays.includes(weekdayOfKey(key))) continue;
    days++;
  }
  return days * o.maxPerDay;
}

export function neededPosts(target: number, pipeline: number, capPerRun: number) {
  return Math.max(0, Math.min(capPerRun, target - pipeline));
}

/**
 * Elige el formato según los permitidos y la mezcla recomendada por la estrategia, favoreciendo
 * los menos usados recientemente (variedad). Determinista.
 */
export function pickFormat(o: { allowed?: string[] | null; recommended: { format: string; weeklyFrequency: number }[]; recentFormats: string[] }): string {
  const allowed = o.allowed?.length ? o.allowed : [...DEFAULT_FORMATS];
  const weights = new Map(o.recommended.map((r) => [r.format, Math.max(1, r.weeklyFrequency)]));
  const rec = allowed.filter((f) => weights.has(f));
  const pool = rec.length ? rec : allowed;
  let best = pool[0];
  let bestScore = -1;
  for (const f of pool) {
    const used = o.recentFormats.filter((x) => x === f).length;
    const score = (weights.get(f) ?? 1) / (1 + used);
    if (score > bestScore + 1e-9) { best = f; bestScore = score; }
  }
  return best;
}
