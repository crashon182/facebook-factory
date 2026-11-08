// Cálculos de analíticas puros (sin base de datos ni red): fáciles de probar y de razonar.
import { utcToLocalParts } from "@/lib/time/tz";

export type PostSample = {
  id: string;
  title: string;
  format: string;
  publishedAt: Date;
  reach: number | null;
  views: number | null;
  engagements: number | null;
};

/** Tasa de interacción = interacciones / alcance (o vistas si no hay alcance). `null` si no hay denominador confiable. */
export function engagementRate(p: Pick<PostSample, "reach" | "views" | "engagements">): number | null {
  if (p.engagements == null) return null;
  const denom = p.reach && p.reach > 0 ? p.reach : p.views && p.views > 0 ? p.views : 0;
  return denom > 0 ? p.engagements / denom : null;
}

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export type ScoredPost = PostSample & { rate: number | null; /** 1 = igual a la mediana de la página; 2 = el doble. */ index: number | null };

/**
 * Indicador normalizado: la tasa de interacción de cada publicación dividida por la mediana de la página.
 * Permite comparar páginas de tamaños muy distintos y formatos entre sí. Con menos de `minPosts` muestras no se normaliza.
 */
export function scorePosts(posts: PostSample[], minPosts = 3): ScoredPost[] {
  const rates = posts.map(engagementRate);
  const base = rates.filter((r): r is number => r != null);
  const med = base.length >= minPosts ? median(base) : null;
  return posts.map((p, i) => {
    const rate = rates[i];
    return { ...p, rate, index: rate != null && med != null && med > 0 ? rate / med : null };
  });
}

export type Bucket = { key: string; n: number; avgIndex: number };

function groupAvg(items: { key: string; index: number }[]): Bucket[] {
  const m = new Map<string, number[]>();
  for (const it of items) m.set(it.key, [...(m.get(it.key) ?? []), it.index]);
  return [...m.entries()].map(([key, xs]) => ({ key, n: xs.length, avgIndex: mean(xs)! })).sort((a, b) => b.avgIndex - a.avgIndex);
}

/** Rendimiento promedio por formato (solo publicaciones con índice). */
export function formatPerformance(scored: ScoredPost[]): Bucket[] {
  return groupAvg(scored.flatMap((p) => (p.index == null ? [] : [{ key: p.format, index: p.index }])));
}

/** Rendimiento por hora local de publicación (0-23). */
export function hourPerformance(scored: ScoredPost[], tz: string): Bucket[] {
  return groupAvg(scored.flatMap((p) => (p.index == null ? [] : [{ key: String(utcToLocalParts(p.publishedAt, tz).h), index: p.index }])));
}

/** Rendimiento por día de la semana local (0 = domingo). */
export function weekdayPerformance(scored: ScoredPost[], tz: string): Bucket[] {
  return groupAvg(
    scored.flatMap((p) => {
      if (p.index == null) return [];
      const l = utcToLocalParts(p.publishedAt, tz);
      return [{ key: String(new Date(Date.UTC(l.y, l.m - 1, l.d)).getUTCDay()), index: p.index }];
    }),
  );
}

/**
 * Hora "óptima" local como promedio ponderado: cada hora pesa por `n * max(avgIndex, 0)`, solo entre horas con al menos
 * `minPerHour` muestras. Devuelve `null` si no hay datos suficientes para recomendar algo.
 */
export function bestHour(hours: Bucket[], opts: { minPerHour?: number; minTotal?: number; topK?: number } = {}): number | null {
  const { minPerHour = 2, minTotal = 8, topK = 3 } = opts;
  const total = hours.reduce((a, h) => a + h.n, 0);
  if (total < minTotal) return null;
  const top = hours.filter((h) => h.n >= minPerHour).slice(0, topK);
  if (top.length === 0) return null;
  const w = top.map((h) => h.n * Math.max(h.avgIndex, 0));
  const sum = w.reduce((a, b) => a + b, 0);
  if (sum <= 0) return null;
  return top.reduce((acc, h, i) => acc + Number(h.key) * w[i], 0) / sum;
}

/** Variación porcentual entre dos períodos (null si el anterior es 0 o no existe). */
export function pctChange(curr: number | null, prev: number | null): number | null {
  if (curr == null || prev == null || prev === 0) return null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

// ───────────── Franja horaria ─────────────

export const MIN_WINDOW_HOUR = 6;  // nunca proponer publicar antes de las 06:00
export const MAX_WINDOW_HOUR = 23; // ni después de las 23:00
export const MAX_SHIFT_MIN = 60;   // ajuste gradual: como máximo 1 hora por experimento

export const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
export const fromMin = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/**
 * Propone desplazar la franja de publicación hacia la mejor hora, conservando su ancho y sin pasar de `MAX_SHIFT_MIN`.
 * No toca el máximo de publicaciones por día ni ningún otro límite. Devuelve `null` si no hace falta cambiar nada.
 */
export function proposeWindowShift(window: { windowStart: string; windowEnd: string }, best: number | null): { windowStart: string; windowEnd: string; shiftMin: number } | null {
  if (best == null) return null;
  const start = toMin(window.windowStart);
  const end = toMin(window.windowEnd);
  if (end <= start) return null;
  const center = (start + end) / 2;
  const diff = best * 60 + 30 - center; // la hora "h" cubre h:00-h:59, su centro es h:30
  if (Math.abs(diff) < 60) return null; // dentro de la franja actual: no vale la pena mover
  let shift = Math.sign(diff) * Math.min(MAX_SHIFT_MIN, Math.round(Math.abs(diff) / 15) * 15);
  const lo = MIN_WINDOW_HOUR * 60;
  const hi = MAX_WINDOW_HOUR * 60;
  if (start + shift < lo) shift = lo - start;
  if (end + shift > hi) shift = hi - end;
  if (shift === 0) return null;
  return { windowStart: fromMin(start + shift), windowEnd: fromMin(end + shift), shiftMin: shift };
}

export type Verdict = "better" | "worse" | "neutral" | "insufficient";

/** Compara la tasa de interacción antes/después de un cambio. `worseBy` = caída relativa que obliga a revertir. */
export function judgeExperiment(before: number[], after: number[], opts: { minEach?: number; worseBy?: number; betterBy?: number } = {}): { verdict: Verdict; beforeAvg: number | null; afterAvg: number | null; changePct: number | null } {
  const { minEach = 3, worseBy = 0.15, betterBy = 0.1 } = opts;
  const beforeAvg = mean(before);
  const afterAvg = mean(after);
  if (before.length < minEach || after.length < minEach || beforeAvg == null || afterAvg == null || beforeAvg <= 0) {
    return { verdict: "insufficient", beforeAvg, afterAvg, changePct: null };
  }
  const change = (afterAvg - beforeAvg) / beforeAvg;
  const verdict: Verdict = change <= -worseBy ? "worse" : change >= betterBy ? "better" : "neutral";
  return { verdict, beforeAvg, afterAvg, changePct: change * 100 };
}
