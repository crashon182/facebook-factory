// Utilidades de zona horaria sin dependencias (Intl). Las fechas se guardan en UTC y se muestran en la zona de cada página.
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    fmtCache.set(tz, f);
  }
  return f;
}

export type LocalParts = { y: number; m: number; d: number; h: number; mi: number; s: number };

export function utcToLocalParts(date: Date, tz: string): LocalParts {
  const o: Record<string, number> = {};
  for (const p of fmt(tz).formatToParts(date)) if (p.type !== "literal") o[p.type] = Number(p.value);
  return { y: o.year, m: o.month, d: o.day, h: o.hour === 24 ? 0 : o.hour, mi: o.minute, s: o.second };
}

/** Desfase (ms) de la zona respecto de UTC en ese instante. */
export function tzOffsetMs(date: Date, tz: string): number {
  const p = utcToLocalParts(date, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(date.getTime() / 1000) * 1000;
}

/** Hora local de una zona → instante UTC. Horas inexistentes (salto de DST) pasan a la hora válida siguiente. */
export function localToUtc(p: { y: number; m: number; d: number; h?: number; mi?: number }, tz: string): Date {
  const guess = Date.UTC(p.y, p.m - 1, p.d, p.h ?? 0, p.mi ?? 0, 0);
  const off1 = tzOffsetMs(new Date(guess), tz);
  let t = guess - off1;
  const off2 = tzOffsetMs(new Date(t), tz);
  if (off2 !== off1) t = guess - off2;
  return new Date(t);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" del día local. */
export function dayKey(date: Date, tz: string): string {
  const p = utcToLocalParts(date, tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

export function parseDayKey(key: string): { y: number; m: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) throw new Error("Fecha inválida");
  const r = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  const t = new Date(Date.UTC(r.y, r.m - 1, r.d));
  if (t.getUTCFullYear() !== r.y || t.getUTCMonth() !== r.m - 1 || t.getUTCDate() !== r.d) throw new Error("Fecha inválida");
  return r;
}

export function addDaysKey(key: string, n: number): string {
  const { y, m, d } = parseDayKey(key);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** 0 = domingo … 6 = sábado. */
export function weekdayOfKey(key: string): number {
  const { y, m, d } = parseDayKey(key);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Inicio (00:00 local) de un día de calendario, como instante UTC. */
export function startOfDayUtc(key: string, tz: string): Date {
  return localToUtc(parseDayKey(key), tz);
}

/** Valor para <input type="datetime-local"> en la zona dada: YYYY-MM-DDTHH:mm */
export function toLocalInput(date: Date, tz: string): string {
  const p = utcToLocalParts(date, tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}

/** Valor de <input type="datetime-local"> interpretado en `tz` → UTC. */
export function parseLocalInput(value: string, tz: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) throw new Error("Fecha y hora inválidas");
  parseDayKey(`${m[1]}-${m[2]}-${m[3]}`);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  if (h > 23 || mi > 59) throw new Error("Fecha y hora inválidas");
  return localToUtc({ y: Number(m[1]), m: Number(m[2]), d: Number(m[3]), h, mi }, tz);
}

export function formatInTz(date: Date, tz: string, opts: Intl.DateTimeFormatOptions = { dateStyle: "short", timeStyle: "short" }) {
  return new Intl.DateTimeFormat("es-AR", { timeZone: tz, ...opts }).format(date);
}

export function isValidTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Sugerencia por defecto para programar: mañana a esta hora (redondeada a la hora en punto), en la zona dada. */
export function suggestedLocalInput(tz: string, now: Date = new Date()): string {
  const t = new Date(now.getTime() + 24 * 3600_000);
  t.setUTCMinutes(0, 0, 0);
  return toLocalInput(t, tz);
}
