import { addDaysKey, parseDayKey, startOfDayUtc, weekdayOfKey } from "@/lib/time/tz";

export const VIEWS = ["month", "week", "day", "list"] as const;
export type CalendarView = (typeof VIEWS)[number];

/** Lunes del día dado (la semana empieza en lunes). */
export function weekStartKey(key: string): string {
  const wd = weekdayOfKey(key); // 0 = domingo
  return addDaysKey(key, -((wd + 6) % 7));
}

export function monthGrid(key: string): { weeks: { key: string; inMonth: boolean }[][]; first: string; last: string } {
  const { y, m } = parseDayKey(key);
  const first = `${y}-${String(m).padStart(2, "0")}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const lastOfMonth = addDaysKey(next, -1);
  const start = weekStartKey(first);
  const weeks: { key: string; inMonth: boolean }[][] = [];
  let cur = start;
  while (cur <= lastOfMonth || weeks.length === 0 || weeks.at(-1)!.length < 7) {
    const week = Array.from({ length: 7 }, (_, i) => {
      const k = addDaysKey(cur, i);
      return { key: k, inMonth: k.slice(0, 7) === first.slice(0, 7) };
    });
    weeks.push(week);
    cur = addDaysKey(cur, 7);
    if (cur > lastOfMonth) break;
  }
  return { weeks, first, last: lastOfMonth };
}

/** Rango [from, to) de días de calendario que cubre una vista. */
export function viewRange(view: CalendarView, key: string): { fromKey: string; toKey: string } {
  if (view === "month") {
    const g = monthGrid(key);
    return { fromKey: g.weeks[0][0].key, toKey: addDaysKey(g.weeks.at(-1)![6].key, 1) };
  }
  if (view === "week") {
    const s = weekStartKey(key);
    return { fromKey: s, toKey: addDaysKey(s, 7) };
  }
  if (view === "day") return { fromKey: key, toKey: addDaysKey(key, 1) };
  return { fromKey: key, toKey: addDaysKey(key, 31) }; // lista: 30 días desde la fecha
}

export function viewRangeUtc(view: CalendarView, key: string, tz: string) {
  const { fromKey, toKey } = viewRange(view, key);
  return { from: startOfDayUtc(fromKey, tz), to: startOfDayUtc(toKey, tz), fromKey, toKey };
}

/** Fecha anterior/siguiente según la vista. */
export function shiftKey(view: CalendarView, key: string, dir: -1 | 1): string {
  if (view === "month") {
    const { y, m } = parseDayKey(key);
    const t = new Date(Date.UTC(y, m - 1 + dir, 1));
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-01`;
  }
  return addDaysKey(key, dir * (view === "week" ? 7 : view === "day" ? 1 : 30));
}

export function isViewKey(v: string | undefined): v is CalendarView {
  return !!v && (VIEWS as readonly string[]).includes(v);
}
