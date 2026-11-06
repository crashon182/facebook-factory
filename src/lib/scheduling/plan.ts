import { addDaysKey, dayKey, localToUtc, parseDayKey, weekdayOfKey } from "@/lib/time/tz";

const WD: Record<string, number> = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };

export type PlanInput = {
  tz: string;
  now: Date;
  count: number;
  /** Hipótesis de horarios de la estrategia (días + HH:MM local). */
  hypotheses: { days: string[]; timeLocal: string }[];
  windowStart: string; // HH:MM
  windowEnd: string; // HH:MM
  maxPerDay: number;
  /** Días permitidos (0 = domingo); null/vacío = todos. */
  publishDays?: number[] | null;
  /** Publicaciones ya programadas por día local (YYYY-MM-DD). */
  existing?: Record<string, number>;
  minLeadMinutes?: number;
  horizonDays?: number;
};

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const fromMin = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;

/** Horarios candidatos de un día: los de la estrategia dentro de la franja o, si no hay, repartidos uniformemente en la franja. */
export function candidateTimes(weekday: number, i: Pick<PlanInput, "hypotheses" | "windowStart" | "windowEnd" | "maxPerDay">): string[] {
  const ws = toMin(i.windowStart);
  const we = toMin(i.windowEnd);
  const fromStrategy = i.hypotheses
    .filter((h) => h.days.some((d) => WD[d] === weekday) && /^([01]\d|2[0-3]):[0-5]\d$/.test(h.timeLocal))
    .map((h) => toMin(h.timeLocal))
    .filter((t) => t >= ws && t <= we);
  const uniq = [...new Set(fromStrategy)].sort((a, b) => a - b);
  if (uniq.length) return uniq.slice(0, i.maxPerDay).map(fromMin);
  const n = Math.max(1, i.maxPerDay);
  const span = Math.max(0, we - ws);
  return Array.from({ length: n }, (_, k) => fromMin(n === 1 ? ws + Math.round(span / 2) : ws + Math.round((span * k) / (n - 1))));
}

/** Asigna horarios futuros respetando franja, días permitidos y máximo diario. Determinista. */
export function planSlots(i: PlanInput): Date[] {
  const out: Date[] = [];
  const lead = (i.minLeadMinutes ?? 15) * 60_000;
  const earliest = i.now.getTime() + lead;
  const used: Record<string, number> = { ...(i.existing ?? {}) };
  let key = dayKey(i.now, i.tz);
  for (let n = 0; n <= (i.horizonDays ?? 60) && out.length < i.count; n++, key = addDaysKey(key, 1)) {
    const wd = weekdayOfKey(key);
    if (i.publishDays?.length && !i.publishDays.includes(wd)) continue;
    const { y, m, d } = parseDayKey(key);
    for (const t of candidateTimes(wd, i)) {
      if (out.length >= i.count) break;
      if ((used[key] ?? 0) >= i.maxPerDay) break;
      const [h, mi] = t.split(":").map(Number);
      const at = localToUtc({ y, m, d, h, mi }, i.tz);
      if (at.getTime() < earliest) continue;
      out.push(at);
      used[key] = (used[key] ?? 0) + 1;
    }
  }
  return out;
}
